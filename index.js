require('dotenv').config();
const { Client, GatewayIntentBits, Partials, Collection, EmbedBuilder, ChannelType, PermissionFlagsBits, REST, Routes } = require('discord.js');
const { addXp, addCoins } = require('./data/store');
const cfg = require('./data/config');
const fs = require('fs');
const path = require('path');
const cron = require('node-cron');
const http = require('http');

// ── Startup token validation ──────────────────────────────────────────────────
const TOKEN = process.env.DISCORD_TOKEN;
if (!TOKEN || TOKEN.trim() === '') {
  console.error('❌ DISCORD_TOKEN is not set. Add it to your environment variables (Railway → Variables) and redeploy.');
  process.exit(1);
}
if (TOKEN.split('.').length !== 3) {
  console.error('❌ DISCORD_TOKEN looks malformed (expected 3 parts separated by dots). Copy a fresh token from Discord Developer Portal → Bot → Reset Token, paste it into Railway → Variables → DISCORD_TOKEN, and redeploy.');
  process.exit(1);
}

// Keep-alive server so UptimeRobot can ping this bot
http.createServer((req, res) => {
  res.writeHead(200);
  res.end('Bot is alive!');
}).listen(process.env.PORT || 3000, () => {
  console.log('✅ Keep-alive server running');
});

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildVoiceStates,
  ],
  partials: [
    Partials.Message,
    Partials.Channel,
    Partials.Reaction,
    Partials.User,
    Partials.GuildMember,
  ],
});

client.commands = new Collection();
client.warnings = new Map();
const tempVoiceChannels = new Set(); // track temp voice channel IDs
const xpCooldowns = new Map();       // prevent XP spam

const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter((f) => f.endsWith('.js'));

const slashCommandsJson = [];
for (const file of commandFiles) {
  const command = require(path.join(commandsPath, file));
  client.commands.set(command.data.name, command);
  slashCommandsJson.push(command.data.toJSON());
}

// ── Auto-register slash commands on startup ──────────────────────────────────
async function registerSlashCommands(applicationId) {
  try {
    const rest = new REST().setToken(TOKEN);
    console.log(`⏳ Registering ${slashCommandsJson.length} slash commands with Discord...`);
    await rest.put(Routes.applicationCommands(applicationId), { body: slashCommandsJson });
    console.log(`✅ Successfully registered ${slashCommandsJson.length} slash commands.`);
  } catch (err) {
    console.error('❌ Failed to register slash commands:', err.message);
  }
}

// ── Daily gaming tips ─────────────────────────────────────────────────────────
const dailyTips = [
  '🎯 Warm up before ranked — even 10 minutes in aim trainers makes a difference!',
  '😴 Sleep is the best performance booster. A well-rested mind plays sharper.',
  '📺 Watch your replays — you learn more from losses than wins.',
  '🔇 Mute toxic players immediately. A calm mind plays better.',
  '💧 Stay hydrated while gaming. Dehydration slows reaction time.',
  '🧠 Focus on one game at a time — mastering mechanics beats playing many games casually.',
  '⏰ Take a 5-minute break every hour to avoid fatigue and tilt.',
  '🎮 Lower your sensitivity and relearn — consistency beats speed.',
  '🔊 Use headphones — sound cues reveal enemies before you see them.',
  '📊 Track your stats to see where you actually need improvement.',
];

// ── Daily questions ───────────────────────────────────────────────────────────
const dailyQuestions = [
  '🎮 What game are you playing most this week?',
  '🏆 What is your biggest gaming achievement so far?',
  '🔥 Which game has the best storyline you have ever played?',
  '😤 What is your most frustrating gaming moment ever?',
  '🎯 What is a game you are currently trying to get better at?',
  '👾 If you could only play one game for a year, what would it be?',
  '🌍 What game world would you want to live in?',
  '🕹️ What was the first game you ever played?',
  '🤝 Do you prefer playing solo or with a team?',
  '🎲 What is the most underrated game you have ever played?',
  '💀 What game has the hardest boss you have ever faced?',
  '🎵 Which game has the best soundtrack?',
];

client.once('clientReady', async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);

  // Auto-register slash commands every startup
  await registerSlashCommands(client.application.id);

  // Daily tip at 10am UTC
  cron.schedule('0 10 * * *', () => {
    const tip = dailyTips[Math.floor(Math.random() * dailyTips.length)];
    client.guilds.cache.forEach((guild) => {
      const channel =
        guild.channels.cache.find((c) => c.name === '🤖bot-commands' && c.isTextBased()) ??
        guild.channels.cache.find((c) => c.name === '💬general' && c.isTextBased()) ??
        guild.channels.cache.find((c) => c.isTextBased() && c.permissionsFor(guild.members.me).has('SendMessages'));

      if (channel) {
        const embed = new EmbedBuilder()
          .setColor(0x10b981)
          .setTitle('💡 Daily Gaming Tip')
          .setDescription(tip)
          .setFooter({ text: 'Use /tip for more tips anytime!' })
          .setTimestamp();
        channel.send({ embeds: [embed] }).catch(console.error);
      }
    });
  });

  // Daily question at 12pm UTC
  cron.schedule('0 12 * * *', () => {
    const question = dailyQuestions[Math.floor(Math.random() * dailyQuestions.length)];
    client.guilds.cache.forEach((guild) => {
      const channel =
        guild.channels.cache.find((c) => c.name === '💬general' && c.isTextBased()) ??
        guild.channels.cache.find((c) => c.isTextBased() && c.permissionsFor(guild.members.me).has('SendMessages'));

      if (channel) {
        const embed = new EmbedBuilder()
          .setColor(0x6366f1)
          .setTitle('❓ Daily Question')
          .setDescription(question)
          .setFooter({ text: 'Drop your answer in the chat!' })
          .setTimestamp();
        channel.send({ embeds: [embed] }).catch(console.error);
      }
    });
  });

  // Weekend game night reminder (Friday 6pm UTC)
  cron.schedule('0 18 * * 5', () => {
    client.guilds.cache.forEach((guild) => {
      const channel =
        guild.channels.cache.find((c) => c.name === '📣announcements' && c.isTextBased()) ??
        guild.channels.cache.find((c) => c.name === '💬general' && c.isTextBased());

      if (channel) {
        const embed = new EmbedBuilder()
          .setColor(0xf59e0b)
          .setTitle('🎮 It\'s the Weekend!')
          .setDescription("Friday night is here — time to game! 🕹️\nJump in a voice channel and let's play. Use `/wouldyourather` or `/8ball` to get the party started!")
          .setTimestamp();
        channel.send({ embeds: [embed] }).catch(console.error);
      }
    });
  });
});

// ── Welcome new members ───────────────────────────────────────────────────────
client.on('guildMemberAdd', async (member) => {
  // Apply auto-role if configured
  const autoRoleId = cfg.get(member.guild.id, 'autorole');
  if (autoRoleId) {
    const role = member.guild.roles.cache.get(autoRoleId);
    if (role) await member.roles.add(role).catch(console.error);
  }

  const channel =
    member.guild.channels.cache.find((c) => c.name === '👋welcome' && c.isTextBased()) ??
    member.guild.channels.cache.find((c) => c.name === '💬general' && c.isTextBased());

  if (!channel) return;

  const embed = new EmbedBuilder()
    .setColor(0x22c55e)
    .setTitle('👋 Welcome to the Server!')
    .setDescription(`Hey ${member}, welcome to **${member.guild.name}**! Glad to have you here. 🎮`)
    .addFields(
      { name: '📜 Get Started', value: 'Check out #📜rules and grab your roles in #🗺️roles.' },
      { name: '💬 Say Hi', value: 'Introduce yourself in #💬general!' },
      { name: '🎮 Play Together', value: 'Jump in a voice channel and game with us!' }
    )
    .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
    .setFooter({ text: `Member #${member.guild.memberCount}` })
    .setTimestamp();

  channel.send({ embeds: [embed] }).catch(console.error);
});

// ── XP & Coins on message ────────────────────────────────────────────────────
const LEVEL_ROLES = {
  5:  '🎮 Gamer',
  10: '💜 Elite',
  20: '🏆 Legend',
};

client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.guild) return;

  const cooldownKey = `${message.guild.id}-${message.author.id}`;
  if (xpCooldowns.has(cooldownKey)) return;
  xpCooldowns.set(cooldownKey, true);
  setTimeout(() => xpCooldowns.delete(cooldownKey), 60_000);

  const xpGain = Math.floor(Math.random() * 11) + 15;
  const coinGain = Math.floor(Math.random() * 6) + 5;
  const result = addXp(message.guild.id, message.author.id, xpGain);
  addCoins(message.guild.id, message.author.id, coinGain);

  if (result.leveledUp) {
    const levelChannel =
      message.guild.channels.cache.find((c) => c.name === '📈levels' && c.isTextBased()) ??
      message.channel;

    const embed = new EmbedBuilder()
      .setColor(0xf59e0b)
      .setTitle('⭐ Level Up!')
      .setDescription(`${message.author} reached **Level ${result.level}**! 🎉`)
      .setTimestamp();

    levelChannel.send({ embeds: [embed] }).catch(() => {});

    const rewardRole = LEVEL_ROLES[result.level];
    if (rewardRole) {
      const role = message.guild.roles.cache.find((r) => r.name === rewardRole);
      if (role) {
        await message.member.roles.add(role).catch(() => {});
        levelChannel.send({
          content: `🎁 ${message.author} unlocked the **${rewardRole}** role for reaching Level ${result.level}!`
        }).catch(() => {});
      }
    }
  }
});

// ── Temporary voice channels ──────────────────────────────────────────────────
client.on('voiceStateUpdate', async (oldState, newState) => {
  const CREATE_CHANNEL_NAME = '➕ Create a Room';

  // User joined the "Create a Room" channel
  if (newState.channel && newState.channel.name === CREATE_CHANNEL_NAME) {
    const guild = newState.guild;
    const member = newState.member;
    const category = newState.channel.parent;

    const tempChannel = await guild.channels.create({
      name: `🎮 ${member.user.username}'s Room`,
      type: ChannelType.GuildVoice,
      parent: category,
      permissionOverwrites: [
        {
          id: member.id,
          allow: [PermissionFlagsBits.ManageChannels, PermissionFlagsBits.MoveMembers],
        },
      ],
    }).catch(() => null);

    if (tempChannel) {
      tempVoiceChannels.add(tempChannel.id);
      await member.voice.setChannel(tempChannel).catch(() => {});
    }
  }

  // Delete temp channel when it becomes empty
  if (oldState.channel && tempVoiceChannels.has(oldState.channel.id)) {
    const ch = oldState.channel;
    if (ch.members.size === 0) {
      await ch.delete().catch(() => {});
      tempVoiceChannels.delete(ch.id);
    }
  }
});

// ── Reaction roles ────────────────────────────────────────────────────────────
const reactionRolesCmd = require('./commands/reactionroles');

async function handleReaction(reaction, user, add) {
  if (user.bot) return;
  if (reaction.partial) {
    try { await reaction.fetch(); } catch { return; }
  }

  const data = reactionRolesCmd.loadData();
  const emojiMap = data[reaction.message.id];
  if (!emojiMap) return;

  const roleName = emojiMap[reaction.emoji.name];
  if (!roleName) return;

  const guild = reaction.message.guild;
  const member = await guild.members.fetch(user.id).catch(() => null);
  if (!member) return;

  const role = guild.roles.cache.find((r) => r.name === roleName);
  if (!role) return;

  if (add) {
    await member.roles.add(role).catch(console.error);
  } else {
    await member.roles.remove(role).catch(console.error);
  }
}

client.on('messageReactionAdd', (reaction, user) => handleReaction(reaction, user, true));
client.on('messageReactionRemove', (reaction, user) => handleReaction(reaction, user, false));

// ── Slash command handler ─────────────────────────────────────────────────────
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const command = client.commands.get(interaction.commandName);
  if (!command) return;

  try {
    await command.execute(interaction, client);
  } catch (error) {
    console.error(error);
    const msg = { content: '❌ There was an error executing this command.', ephemeral: true };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(msg);
    } else {
      await interaction.reply(msg);
    }
  }
});

client.login(TOKEN).catch((err) => {
  console.error('❌ Failed to log in to Discord:', err.message);
  console.error('   → Check that DISCORD_TOKEN is correct and the bot is not banned/disabled.');
  process.exit(1);
});

process.on('unhandledRejection', (err) => {
  console.error('Unhandled promise rejection:', err);
});

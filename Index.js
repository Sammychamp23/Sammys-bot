require('dotenv').config();
process.on('uncaughtException', (err) => {
  console.error('[Uncaught Exception]', err.message);
});
process.on('unhandledRejection', (reason) => {
  console.error('[Unhandled Rejection]', reason?.message ?? reason);
});
const { Client, GatewayIntentBits, Partials, Collection, EmbedBuilder, ChannelType, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const OpenAI = require('openai');

const openai = (process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY)
  ? new OpenAI({
      apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY,
      baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL || undefined,
    })
  : null;

const aiConversationHistory = new Map();
const { addXp, addCoins, addVoiceMinutes, incrementMessageCount, incrementQuestProgress, createMysteryDrop, claimMysteryDrop, advanceSeason, getLeaderboard, getSeasonData, hasActiveXpBoost, recordSessionJoin, recordSessionComplete, getUpgradeMultiplier, getChaosMode, trackMessageAnalytics } = require('./data/store');
const fs = require('fs');
const path = require('path');
const cron = require('node-cron');
const http = require('http');
const { randomUUID } = require('crypto');
const cfg = require('./data/config');

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
    GatewayIntentBits.GuildInvites,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.MessageContent,
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
const tempVoiceChannels = new Set();
const xpCooldowns = new Map();
const activeMysteryDrops = new Map(); // messageId -> { dropId, guildId }
const feedbackCooldowns = new Map(); // userId -> lastFeedbackTs (prevent spammy notifications)
const activeSessionEmbeds = new Map(); // messageId -> sessionState object
const sessionJoinCooldowns = new Map(); // userId -> lastJoinAttempt (anti-spam)

// ── Slow mode manager ──────────────────────────────────────────────────────────
const channelMsgTimestamps = new Map(); // channelId -> [timestamp, ...]
const channelSlowModeActive = new Map(); // channelId -> boolean
const SLOW_MODE_THRESHOLD  = 8;  // messages per 60s window to trigger
const SLOW_MODE_RELEASE    = 4;  // drop below this to release
const SLOW_MODE_SECONDS    = 5;  // seconds of slow mode to apply
const SLOW_MODE_CHECK_MS   = 30_000; // recheck interval after enabling
const SLOW_MODE_SKIP       = new Set(['log', 'mod', 'admin', 'staff', 'bot', 'rule', 'verify', 'welcome', 'announce']);

// Voice tracking: userId -> { joinedAt, guildId, interval }
const voiceTrackers = new Map();

const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter((f) => f.endsWith('.js'));

for (const file of commandFiles) {
  const command = require(path.join(commandsPath, file));
  client.commands.set(command.data.name, command);
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

// ── Rotating channel topics ────────────────────────────────────────────────────
const rotatingTopics = [
  { name: '🎯 This Week: Aim Training', topic: 'Drop your aim training routines, tips, and scores! Best sensitivity setups welcome.' },
  { name: '🗺️ This Week: Hidden Gems', topic: 'Share underrated games that deserve more love. What\'s your hidden gem pick?' },
  { name: '🏆 This Week: Clutch Moments', topic: 'Share your best clutch moments and outplays this week! Video clips encouraged.' },
  { name: '🔧 This Week: Setup Showcase', topic: 'Show off your gaming setup — gear, settings, keybinds. What\'s your loadout?' },
  { name: '🤝 This Week: LFT (Looking for Team)', topic: 'Recruit for your squad or find a team! State your game, rank, and playtime.' },
  { name: '🎬 This Week: Best Gaming Moments', topic: 'Submit your funniest or most epic gaming clips. Community votes on the best!' },
  { name: '📈 This Week: Rank Up Goals', topic: 'Share your ranked goals for this season. What rank are you grinding for?' },
  { name: '🧠 This Week: Strategy Talk', topic: 'Deep-dive strategy discussions. Metas, tactics, and team compositions.' },
];

// Mystery drop reward pool
const DROP_REWARDS = [
  { type: 'coins', amount: 100, label: '💰 100 Coins' },
  { type: 'coins', amount: 250, label: '💰 250 Coins' },
  { type: 'coins', amount: 500, label: '💰 500 Coins' },
  { type: 'xp', amount: 50, label: '⭐ 50 XP' },
  { type: 'xp', amount: 150, label: '⭐ 150 XP' },
  { type: 'item', item: '🍀 Lucky Charm', label: '🍀 Lucky Charm (rare item)' },
  { type: 'item', item: '⚡ XP Boost Token', label: '⚡ XP Boost Token (rare item)' },
];

// Helper to find best text channel in a guild
function findChannel(guild, names) {
  for (const name of names) {
    const ch = guild.channels.cache.find((c) => c.name === name && c.isTextBased());
    if (ch) return ch;
  }
  return guild.channels.cache.find(
    (c) => c.isTextBased() && c.permissionsFor(guild.members.me)?.has('SendMessages')
  );
}

// ── Mystery drop spawner (reaction-based, no buttons) ────────────────────────
function spawnMysteryDrop(guild) {
  const activeChannels = guild.channels.cache.filter(
    (c) => c.isTextBased() &&
      !c.name.includes('log') &&
      !c.name.includes('mod') &&
      !c.name.includes('admin') &&
      !c.name.includes('staff') &&
      c.permissionsFor(guild.members.me)?.has('SendMessages') &&
      c.permissionsFor(guild.members.me)?.has('AddReactions')
  );

  if (!activeChannels.size) return;

  const channelArr = [...activeChannels.values()];
  const channel = channelArr[Math.floor(Math.random() * channelArr.length)];
  const reward = DROP_REWARDS[Math.floor(Math.random() * DROP_REWARDS.length)];
  const dropId = randomUUID();

  createMysteryDrop(dropId, reward);

  const embed = new EmbedBuilder()
    .setColor(0xf59e0b)
    .setTitle('🎁 Mystery Drop Appeared!')
    .setDescription(`A mystery drop has landed in this channel!\n\nBe the **first** to react with **🎁** and claim **${reward.label}**!`)
    .setFooter({ text: 'First come, first served — expires in 5 minutes!' })
    .setTimestamp();

  channel.send({ embeds: [embed] }).then(async (msg) => {
    activeMysteryDrops.set(msg.id, { dropId, guildId: guild.id });
    await msg.react('🎁').catch(() => {});
    setTimeout(() => {
      activeMysteryDrops.delete(msg.id);
      const expiredEmbed = new EmbedBuilder()
        .setColor(0x6b7280)
        .setTitle('🎁 Drop Expired')
        .setDescription('Nobody claimed this drop in time — better luck next time!')
        .setTimestamp();
      msg.edit({ embeds: [expiredEmbed] }).catch(() => {});
      msg.reactions.removeAll().catch(() => {});
    }, 5 * 60 * 1000);
  }).catch(() => {});
}

// ── Slow mode manager helper ──────────────────────────────────────────────────
async function handleSlowMode(channel) {
  // Skip excluded channel types
  const name = channel.name || '';
  for (const keyword of SLOW_MODE_SKIP) {
    if (name.toLowerCase().includes(keyword)) return;
  }

  const now = Date.now();
  const WINDOW = 60_000;

  // Track timestamp
  const timestamps = channelMsgTimestamps.get(channel.id) || [];
  timestamps.push(now);
  // Prune older than window
  const fresh = timestamps.filter((t) => now - t < WINDOW);
  channelMsgTimestamps.set(channel.id, fresh);

  const count = fresh.length;
  const isActive = channelSlowModeActive.get(channel.id) || false;

  // Enable slow mode if threshold hit
  if (count >= SLOW_MODE_THRESHOLD && !isActive) {
    try {
      await channel.setRateLimitPerUser(SLOW_MODE_SECONDS, 'Auto slow mode: high traffic detected');
      channelSlowModeActive.set(channel.id, true);

      channel.send({
        embeds: [new EmbedBuilder()
          .setColor(0xf59e0b)
          .setTitle('🐌 Slow Mode Enabled')
          .setDescription(`This channel is moving fast! Slow mode has been set to **${SLOW_MODE_SECONDS} seconds** to keep things readable.\n\nIt will be removed automatically once traffic calms down.`)
          .setFooter({ text: 'Auto Slow Mode • GameCrib Bot' })
          .setTimestamp()],
      }).catch(() => {});

      // Schedule a check to remove slow mode
      scheduleSlowModeRelease(channel);
    } catch { /* missing permissions — ignore silently */ }
  }
}

function scheduleSlowModeRelease(channel) {
  setTimeout(async () => {
    const now = Date.now();
    const WINDOW = 60_000;
    const timestamps = channelMsgTimestamps.get(channel.id) || [];
    const fresh = timestamps.filter((t) => now - t < WINDOW);
    channelMsgTimestamps.set(channel.id, fresh);

    if (fresh.length < SLOW_MODE_RELEASE) {
      // Traffic calmed — remove slow mode
      try {
        await channel.setRateLimitPerUser(0, 'Auto slow mode: traffic calmed');
        channelSlowModeActive.set(channel.id, false);
        channel.send({
          embeds: [new EmbedBuilder()
            .setColor(0x22c55e)
            .setTitle('✅ Slow Mode Removed')
            .setDescription('Traffic has calmed down — slow mode has been lifted. Chat freely!')
            .setFooter({ text: 'Auto Slow Mode • GameCrib Bot' })
            .setTimestamp()],
        }).catch(() => {});
      } catch { /* ignore */ }
    } else {
      // Still busy — check again
      scheduleSlowModeRelease(channel);
    }
  }, SLOW_MODE_CHECK_MS);
}

// ── Session system constants ───────────────────────────────────────────────────
const AUTO_SESSION_TYPES = [
  { game: 'Valorant',        mode: 'Ranked',      maxPlayers: 5,  emoji: '🎯', xp: 150, coins: 200 },
  { game: 'Warzone',         mode: 'Quads',        maxPlayers: 4,  emoji: '💥', xp: 120, coins: 180 },
  { game: 'Minecraft',       mode: 'Survival',     maxPlayers: 8,  emoji: '⛏️', xp: 100, coins: 150 },
  { game: 'Fortnite',        mode: 'Squads',       maxPlayers: 4,  emoji: '🏗️', xp: 120, coins: 180 },
  { game: 'Rocket League',   mode: '3v3',          maxPlayers: 6,  emoji: '🚗', xp: 130, coins: 190 },
  { game: 'Game Night',      mode: 'Chill',        maxPlayers: 10, emoji: '🎮', xp: 80,  coins: 120 },
  { game: 'Ranked Session',  mode: 'Competitive',  maxPlayers: 5,  emoji: '🏆', xp: 200, coins: 300 },
  { game: 'Chill Session',   mode: 'Fun',          maxPlayers: 10, emoji: '😎', xp: 80,  coins: 100 },
  { game: 'Apex Legends',    mode: 'Trios',        maxPlayers: 3,  emoji: '🔫', xp: 140, coins: 200 },
];

function buildSessionEmbed(state) {
  const now = Date.now();
  const secsLeft = Math.max(0, Math.floor((state.startsAt - now) / 1000));
  const minsLeft = Math.floor(secsLeft / 60);
  const sLeft    = secsLeft % 60;

  const sessionType = AUTO_SESSION_TYPES.find(
    (t) => t.game === state.game && t.mode === state.mode
  );
  const emoji = sessionType?.emoji || '🎮';

  const bonusLine = state.bonusType === 'double'
    ? '\n🌟 **DOUBLE REWARDS SESSION!** All rewards are 2×!\n'
    : state.bonusType === 'chaos'
    ? '\n🌪️ **CHAOS SESSION!** Boosted rewards + Chaos Mode!\n'
    : '';

  const playerList = state.players.length > 0
    ? state.players.map((id, i) => `${i === 0 ? '👑' : `${i + 1}.`} <@${id}>`).join('\n')
    : '*Waiting for players...*';

  const statusLine = state.status === 'started'
    ? '🟢 **SESSION ACTIVE** — Good luck!'
    : state.players.length >= state.maxPlayers
    ? '🔒 **FULL — Starting now!**'
    : `⏳ Starts in **${minsLeft}m ${sLeft}s**`;

  return new EmbedBuilder()
    .setColor(
      state.bonusType === 'double' ? 0xf59e0b
      : state.bonusType === 'chaos' ? 0xef4444
      : 0x6366f1
    )
    .setTitle(`${emoji} ${state.game} — ${state.mode} Session`)
    .setDescription(
      `${bonusLine}` +
      `React with ✅ to **join this session!**\n\n` +
      `👥 Players: **${state.players.length} / ${state.maxPlayers}**\n` +
      `${statusLine}`
    )
    .addFields(
      { name: '🎮 Players Joined', value: playerList, inline: false },
      { name: '🎁 Rewards', value: `${state.xpReward} ⭐ XP + ${state.coinReward} 💰 Coins\n🥇 First to join: +50 💰 bonus`, inline: true },
      { name: '🎯 Full Session Bonus', value: '+50 ⭐ XP + 100 💰 Coins extra', inline: true },
    )
    .setFooter({ text: 'Host: GameCrib Bot 🤖 • React ✅ to join • Only ✅ reactions allowed' })
    .setTimestamp();
}

async function createAndRunSession(guild, channel, opts = {}) {
  const {
    game = 'Game Night',
    mode = 'Chill',
    maxPlayers = 10,
    countdownMins = 10,
    bonusType = null,
  } = opts;

  const sessionType = AUTO_SESSION_TYPES.find((t) => t.game === game && t.mode === mode);
  let xpReward   = sessionType?.xp   ?? 150;
  let coinReward = sessionType?.coins ?? 200;

  if (bonusType === 'double') { xpReward *= 2; coinReward *= 2; }

  const state = {
    id:           require('crypto').randomUUID(),
    guildId:      guild.id,
    channelId:    channel.id,
    game,
    mode,
    maxPlayers,
    players:      [],
    status:       'waiting',
    createdAt:    Date.now(),
    startsAt:     Date.now() + countdownMins * 60 * 1000,
    firstPlayerId: null,
    bonusType,
    xpReward,
    coinReward,
    vcChannelId:  null,
    messageId:    null,
  };

  // Post the session embed
  let msg;
  try {
    msg = await channel.send({ embeds: [buildSessionEmbed(state)] });
    await msg.react('✅');
  } catch {
    return;
  }

  state.messageId = msg.id;
  activeSessionEmbeds.set(msg.id, state);

  // Announce if special bonus
  if (bonusType) {
    const announceCh = findChannel(guild, ['📣announcements', '💬general']);
    if (announceCh && announceCh.id !== channel.id) {
      const bonusLabel = bonusType === 'double' ? '🌟 DOUBLE REWARDS' : '🌪️ CHAOS';
      announceCh.send({
        content: `@here 🎮 A **${bonusLabel} SESSION** just started in ${channel}! React ✅ to join — extra rewards await!`,
      }).catch(() => {});
    }
  } else {
    const announceCh = findChannel(guild, ['📣announcements', '💬general']);
    if (announceCh && announceCh.id !== channel.id) {
      announceCh.send({
        content: `🎮 A new **${game}** session just started in ${channel}! React ✅ to join!`,
      }).catch(() => {});
    }
  }

  // Live countdown — update embed every 60 seconds
  const countdownInterval = setInterval(async () => {
    if (state.status !== 'waiting') { clearInterval(countdownInterval); return; }
    msg.edit({ embeds: [buildSessionEmbed(state)] }).catch(() => {});
  }, 60_000);

  // Reminder ping at 2 minutes left
  const reminderTimeout = setTimeout(() => {
    if (state.status !== 'waiting' || state.players.length >= state.maxPlayers) return;
    const spotsLeft = state.maxPlayers - state.players.length;
    msg.channel.send({
      content: `⏰ **2 minutes left** to join the **${game}** session! ${spotsLeft} spot${spotsLeft !== 1 ? 's' : ''} remaining — react ✅ on the embed above!`,
    }).catch(() => {});
  }, Math.max(0, (countdownMins - 2) * 60_000));

  // Session start when timer expires
  const startTimeout = setTimeout(async () => {
    clearInterval(countdownInterval);
    clearTimeout(reminderTimeout);
    if (state.status !== 'waiting') return;
    await startSession(guild, msg, state);
  }, countdownMins * 60_000);

  state._countdownInterval = countdownInterval;
  state._startTimeout      = startTimeout;
  state._reminderTimeout   = reminderTimeout;
}

async function startSession(guild, msg, state) {
  if (state.status !== 'waiting') return;
  state.status = 'started';

  // Remove reactions so no more joins
  msg.reactions.removeAll().catch(() => {});

  if (state.players.length === 0) {
    // No one joined — cancel silently
    activeSessionEmbeds.delete(msg.id);
    const cancelEmbed = new EmbedBuilder()
      .setColor(0x6b7280)
      .setTitle('🎮 Session Cancelled')
      .setDescription(`The **${state.game}** session had no players and has been cancelled.`)
      .setTimestamp();
    msg.edit({ embeds: [cancelEmbed] }).catch(() => {});
    return;
  }

  const isFull    = state.players.length >= state.maxPlayers;
  const finalXp   = isFull ? state.xpReward + 50   : state.xpReward;
  const finalCoins = isFull ? state.coinReward + 100 : state.coinReward;

  // Create temp voice channel
  let vcChannel = null;
  try {
    const category = guild.channels.cache.find(
      (c) => c.type === ChannelType.GuildCategory && (c.name.toLowerCase().includes('gaming') || c.name.toLowerCase().includes('voice') || c.name.toLowerCase().includes('session'))
    );
    vcChannel = await guild.channels.create({
      name: `🎮 ${state.game} Session`,
      type: ChannelType.GuildVoice,
      parent: category?.id ?? null,
      reason: 'Automated gaming session',
    });
    tempVoiceChannels.add(vcChannel.id);
    state.vcChannelId = vcChannel.id;
  } catch { /* VC creation failed — continue anyway */ }

  // Reward all participants
  const playerMentions = [];
  for (let i = 0; i < state.players.length; i++) {
    const userId = state.players[i];
    const isFirst = i === 0;
    let xp    = finalXp;
    let coins = finalCoins + (isFirst ? 50 : 0);

    // Apply chaos mode multiplier
    const chaos = getChaosMode(state.guildId);
    if (chaos.active) { xp = Math.floor(xp * chaos.multiplier); coins = Math.floor(coins * chaos.multiplier); }

    // Apply upgrade multipliers
    try {
      const mult = getUpgradeMultiplier(state.guildId, userId);
      xp    = Math.floor(xp    * (mult.xp   || 1));
      coins = Math.floor(coins * (mult.coins || 1));
    } catch { /* ignore */ }

    addXp(state.guildId, userId, xp);
    addCoins(state.guildId, userId, coins);
    recordSessionJoin(state.guildId, userId);
    recordSessionComplete(state.guildId, userId);

    const member = await guild.members.fetch(userId).catch(() => null);
    if (member) playerMentions.push(`${isFirst ? '👑' : `${i + 1}.`} ${member} +${xp} ⭐ +${coins} 💰${isFirst ? ' (first join bonus!)' : ''}`);

    // Try to move player to session VC
    if (vcChannel) {
      const voiceState = member?.voice?.channel;
      if (voiceState) member.voice.setChannel(vcChannel).catch(() => {});
    }
  }

  // Chaos session event: trigger chaos mode
  if (state.bonusType === 'chaos') {
    const { activateChaosMode } = require('./data/store');
    activateChaosMode(state.guildId, 30 * 60 * 1000, 2);
  }

  const startedEmbed = new EmbedBuilder()
    .setColor(0x22c55e)
    .setTitle(`🚀 ${state.game} Session Started!`)
    .setDescription(
      `The **${state.game} — ${state.mode}** session is now live! 🎮\n\n` +
      (vcChannel ? `🔊 Voice channel: ${vcChannel}\n\n` : '') +
      `**Rewards distributed${isFull ? ' (full session bonus included!)' : ''}:**\n` +
      (playerMentions.join('\n') || '*No players*')
    )
    .setFooter({ text: 'Session will be cleaned up in 90 minutes. GG!' })
    .setTimestamp();

  msg.edit({ embeds: [startedEmbed] }).catch(() => {});

  // Schedule VC cleanup after 90 minutes
  setTimeout(async () => {
    activeSessionEmbeds.delete(msg.id);
    if (vcChannel) {
      vcChannel.delete('Gaming session ended').catch(() => {});
      tempVoiceChannels.delete(vcChannel.id);
    }
    const endedEmbed = new EmbedBuilder()
      .setColor(0x6b7280)
      .setTitle(`🏁 ${state.game} Session Ended`)
      .setDescription('This session has been cleaned up. Start a new one with `/session create`!')
      .setTimestamp();
    msg.edit({ embeds: [endedEmbed] }).catch(() => {});
  }, 90 * 60_000);
}

// Expose createAndRunSession so the slash command can call it
// (set on client after client is constructed, before login)

client.once('clientReady', async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);

  // Auto-create #trade-alerts channel in every guild if it doesn't exist
  const { setAlertChannelId } = require('./commands/trade');
  for (const guild of client.guilds.cache.values()) {
    try {
      const existing = guild.channels.cache.find(
        (ch) => ch.isTextBased() && ch.name === 'trade-alerts'
      );
      if (existing) {
        setAlertChannelId(guild.id, existing.id);
      } else {
        const created = await guild.channels.create({
          name: 'trade-alerts',
          topic: '🚨 Major AI trade signals and emergency alerts. Managed by the bot.',
        });
        setAlertChannelId(guild.id, created.id);
        await created.send({
          embeds: [
            new EmbedBuilder()
              .setColor(0x6366f1)
              .setTitle('🚨 Trade Alerts Channel Ready')
              .setDescription(
                'This channel will receive **emergency trade alerts** whenever the AI detects a high-confidence BUY or SELL signal.\n\n' +
                'Use `/trade analyze` and upload a chart to get started.'
              )
              .setTimestamp(),
          ],
        });
        console.log(`✅ Created #trade-alerts in ${guild.name}`);
      }
    } catch (err) {
      console.error(`[trade-alerts] Could not create channel in ${guild.name}:`, err.message);
    }
  }

  // Pre-cache all guild invites for invite tracking
  for (const guild of client.guilds.cache.values()) {
    const invites = await guild.invites.fetch().catch(() => null);
    if (invites) guildInviteCache.set(guild.id, new Map(invites.map((i) => [i.code, i.uses])));
  }

  // Daily tip at 10am UTC
  cron.schedule('0 10 * * *', () => {
    const tip = dailyTips[Math.floor(Math.random() * dailyTips.length)];
    client.guilds.cache.forEach((guild) => {
      const channel = findChannel(guild, ['🤖bot-commands', '💬general']);
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
      const channel = findChannel(guild, ['💬general', '🤖bot-commands']);
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
      const channel = findChannel(guild, ['📣announcements', '💬general']);
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

  // Mystery drops — spawn every 25-45 minutes (random interval)
  function scheduleDrop() {
    const delay = (Math.floor(Math.random() * 20) + 25) * 60 * 1000;
    setTimeout(() => {
      client.guilds.cache.forEach((guild) => {
        spawnMysteryDrop(guild);
      });
      scheduleDrop();
    }, delay);
  }
  scheduleDrop();

  // Rotating channel topic — every Monday at 9am UTC
  cron.schedule('0 9 * * 1', () => {
    const topic = rotatingTopics[Math.floor(Math.random() * rotatingTopics.length)];
    client.guilds.cache.forEach(async (guild) => {
      const channel = guild.channels.cache.find(
        (c) => (c.name.includes('lounge') || c.name.includes('general') || c.name.includes('chat')) && c.isTextBased()
      );
      if (channel) {
        await channel.setTopic(topic.topic).catch(() => {});
        const embed = new EmbedBuilder()
          .setColor(0xa855f7)
          .setTitle(`🔄 Channel Theme Changed: ${topic.name}`)
          .setDescription(topic.topic)
          .setFooter({ text: 'Theme rotates every Monday. Get involved!' })
          .setTimestamp();
        channel.send({ embeds: [embed] }).catch(() => {});
      }
    });
  });

  // Monthly seasonal reset — 1st of each month at midnight UTC
  cron.schedule('0 0 1 * *', async () => {
    client.guilds.cache.forEach(async (guild) => {
      const leaderboard = getLeaderboard(guild.id);
      const newSeason = advanceSeason(guild.id);

      const SEASON_REWARDS = [
        { role: '🥇 Seasonal Champion', coins: 5000 },
        { role: '🥈 Elite Rival', coins: 2500 },
        { role: '🥉 Season Veteran', coins: 1000 },
      ];

      const channel = findChannel(guild, ['📣announcements', '💬general']);
      if (!channel) return;

      const rewardLines = [];
      for (let i = 0; i < Math.min(3, leaderboard.length); i++) {
        const entry = leaderboard[i];
        const rewardDef = SEASON_REWARDS[i];
        const member = await guild.members.fetch(entry.userId).catch(() => null);
        if (member) {
          addCoins(guild.id, entry.userId, rewardDef.coins);
          let role = guild.roles.cache.find((r) => r.name === rewardDef.role);
          if (!role) {
            const colors = [0xf59e0b, 0x9ca3af, 0xb45309];
            role = await guild.roles.create({ name: rewardDef.role, color: colors[i], hoist: false }).catch(() => null);
          }
          if (role) await member.roles.add(role).catch(() => {});
          rewardLines.push(`${['🥇', '🥈', '🥉'][i]} ${member.user.username} — **${rewardDef.role}** + **${rewardDef.coins.toLocaleString()} coins**`);
        }
      }

      const embed = new EmbedBuilder()
        .setColor(0xa855f7)
        .setTitle(`🏆 Season ${newSeason.prevSeason} Has Ended!`)
        .setDescription(`A new season begins! Congratulations to our season champions:\n\n${rewardLines.join('\n') || 'No ranked players this season.'}`)
        .addFields({
          name: `🚀 Season ${newSeason.season} Begins!`,
          value: 'Leaderboards are fresh. Compete hard for the top spot!',
        })
        .setTimestamp();

      channel.send({ embeds: [embed] }).catch(console.error);
    });
  });

  // ── Game Rotation — every Monday 8am UTC ──────────────────────────────────
  cron.schedule('0 8 * * 1', () => {
    const { rotateGames } = require('./data/store');
    const rotation = rotateGames();
    client.guilds.cache.forEach((guild) => {
      const channel = findChannel(guild, ['🎮game-chat', '💬general']);
      if (!channel) return;
      const embed = new EmbedBuilder()
        .setColor(0x22c55e)
        .setTitle('🎮 Weekly Game Rotation!')
        .setDescription(`This week's featured games are:\n\n${rotation.games.map((g, i) => `**${i + 1}.** ${g}`).join('\n')}\n\nLFG, chat, and voice activity in these games earns **+25% bonus coins**! 🔥`)
        .setFooter({ text: 'Rotates every Monday • Get active to earn more!' })
        .setTimestamp();
      channel.send({ embeds: [embed] }).catch(() => {});
    });
  });

  // ── AI Announcer — daily at 8pm UTC ──────────────────────────────────────
  cron.schedule('0 20 * * *', async () => {
    const { load } = require('./data/store');
    const economy = load('economy.json');
    const levels = load('levels.json');

    for (const guild of client.guilds.cache.values()) {
      const channel = findChannel(guild, ['🤖bot-commands', '💬general']);
      if (!channel) continue;

      // Top chatter today
      const todayKey = new Date().toDateString();
      const entries = Object.entries(economy)
        .filter(([k]) => k.startsWith(guild.id))
        .map(([k, v]) => ({ userId: k.replace(`${guild.id}-`, ''), msgs: v.messagesCount || 0 }))
        .sort((a, b) => b.msgs - a.msgs);

      if (entries.length === 0) continue;
      const topUser = await guild.members.fetch(entries[0].userId).catch(() => null);

      // Top level
      const levelEntries = Object.entries(levels)
        .filter(([k]) => k.startsWith(guild.id))
        .map(([k, v]) => ({ userId: k.replace(`${guild.id}-`, ''), level: v.level || 0 }))
        .sort((a, b) => b.level - a.level);
      const topLevelUser = levelEntries[0] ? await guild.members.fetch(levelEntries[0].userId).catch(() => null) : null;

      const embed = new EmbedBuilder()
        .setColor(0xf59e0b)
        .setTitle('📊 Daily Server Recap')
        .addFields(
          { name: '🔥 Most Active Member', value: topUser ? `${topUser} with **${entries[0].msgs.toLocaleString()}** messages all-time` : 'No data', inline: false },
          { name: '🏆 Top Level', value: topLevelUser ? `${topLevelUser} at **Level ${levelEntries[0].level}**` : 'No data', inline: false },
          { name: '💡 Tip', value: 'Chat, voice, quests & contracts all earn you coins + XP. Stay active! 💪', inline: false },
        )
        .setFooter({ text: 'Stay active to make the leaderboard!' })
        .setTimestamp();
      channel.send({ embeds: [embed] }).catch(() => {});
    }
  });

  // ── Comeback system — daily at 2am UTC ────────────────────────────────────
  cron.schedule('0 2 * * *', async () => {
    const { getInactiveUsers, canGiveComebackReward, recordComebackReward, addClaimableReward } = require('./data/store');
    for (const guild of client.guilds.cache.values()) {
      const inactiveUsers = getInactiveUsers(guild.id, 3, 7);
      for (const userId of inactiveUsers) {
        if (!canGiveComebackReward(guild.id, userId)) continue;
        const member = await guild.members.fetch(userId).catch(() => null);
        if (!member || member.user.bot) continue;
        const comebackCoins = 300;
        const comebackXp = 100;
        addClaimableReward(guild.id, userId, { coins: comebackCoins, xp: comebackXp, reason: 'Comeback bonus — we missed you!' });
        recordComebackReward(guild.id, userId);
        member.user.send(
          `👋 **Hey ${member.user.username}! We missed you on ${guild.name}!**\n\n` +
          `You've been away for a few days — come back and claim your **comeback reward!** 🎁\n` +
          `You have **${comebackCoins} 💰 coins** + **${comebackXp} ⭐ XP** waiting for you.\n\n` +
          `Use \`/claim\` in the server to collect your reward!`
        ).catch(() => {});
      }
    }
  });

  // ── Chaos mode auto-trigger — random chance every 6 hours ─────────────────
  cron.schedule('0 */6 * * *', () => {
    const { activateChaosMode, getChaosMode } = require('./data/store');
    // 30% chance to trigger chaos mode each check
    if (Math.random() > 0.30) return;
    client.guilds.cache.forEach((guild) => {
      const current = getChaosMode(guild.id);
      if (current.active) return; // already active
      const duration = 30 * 60 * 1000; // 30 minutes
      const mult = [1.5, 2, 2.5][Math.floor(Math.random() * 3)];
      activateChaosMode(guild.id, duration, mult);
      const channel = findChannel(guild, ['📣announcements', '💬general', '🤖bot-commands']);
      if (!channel) return;
      const embed = new EmbedBuilder()
        .setColor(0xef4444)
        .setTitle('🌪️ CHAOS MODE ACTIVATED!')
        .setDescription(`**${mult}x rewards** for the next **30 minutes!** 🔥\n\nAll XP and coin gains are boosted — get chatting and hop in VC NOW!`)
        .setFooter({ text: 'Chaos Mode ends in 30 minutes. Make every message count!' })
        .setTimestamp();
      channel.send({ content: '@everyone', embeds: [embed] }).catch(() => {});
    });
  });

  // ── Auto-advertise — check every hour, post when interval has elapsed ────────
  const { buildAdEmbed } = require('./commands/advertise');
  cron.schedule('0 * * * *', () => {
    client.guilds.cache.forEach(async (guild) => {
      const channelId = cfg.get(guild.id, 'advertiseChannel');
      const interval  = cfg.get(guild.id, 'advertiseInterval');
      if (!channelId || !interval) return;

      const lastPost = cfg.get(guild.id, 'advertiseLastPost', 0);
      const msSincePost = Date.now() - lastPost;
      if (msSincePost < interval * 60 * 60 * 1000) return;

      const channel = guild.channels.cache.get(channelId);
      if (!channel || !channel.isTextBased()) return;

      let inviteUrl = null;
      try {
        const invite = await channel.createInvite({ maxAge: 0, maxUses: 0, unique: false, reason: 'Auto-advertise' });
        inviteUrl = invite.url;
      } catch { /* no perms, skip */ }

      const embed = buildAdEmbed(guild);
      if (inviteUrl) embed.addFields({ name: '🔗 Join Now', value: inviteUrl });

      channel.send({ embeds: [embed] }).catch(console.error);
      cfg.set(guild.id, 'advertiseLastPost', Date.now());
    });
  });

  // ── Auto session scheduler — every 3 hours, 35% random chance ───────────────
  cron.schedule('0 */3 * * *', () => {
    if (Math.random() > 0.35) return;
    client.guilds.cache.forEach(async (guild) => {
      const channel = findChannel(guild, ['🎮game-sessions', '🎮sessions', '🔍lfg', '💬general']);
      if (!channel) return;

      // 20% chance of a special bonus session
      const roll = Math.random();
      let bonusType = null;
      if (roll < 0.10) bonusType = 'chaos';
      else if (roll < 0.20) bonusType = 'double';

      const pick = AUTO_SESSION_TYPES[Math.floor(Math.random() * AUTO_SESSION_TYPES.length)];
      const countdownMins = Math.floor(Math.random() * 6) + 7; // 7–12 min countdown

      await createAndRunSession(guild, channel, {
        game:         pick.game,
        mode:         pick.mode,
        maxPlayers:   pick.maxPlayers,
        countdownMins,
        bonusType,
      });
    });
  });

  // Expose createAndRunSession on client so /session create can use it
  client.createAndRunSession = createAndRunSession;

  // ── Auction expiry checker — every 10 minutes ─────────────────────────────
  cron.schedule('*/10 * * * *', async () => {
    const { getAuctions, endAuction } = require('./data/store');
    for (const guild of client.guilds.cache.values()) {
      const auctions = getAuctions(guild.id).filter((a) => !a.ended && a.endsAt <= Date.now());
      for (const auction of auctions) {
        const result = endAuction(guild.id, auction.id);
        if (!result) continue;
        const channel = findChannel(guild, ['🏪marketplace', '🤖bot-commands', '💬general']);
        if (!channel) continue;
        const winner = result.topBidderId ? await guild.members.fetch(result.topBidderId).catch(() => null) : null;
        const seller = await guild.members.fetch(result.sellerId).catch(() => null);
        const embed = new EmbedBuilder()
          .setColor(0xf59e0b)
          .setTitle('🔨 Auction Ended!')
          .addFields(
            { name: 'Item', value: result.item, inline: true },
            { name: 'Seller', value: seller?.toString() ?? 'Unknown', inline: true },
            { name: 'Winner', value: winner ? `${winner} — **${result.currentBid.toLocaleString()} 💰**` : 'No bids — item returned', inline: false },
          )
          .setTimestamp();
        channel.send({ embeds: [embed] }).catch(() => {});
      }
    }
  });
});

// ── Welcome new members ───────────────────────────────────────────────────────
// Cache invites per guild so we can diff on join
const guildInviteCache = new Map();

client.on('inviteCreate', async (invite) => {
  const cache = guildInviteCache.get(invite.guild.id) || new Map();
  cache.set(invite.code, invite.uses);
  guildInviteCache.set(invite.guild.id, cache);
});

client.on('guildMemberAdd', async (member) => {
  // Give starter rewards
  const JOIN_COINS = 100;
  const JOIN_XP    = 50;
  addCoins(member.guild.id, member.user.id, JOIN_COINS);
  addXp(member.guild.id, member.user.id, JOIN_XP);

  // Assign Member role
  const memberRole = member.guild.roles.cache.find((r) => r.name === '🆕 Member');
  if (memberRole) await member.roles.add(memberRole).catch(() => {});

  // Detect which invite was used (best-effort)
  let inviterId = null;
  try {
    const newInvites = await member.guild.invites.fetch().catch(() => null);
    if (newInvites) {
      const oldCache = guildInviteCache.get(member.guild.id) || new Map();
      const used = newInvites.find((inv) => (oldCache.get(inv.code) ?? 0) < inv.uses);
      if (used?.inviterId) inviterId = used.inviterId;
      guildInviteCache.set(member.guild.id, new Map(newInvites.map((i) => [i.code, i.uses])));
    }
  } catch { /* silent */ }

  // Track invite + reward inviter
  if (inviterId && inviterId !== member.user.id) {
    const inviteCmd = require('./commands/invite');
    const milestone = await inviteCmd.trackInvite(member.guild, inviterId);
    if (milestone) {
      addCoins(member.guild.id, inviterId, milestone.coins);
      const inviter = await member.guild.members.fetch(inviterId).catch(() => null);
      if (inviter && milestone.role) {
        const role = member.guild.roles.cache.find((r) => r.name === milestone.role);
        if (role) await inviter.roles.add(role).catch(() => {});
      }
      const notifChannel = findChannel(member.guild, ['📣announcements', '💬general']);
      if (notifChannel && inviter) {
        notifChannel.send({
          content: `🎉 ${inviter} just hit the **${milestone.label}** invite milestone! +**${milestone.coins.toLocaleString()}** coins${milestone.role ? ` + **${milestone.role}** role` : ''}!`,
        }).catch(() => {});
      }
    }
  }

  // Welcome embed with action buttons
  const channel = findChannel(member.guild, ['👋welcome', '💬general']);
  if (!channel) return;

  const embed = new EmbedBuilder()
    .setColor(0x22c55e)
    .setTitle(`👋 Welcome to ${member.guild.name}!`)
    .setDescription(`Hey ${member}! You just joined **${member.guild.name}** — glad to have you! 🎮\n\n✨ **You received ${JOIN_COINS} coins & ${JOIN_XP} XP just for joining!**`)
    .addFields(
      { name: '📜 Step 1 — Rules',    value: 'Read the rules so you know how we roll.', inline: true },
      { name: '🗺️ Step 2 — Roles',    value: 'Pick your games, platform & path in **#🗺️roles**.', inline: true },
      { name: '💰 Step 3 — Daily',    value: 'Run `/coins daily` every day for coins & streak bonuses!', inline: false },
      { name: '🤝 Step 4 — Invite',   value: 'Invite friends with `/invite link` to earn big rewards!', inline: false },
    )
    .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
    .setFooter({ text: `Member #${member.guild.memberCount} · ${member.guild.name}` })
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setLabel('📜 Rules').setStyle(ButtonStyle.Link)
      .setURL(`https://discord.com/channels/${member.guild.id}`),
    new ButtonBuilder().setCustomId('welcome_daily').setLabel('💰 Claim Daily').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('welcome_invite').setLabel('📲 Invite Friends').setStyle(ButtonStyle.Primary),
  );

  channel.send({ embeds: [embed], components: [row] }).catch(console.error);
});

// ── XP & Coins on message ────────────────────────────────────────────────────
const LEVEL_ROLES = {
  5:  '🎮 Gamer',
  10: '💜 Elite',
  20: '🏆 Legend',
};

// ── Disboard bump detection ────────────────────────────────────────────────────
const DISBOARD_BOT_ID = '302050872383242240';

client.on('messageCreate', async (message) => {
  // Detect Disboard bump confirmation (comes from Disboard bot as an embed)
  if (
    message.author?.id === DISBOARD_BOT_ID &&
    message.guild &&
    message.embeds?.length > 0
  ) {
    const embedDesc = message.embeds[0]?.description ?? '';
    const embedTitle = message.embeds[0]?.title ?? '';
    const isBumpSuccess =
      embedDesc.toLowerCase().includes('bump done') ||
      embedDesc.toLowerCase().includes('bumped') ||
      embedTitle.toLowerCase().includes('bump done') ||
      embedTitle.toLowerCase().includes('bumped');

    if (isBumpSuccess) {
      const guildId = message.guild.id;
      const enabled = cfg.get(guildId, 'bumpEnabled', false);
      if (!enabled) return;

      cfg.set(guildId, 'lastBumpTime', Date.now());

      // Confirm the bump was registered
      const bumpChannelId = cfg.get(guildId, 'bumpChannel');
      const bumpChannel = bumpChannelId ? message.guild.channels.cache.get(bumpChannelId) : message.channel;
      if (bumpChannel) {
        bumpChannel.send({
          embeds: [
            new EmbedBuilder()
              .setColor(0x22c55e)
              .setTitle('✅ Server Bumped!')
              .setDescription("We're now visible to new members on Disboard! I'll remind you in **2 hours** when it's time to bump again. 🚀")
              .setFooter({ text: 'Consistent bumping = more members finding your server' })
              .setTimestamp(),
          ],
        }).catch(() => {});
      }

      // Schedule reminder after 2 hours
      setTimeout(() => {
        const stillEnabled = cfg.get(guildId, 'bumpEnabled', false);
        if (!stillEnabled) return;
        const reminderChannelId = cfg.get(guildId, 'bumpChannel');
        const roleId = cfg.get(guildId, 'bumpRole');
        const guild = client.guilds.cache.get(guildId);
        if (!guild) return;
        const reminderChannel = reminderChannelId ? guild.channels.cache.get(reminderChannelId) : null;
        if (!reminderChannel) return;
        const mention = roleId ? `<@&${roleId}> ` : '';
        reminderChannel.send({
          content: mention || undefined,
          embeds: [
            new EmbedBuilder()
              .setColor(0xf59e0b)
              .setTitle('⏰ Time to Bump!')
              .setDescription(
                "The 2-hour cooldown is up! **Bump the server now** to push it to the top of Disboard and attract new members.\n\n👉 Type `/bump` in this channel to do it!"
              )
              .setFooter({ text: 'Every bump helps new members discover your server' })
              .setTimestamp(),
          ],
        }).catch(() => {});
      }, 2 * 60 * 60 * 1000);
    }
    return;
  }

  if (message.author.bot || !message.guild) return;

  // ── Analytics tracking (all messages, including bot-ignored) ─────────────
  trackMessageAnalytics(message.guild.id, message.channel.id);

  // ── Auto slow mode check ──────────────────────────────────────────────────
  handleSlowMode(message.channel).catch(() => {});

  // Handle @mention AI
  if (message.mentions.has(client.user) && !message.mentions.everyone) {
    const content = message.content.replace(/<@!?[0-9]+>/g, '').trim();
    if (!content) return message.reply('Hey! Ask me something 😊');

    if (!openai) return message.reply("🤖 AI assistant isn't configured right now. Ask a staff member to set it up!");

    const userId = message.author.id;
    if (!aiConversationHistory.has(userId)) {
      aiConversationHistory.set(userId, [
        {
          role: 'system',
          content: 'You are a hype gaming assistant for a Discord server. You speak in casual American slang — use words like "no cap", "lowkey", "bussin", "fam", "bet", "fr fr", "ngl", "fire", "slaps", "goated", "W", "L", "mid", "slay", "deadass", "lit", "vibe". Keep it real, short, and hype. Help with game tips, server questions, and keep the energy up. Never be formal.',
        },
      ]);
    }

    const history = aiConversationHistory.get(userId);
    history.push({ role: 'user', content });

    try {
      await message.channel.sendTyping();
      const response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        max_completion_tokens: 500,
        messages: history,
      });

      const reply = response.choices[0]?.message?.content ?? 'I had trouble thinking of a response!';
      history.push({ role: 'assistant', content: reply });

      if (history.length > 21) history.splice(1, 2);

      await message.reply(reply);
    } catch (error) {
      console.error(error);
      await message.reply('❌ Something went wrong with the AI. Please try again.');
    }
    return;
  }

  const cooldownKey = `${message.guild.id}-${message.author.id}`;
  if (xpCooldowns.has(cooldownKey)) return;
  const {
    updateActivityStreak, updateContractProgress, getActivityStreak,
    updateLastSeen, checkFirstAction, updateAchievementProgress,
    getChaosMode, getUpgradeMultiplier, getQuestData, xpForLevel: xpNeeded,
    DAILY_QUESTS,
  } = require('./data/store');
  const cdSeconds = getUpgradeMultiplier(message.guild.id, message.author.id, 'cd');
  xpCooldowns.set(cooldownKey, true);
  setTimeout(() => xpCooldowns.delete(cooldownKey), cdSeconds * 1000);

  // Track last seen (for comeback system)
  updateLastSeen(message.guild.id, message.author.id);

  // Update activity streak + get multiplier
  const streakResult = updateActivityStreak(message.guild.id, message.author.id);
  const streakData = getActivityStreak(message.guild.id, message.author.id);
  let mult = 1.0;
  if (streakData.current >= 30) mult = 3.0;
  else if (streakData.current >= 14) mult = 2.5;
  else if (streakData.current >= 7) mult = 2.0;
  else if (streakData.current >= 3) mult = 1.5;

  // Chaos mode multiplier
  const chaos = getChaosMode(message.guild.id);
  const chaosMult = chaos.active ? chaos.multiplier : 1;

  // Upgrade multipliers
  const xpUpgradeMult = getUpgradeMultiplier(message.guild.id, message.author.id, 'xp');
  const coinUpgradeMult = getUpgradeMultiplier(message.guild.id, message.author.id, 'coins');

  // Attachment bonus: +10 XP +5 coins per image/video/file
  const attachmentBonus = message.attachments.size > 0
    ? { xp: message.attachments.size * 10, coins: message.attachments.size * 5 }
    : { xp: 0, coins: 0 };

  // Conversation/reply bonus: extra rewards for engaging in threads
  const replyBonus = message.reference ? { xp: 5, coins: 3 } : { xp: 0, coins: 0 };

  const boostMult = hasActiveXpBoost(message.guild.id, message.author.id) ? 2 : 1;
  const xpGain = Math.floor((Math.floor(Math.random() * 11) + 15 + attachmentBonus.xp + replyBonus.xp) * mult * boostMult * chaosMult * xpUpgradeMult);
  const coinGain = Math.floor((Math.floor(Math.random() * 6) + 5 + attachmentBonus.coins + replyBonus.coins) * mult * chaosMult * coinUpgradeMult);
  const result = addXp(message.guild.id, message.author.id, xpGain);
  addCoins(message.guild.id, message.author.id, coinGain);
  incrementMessageCount(message.guild.id, message.author.id);
  incrementQuestProgress(message.guild.id, message.author.id, 'messages', 1);
  updateContractProgress(message.guild.id, message.author.id, 'messages', 1);

  // Achievement progress for messages
  const achUnlocked = updateAchievementProgress(message.guild.id, message.author.id, 'messages', 1);
  for (const ach of achUnlocked) {
    message.channel.send({
      embeds: [new EmbedBuilder()
        .setColor(0xa855f7)
        .setTitle('🏆 Achievement Unlocked!')
        .setDescription(`${message.author} just unlocked **${ach.name}**!\n*${ach.desc}*\n\nUse \`/achievements claim ${ach.id}\` to collect your reward!`)
        .setTimestamp()],
    }).catch(() => {});
  }

  // First action bonus: reward the first message of the day
  if (checkFirstAction(message.guild.id, message.author.id, 'message')) {
    addCoins(message.guild.id, message.author.id, 50);
    addXp(message.guild.id, message.author.id, 100);
    message.channel.send({
      embeds: [new EmbedBuilder()
        .setColor(0x22c55e)
        .setTitle('🌟 First Message Bonus!')
        .setDescription(`${message.author} sent their **first message today!** 🎉\n+**50 💰 coins** + **100 ⭐ XP** bonus!\n\n*Keep chatting for more rewards!*`)
        .setFooter({ text: 'Come back tomorrow for another first-message bonus!' })
        .setTimestamp()],
    }).catch(() => {});
  }

  // Personalized feedback: notify when close to leveling up (once per cooldown window)
  const feedbackKey = `lvl-${message.guild.id}-${message.author.id}`;
  const lastFeedback = feedbackCooldowns.get(feedbackKey) || 0;
  if (Date.now() - lastFeedback > 10 * 60 * 1000) {
    const { xp: currentXp, level: currentLevel } = result;
    const needed = xpNeeded(currentLevel + 1);
    const pct = currentXp / needed;
    if (pct >= 0.85) {
      feedbackCooldowns.set(feedbackKey, Date.now());
      message.channel.send({
        content: `🔔 ${message.author} — you're **${Math.round((1 - pct) * needed)} XP** away from **Level ${currentLevel + 1}**! Keep going! 🔥`,
      }).catch(() => {});
    }
  }

  // Personalized feedback: notify when 1-2 actions away from completing a daily quest
  const questFeedbackKey = `quest-${message.guild.id}-${message.author.id}`;
  const lastQuestFeedback = feedbackCooldowns.get(questFeedbackKey) || 0;
  if (Date.now() - lastQuestFeedback > 15 * 60 * 1000) {
    const { entry: questEntry } = getQuestData(message.guild.id, message.author.id);
    for (const q of DAILY_QUESTS) {
      if (q.type !== 'messages') continue;
      const progress = questEntry.daily[q.id]?.progress || 0;
      const claimed = questEntry.daily[q.id]?.claimed || false;
      if (!claimed && q.goal - progress <= 2 && q.goal - progress > 0) {
        feedbackCooldowns.set(questFeedbackKey, Date.now());
        message.author.send(
          `🎯 You're only **${q.goal - progress}** message${q.goal - progress > 1 ? 's' : ''} away from completing your daily quest **"${q.name}"**! Almost there!`
        ).catch(() => {});
        break;
      }
    }
  }

  // Streak milestone notification
  if (streakResult.streaked) {
    const { MILESTONES } = require('./commands/streak');
    const milestone = MILESTONES.find((m) => m.days === streakResult.current);
    if (milestone) {
      addCoins(message.guild.id, message.author.id, milestone.coins);
      addXp(message.guild.id, message.author.id, milestone.xp);
      message.channel.send({
        embeds: [new EmbedBuilder()
          .setColor(0xf59e0b)
          .setTitle(`🔥 ${milestone.label} Unlocked!`)
          .setDescription(`${message.author} hit a **${milestone.days}-day streak!** 🎉\n+**${milestone.coins} coins** + **${milestone.xp} XP** bonus!`)
          .setTimestamp()],
      }).catch(() => {});
    }
  }

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

// ── Voice time tracking + quest progress ─────────────────────────────────────
client.on('voiceStateUpdate', async (oldState, newState) => {
  const CREATE_CHANNEL_NAME = '➕ Create a Room';
  const userId = newState.member?.id ?? oldState.member?.id;
  const guildId = newState.guild?.id ?? oldState.guild?.id;
  if (!userId || !guildId) return;
  if (newState.member?.user?.bot) return;

  // Handle temp VC creation
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

  // Delete temp channel when empty
  if (oldState.channel && tempVoiceChannels.has(oldState.channel.id)) {
    const ch = oldState.channel;
    if (ch.members.size === 0) {
      await ch.delete().catch(() => {});
      tempVoiceChannels.delete(ch.id);
    }
  }

  // Track voice time: user joined a voice channel
  if (!oldState.channelId && newState.channelId) {
    voiceTrackers.set(`${guildId}-${userId}`, { joinedAt: Date.now(), guildId });

    // First action bonus: first VC join of the day
    const { checkFirstAction: checkFirst } = require('./data/store');
    if (checkFirst(guildId, userId, 'vc')) {
      addCoins(guildId, userId, 75);
      addXp(guildId, userId, 150);
      const vcCh = newState.channel;
      if (vcCh && vcCh.isVoiceBased()) {
        const announceCh = findChannel(newState.guild, ['📈levels', '💬general', '🤖bot-commands']);
        if (announceCh) {
          announceCh.send({
            embeds: [new EmbedBuilder()
              .setColor(0x22c55e)
              .setTitle('🎤 First VC Bonus!')
              .setDescription(`${newState.member} jumped into voice chat for the **first time today!** 🎉\n+**75 💰 coins** + **150 ⭐ XP** bonus!\n\n*Stay active in VC to keep earning!*`)
              .setFooter({ text: 'Come back tomorrow for another first-VC bonus!' })
              .setTimestamp()],
          }).catch(() => {});
        }
      }
    }
  }

  // Track voice time: user left a voice channel
  if (oldState.channelId && !newState.channelId) {
    const trackerKey = `${guildId}-${userId}`;
    const tracker = voiceTrackers.get(trackerKey);
    if (tracker) {
      voiceTrackers.delete(trackerKey);
      const minutesSpent = Math.floor((Date.now() - tracker.joinedAt) / 60000);
      if (minutesSpent >= 1) {
        awardVoiceRewards(guildId, userId, minutesSpent);
      }
    }
  }

  // Track voice time: user switched channels — keep tracking
  if (oldState.channelId && newState.channelId && oldState.channelId !== newState.channelId) {
    const trackerKey = `${guildId}-${userId}`;
    const tracker = voiceTrackers.get(trackerKey);
    if (tracker) {
      const minutesSpent = Math.floor((Date.now() - tracker.joinedAt) / 60000);
      if (minutesSpent >= 1) {
        awardVoiceRewards(guildId, userId, minutesSpent);
      }
      tracker.joinedAt = Date.now();
    } else {
      voiceTrackers.set(trackerKey, { joinedAt: Date.now(), guildId });
    }
  }
});

// ── Voice reward helper ───────────────────────────────────────────────────────
function awardVoiceRewards(guildId, userId, minutesSpent) {
  const { updateActivityStreak, updateContractProgress, updateAchievementProgress, getChaosMode, getUpgradeMultiplier, updateLastSeen } = require('./data/store');
  addVoiceMinutes(guildId, userId, minutesSpent);
  incrementQuestProgress(guildId, userId, 'vc', minutesSpent);
  updateContractProgress(guildId, userId, 'voice', minutesSpent);
  updateActivityStreak(guildId, userId);
  updateLastSeen(guildId, userId);

  // Achievement progress for VC time
  updateAchievementProgress(guildId, userId, 'vc_minutes', minutesSpent);

  // Chaos mode & upgrade multipliers
  const chaos = getChaosMode(guildId);
  const chaosMult = chaos.active ? chaos.multiplier : 1;
  const xpMult = getUpgradeMultiplier(guildId, userId, 'xp');
  const coinMult = getUpgradeMultiplier(guildId, userId, 'coins');

  // 5 XP + 3 coins per minute in voice (boosted by chaos/upgrades)
  const xpGain = Math.floor(minutesSpent * 5 * chaosMult * xpMult);
  const coinGain = Math.floor(minutesSpent * 3 * chaosMult * coinMult);
  addXp(guildId, userId, xpGain);
  addCoins(guildId, userId, coinGain);
}

// Periodic VC flush every 10 minutes for users staying in channels
setInterval(() => {
  for (const [key, tracker] of voiceTrackers.entries()) {
    const minutesSpent = Math.floor((Date.now() - tracker.joinedAt) / 60000);
    if (minutesSpent >= 1) {
      const parts = key.split('-');
      const userId = parts.pop();
      const guildId = parts.join('-');
      awardVoiceRewards(guildId, userId, minutesSpent);
      tracker.joinedAt = Date.now();
    }
  }
}, 10 * 60 * 1000);

// ── Reaction rewards + mystery drops + enforcement (30s cooldown) ─────────────
const reactionCooldowns = new Map();
client.on('messageReactionAdd', async (reaction, user) => {
  if (user.bot) return;
  if (reaction.partial) { try { await reaction.fetch(); } catch { return; } }
  if (reaction.message.partial) { try { await reaction.message.fetch(); } catch { return; } }
  if (!reaction.message.guild) return;

  const guild = reaction.message.guild;
  const guildId = guild.id;
  const userId = user.id;
  const channel = reaction.message.channel;

  // ── Mystery Drop Claim (reaction-based) ───────────────────────────────────
  const dropInfo = activeMysteryDrops.get(reaction.message.id);
  if (dropInfo && reaction.emoji.name === '🎁') {
    const result = claimMysteryDrop(dropInfo.dropId, userId);
    if (!result.success) {
      reaction.users.remove(userId).catch(() => {});
      return;
    }
    activeMysteryDrops.delete(reaction.message.id);
    const reward = result.reward;
    let rewardDesc = '';
    if (reward.type === 'coins') {
      addCoins(guildId, userId, reward.amount);
      rewardDesc = `+**${reward.amount}** 💰 coins added to your balance!`;
    } else if (reward.type === 'xp') {
      addXp(guildId, userId, reward.amount);
      rewardDesc = `+**${reward.amount}** ⭐ XP added to your profile!`;
    } else if (reward.type === 'item') {
      const { addToInventory } = require('./data/store');
      addToInventory(guildId, userId, reward.item);
      rewardDesc = `**${reward.item}** added to your inventory!`;
    }
    reaction.message.reactions.removeAll().catch(() => {});
    const claimEmbed = new EmbedBuilder()
      .setColor(0x22c55e)
      .setTitle('🎁 Drop Claimed!')
      .setDescription(`<@${userId}> snagged the mystery drop!\n\n${rewardDesc}`)
      .setFooter({ text: 'Keep an eye on active channels for more drops!' })
      .setTimestamp();
    reaction.message.edit({ embeds: [claimEmbed] }).catch(() => {});
    return;
  }

  // ── Reaction Enforcement: ROLES channel ───────────────────────────────────
  // Auto-remove any reaction NOT added by the bot on bot messages in roles channel
  if (channel.name && (channel.name.includes('roles') || channel.name === '🗺️roles')) {
    if (reaction.message.author?.id === client.user.id) {
      const { loadData } = require('./commands/reactionroles');
      const rrData = loadData();
      const allowedEmojis = rrData[reaction.message.id];
      if (allowedEmojis) {
        if (!allowedEmojis[reaction.emoji.name]) {
          reaction.users.remove(userId).catch(() => {});
          return;
        }
      } else {
        reaction.users.remove(userId).catch(() => {});
        return;
      }
    }
  }

  // ── Reaction Enforcement: VERIFY channel ──────────────────────────────────
  // Only ✅ is allowed in verify channels; no XP farming from verify reactions
  if (channel.name && channel.name.includes('verify')) {
    if (reaction.emoji.name !== '✅') {
      reaction.users.remove(userId).catch(() => {});
    }
    return; // verification is handled by the dedicated verify handler below
  }

  // ── Regular XP / coin reward for reactions ────────────────────────────────
  const key = `react-${guildId}-${userId}`;
  if (reactionCooldowns.has(key)) return;
  reactionCooldowns.set(key, true);
  setTimeout(() => reactionCooldowns.delete(key), 30_000);

  const { updateActivityStreak, updateContractProgress } = require('./data/store');
  addXp(guildId, userId, 5);
  addCoins(guildId, userId, 2);
  updateActivityStreak(guildId, userId);
  updateContractProgress(guildId, userId, 'messages', 0);
  incrementQuestProgress(guildId, userId, 'messages', 0);
});

// ── Thread creation bonus (50 XP + 25 coins) ─────────────────────────────────
client.on('threadCreate', async (thread) => {
  if (!thread.guild || !thread.ownerId) return;
  const member = await thread.guild.members.fetch(thread.ownerId).catch(() => null);
  if (!member || member.user.bot) return;

  const { updateActivityStreak, updateContractProgress } = require('./data/store');
  addXp(thread.guild.id, thread.ownerId, 50);
  addCoins(thread.guild.id, thread.ownerId, 25);
  updateActivityStreak(thread.guild.id, thread.ownerId);
  updateContractProgress(thread.guild.id, thread.ownerId, 'messages', 5);
  incrementQuestProgress(thread.guild.id, thread.ownerId, 'messages', 5);
});

// ── Mod Log ───────────────────────────────────────────────────────────────────
function getModLog(guild) {
  return guild.channels.cache.find(
    (c) => c.name === '📋mod-log' && c.isTextBased()
  );
}

async function modLog(guild, embed) {
  const ch = getModLog(guild);
  if (ch) await ch.send({ embeds: [embed] }).catch(() => {});
}

// Member joined
client.on('guildMemberAdd', async (member) => {
  const embed = new EmbedBuilder()
    .setColor(0x22c55e)
    .setTitle('📥 Member Joined')
    .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
    .addFields(
      { name: 'User', value: `${member.user.tag} (${member.user.id})`, inline: true },
      { name: 'Account Created', value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`, inline: true },
      { name: 'Members', value: `${member.guild.memberCount}`, inline: true },
    )
    .setFooter({ text: `ID: ${member.user.id}` })
    .setTimestamp();
  await modLog(member.guild, embed);
});

// Member left / kicked
client.on('guildMemberRemove', async (member) => {
  const roles = member.roles.cache
    .filter((r) => r.name !== '@everyone')
    .map((r) => r.toString())
    .join(', ') || 'None';
  const embed = new EmbedBuilder()
    .setColor(0xef4444)
    .setTitle('📤 Member Left')
    .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
    .addFields(
      { name: 'User', value: `${member.user.tag} (${member.user.id})`, inline: true },
      { name: 'Joined', value: member.joinedTimestamp ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>` : 'Unknown', inline: true },
      { name: 'Roles', value: roles.length > 1024 ? roles.slice(0, 1020) + '...' : roles, inline: false },
    )
    .setFooter({ text: `ID: ${member.user.id}` })
    .setTimestamp();
  await modLog(member.guild, embed);
});

// ── Verification reaction role ─────────────────────────────────────────────
client.on('messageReactionAdd', async (reaction, user) => {
  if (user.bot) return;

  // Fetch partial reaction/message if not cached
  if (reaction.partial) {
    try { await reaction.fetch(); } catch { return; }
  }
  if (reaction.message.partial) {
    try { await reaction.message.fetch(); } catch { return; }
  }

  // Only act on ✅ in a channel named "🔐verify"
  if (reaction.emoji.name !== '✅') return;
  const channel = reaction.message.channel;
  if (!channel.name || !channel.name.includes('verify')) return;

  // Only act on the bot's own verify message
  if (reaction.message.author?.id !== client.user.id) return;

  const guild = reaction.message.guild;
  if (!guild) return;

  const member = await guild.members.fetch(user.id).catch(() => null);
  if (!member) return;

  const verifiedRole   = guild.roles.cache.find((r) => r.name === '✅ Verified');
  const unverifiedRole = guild.roles.cache.find((r) => r.name === '🔐 Unverified');

  // Remove their reaction to keep the message clean for the next person
  reaction.users.remove(user.id).catch(() => {});

  // Already verified — silently ignore
  if (verifiedRole && member.roles.cache.has(verifiedRole.id)) return;

  try {
    if (unverifiedRole && member.roles.cache.has(unverifiedRole.id)) {
      await member.roles.remove(unverifiedRole);
    }
    if (verifiedRole) {
      await member.roles.add(verifiedRole);
    }
    // DM the member a welcome
    user.send(`✅ **You're verified in ${guild.name}!** All channels are now unlocked — welcome aboard!`).catch(() => {});
  } catch (err) {
    console.error('Verification error:', err);
  }
});

// ── Mystery drop claim (🎁 reaction) ─────────────────────────────────────────
client.on('messageReactionAdd', async (reaction, user) => {
  if (user.bot) return;
  if (reaction.partial) { try { await reaction.fetch(); } catch { return; } }
  if (reaction.message.partial) { try { await reaction.message.fetch(); } catch { return; } }

  const msgId = reaction.message.id;

  // ── Session join handler ──────────────────────────────────────────────────
  const sessionState = activeSessionEmbeds.get(msgId);
  if (sessionState) {
    // Enforce ✅ only — remove anything else immediately
    if (reaction.emoji.name !== '✅') {
      reaction.users.remove(user.id).catch(() => {});
      return;
    }

    // Session already started/locked
    if (sessionState.status !== 'waiting') {
      reaction.users.remove(user.id).catch(() => {});
      return;
    }

    // Anti-spam cooldown (10 seconds between join attempts per user)
    const lastAttempt = sessionJoinCooldowns.get(user.id) || 0;
    if (Date.now() - lastAttempt < 10_000) {
      reaction.users.remove(user.id).catch(() => {});
      return;
    }
    sessionJoinCooldowns.set(user.id, Date.now());

    // Duplicate join prevention
    if (sessionState.players.includes(user.id)) {
      reaction.users.remove(user.id).catch(() => {});
      return;
    }

    // Max player check
    if (sessionState.players.length >= sessionState.maxPlayers) {
      reaction.users.remove(user.id).catch(() => {});
      return;
    }

    // Add player
    sessionState.players.push(user.id);

    // Update embed
    const msg = reaction.message;
    msg.edit({ embeds: [buildSessionEmbed(sessionState)] }).catch(() => {});

    // Remove their reaction so the embed stays clean (only bot ✅ shows)
    reaction.users.remove(user.id).catch(() => {});

    // If full, start immediately
    if (sessionState.players.length >= sessionState.maxPlayers) {
      clearTimeout(sessionState._startTimeout);
      clearInterval(sessionState._countdownInterval);
      clearTimeout(sessionState._reminderTimeout);
      const guild = reaction.message.guild;
      await startSession(guild, msg, sessionState);
    }
    return;
  }

  // ── Mystery drop claim (🎁) ───────────────────────────────────────────────
  if (reaction.emoji.name !== '🎁') return;
  const dropEntry = activeMysteryDrops.get(msgId);
  if (!dropEntry) return;

  const { dropId, guildId } = dropEntry;
  const result = claimMysteryDrop(dropId, user.id);
  if (!result.success) return; // already claimed

  activeMysteryDrops.delete(msgId);

  const reward = result.reward;
  if (reward.type === 'coins') addCoins(guildId, user.id, reward.amount);
  else if (reward.type === 'xp')  addXp(guildId, user.id, reward.amount);
  else if (reward.type === 'item') {
    const { addToInventory } = require('./data/store');
    addToInventory(guildId, user.id, reward.item);
  }

  reaction.message.reactions.removeAll().catch(() => {});

  const claimedEmbed = new EmbedBuilder()
    .setColor(0x22c55e)
    .setTitle('🎁 Drop Claimed!')
    .setDescription(`<@${user.id}> snagged the mystery drop and won **${reward.label}**! 🎉`)
    .setTimestamp();
  reaction.message.edit({ embeds: [claimedEmbed] }).catch(() => {});
});

// Member banned
client.on('guildBanAdd', async (ban) => {
  const embed = new EmbedBuilder()
    .setColor(0x7f1d1d)
    .setTitle('🔨 Member Banned')
    .setThumbnail(ban.user.displayAvatarURL({ dynamic: true }))
    .addFields(
      { name: 'User', value: `${ban.user.tag} (${ban.user.id})`, inline: true },
      { name: 'Reason', value: ban.reason || 'No reason provided', inline: false },
    )
    .setFooter({ text: `ID: ${ban.user.id}` })
    .setTimestamp();
  await modLog(ban.guild, embed);
});

// Member unbanned
client.on('guildBanRemove', async (ban) => {
  const embed = new EmbedBuilder()
    .setColor(0x10b981)
    .setTitle('✅ Member Unbanned')
    .addFields(
      { name: 'User', value: `${ban.user.tag} (${ban.user.id})`, inline: true },
    )
    .setFooter({ text: `ID: ${ban.user.id}` })
    .setTimestamp();
  await modLog(ban.guild, embed);
});

// Member updated (roles, nickname, timeout)
client.on('guildMemberUpdate', async (oldMember, newMember) => {
  const embeds = [];

  // Nickname change
  if (oldMember.nickname !== newMember.nickname) {
    embeds.push(new EmbedBuilder()
      .setColor(0x6366f1)
      .setTitle('✏️ Nickname Changed')
      .addFields(
        { name: 'User', value: `${newMember.user.tag}`, inline: true },
        { name: 'Before', value: oldMember.nickname || '*None*', inline: true },
        { name: 'After', value: newMember.nickname || '*None*', inline: true },
      )
      .setFooter({ text: `ID: ${newMember.id}` })
      .setTimestamp());
  }

  // Role changes
  const addedRoles = newMember.roles.cache.filter((r) => !oldMember.roles.cache.has(r.id));
  const removedRoles = oldMember.roles.cache.filter((r) => !newMember.roles.cache.has(r.id));
  if (addedRoles.size > 0) {
    embeds.push(new EmbedBuilder()
      .setColor(0xa855f7)
      .setTitle('🎭 Role Added')
      .addFields(
        { name: 'User', value: `${newMember.user.tag}`, inline: true },
        { name: 'Roles Added', value: addedRoles.map((r) => r.toString()).join(', '), inline: false },
      )
      .setFooter({ text: `ID: ${newMember.id}` })
      .setTimestamp());
  }
  if (removedRoles.size > 0) {
    embeds.push(new EmbedBuilder()
      .setColor(0xf97316)
      .setTitle('🎭 Role Removed')
      .addFields(
        { name: 'User', value: `${newMember.user.tag}`, inline: true },
        { name: 'Roles Removed', value: removedRoles.map((r) => r.toString()).join(', '), inline: false },
      )
      .setFooter({ text: `ID: ${newMember.id}` })
      .setTimestamp());
  }

  // Timeout
  const wasTimedOut = !!oldMember.communicationDisabledUntil;
  const isTimedOut  = !!newMember.communicationDisabledUntil;
  if (!wasTimedOut && isTimedOut) {
    embeds.push(new EmbedBuilder()
      .setColor(0xf59e0b)
      .setTitle('⏱️ Member Timed Out')
      .addFields(
        { name: 'User', value: `${newMember.user.tag}`, inline: true },
        { name: 'Until', value: `<t:${Math.floor(newMember.communicationDisabledUntil.getTime() / 1000)}:F>`, inline: true },
      )
      .setFooter({ text: `ID: ${newMember.id}` })
      .setTimestamp());
  }
  if (wasTimedOut && !isTimedOut) {
    embeds.push(new EmbedBuilder()
      .setColor(0x10b981)
      .setTitle('⏱️ Timeout Removed')
      .addFields({ name: 'User', value: `${newMember.user.tag}`, inline: true })
      .setFooter({ text: `ID: ${newMember.id}` })
      .setTimestamp());
  }

  // ── Booster auto-handler ──────────────────────────────────────────────────
  const wasBooster = !!oldMember.premiumSince;
  const isBooster  = !!newMember.premiumSince;

  if (!wasBooster && isBooster) {
    // Just started boosting — assign booster role + reward
    const boosterRole = newMember.guild.roles.cache.find((r) => r.name === '💎 Server Booster');
    if (boosterRole && !newMember.roles.cache.has(boosterRole.id)) {
      await newMember.roles.add(boosterRole).catch(() => {});
    }
    addCoins(newMember.guild.id, newMember.id, 2000);
    const { addXp: axp } = require('./data/store');
    axp(newMember.guild.id, newMember.id, 500);

    const generalCh = newMember.guild.channels.cache.find((c) => c.name === '💬general' && c.isTextBased());
    if (generalCh) {
      const boostEmbed = new EmbedBuilder()
        .setColor(0xf472b6)
        .setTitle('💎 New Server Booster!')
        .setDescription(`${newMember} just boosted the server! 🎉\nThank you so much — you received **2,000 💰 coins** and **500 XP** as a gift!`)
        .setThumbnail(newMember.user.displayAvatarURL({ dynamic: true }))
        .setTimestamp();
      generalCh.send({ embeds: [boostEmbed] }).catch(() => {});
    }
  }

  if (wasBooster && !isBooster) {
    // Stopped boosting — remove booster role
    const boosterRole = newMember.guild.roles.cache.find((r) => r.name === '💎 Server Booster');
    if (boosterRole && newMember.roles.cache.has(boosterRole.id)) {
      await newMember.roles.remove(boosterRole).catch(() => {});
    }
  }

  for (const embed of embeds) await modLog(newMember.guild, embed);
});

// Message deleted
client.on('messageDelete', async (message) => {
  if (!message.guild || message.author?.bot) return;
  const embed = new EmbedBuilder()
    .setColor(0xef4444)
    .setTitle('🗑️ Message Deleted')
    .addFields(
      { name: 'Author', value: message.author ? `${message.author.tag} (${message.author.id})` : 'Unknown', inline: true },
      { name: 'Channel', value: message.channel.toString(), inline: true },
      { name: 'Content', value: message.content ? (message.content.length > 1024 ? message.content.slice(0, 1020) + '...' : message.content) : '*No text content*', inline: false },
    )
    .setFooter({ text: `Message ID: ${message.id}` })
    .setTimestamp();

  if (message.attachments.size > 0) {
    embed.addFields({ name: 'Attachments', value: message.attachments.map((a) => a.url).join('\n').slice(0, 1024), inline: false });
  }

  await modLog(message.guild, embed);
});

// Bulk message delete
client.on('messageDeleteBulk', async (messages, channel) => {
  if (!channel.guild) return;
  const embed = new EmbedBuilder()
    .setColor(0x7f1d1d)
    .setTitle('🗑️ Bulk Messages Deleted')
    .addFields(
      { name: 'Channel', value: channel.toString(), inline: true },
      { name: 'Count', value: `${messages.size} messages`, inline: true },
    )
    .setTimestamp();
  await modLog(channel.guild, embed);
});

// Message edited
client.on('messageUpdate', async (oldMessage, newMessage) => {
  if (!newMessage.guild || newMessage.author?.bot) return;
  if (oldMessage.content === newMessage.content) return;
  const embed = new EmbedBuilder()
    .setColor(0x6366f1)
    .setTitle('✏️ Message Edited')
    .addFields(
      { name: 'Author', value: `${newMessage.author.tag} (${newMessage.author.id})`, inline: true },
      { name: 'Channel', value: newMessage.channel.toString(), inline: true },
      { name: 'Before', value: oldMessage.content ? (oldMessage.content.length > 1024 ? oldMessage.content.slice(0, 1020) + '...' : oldMessage.content) : '*Unknown*', inline: false },
      { name: 'After', value: newMessage.content ? (newMessage.content.length > 1024 ? newMessage.content.slice(0, 1020) + '...' : newMessage.content) : '*Empty*', inline: false },
    )
    .setFooter({ text: `Message ID: ${newMessage.id}` })
    .setURL(newMessage.url)
    .setTimestamp();
  await modLog(newMessage.guild, embed);
});

// Channel created
client.on('channelCreate', async (channel) => {
  if (!channel.guild) return;
  const embed = new EmbedBuilder()
    .setColor(0x22c55e)
    .setTitle('📁 Channel Created')
    .addFields(
      { name: 'Name', value: channel.name, inline: true },
      { name: 'Type', value: channel.type === ChannelType.GuildVoice ? 'Voice' : channel.type === ChannelType.GuildCategory ? 'Category' : 'Text', inline: true },
      { name: 'Category', value: channel.parent?.name || 'None', inline: true },
    )
    .setFooter({ text: `ID: ${channel.id}` })
    .setTimestamp();
  await modLog(channel.guild, embed);
});

// Channel deleted
client.on('channelDelete', async (channel) => {
  if (!channel.guild) return;
  const embed = new EmbedBuilder()
    .setColor(0xef4444)
    .setTitle('📁 Channel Deleted')
    .addFields(
      { name: 'Name', value: channel.name, inline: true },
      { name: 'Category', value: channel.parent?.name || 'None', inline: true },
    )
    .setFooter({ text: `ID: ${channel.id}` })
    .setTimestamp();
  await modLog(channel.guild, embed);
});

// Channel updated
client.on('channelUpdate', async (oldChannel, newChannel) => {
  if (!newChannel.guild) return;
  const changes = [];
  if (oldChannel.name !== newChannel.name)
    changes.push({ name: 'Name', value: `${oldChannel.name} → ${newChannel.name}`, inline: false });
  if (oldChannel.topic !== newChannel.topic)
    changes.push({ name: 'Topic', value: `**Before:** ${oldChannel.topic || 'None'}\n**After:** ${newChannel.topic || 'None'}`, inline: false });
  if (!changes.length) return;
  const embed = new EmbedBuilder()
    .setColor(0x6366f1)
    .setTitle('📁 Channel Updated')
    .addFields({ name: 'Channel', value: newChannel.toString(), inline: true }, ...changes)
    .setFooter({ text: `ID: ${newChannel.id}` })
    .setTimestamp();
  await modLog(newChannel.guild, embed);
});

// Role created
client.on('roleCreate', async (role) => {
  const embed = new EmbedBuilder()
    .setColor(0x22c55e)
    .setTitle('🎭 Role Created')
    .addFields(
      { name: 'Name', value: role.name, inline: true },
      { name: 'Color', value: role.hexColor, inline: true },
      { name: 'Hoisted', value: role.hoist ? 'Yes' : 'No', inline: true },
    )
    .setFooter({ text: `ID: ${role.id}` })
    .setTimestamp();
  await modLog(role.guild, embed);
});

// Role deleted
client.on('roleDelete', async (role) => {
  const embed = new EmbedBuilder()
    .setColor(0xef4444)
    .setTitle('🎭 Role Deleted')
    .addFields({ name: 'Name', value: role.name, inline: true })
    .setFooter({ text: `ID: ${role.id}` })
    .setTimestamp();
  await modLog(role.guild, embed);
});

// Role updated
client.on('roleUpdate', async (oldRole, newRole) => {
  const changes = [];
  if (oldRole.name !== newRole.name)
    changes.push({ name: 'Name', value: `${oldRole.name} → ${newRole.name}`, inline: true });
  if (oldRole.hexColor !== newRole.hexColor)
    changes.push({ name: 'Color', value: `${oldRole.hexColor} → ${newRole.hexColor}`, inline: true });
  if (!changes.length) return;
  const embed = new EmbedBuilder()
    .setColor(0xf97316)
    .setTitle('🎭 Role Updated')
    .addFields({ name: 'Role', value: newRole.toString(), inline: true }, ...changes)
    .setFooter({ text: `ID: ${newRole.id}` })
    .setTimestamp();
  await modLog(newRole.guild, embed);
});

// Voice state log (join / leave / move)
client.on('voiceStateUpdate', async (oldState, newState) => {
  const member = newState.member ?? oldState.member;
  if (!member || member.user.bot) return;
  const guild = newState.guild ?? oldState.guild;

  if (!oldState.channelId && newState.channelId) {
    const embed = new EmbedBuilder()
      .setColor(0x22c55e)
      .setTitle('🔊 Joined Voice')
      .addFields(
        { name: 'User', value: `${member.user.tag}`, inline: true },
        { name: 'Channel', value: newState.channel.name, inline: true },
      )
      .setFooter({ text: `ID: ${member.id}` })
      .setTimestamp();
    await modLog(guild, embed);
  } else if (oldState.channelId && !newState.channelId) {
    const embed = new EmbedBuilder()
      .setColor(0xef4444)
      .setTitle('🔇 Left Voice')
      .addFields(
        { name: 'User', value: `${member.user.tag}`, inline: true },
        { name: 'Channel', value: oldState.channel.name, inline: true },
      )
      .setFooter({ text: `ID: ${member.id}` })
      .setTimestamp();
    await modLog(guild, embed);
  } else if (oldState.channelId && newState.channelId && oldState.channelId !== newState.channelId) {
    const embed = new EmbedBuilder()
      .setColor(0x6366f1)
      .setTitle('🔀 Moved Voice Channel')
      .addFields(
        { name: 'User', value: `${member.user.tag}`, inline: true },
        { name: 'From', value: oldState.channel.name, inline: true },
        { name: 'To', value: newState.channel.name, inline: true },
      )
      .setFooter({ text: `ID: ${member.id}` })
      .setTimestamp();
    await modLog(guild, embed);
  }
});

// Invite created
client.on('inviteCreate', async (invite) => {
  const embed = new EmbedBuilder()
    .setColor(0x10b981)
    .setTitle('🔗 Invite Created')
    .addFields(
      { name: 'Code', value: invite.code, inline: true },
      { name: 'Created By', value: invite.inviter ? invite.inviter.tag : 'Unknown', inline: true },
      { name: 'Channel', value: invite.channel?.name || 'Unknown', inline: true },
      { name: 'Max Uses', value: invite.maxUses ? `${invite.maxUses}` : 'Unlimited', inline: true },
      { name: 'Expires', value: invite.expiresAt ? `<t:${Math.floor(invite.expiresAt.getTime() / 1000)}:R>` : 'Never', inline: true },
    )
    .setTimestamp();
  await modLog(invite.guild, embed);
});

// Invite deleted
client.on('inviteDelete', async (invite) => {
  const embed = new EmbedBuilder()
    .setColor(0xef4444)
    .setTitle('🔗 Invite Deleted')
    .addFields({ name: 'Code', value: invite.code, inline: true })
    .setTimestamp();
  await modLog(invite.guild, embed);
});

// Server (guild) updated
client.on('guildUpdate', async (oldGuild, newGuild) => {
  const changes = [];
  if (oldGuild.name !== newGuild.name)
    changes.push({ name: 'Name', value: `${oldGuild.name} → ${newGuild.name}`, inline: false });
  if (oldGuild.icon !== newGuild.icon)
    changes.push({ name: 'Icon', value: 'Server icon was changed', inline: false });
  if (!changes.length) return;
  const embed = new EmbedBuilder()
    .setColor(0x6366f1)
    .setTitle('⚙️ Server Updated')
    .addFields(...changes)
    .setTimestamp();
  await modLog(newGuild, embed);
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

client.on('messageReactionAdd',    (reaction, user) => handleReaction(reaction, user, true));
client.on('messageReactionRemove', (reaction, user) => handleReaction(reaction, user, false));

// ── Slash command + button interaction handler ────────────────────────────────
const COMMAND_CHANNELS = {
  // Coin / economy commands → coin-shop channel
  coins:           '💰coin-shop',
  shop:            '💰coin-shop',
  inventory:       '💰coin-shop',
  tip:             '💰coin-shop',
  marketplace:     '🏪marketplace',

  // Leveling commands → levels channel
  rank:            '📈levels',
  level:           '📈levels',

  // Challenge, quests, season → their own channels
  challenge:       '🏆challenges',
  quests:          '🎯quests',
  season:          '🏅season',

  // Path → path lounge
  path:            '🛤️path-lounge',

  // Content → content channel
  content:         '🎬content',

  // LFG / squad
  lfg:             '🔍lfg',
  squad:           '🔍lfg',

  // Suggestions
  suggest:         '💡suggestions',

  // Giveaways
  giveaway:        '🎁giveaways',

  // Role shop
  roleshop:        '💰coin-shop',

  // Gambling
  gamble:          '💰coin-shop',

  // Contracts
  contracts:       '🎯quests',

  // Auction
  auction:         '🏪marketplace',

  // Streak
  streak:          '📈levels',

  // Admin (no restriction — admin-only by permissions)
  // serverstats and analytics are unrestricted so admins can use anywhere
  // analytics: unrestricted

  // Queue / matchmaking
  queue:           '🔍lfg',

  // Session hosting
  session:         '🎮game-sessions',

  // Achievements & upgrades
  achievements:    '🤖bot-commands',
  upgrades:        '💰coin-shop',

  // Claim pending rewards
  claim:           '🤖bot-commands',

  // Forex trade analysis
  trade:           '🤖bot-commands',

  // General bot commands
  '8ball':         '🤖bot-commands',
  wouldyourather:  '🤖bot-commands',
  profile:         '🤖bot-commands',
  rep:             '🤖bot-commands',
  userinfo:        '🤖bot-commands',
  stats:           '🤖bot-commands',
  minigames:       '🤖bot-commands',
  guide:           '🤖bot-commands',
  invite:          '🤖bot-commands',
  utility:         '🤖bot-commands',
};

client.on('interactionCreate', async (interaction) => {
  // Handle button interactions
  if (interaction.isButton()) {
    const customId = interaction.customId;

    // Giveaway entry
    if (customId.startsWith('giveaway_enter_')) {
      const giveawayCmd = require('./commands/giveaway');
      return giveawayCmd.handleEntry(interaction);
    }

    // Welcome quick-action buttons
    if (customId === 'welcome_daily') {
      const { claimDaily } = require('./data/store');
      const result = claimDaily(interaction.guild.id, interaction.user.id);
      if (!result.success) {
        const hours = Math.floor(result.remaining / 3600000);
        const mins  = Math.floor((result.remaining % 3600000) / 60000);
        return interaction.reply({ content: `⏳ Already claimed! Come back in **${hours}h ${mins}m**.`, ephemeral: true });
      }
      return interaction.reply({
        content: `💰 Daily claimed! You got **+${result.reward}** coins. 🔥 Streak: **${result.streak}** day${result.streak > 1 ? 's' : ''}!`,
        ephemeral: true,
      });
    }

    if (customId === 'welcome_invite') {
      return interaction.reply({
        content: `📲 Use \`/invite link\` to get your personal invite link and see all the rewards for bringing friends!\n\n🎁 Milestones: 1 invite = 200 coins · 5 invites = 1,000 coins + **🤝 Trusted** role · 10 invites = 2,500 coins + **🌟 VIP** role!`,
        ephemeral: true,
      });
    }

    return;
  }

  if (!interaction.isChatInputCommand()) return;

  const command = client.commands.get(interaction.commandName);
  if (!command) return;

  const requiredChannelName = COMMAND_CHANNELS[interaction.commandName];
  if (requiredChannelName) {
    const target = interaction.guild?.channels.cache.find(
      (c) => c.name === requiredChannelName && c.isTextBased()
    );
    if (target && interaction.channelId !== target.id) {
      return interaction.reply({
        content: `❌ Please use this command in ${target}.`,
        ephemeral: true,
      });
    }
  }

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

client.login(process.env.DISCORD_TOKEN);

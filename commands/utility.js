const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('utility')
    .setDescription('Useful server utilities')
    .addSubcommand((sub) => sub.setName('ping').setDescription("Check the bot's latency"))
    .addSubcommand((sub) =>
      sub
        .setName('avatar')
        .setDescription("Get a member's avatar")
        .addUserOption((opt) => opt.setName('user').setDescription('User to get avatar of'))
    )
    .addSubcommand((sub) => sub.setName('serverinfo').setDescription('View server information'))
    .addSubcommand((sub) => sub.setName('coinflip').setDescription('Flip a coin'))
    .addSubcommand((sub) => sub.setName('help').setDescription('View all available commands')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'ping') {
      const sent = await interaction.reply({ content: '🏓 Pinging...', fetchReply: true });
      const latency = sent.createdTimestamp - interaction.createdTimestamp;
      const embed = new EmbedBuilder()
        .setColor(0x6366f1)
        .setTitle('🏓 Pong!')
        .addFields(
          { name: 'Bot Latency', value: `${latency}ms`, inline: true },
          { name: 'API Latency', value: `${Math.round(interaction.client.ws.ping)}ms`, inline: true }
        )
        .setTimestamp();
      await interaction.editReply({ content: null, embeds: [embed] });
    }

    if (sub === 'avatar') {
      const user = interaction.options.getUser('user') ?? interaction.user;
      const embed = new EmbedBuilder()
        .setColor(0x6366f1)
        .setTitle(`🖼️ ${user.username}'s Avatar`)
        .setImage(user.displayAvatarURL({ dynamic: true, size: 512 }))
        .setTimestamp();
      await interaction.reply({ embeds: [embed] });
    }

    if (sub === 'serverinfo') {
      const guild = interaction.guild;
      await guild.members.fetch();
      const bots = guild.members.cache.filter((m) => m.user.bot).size;
      const humans = guild.memberCount - bots;

      const embed = new EmbedBuilder()
        .setColor(0x6366f1)
        .setTitle(`📊 ${guild.name}`)
        .setThumbnail(guild.iconURL({ dynamic: true }))
        .addFields(
          { name: 'Owner', value: `<@${guild.ownerId}>`, inline: true },
          { name: 'Members', value: `${humans} humans / ${bots} bots`, inline: true },
          { name: 'Channels', value: `${guild.channels.cache.size}`, inline: true },
          { name: 'Roles', value: `${guild.roles.cache.size}`, inline: true },
          { name: 'Boosts', value: `${guild.premiumSubscriptionCount}`, inline: true },
          { name: 'Created', value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:F>`, inline: true }
        )
        .setFooter({ text: `ID: ${guild.id}` })
        .setTimestamp();
      await interaction.reply({ embeds: [embed] });
    }

    if (sub === 'coinflip') {
      const result = Math.random() < 0.5 ? '🪙 Heads' : '🪙 Tails';
      const embed = new EmbedBuilder()
        .setColor(0xf59e0b)
        .setTitle('🪙 Coin Flip')
        .setDescription(`**${result}!**`)
        .setTimestamp();
      await interaction.reply({ embeds: [embed] });
    }

    if (sub === 'help') {
      const embed = new EmbedBuilder()
        .setColor(0x6366f1)
        .setTitle('📖 Command List')
        .addFields(
          { name: '🔨 Moderation', value: '`/ban` `/kick` `/timeout` `/warn` `/warnings` `/clear` `/lock` `/unban`' },
          { name: '🎭 Roles', value: '`/role add` `/role remove` `/reactionroles` `/config autorole`' },
          { name: '⭐ Levels', value: '`/level check` `/level leaderboard` `/rank`' },
          { name: '💰 Economy', value: '`/coins balance` `/coins daily` `/coins give` `/shop browse` `/shop buy`' },
          { name: '🎮 Gaming', value: '`/lfg` `/wouldyourather` `/8ball` `/tip`' },
          { name: '💡 Suggestions', value: '`/suggest`' },
          { name: '🤖 AI', value: '`/chat`' },
          { name: '🛠️ Utility', value: '`/utility ping` `/utility avatar` `/utility serverinfo` `/utility coinflip` `/utility help`' },
          { name: '⚙️ Config', value: '`/config logs` `/config automod` `/config autorole` `/config blacklist`' },
          { name: '🏗️ Setup', value: '`/setup` `/reactionroles`' }
        )
        .setFooter({ text: 'Use /utility help to see this anytime' })
        .setTimestamp();
      await interaction.reply({ embeds: [embed] });
    }
  },
};

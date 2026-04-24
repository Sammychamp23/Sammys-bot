const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getLevel, getLeaderboard, xpForLevel } = require('../data/store');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('level')
    .setDescription('Check your level or view the leaderboard')
    .addSubcommand((sub) =>
      sub
        .setName('check')
        .setDescription('Check your current level')
        .addUserOption((opt) => opt.setName('user').setDescription('User to check'))
    )
    .addSubcommand((sub) =>
      sub.setName('leaderboard').setDescription('View the top 10 members by level')
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'check') {
      const target = interaction.options.getUser('user') ?? interaction.user;
      const { level, xp } = getLevel(interaction.guild.id, target.id);
      const needed = xpForLevel(level + 1);
      const progress = Math.floor((xp / needed) * 20);
      const bar = '█'.repeat(progress) + '░'.repeat(20 - progress);

      const embed = new EmbedBuilder()
        .setColor(0x6366f1)
        .setTitle(`⭐ ${target.username}'s Level`)
        .setThumbnail(target.displayAvatarURL())
        .addFields(
          { name: 'Level', value: `**${level}**`, inline: true },
          { name: 'XP', value: `${xp} / ${needed}`, inline: true },
          { name: 'Progress', value: `\`${bar}\`` }
        )
        .setFooter({ text: 'Keep chatting to earn XP!' })
        .setTimestamp();

      return interaction.reply({ embeds: [embed] });
    }

    if (sub === 'leaderboard') {
      const board = getLeaderboard(interaction.guild.id);

      const medals = ['🥇', '🥈', '🥉'];
      const lines = await Promise.all(
        board.map(async (entry, i) => {
          const user = await interaction.client.users.fetch(entry.userId).catch(() => null);
          const name = user ? user.username : 'Unknown';
          return `${medals[i] ?? `**${i + 1}.**`} ${name} — Level **${entry.level}** (${entry.xp} XP)`;
        })
      );

      const embed = new EmbedBuilder()
        .setColor(0xf59e0b)
        .setTitle('🏆 Level Leaderboard')
        .setDescription(lines.join('\n') || 'No data yet — start chatting!')
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });
    }
  },
};

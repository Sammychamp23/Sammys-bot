const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ban')
    .setDescription('Ban a member from the server')
    .addUserOption((option) =>
      option.setName('target').setDescription('The member to ban').setRequired(true)
    )
    .addStringOption((option) =>
      option.setName('reason').setDescription('Reason for the ban')
    )
    .addIntegerOption((option) =>
      option
        .setName('delete_days')
        .setDescription('Number of days of messages to delete (0-7)')
        .setMinValue(0)
        .setMaxValue(7)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),

  async execute(interaction) {
    const target = interaction.options.getMember('target');
    const reason = interaction.options.getString('reason') ?? 'No reason provided';
    const deleteDays = interaction.options.getInteger('delete_days') ?? 0;

    if (!target) return interaction.reply({ content: '❌ Member not found.', ephemeral: true });
    if (!target.bannable)
      return interaction.reply({ content: '❌ I cannot ban this member.', ephemeral: true });
    if (target.id === interaction.user.id)
      return interaction.reply({ content: '❌ You cannot ban yourself.', ephemeral: true });

    await target.ban({ reason, deleteMessageSeconds: deleteDays * 86400 });

    const embed = new EmbedBuilder()
      .setColor(0xef4444)
      .setTitle('🔨 Member Banned')
      .addFields(
        { name: 'Member', value: `${target.user.tag} (${target.id})` },
        { name: 'Moderator', value: interaction.user.tag },
        { name: 'Reason', value: reason },
        { name: 'Messages Deleted', value: `${deleteDays} day(s)` }
      )
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  },
};

const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { getCoins, addCoins, claimDaily } = require('../data/store');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('coins')
    .setDescription('Manage your server coins')
    .addSubcommand((sub) =>
      sub
        .setName('balance')
        .setDescription('Check your coin balance')
        .addUserOption((opt) => opt.setName('user').setDescription('User to check'))
    )
    .addSubcommand((sub) =>
      sub.setName('daily').setDescription('Claim your daily coins (150–250 coins)')
    )
    .addSubcommand((sub) =>
      sub
        .setName('give')
        .setDescription('Give coins to another member')
        .addUserOption((opt) => opt.setName('user').setDescription('Who to give coins to').setRequired(true))
        .addIntegerOption((opt) =>
          opt.setName('amount').setDescription('Amount to give').setRequired(true).setMinValue(1)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('add')
        .setDescription('Add coins to a member (Admin only)')
        .addUserOption((opt) => opt.setName('user').setDescription('Target user').setRequired(true))
        .addIntegerOption((opt) =>
          opt.setName('amount').setDescription('Amount to add').setRequired(true)
        )
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guild.id;

    if (sub === 'balance') {
      const target = interaction.options.getUser('user') ?? interaction.user;
      const { coins } = getCoins(guildId, target.id);

      const embed = new EmbedBuilder()
        .setColor(0xf59e0b)
        .setTitle(`💰 ${target.username}'s Balance`)
        .setDescription(`**${coins.toLocaleString()} coins**`)
        .setFooter({ text: 'Earn coins by chatting or use /coins daily' })
        .setTimestamp();

      return interaction.reply({ embeds: [embed] });
    }

    if (sub === 'daily') {
      const result = claimDaily(guildId, interaction.user.id);
      if (!result.success) {
        const hours = Math.floor(result.remaining / 3600000);
        const mins = Math.floor((result.remaining % 3600000) / 60000);
        return interaction.reply({
          content: `⏳ You already claimed your daily coins! Come back in **${hours}h ${mins}m**.`,
          ephemeral: true,
        });
      }

      const embed = new EmbedBuilder()
        .setColor(0x22c55e)
        .setTitle('💰 Daily Coins Claimed!')
        .addFields(
          { name: 'Reward', value: `+**${result.reward}** coins`, inline: true },
          { name: 'New Balance', value: `**${result.total.toLocaleString()}** coins`, inline: true }
        )
        .setFooter({ text: 'Come back tomorrow for more!' })
        .setTimestamp();

      return interaction.reply({ embeds: [embed] });
    }

    if (sub === 'give') {
      const target = interaction.options.getUser('user');
      const amount = interaction.options.getInteger('amount');
      const { coins: senderCoins } = getCoins(guildId, interaction.user.id);

      if (target.id === interaction.user.id)
        return interaction.reply({ content: '❌ You cannot give coins to yourself.', ephemeral: true });
      if (senderCoins < amount)
        return interaction.reply({ content: `❌ You only have **${senderCoins}** coins.`, ephemeral: true });

      addCoins(guildId, interaction.user.id, -amount);
      const newBalance = addCoins(guildId, target.id, amount);

      const embed = new EmbedBuilder()
        .setColor(0x22c55e)
        .setTitle('💸 Coins Sent!')
        .addFields(
          { name: 'Sent To', value: target.username, inline: true },
          { name: 'Amount', value: `**${amount}** coins`, inline: true },
          { name: "Recipient's Balance", value: `**${newBalance.toLocaleString()}** coins` }
        )
        .setTimestamp();

      return interaction.reply({ embeds: [embed] });
    }

    if (sub === 'add') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator))
        return interaction.reply({ content: '❌ Admins only.', ephemeral: true });

      const target = interaction.options.getUser('user');
      const amount = interaction.options.getInteger('amount');
      const newBalance = addCoins(guildId, target.id, amount);

      await interaction.reply({
        content: `✅ Added **${amount}** coins to ${target.username}. New balance: **${newBalance.toLocaleString()}**.`,
        ephemeral: true,
      });
    }
  },
};

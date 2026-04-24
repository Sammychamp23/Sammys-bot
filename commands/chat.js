const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const OpenAI = require('openai');

const openai = new OpenAI({
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL || process.env.OPENAI_BASE_URL,
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY,
});

const CHAT_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

const conversationHistory = new Map();

module.exports = {
  data: new SlashCommandBuilder()
    .setName('chat')
    .setDescription('Chat with the AI assistant')
    .addStringOption((option) =>
      option.setName('message').setDescription('Your message').setRequired(true)
    )
    .addBooleanOption((option) =>
      option.setName('reset').setDescription('Reset your conversation history')
    ),

  async execute(interaction) {
    await interaction.deferReply();

    const message = interaction.options.getString('message');
    const reset = interaction.options.getBoolean('reset') ?? false;
    const userId = interaction.user.id;

    if (reset) {
      conversationHistory.delete(userId);
    }

    if (!conversationHistory.has(userId)) {
      conversationHistory.set(userId, [
        {
          role: 'system',
          content:
            'You are a helpful and friendly assistant for a gaming Discord server. You help members with game tips, answer questions, and keep the conversation fun. Keep responses concise and suitable for Discord.',
        },
      ]);
    }

    const history = conversationHistory.get(userId);
    history.push({ role: 'user', content: message });

    try {
      const response = await openai.chat.completions.create({
        model: CHAT_MODEL,
        max_completion_tokens: 500,
        messages: history,
      });

      const reply = response.choices[0]?.message?.content ?? 'I had trouble thinking of a response!';
      history.push({ role: 'assistant', content: reply });

      if (history.length > 21) {
        history.splice(1, 2);
      }

      const embed = new EmbedBuilder()
        .setColor(0x6366f1)
        .setAuthor({ name: interaction.user.username, iconURL: interaction.user.displayAvatarURL() })
        .addFields(
          { name: '💬 You', value: message.length > 1024 ? message.slice(0, 1021) + '...' : message },
          { name: '🤖 Assistant', value: reply.length > 1024 ? reply.slice(0, 1021) + '...' : reply }
        )
        .setFooter({ text: reset ? 'Conversation reset ✓' : 'Tip: Use /chat reset:True to start a new conversation' })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      console.error(error);
      await interaction.editReply({ content: '❌ Something went wrong with the AI. Please try again.' });
    }
  },
};

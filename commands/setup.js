const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  ChannelType,
} = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setup')
    .setDescription('Set up the server with channels, categories, and roles for a gaming server')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    await interaction.deferReply();

    const guild = interaction.guild;

    try {
      // ── Roles ──────────────────────────────────────────────────────────────
      const roleData = [
        // Staff
        { name: '👑 Owner',              color: 0xf59e0b, hoist: true  },
        { name: '⚔️ Co-Owner',           color: 0xf97316, hoist: true  },
        { name: '🔴 Admin',              color: 0xef4444, hoist: true  },
        { name: '🛡️ Moderator',          color: 0x3b82f6, hoist: true  },
        { name: '🔨 Trial Moderator',    color: 0x60a5fa, hoist: true  },
        { name: '🤝 Helper',             color: 0x38bdf8, hoist: true  },
        // Special
        { name: '🤖 Bot',               color: 0x64748b, hoist: false },
        { name: '💎 Server Booster',    color: 0xf472b6, hoist: true  },
        { name: '🌟 VIP',               color: 0xa855f7, hoist: true  },
        { name: '🎉 Giveaway Winner',   color: 0xfbbf24, hoist: false },
        // Member levels
        { name: '🏆 Legend',            color: 0xf59e0b, hoist: true  },
        { name: '💜 Elite',             color: 0x8b5cf6, hoist: true  },
        { name: '🎮 Gamer',             color: 0x22c55e, hoist: true  },
        { name: '🆕 Member',            color: 0x6b7280, hoist: true  },
        // Platform roles
        { name: '🖥️ PC',               color: 0x0ea5e9, hoist: false },
        { name: '🎮 PlayStation',       color: 0x003087, hoist: false },
        { name: '🟢 Xbox',             color: 0x107c10, hoist: false },
        { name: '📱 Mobile',            color: 0x6366f1, hoist: false },
        { name: '🔴 Nintendo Switch',   color: 0xe4000f, hoist: false },
        // Game roles
        { name: '🔫 Fortnite',          color: 0x9333ea, hoist: false },
        { name: '⚡ Valorant',          color: 0xff4655, hoist: false },
        { name: '🔲 Minecraft',         color: 0x5b8731, hoist: false },
        { name: '💣 Call of Duty',      color: 0x4b5320, hoist: false },
        { name: '🏃 Apex Legends',      color: 0xda292a, hoist: false },
        { name: '🌍 GTA V',             color: 0x2563eb, hoist: false },
        { name: '🔵 Roblox',            color: 0xe2231a, hoist: false },
        { name: '🗡️ League of Legends', color: 0xc89b3c, hoist: false },
        { name: '💀 Warzone',           color: 0x374151, hoist: false },
        { name: '🎯 Overwatch 2',       color: 0xf99e1a, hoist: false },
        { name: '⚽ Rocket League',     color: 0x1a6ef9, hoist: false },
        { name: '🕷️ Dead by Daylight',  color: 0x8b0000, hoist: false },
        // Ping roles
        { name: '📣 Announcements',     color: 0xfbbf24, hoist: false },
        { name: '🎉 Giveaways',         color: 0xec4899, hoist: false },
        { name: '🎮 Game Night',        color: 0x10b981, hoist: false },
        { name: '📺 Stream Pings',      color: 0x7c3aed, hoist: false },
        { name: '🔔 Event Pings',       color: 0xf59e0b, hoist: false },
      ];

      const createdRoles = {};
      for (const r of roleData) {
        const existing = guild.roles.cache.find((role) => role.name === r.name);
        const role = existing ?? await guild.roles.create({ name: r.name, color: r.color, hoist: r.hoist });
        createdRoles[r.name] = role;
      }

      // ── Helper: create category + channels ────────────────────────────────
      async function makeCategory(name, channels) {
        const existingCat = guild.channels.cache.find(
          (c) => c.type === ChannelType.GuildCategory && c.name === name
        );
        const category = existingCat ?? await guild.channels.create({
          name,
          type: ChannelType.GuildCategory,
        });

        for (const ch of channels) {
          const existing = guild.channels.cache.find(
            (c) => c.name === ch.name && c.parentId === category.id
          );
          if (!existing) {
            await guild.channels.create({
              name: ch.name,
              type: ch.voice ? ChannelType.GuildVoice : ChannelType.GuildText,
              parent: category.id,
              topic: ch.topic ?? null,
            });
          }
        }
      }

      // ── Categories & Channels ─────────────────────────────────────────────
      await makeCategory('📢 INFORMATION', [
        { name: '📜rules',        topic: 'Read and follow the server rules.' },
        { name: '📣announcements',topic: 'Server announcements and updates.' },
        { name: '👋welcome',      topic: 'Welcome new members!' },
        { name: '🗺️roles',        topic: 'Assign yourself roles here.' },
      ]);

      await makeCategory('💬 GENERAL', [
        { name: '💬general',      topic: 'General chat for everything.' },
        { name: '🤣memes',        topic: 'Post your best memes here.' },
        { name: '📸media',        topic: 'Share screenshots, clips, and art.' },
        { name: '🔗links',        topic: 'Share useful links and resources.' },
      ]);

      await makeCategory('🎮 GAMING', [
        { name: '🎮game-chat',    topic: 'Talk about any game.' },
        { name: '🏆clips-highlights', topic: 'Share your best gaming moments.' },
        { name: '🔍lfg',          topic: 'Looking for group? Post here.' },
        { name: '🗳️game-polls',   topic: 'Vote on games to play together.' },
      ]);

      await makeCategory('🤖 BOT COMMANDS', [
        { name: '🤖bot-commands', topic: 'Use bot commands here.' },
        { name: '🎵music-commands', topic: 'Use music bot commands here.' },
      ]);

      await makeCategory('🔊 VOICE CHANNELS', [
        { name: '🎮 Gaming Lounge',  voice: true },
        { name: '🏆 Competitive',    voice: true },
        { name: '💬 Chill Zone',     voice: true },
        { name: '🎵 Music Room',     voice: true },
        { name: '📺 Stream Room',    voice: true },
        { name: '🔕 AFK',           voice: true },
      ]);

      await makeCategory('🔒 STAFF ONLY', [
        { name: '🛡️staff-chat',   topic: 'Private staff discussion.' },
        { name: '📋mod-log',      topic: 'Moderation action log.' },
        { name: '🚨reports',      topic: 'User reports go here.' },
      ]);

      await makeCategory('⭐ LEVELS & ECONOMY', [
        { name: '📈levels',       topic: 'Level up announcements and the leaderboard. Use /level to check your rank!' },
        { name: '💰coin-shop',    topic: 'Use /coins daily to earn coins, /shop to spend them, and /coins balance to check your balance.' },
        { name: '💡suggestions',  topic: 'Submit suggestions with /suggest. Vote with 👍 or 👎!' },
      ]);

      // VIP lounge — only visible to VIP role
      const vipRole = guild.roles.cache.find((r) => r.name === '🌟 VIP');
      const everyoneRole = guild.roles.everyone;

      const existingVipCat = guild.channels.cache.find(
        (c) => c.type === ChannelType.GuildCategory && c.name === '💎 VIP LOUNGE'
      );
      const vipCategory = existingVipCat ?? await guild.channels.create({
        name: '💎 VIP LOUNGE',
        type: ChannelType.GuildCategory,
        permissionOverwrites: [
          { id: everyoneRole.id, deny: [PermissionFlagsBits.ViewChannel] },
          ...(vipRole ? [{ id: vipRole.id, allow: [PermissionFlagsBits.ViewChannel] }] : []),
        ],
      });

      const vipChannels = [
        { name: '💎vip-lounge',   topic: 'Exclusive chat for VIP members.' },
        { name: '🎁vip-perks',    topic: 'VIP-only giveaways and perks.' },
      ];
      for (const ch of vipChannels) {
        const existing = guild.channels.cache.find((c) => c.name === ch.name && c.parentId === vipCategory.id);
        if (!existing) {
          await guild.channels.create({
            name: ch.name,
            type: ChannelType.GuildText,
            parent: vipCategory.id,
            topic: ch.topic,
            permissionOverwrites: [
              { id: everyoneRole.id, deny: [PermissionFlagsBits.ViewChannel] },
              ...(vipRole ? [{ id: vipRole.id, allow: [PermissionFlagsBits.ViewChannel] }] : []),
            ],
          });
        }
      }

      // Update voice channels to include temp room creator
      const voiceCat = guild.channels.cache.find(
        (c) => c.type === ChannelType.GuildCategory && c.name === '🔊 VOICE CHANNELS'
      );
      if (voiceCat) {
        const hasCreateRoom = guild.channels.cache.find((c) => c.name === '➕ Create a Room');
        if (!hasCreateRoom) {
          await guild.channels.create({
            name: '➕ Create a Room',
            type: ChannelType.GuildVoice,
            parent: voiceCat.id,
          });
        }
      }

      // ── Success embed ──────────────────────────────────────────────────────
      const embed = new EmbedBuilder()
        .setColor(0x22c55e)
        .setTitle('🎮 Server Setup Complete!')
        .setDescription('Your gaming server has been set up successfully.')
        .addFields(
          {
            name: '📁 Categories Created',
            value: [
              '📢 Information',
              '💬 General',
              '🎮 Gaming',
              '🤖 Bot Commands',
              '🔊 Voice Channels',
              '🔒 Staff Only',
            ].join('\n'),
            inline: true,
          },
          {
            name: '🎭 Staff Roles',
            value: '👑 Owner\n⚔️ Co-Owner\n🔴 Admin\n🛡️ Moderator\n🔨 Trial Moderator\n🤝 Helper',
            inline: true,
          },
          {
            name: '⭐ Special Roles',
            value: '💎 Server Booster\n🌟 VIP\n🎉 Giveaway Winner\n🤖 Bot',
            inline: true,
          },
          {
            name: '🏅 Member Levels',
            value: '🏆 Legend\n💜 Elite\n🎮 Gamer\n🆕 Member',
            inline: true,
          },
          {
            name: '🖥️ Platform Roles',
            value: '🖥️ PC\n🎮 PlayStation\n🟢 Xbox\n📱 Mobile\n🔴 Nintendo Switch',
            inline: true,
          },
          {
            name: '🎮 Game Roles',
            value: '🔫 Fortnite\n⚡ Valorant\n🔲 Minecraft\n💣 Call of Duty\n🏃 Apex Legends\n🌍 GTA V\n🔵 Roblox\n🗡️ League of Legends\n💀 Warzone\n🎯 Overwatch 2\n⚽ Rocket League\n🕷️ Dead by Daylight',
            inline: true,
          },
          {
            name: '🔔 Ping Roles',
            value: '📣 Announcements\n🎉 Giveaways\n🎮 Game Night\n📺 Stream Pings\n🔔 Event Pings',
            inline: true,
          }
        )
        .setFooter({ text: 'Tip: Existing channels and roles were not duplicated.' })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      console.error(error);
      await interaction.editReply({
        content: '❌ Something went wrong during setup. Make sure I have **Administrator** permissions.',
      });
    }
  },
};

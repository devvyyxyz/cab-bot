// src/handlers/spawn.js
// Handles /forcespawn

const { MessageFlags, PermissionFlagsBits } = require('discord.js');

async function handleForceSpawn(interaction, ctx) {
  // Require Manage Channels permission to force a spawn.
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels)) {
    await interaction.reply({
      content: '❌ You need the **Manage Channels** permission to force a spawn, fr.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const guildId = interaction.guildId;
  const channelId = ctx.db.getGuildSetting(guildId, 'spawn_channel');
  if (!channelId) {
    await interaction.reply({
      content: '❌ No spawn channel is set for this server. Set one with `/settings spawnchannel channel:<channel>` first.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // If there's already an active spawn, deny to avoid overlap.
  if (ctx.activeSpawns.has(guildId)) {
    await interaction.reply({
      content: '⏳ A brainrot is already spawned in this server. Wait for it to be caught or expire, fr.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  const guild = interaction.guild;
  if (!guild) {
    await interaction.editReply({ content: '❌ Could not resolve this guild, fr.' });
    return;
  }

  try {
    await ctx.spawnRotForGuild(guild);
    await interaction.editReply({ content: '✅ Forced a spawn! Check the spawn channel, fr.' });
  } catch (err) {
    ctx.log.error('Force spawn error:', err);
    await interaction.editReply({
      content: `❌ Couldn't force a spawn: ${err.message || 'unknown error'}`,
    });
  }
}

module.exports = handleForceSpawn;

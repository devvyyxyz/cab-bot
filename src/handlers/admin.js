// src/handlers/admin.js

const { MessageFlags } = require('discord.js');
const handleForceSpawn = require('./spawn');

async function handleAdmin(interaction, ctx) {
  const sub = interaction.options.getSubcommand();
  if (sub === 'forcespawn') {
    return handleForceSpawn(interaction, ctx);
  }
  await interaction.reply({
    content: 'Unknown admin subcommand, fr.',
    flags: MessageFlags.Ephemeral,
  });
}

module.exports = handleAdmin;

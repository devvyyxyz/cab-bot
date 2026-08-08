// src/handlers/ping.js

const { MessageFlags } = require('discord.js');

async function handlePing(interaction, ctx) {
  const sent = await interaction.reply({ content: 'Pinging...', flags: MessageFlags.Ephemeral });
  const latency = sent.createdTimestamp - interaction.createdTimestamp;
  const apiPing = Math.round(ctx.client.ws.ping);
  await interaction.editReply({ content: `🏓 Pong! Latency: ${latency}ms | API: ${apiPing}ms` });
}

module.exports = handlePing;

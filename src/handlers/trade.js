// src/handlers/trade.js

const { MessageFlags } = require('discord.js');
const { buildTradeEmbed } = require('../embeds');
const { findRot, rarityStars, rarityLabel } = require('../helpers');

async function handleTrade(interaction, ctx) {
  const aName = interaction.options.getString('a');
  const bName = interaction.options.getString('b');
  const aIv = interaction.options.getInteger('a_iv') ?? 50;
  const aLevel = interaction.options.getInteger('a_level') ?? 10;
  const bIv = interaction.options.getInteger('b_iv') ?? 50;
  const bLevel = interaction.options.getInteger('b_level') ?? 10;

  const rotA = findRot(aName);
  const rotB = findRot(bName);
  if (!rotA || !rotB) {
    await interaction.reply({ content: 'Couldn\'t find one of those brainrots, fr. Use autocomplete to pick valid names.', flags: MessageFlags.Ephemeral });
    return;
  }
  await interaction.reply({ embeds: [buildTradeEmbed(rotA, rotB, aIv, aLevel, bIv, bLevel)] });
}

module.exports = handleTrade;

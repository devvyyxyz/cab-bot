// src/handlers/info.js

const { MessageFlags } = require('discord.js');
const {
  buildRotEmbed,
  buildBagEmbed,
  buildSkinEmbed,
  buildAboutEmbed,
  buildSpawnEmbed,
  buildRandomSpawnEmbed,
} = require('../embeds');
const { findRot, findItem, findSkin, pick } = require('../helpers');
const inventoryHandlers = require('./inventory');

async function handleInfo(interaction, ctx) {
  const type = interaction.options.getString('type');
  const query = interaction.options.getString('name');

  if (type === 'rot') {
    const random = interaction.options.getBoolean('random');
    const rot = (random || !query) ? pick(ctx.data.rots) : findRot(query);
    if (!rot) {
      await interaction.reply({ content: `Couldn't find a rot matching \`${query}\`, fr. Try the autocomplete.`, flags: MessageFlags.Ephemeral });
      return;
    }
    await interaction.reply({ embeds: [buildRotEmbed(rot)] });
    return;
  }

  if (type === 'hoverboard') {
    const skin = query ? findSkin(query) : pick(ctx.data.skins);
    if (!skin) {
      await interaction.reply({ content: `Couldn't find a hoverboard matching \`${query}\`, fr. Try the autocomplete.`, flags: MessageFlags.Ephemeral });
      return;
    }
    await interaction.reply({ embeds: [buildSkinEmbed(skin)] });
    return;
  }

  if (type === 'item') {
    const random = interaction.options.getBoolean('random');
    const item = (random || !query) ? pick(ctx.data.items) : findItem(query);
    if (!item) {
      await interaction.reply({ content: `Couldn't find an item matching \`${query}\`, fr. Try the autocomplete.`, flags: MessageFlags.Ephemeral });
      return;
    }
    await interaction.reply({ embeds: [buildBagEmbed(item)] });
    return;
  }

  if (type === 'about') {
    await interaction.reply({ embeds: [buildAboutEmbed()] });
    return;
  }

  if (type === 'inventory') {
    // Delegate to the inventory handler so /info type:inventory works like /inventory
    await inventoryHandlers.handleInventory(interaction, ctx);
    return;
  }

  if (type === 'spawnlocation') {
    const world = interaction.options.getInteger('world');
    const zone = interaction.options.getInteger('zone');

    if (!world && !zone) {
      await interaction.reply({ embeds: [buildRandomSpawnEmbed()] });
      return;
    }

    if ((world && !zone) || (zone && !world)) {
      await interaction.reply({
        content: 'Give me both `world` and `zone`, bro — or leave both blank for a random spawn. Like `/info type:spawnlocation world:2 zone:3`.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const key = `W${world}.Z${zone}`;
    const list = ctx.data.spawnIndex.get(key);
    if (!list || list.length === 0) {
      await interaction.reply({
        content: `No brainrots spawn at W${world}.Z${zone}, fr. Valid zones: ${ctx.data.spawnKeys.join(', ')}.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await interaction.reply({ embeds: [buildSpawnEmbed(key, list)] });
    return;
  }

  await interaction.reply({ content: 'Unknown info type, fr. Pick rot / hoverboard / item / spawnlocation / about.', flags: MessageFlags.Ephemeral });
}

module.exports = handleInfo;

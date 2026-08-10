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
const { findRot, findItem, findSkin } = require('../helpers');
const { resolveRobloxUser, fetchInventory, cleanUserInput, looksLikeUserId } = require('../helpers');
const { Paginator } = require('../paginator');
const { buildInventoryEmbeds } = require('../helpers');
const { pick } = require('../data');

async function handleInfo(interaction, ctx) {
  const sub = interaction.options.getSubcommand();
  const query = interaction.options.getString('name');
  const user = interaction.options.getString('user');

  if (sub === 'brainrot') {
    const random = interaction.options.getBoolean('random');
    const rot = (random || !query) ? pick(ctx.data.rots) : findRot(query);
    if (!rot) {
      await interaction.reply({ content: `Couldn't find a rot matching \`${query}\`, fr. Try the autocomplete.`, flags: MessageFlags.Ephemeral });
      return;
    }
    await interaction.reply({ embeds: [buildRotEmbed(rot)] });
    return;
  }

  if (sub === 'hoverboard') {
    const random = interaction.options.getBoolean('random');
    const skin = (random || !query) ? pick(ctx.data.skins) : findSkin(query);
    if (!skin) {
      await interaction.reply({ content: `Couldn't find a hoverboard matching \`${query}\`, fr. Try the autocomplete.`, flags: MessageFlags.Ephemeral });
      return;
    }
    await interaction.reply({ embeds: [buildSkinEmbed(skin)] });
    return;
  }

  if (sub === 'item') {
    const random = interaction.options.getBoolean('random');
    const item = (random || !query) ? pick(ctx.data.items) : findItem(query);
    if (!item) {
      await interaction.reply({ content: `Couldn't find an item matching \`${query}\`, fr. Try the autocomplete.`, flags: MessageFlags.Ephemeral });
      return;
    }
    await interaction.reply({ embeds: [buildBagEmbed(item)] });
    return;
  }

  if (sub === 'inventory') {
    if (!user) {
      await interaction.reply({
        content: 'Give me a Roblox user ID or username for live API inventory lookup, bro. `/info inventory user:1559610713`',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await interaction.deferReply();
    const rawUser = user;
    const userId = cleanUserInput(rawUser);
    if (!userId) {
      await interaction.editReply({ content: `Invalid user input \`${rawUser}\`, fr. Use a UID or username.` });
      return;
    }
    let resolvedId = userId;
    if (!looksLikeUserId(userId)) {
      const resolved = await resolveRobloxUser(userId);
      if (resolved.error) {
        await interaction.editReply({ content: `Couldn't resolve \`${userId}\` to a Roblox user, fr. ${resolved.error}` });
        return;
      }
      resolvedId = resolved.userId;
    }
    const result = await fetchInventory(resolvedId);
    if (result.error) {
      await interaction.editReply({ content: `Couldn't pull inventory for \`${userId}\` — ${result.error}.\nDouble-check the UID is a real Roblox user with brainrot progress, ong.` });
      return;
    }
    const inv = result.data;
    if (!inv.Team && !inv.PC && !inv.Hoverboards && !inv.Bag) {
      await interaction.editReply({ content: `Player \`${userId}\` has an empty inventory, fr.` });
      return;
    }
    const { pages, categoryRanges } = buildInventoryEmbeds(userId, inv);
    const paginator = new Paginator({ pages, categoryRanges, mode: 'components', userId: interaction.user.id, timeout: 120000 });
    await paginator.send(interaction);
    return;
  }

  if (sub === 'spawn') {
    const random = interaction.options.getBoolean('random');
    if (random) {
      await interaction.reply({ embeds: [buildRandomSpawnEmbed()] });
      return;
    }

    const world = interaction.options.getInteger('world');
    const zone = interaction.options.getInteger('zone');

    if (!world && !zone) {
      await interaction.reply({ embeds: [buildRandomSpawnEmbed()] });
      return;
    }

    if ((world && !zone) || (zone && !world)) {
      await interaction.reply({
        content: 'Give me both `world` and `zone`, bro — or leave both blank for a random spawn. Like `/info spawn world:2 zone:3`.',
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

  await interaction.reply({ content: 'Unknown info subcommand, fr. Pick brainrot / hoverboard / item / spawn / inventory.', flags: MessageFlags.Ephemeral });
}

module.exports = handleInfo;

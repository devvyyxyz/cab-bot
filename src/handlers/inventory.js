// src/handlers/inventory.js

const { MessageFlags } = require('discord.js');
const { Paginator } = require('../paginator');
const { buildInventoryEmbeds } = require('../helpers');
const { resolveRobloxUser, fetchInventory, cleanUserInput, looksLikeUserId } = require('../helpers');
const { entryToTierlistEntry, runTierlistScript } = require('../helpers');

async function handleInventory(interaction, ctx) {
  const rawUser = interaction.options.getString('user');
  const userId = cleanUserInput(rawUser);
  if (!userId) {
    await interaction.reply({
      content: 'Give me a user ID or username, bro. `/inventory user:1559610713` or `/inventory user:YourUsername` for example.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  await interaction.deferReply();
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
  const pages = buildInventoryEmbeds(userId, inv);
  const paginator = new Paginator({ pages, mode: 'components', userId: interaction.user.id, timeout: 120000 });
  await paginator.send(interaction);
}

async function handleTierlist(interaction, ctx) {
  const rawUser = interaction.options.getString('user');
  const userId = cleanUserInput(rawUser);
  const source = interaction.options.getString('source') || 'team';
  if (!userId) {
    await interaction.reply({
      content: 'Give me a user ID or username, bro. `/tierlist user:1559610713` or `/tierlist user:YourUsername` for example.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  await interaction.deferReply();
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
  const rawEntries = source === 'pc' ? inv.PC || [] : inv.Team || [];
  if (!rawEntries.length) {
    await interaction.editReply({ content: `Player \`${userId}\` has no entries in their ${source.toUpperCase()}, fr. Try the other source?` });
    return;
  }
  const entries = rawEntries.map(entryToTierlistEntry);
  const payload = { user: userId, source, entries };
  const tierResult = await runTierlistScript(payload);
  if (!tierResult.ok) {
    const isMissingPython = tierResult.stderr && /not found|No such file|ENOENT|python3.*not/.test(tierResult.stderr);
    const hint = isMissingPython ? 'Make sure Python 3 and Pillow (`pip install Pillow`) are installed on the server.' : 'Try again in a moment, fr.';
    await interaction.editReply({ content: `Tierlist generation failed: ${tierResult.error || 'unknown error'}. ${hint}` });
    return;
  }
  const attachment = new AttachmentBuilder(tierResult.path, { name: `tierlist_${userId}_${source}.png` });
  const tierSummary = Object.entries(tierResult.tiers || {})
    .filter(([, names]) => names && names.length)
    .map(([t, names]) => `**${t}** (${names.length}): ${names.slice(0, 5).join(', ')}${names.length > 5 ? ', …' : ''}`)
    .join('\n');
  const embed = new EmbedBuilder()
    .setTitle(`📊 Tier List — ${userId} (${source.toUpperCase()})`)
    .setDescription(`Scored ${tierResult.total} entries by IV% (60%) + Level (40%).\n\n${tierSummary}`)
    .setColor(0x8b5cf6)
    .setImage(`attachment://tierlist_${userId}_${source}.png`)
    .setFooter({ text: 'Brainrot Bot • live data from indieun.com/cab' })
    .setTimestamp();
  await interaction.editReply({ embeds: [embed], files: [attachment] });
  try { require('fs').unlinkSync(tierResult.path); } catch {}
}

module.exports = { handleInventory, handleTierlist };

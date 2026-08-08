// src/handlers/inventory_local.js
const { MessageFlags, EmbedBuilder } = require('discord.js');
const { Paginator } = require('../paginator');
const { ContainerBuilder, SectionBuilder, TextDisplayBuilder, ThumbnailBuilder } = require('discord.js');

async function handleInventoryLocal(interaction, ctx) {
  const userOpt = interaction.options.getUser ? interaction.options.getUser('user') : null;
  const targetUser = userOpt ? userOpt.id : interaction.user.id;
  const guildId = interaction.guild.id;

  await interaction.deferReply();
  const inv = ctx.db.getUserInventory(guildId, targetUser) || [];
  if (!inv.length) {
    if (targetUser === interaction.user.id) {
      await interaction.editReply({ content: "You haven't caught any brainrots yet, fr. Try clicking some 'catch' buttons." });
    } else {
      await interaction.editReply({ content: "That user hasn't caught any brainrots on this server, fr." });
    }
    return;
  }

  // Build display lines "emoji Name — xN"
  const data = ctx.data;
  const emojis = require('../emojis');
  const helpers = require('../helpers');

  const lines = inv.map((r) => {
    const rot = helpers.findRot(r.rot_name) || {};
    const em = emojis.emojiFor(r.rot_name) || '';
    return { name: r.rot_name, count: r.count, emoji: em, icon: rot.Icon };
  });

  const perPage = 10;
  const pages = [];
  for (let i = 0; i < lines.length; i += perPage) {
    const chunk = lines.slice(i, i + perPage);
    // Try Components V2 page: a single Container with a header section and one section with lines
    const header = new ContainerBuilder()
      .setAccentColor(0x8b5cf6)
      .addSectionComponents(
        new SectionBuilder().addTextDisplayComponents(
          new TextDisplayBuilder().setContent(`🎒 Caught inventory — ${interaction.guild.name}`),
          new TextDisplayBuilder().setContent(`User: ${interaction.user.tag} (${targetUser})`),
        )
      );

    const contentSection = new SectionBuilder();
    for (const item of chunk) {
      contentSection.addTextDisplayComponents(new TextDisplayBuilder().setContent(`${item.emoji} ${item.name} — x${item.count}`));
    }
    header.addSectionComponents(contentSection);
    pages.push([header]);
  }

  // If runtime supports Components V2 flag, use components mode; otherwise fallback to embeds.
  const useV2 = MessageFlags && MessageFlags.IsComponentsV2;
  if (useV2) {
    const paginator = new Paginator({ pages, mode: 'components', userId: interaction.user.id, timeout: 120000 });
    await paginator.send(interaction);
    return;
  }

  // Fallback to embed pages
  const embedPages = [];
  for (let i = 0; i < lines.length; i += perPage) {
    const chunk = lines.slice(i, i + perPage);
    const e = new EmbedBuilder()
      .setTitle('🎒 Caught Inventory')
      .setDescription(chunk.map((c) => `${c.emoji} ${c.name} — x${c.count}`).join('\n'))
      .setFooter({ text: `Page ${Math.floor(i / perPage) + 1}` });
    embedPages.push(e);
  }
  const paginator = new Paginator({ pages: embedPages, mode: 'embed', userId: interaction.user.id, timeout: 120000 });
  await paginator.send(interaction);
}

module.exports = handleInventoryLocal;

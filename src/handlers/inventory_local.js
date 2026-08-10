// src/handlers/inventory_local.js
const { MessageFlags, ButtonStyle } = require('discord.js');
const log = require('../logger');
const { Paginator } = require('../paginator');
const { V2ContainerBuilder: ContainerBuilder, V2SectionBuilder: SectionBuilder, V2TextDisplayBuilder: TextDisplayBuilder, V2ThumbnailBuilder: ThumbnailBuilder, V2ButtonBuilder: ButtonBuilder, V2ActionRowBuilder: ActionRowBuilder, V2SeparatorBuilder: SeparatorBuilder } = require('v2componentsbuilder');

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

  const data = ctx.data;
  const emojis = require('../emojis');
  const helpers = require('../helpers');

  const lines = inv.map((r) => {
    const rot = helpers.findRot(r.rot_name) || {};
    const em = emojis.emojiFor(r.rot_name) || '';
    return { name: r.rot_name, count: r.count, emoji: em, icon: rot.Icon };
  });

  const perPage = 6;
  const totalPages = Math.ceil(lines.length / perPage);
  const totalRots = lines.reduce((s, l) => s + l.count, 0);
  const uniqueRots = lines.length;
  const pages = [];

  for (let i = 0; i < lines.length; i += perPage) {
    const chunk = lines.slice(i, i + perPage);
    const pageIndex = Math.floor(i / perPage) + 1;
    const components = [];

    // Header section with thumbnail
    const headerThumb = new ThumbnailBuilder().setURL('https://cdn.discordapp.com/emojis/1535487893722763304.webp?size=240');
    const headerSection = new SectionBuilder()
      .setComponents([
        new TextDisplayBuilder().setContent(`🎒 Inventory (@${targetUser})`),
        new TextDisplayBuilder().setContent(`${totalRots} total rots\n${uniqueRots} unique rots`),
      ])
      .setAccessory(headerThumb);
    components.push(headerSection);

    // Separator
    components.push(new SeparatorBuilder().setDivider(true).setSpacing(1));

    // Item sections with thumbnails
    for (const item of chunk) {
      const thumbUrl = item.icon ? `${data.ICON_BASE}/${item.icon}` : null;
      const section = new SectionBuilder()
        .setComponents([
          new TextDisplayBuilder().setContent(`${item.emoji} ${item.name} (x${item.count})`),
        ]);
      if (thumbUrl) {
        section.setAccessory(new ThumbnailBuilder().setURL(thumbUrl));
      }
      components.push(section);
    }

    // Separator
    components.push(new SeparatorBuilder().setDivider(true).setSpacing(1));

    // Nav action row inside container
    const navRow = new ActionRowBuilder().setComponents([
      new ButtonBuilder().setCustomId('pg:first').setLabel('⏪').setStyle(ButtonStyle.Secondary).setDisabled(pageIndex === 1),
      new ButtonBuilder().setCustomId('pg:prev').setLabel('◀️').setStyle(ButtonStyle.Secondary).setDisabled(pageIndex === 1),
      new ButtonBuilder().setCustomId('pg:pages').setLabel(`${pageIndex}/${totalPages}`).setStyle(ButtonStyle.Secondary).setDisabled(true),
      new ButtonBuilder().setCustomId('pg:next').setLabel('▶️').setStyle(ButtonStyle.Secondary).setDisabled(pageIndex === totalPages),
      new ButtonBuilder().setCustomId('pg:last').setLabel('⏩').setStyle(ButtonStyle.Secondary).setDisabled(pageIndex === totalPages),
    ]);
    components.push(navRow);

    if (components.length < 1 || components.length > 10) {
      throw new Error(`Invalid inventory page component count: ${components.length}`);
    }

    const container = new ContainerBuilder()
      .setColor(0x8b5cf6)
      .setComponents(components);

    pages.push(container);
  }

  // V2 components only, no embed fallback
  try {
    for (const page of pages) {
      if (!page || typeof page.toJSON !== 'function') throw new Error('Component missing toJSON');
      page.toJSON();
    }
    const paginator = new Paginator({ pages, mode: 'components', userId: interaction.user.id, timeout: 120000 });
    await paginator.send(interaction);
  } catch (err) {
    const details = {
      message: err && err.message ? err.message : String(err),
      code: err && err.code ? err.code : undefined,
      httpStatus: err && err.httpStatus ? err.httpStatus : undefined,
      stack: err && err.stack ? err.stack : undefined,
    };
    log.error('Components V2 inventory send failed:', details);
    await interaction.editReply({ content: '❌ Failed to render inventory. Components V2 error.', flags: MessageFlags.Ephemeral });
  }
}

module.exports = handleInventoryLocal;

// src/handlers/inventory_local.js
const { MessageFlags, EmbedBuilder } = require('discord.js');
const log = require('../logger');
const { Paginator } = require('../paginator');
// Use the external V2 builders shim for Components V2 payloads
const { V2ContainerBuilder: ContainerBuilder, V2SectionBuilder: SectionBuilder, V2TextDisplayBuilder: TextDisplayBuilder, V2ThumbnailBuilder: ThumbnailBuilder } = require('v2componentsbuilder');

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
    const headerSection = new SectionBuilder().setComponents([
      new TextDisplayBuilder().setContent(`🎒 Caught inventory — ${interaction.guild.name}`),
      new TextDisplayBuilder().setContent(`User: ${interaction.user.tag} (${targetUser})`),
    ]);

    // Combine the chunk lines into a single TextDisplay to obey Section limits (1-3 text displays)
    const combined = chunk.map((item) => `${item.emoji} ${item.name} — x${item.count}`).join('\n');
    const contentSection = new SectionBuilder().setComponents([new TextDisplayBuilder().setContent(combined)]);

    const container = new ContainerBuilder().setColor(0x8b5cf6).setComponents([
      headerSection,
      contentSection,
    ]);
    pages.push([container]);
  }

  // If runtime supports Components V2 flag, use components mode; otherwise fallback to embeds.
  const useV2 = MessageFlags && MessageFlags.IsComponentsV2;
  if (useV2) {
    // Validate component serialization before attempting to send to avoid runtime validation errors.
    let valid = true;
    try {
      for (const page of pages) {
        for (const comp of page) {
          if (!comp || typeof comp.toJSON !== 'function') throw new Error('Component missing toJSON');
          // Call toJSON to ensure builders validate now instead of during send
          comp.toJSON();
        }
      }
    } catch (err) {
      valid = false;
    }
    if (valid) {
      try {
        const paginator = new Paginator({ pages, mode: 'components', userId: interaction.user.id, timeout: 120000 });
        await paginator.send(interaction);
        return;
      } catch (err) {
        log.warn('Components V2 send failed during send, falling back to embeds:', err);
      }
    } else {
      log.debug && log.debug('Components V2 not available or pages failed validation; using embed fallback');
    }
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

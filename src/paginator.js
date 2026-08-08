// src/paginator.js
// Reusable paginator for slash command responses.
//
// Two modes:
//   1. Embed-based pagination (classic): each page is an EmbedBuilder.
//      Replies with { embeds: [page], components: [navRow] }.
//   2. Components V2 pagination: each page is an array of component builders
//      (ContainerBuilder, TextDisplayBuilder, MediaGalleryBuilder, etc.).
//      Replies with { components: [...page, navRow] } and the IsComponentsV2 flag.
//
// Usage:
//   const paginator = new Paginator({
//     pages: [page1, page2, page3],          // required: array of pages
//     mode: "embed" | "components",           // default "embed"
//     timeout: 60000,                         // ms before buttons disable (default 60s)
//     userId: interaction.user.id,            // only this user can navigate
//     onPage: null,                           // optional (pageIndex) => extra components to inject
//   });
//   await paginator.send(interaction);        // initial reply (defers if needed)
//
// The paginator attaches a button collector on the reply and handles
// prev/next/first/last/jump interactions automatically.

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  MessageFlags,
} = require("discord.js");

// V2 action/button builders for Components V2 mode
const { V2ActionRowBuilder, V2ButtonBuilder } = require('v2componentsbuilder');

const NAV_BUTTONS = {
  first:  { label: "⏮️", style: ButtonStyle.Secondary },
  prev:   { label: "◀️", style: ButtonStyle.Secondary },
  next:   { label: "▶️", style: ButtonStyle.Secondary },
  last:   { label: "⏭️", style: ButtonStyle.Secondary },
  // Jump button is more complex (modal), so we omit it by default.
  // Pages button shows current page count.
  pages:  { label: "Page", style: ButtonStyle.Secondary, disabled: true },
};

class Paginator {
  constructor(opts) {
    this.pages = opts.pages || [];
    this.mode = opts.mode === "components" ? "components" : "embed";
    this.timeout = opts.timeout ?? 120000;
    this.userId = opts.userId;
    this.onPage = opts.onPage || null;
    this.currentPage = 0;
    this._collector = null;
    if (!this.pages.length) {
      throw new Error("Paginator requires at least one page");
    }
  }

  // Build the navigation row for the current page state.
  _buildNavRow() {
    const i = this.currentPage;
    const total = this.pages.length;
    if (this.mode === 'components') {
      const v2row = new V2ActionRowBuilder();
      v2row.setComponents([
        new V2ButtonBuilder().setCustomId('pg:first').setLabel(NAV_BUTTONS.first.label).setStyle(NAV_BUTTONS.first.style).setDisabled(i === 0),
        new V2ButtonBuilder().setCustomId('pg:prev').setLabel(NAV_BUTTONS.prev.label).setStyle(NAV_BUTTONS.prev.style).setDisabled(i === 0),
        new V2ButtonBuilder().setCustomId('pg:pages').setLabel(`${i + 1}/${total}`).setStyle(NAV_BUTTONS.pages.style).setDisabled(true),
        new V2ButtonBuilder().setCustomId('pg:next').setLabel(NAV_BUTTONS.next.label).setStyle(NAV_BUTTONS.next.style).setDisabled(i === total - 1),
        new V2ButtonBuilder().setCustomId('pg:last').setLabel(NAV_BUTTONS.last.label).setStyle(NAV_BUTTONS.last.style).setDisabled(i === total - 1),
      ]);
      return v2row;
    }
    const row = new ActionRowBuilder();
    row.addComponents(
      new ButtonBuilder()
        .setCustomId("pg:first")
        .setLabel(NAV_BUTTONS.first.label)
        .setStyle(NAV_BUTTONS.first.style)
        .setDisabled(i === 0),
      new ButtonBuilder()
        .setCustomId("pg:prev")
        .setLabel(NAV_BUTTONS.prev.label)
        .setStyle(NAV_BUTTONS.prev.style)
        .setDisabled(i === 0),
      new ButtonBuilder()
        .setCustomId("pg:pages")
        .setLabel(`${i + 1}/${total}`)
        .setStyle(NAV_BUTTONS.pages.style)
        .setDisabled(true),
      new ButtonBuilder()
        .setCustomId("pg:next")
        .setLabel(NAV_BUTTONS.next.label)
        .setStyle(NAV_BUTTONS.next.style)
        .setDisabled(i === total - 1),
      new ButtonBuilder()
        .setCustomId("pg:last")
        .setLabel(NAV_BUTTONS.last.label)
        .setStyle(NAV_BUTTONS.last.style)
        .setDisabled(i === total - 1)
    );
    return row;
  }

  // Build the response payload for the current page.
  _buildPayload() {
    const navRow = this._buildNavRow();
    if (this.mode === "embed") {
      const page = this.pages[this.currentPage];
      return { embeds: [page], components: [navRow] };
    } else {
      // Components V2 mode: page is an array of component builders.
      const pageComponents = this.pages[this.currentPage] || [];
      const extra = this.onPage ? this.onPage(this.currentPage) : [];
      return {
        components: [...pageComponents, ...extra, navRow],
        flags: MessageFlags.IsComponentsV2,
      };
    }
  }

  // Send the initial reply.
  async send(interaction) {
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(this._buildPayload());
    } else {
      await interaction.reply(this._buildPayload());
    }
    const message = await interaction.fetchReply();
    this._attachCollector(interaction, message);
    return message;
  }

  // Update the message to a new page.
  async _update(interaction, newIndex) {
    this.currentPage = Math.max(0, Math.min(this.pages.length - 1, newIndex));
    await interaction.update(this._buildPayload());
  }

  // Attach the button collector.
  _attachCollector(interaction, message) {
    this._collector = message.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: this.timeout,
    });

    this._collector.on("collect", async (i) => {
      // Only the original user can navigate.
      if (this.userId && i.user.id !== this.userId) {
        await i.reply({
          content: "Not your paginator, fr. Run the command yourself.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      const action = i.customId.replace("pg:", "");
      switch (action) {
        case "first": await this._update(i, 0); break;
        case "prev":  await this._update(i, this.currentPage - 1); break;
        case "next":  await this._update(i, this.currentPage + 1); break;
        case "last":  await this._update(i, this.pages.length - 1); break;
      }
    });

    this._collector.on("end", async () => {
      // Disable all nav buttons when the collector expires.
      try {
        if (this.mode === 'components') {
          const nav = this._buildNavRow();
          const navJson = typeof nav.toJSON === 'function' ? nav.toJSON() : nav;
          const disabledBtns = (navJson.components || []).map((b) => new V2ButtonBuilder().setCustomId(b.custom_id || b.customId || b.custom_id).setLabel(b.label).setStyle(b.style).setDisabled(true));
          const disabledRow = new V2ActionRowBuilder().setComponents(disabledBtns);
          const payload = { components: [...(this.pages[this.currentPage] || []), disabledRow], flags: MessageFlags.IsComponentsV2 };
          await interaction.editReply(payload);
        } else {
          const row = new ActionRowBuilder();
          for (const b of this._buildNavRow().components) {
            row.addComponents(ButtonBuilder.from(b).setDisabled(true));
          }
          const payload = { embeds: [this.pages[this.currentPage]], components: [row] };
          await interaction.editReply(payload);
        }
      } catch {
        // Message may have been deleted; ignore.
      }
    });
  }

  // Stop the collector early (e.g., if the user runs the command again).
  stop() {
    if (this._collector) this._collector.stop();
  }
}

module.exports = { Paginator };

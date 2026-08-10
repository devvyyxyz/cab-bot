// src/paginator.js
// Reusable paginator for slash command responses.
//
// Two modes:
//   1. Embed-based pagination (classic): each page is an EmbedBuilder.
//      Replies with { embeds: [page], components: [navRow] }.
//   2. Components V2 pagination: each page is either:
//      - An array of component builders, OR
//      - A single ContainerBuilder with nav injected inside
//      Replies with { components: [...page, navRow] } or { components: [container], flags: IsComponentsV2 }

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  MessageFlags,
} = require("discord.js");

// V2 action/button builders for Components V2 mode
const { V2ActionRowBuilder, V2ButtonBuilder, V2ContainerBuilder: ContainerBuilder } = require('v2componentsbuilder');

const NAV_BUTTONS = {
  first:  { label: "⏮️", style: ButtonStyle.Secondary },
  prev:   { label: "◀️", style: ButtonStyle.Secondary },
  next:   { label: "▶️", style: ButtonStyle.Secondary },
  last:   { label: "⏭️", style: ButtonStyle.Secondary },
  pages:  { label: "Page", style: ButtonStyle.Secondary, disabled: true },
};

const activePaginatorByMessage = new Map();

function getActivePaginator(messageId) {
  return activePaginatorByMessage.get(messageId) || null;
}

function setActivePaginator(messageId, paginator) {
  activePaginatorByMessage.set(messageId, paginator);
}

function deleteActivePaginator(messageId) {
  activePaginatorByMessage.delete(messageId);
}

class Paginator {
  constructor(opts) {
    this.pages = opts.pages || [];
    this.mode = opts.mode === "components" ? "components" : "embed";
    this.timeout = opts.timeout ?? 120000;
    this.userId = opts.userId;
    this.onPage = opts.onPage || null;
    this.categoryRanges = opts.categoryRanges || null;
    this.currentPage = 0;
    this._buttonCollector = null;
    this._selectCollector = null;
    this._ended = false;
    if (!this.pages.length) {
      throw new Error("Paginator requires at least one page");
    }
  }

  _isContainerPage(page) {
    return page && typeof page.setComponents === 'function' && typeof page.toJSON === 'function';
  }

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
      new ButtonBuilder().setCustomId("pg:first").setLabel(NAV_BUTTONS.first.label).setStyle(NAV_BUTTONS.first.style).setDisabled(i === 0),
      new ButtonBuilder().setCustomId("pg:prev").setLabel(NAV_BUTTONS.prev.label).setStyle(NAV_BUTTONS.prev.style).setDisabled(i === 0),
      new ButtonBuilder().setCustomId("pg:pages").setLabel(`${i + 1}/${total}`).setStyle(NAV_BUTTONS.pages.style).setDisabled(true),
      new ButtonBuilder().setCustomId("pg:next").setLabel(NAV_BUTTONS.next.label).setStyle(NAV_BUTTONS.next.style).setDisabled(i === total - 1),
      new ButtonBuilder().setCustomId("pg:last").setLabel(NAV_BUTTONS.last.label).setStyle(NAV_BUTTONS.last.style).setDisabled(i === total - 1)
    );
    return row;
  }

  _buildDisabledNavRow(navJson) {
    const disabledBtns = (navJson.components || []).map((b) => {
      const base = {
        type: 2,
        style: b.style,
        label: b.label,
        custom_id: b.custom_id || b.customId,
        disabled: true,
      };
      if (b.emoji) base.emoji = b.emoji;
      return base;
    });
    return { type: 1, components: disabledBtns };
  }

  _buildDisabledSelectRow(actionRowJson) {
    const selectComp = (actionRowJson.components || [])[0] || {};
    const disabledOptions = (selectComp.options || []).map((opt) => ({
      label: opt.label,
      value: opt.value,
      description: opt.description,
      emoji: opt.emoji,
      default: opt.default,
    }));
    return {
      type: 1,
      components: [
        {
          type: 3,
          custom_id: selectComp.custom_id || actionRowJson.custom_id,
          options: disabledOptions,
          placeholder: selectComp.placeholder,
          min_values: selectComp.min_values,
          max_values: selectComp.max_values,
          disabled: true,
        },
      ],
    };
  }

  _getCurrentCategory() {
    if (!this.categoryRanges) return null;
    const page = this.currentPage;
    for (const [cat, [start, end]] of Object.entries(this.categoryRanges)) {
      if (page >= start && page <= end) return cat;
    }
    return null;
  }

  _buildPayload() {
    if (this.mode === "embed") {
      const page = this.pages[this.currentPage];
      return { embeds: [page], components: [this._buildNavRow()] };
    }

    const page = this.pages[this.currentPage];
    const extra = this.onPage ? this.onPage(this.currentPage) : [];

    if (this._isContainerPage(page)) {
      return {
        components: [page],
        flags: MessageFlags.IsComponentsV2,
      };
    }

    const pageComponents = page || [];
    return {
      components: [...pageComponents, ...extra, this._buildNavRow()],
      flags: MessageFlags.IsComponentsV2,
    };
  }

  async send(interaction) {
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(this._buildPayload());
    } else {
      await interaction.reply(this._buildPayload());
    }
    const message = await interaction.fetchReply();
    setActivePaginator(message.id, this);
    this._messageId = message.id;
    this._attachCollector(interaction, message);
    return message;
  }

  async _update(interaction, newIndex) {
    this.currentPage = Math.max(0, Math.min(this.pages.length - 1, newIndex));
    try {
      await interaction.update(this._buildPayload());
    } catch (err) {
      if (err && err.code === 10062) {
        return;
      }
      throw err;
    }
  }

  async _disable(interaction) {
    if (this._ended) return;
    this._ended = true;
    try {
      if (this.mode === 'components' && this._isContainerPage(this.pages[this.currentPage])) {
        const page = this.pages[this.currentPage];
        const json = page.toJSON();
        const components = [...(json.components || [])];
        const updated = components.map((c) => {
          if (c.type === 1 && c.components && c.components[0] && c.components[0].type === 3) {
            return this._buildDisabledSelectRow(c);
          }
          if (c.type === 1) return this._buildDisabledNavRow(c);
          return c;
        });
        const container = new ContainerBuilder()
          .setColor(json.accent_color ?? 0x000000)
          .setSpoiler(json.spoiler || false)
          .setComponents(updated);
        await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
      } else if (this.mode === 'components') {
        const row = new ActionRowBuilder();
        for (const b of this._buildNavRow().components) {
          row.addComponents(ButtonBuilder.from(b).setDisabled(true));
        }
        const payload = { components: [...(this.pages[this.currentPage] || []), row], flags: MessageFlags.IsComponentsV2 };
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
  }

  _attachCollector(interaction, message) {
    this._buttonCollector = message.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: this.timeout,
    });

    this._selectCollector = message.createMessageComponentCollector({
      componentType: ComponentType.StringSelect,
      time: this.timeout,
    });

    const handleInteraction = async (i) => {
      if (this.userId && i.user.id !== this.userId) {
        await i.reply({
          content: "Not your paginator, fr. Run the command yourself.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      if (i.componentType === ComponentType.Button) {
        const action = i.customId.replace("pg:", "");
        let newPage = this.currentPage;
        switch (action) {
          case "first": newPage = 0; break;
          case "prev": newPage = this.currentPage - 1; break;
          case "next": newPage = this.currentPage + 1; break;
          case "last": newPage = this.pages.length - 1; break;
        }
        if (this.categoryRanges) {
          const cat = this._getCurrentCategory();
          if (cat && this.categoryRanges[cat]) {
            const [start, end] = this.categoryRanges[cat];
            newPage = Math.max(start, Math.min(end, newPage));
          }
        }
        await this._update(i, newPage);
      } else if (i.componentType === ComponentType.StringSelect) {
        const value = i.values[0];
        if (this.categoryRanges && this.categoryRanges[value]) {
          const [start] = this.categoryRanges[value];
          await this._update(i, start);
        }
      }
    };

    this._buttonCollector.on("collect", handleInteraction);
    this._selectCollector.on("collect", handleInteraction);

    this._buttonCollector.on("end", async () => {
      this._selectCollector.stop();
      await this._disable(interaction);
      if (this._messageId) deleteActivePaginator(this._messageId);
    });

    this._selectCollector.on("end", async () => {
      this._buttonCollector.stop();
      await this._disable(interaction);
      if (this._messageId) deleteActivePaginator(this._messageId);
    });
  }

  stop() {
    if (this._buttonCollector) this._buttonCollector.stop();
    if (this._selectCollector) this._selectCollector.stop();
    if (this._messageId) deleteActivePaginator(this._messageId);
  }
}

module.exports = { Paginator, getActivePaginator, setActivePaginator, deleteActivePaginator };

// src/handlers/help.js

const { MessageFlags, ComponentType, ButtonStyle, SeparatorSpacingSize } = require('discord.js');
const { V2TextDisplayBuilder: TextDisplayBuilder, V2ContainerBuilder: ContainerBuilder, V2SeparatorBuilder: SeparatorBuilder, V2ActionRowBuilder: ActionRowBuilder, V2ButtonBuilder: ButtonBuilder } = require('v2componentsbuilder');
const { buildHelpDetailEmbed, HELP } = require('../embeds');

const HELP_SESSIONS = new Map();

const COMMANDS_BY_CATEGORY = {
  game: [
    { key: 'guess', label: '/guess', usage: HELP.guess.usage, summary: HELP.guess.summary, notes: HELP.guess.notes },
    { key: 'game 8ball', label: '/game 8ball', usage: HELP['game 8ball'].usage, summary: HELP['game 8ball'].summary, notes: HELP['game 8ball'].notes },
    { key: 'game blackjack', label: '/game blackjack', usage: HELP['game blackjack'].usage, summary: HELP['game blackjack'].summary, notes: HELP['game blackjack'].notes },
    { key: 'game dice_roll', label: '/game dice_roll', usage: HELP['game dice_roll'].usage, summary: HELP['game dice_roll'].summary, notes: HELP['game dice_roll'].notes },
  ],
  info: [
    { key: 'info', label: '/info', usage: HELP.info.usage, summary: HELP.info.summary, notes: HELP.info.notes },
    { key: 'inventory', label: '/inventory', usage: HELP.inventory.usage, summary: HELP.inventory.summary, notes: HELP.inventory.notes },
    { key: 'trade', label: '/trade', usage: HELP.trade.usage, summary: HELP.trade.summary, notes: HELP.trade.notes },
    { key: 'spawn', label: '/info spawn', usage: HELP.spawn.usage, summary: HELP.spawn.summary, notes: HELP.spawn.notes },
    { key: 'top', label: '/top', usage: HELP.top.usage, summary: HELP.top.summary, notes: HELP.top.notes },
    { key: 'daily', label: '/daily', usage: HELP.daily.usage, summary: HELP.daily.summary, notes: HELP.daily.notes },
    { key: 'tierlist', label: '/tierlist', usage: HELP.tierlist.usage, summary: HELP.tierlist.summary, notes: HELP.tierlist.notes },
    { key: 'help', label: '/help', usage: HELP.help.usage, summary: HELP.help.summary, notes: HELP.help.notes },
    { key: 'settings', label: '/settings', usage: HELP.settings.usage, summary: HELP.settings.summary, notes: HELP.settings.notes },
    { key: 'forcespawn', label: '/admin forcespawn', usage: HELP.forcespawn.usage, summary: HELP.forcespawn.summary, notes: HELP.forcespawn.notes },
    { key: 'ping', label: '/ping', usage: HELP.ping.usage, summary: HELP.ping.summary, notes: HELP.ping.notes },
  ],
};

const ITEMS_PER_PAGE = 5;

function buildHelpContainer(category, page, commandId) {
  const items = COMMANDS_BY_CATEGORY[category] || COMMANDS_BY_CATEGORY.info;
  const totalPages = Math.max(1, Math.ceil(items.length / ITEMS_PER_PAGE));
  const safePage = Math.max(1, Math.min(page, totalPages));
  const start = (safePage - 1) * ITEMS_PER_PAGE;
  const slice = items.slice(start, start + ITEMS_PER_PAGE);

  const contentLines = slice.map((cmd) => {
    return `\`${cmd.usage}\` — ${cmd.summary}`;
  }).join('\n\n');

  const selectMenu = {
    type: 1,
    components: [
      {
        type: 3,
        custom_id: 'help:category',
        options: [
          { label: 'Game', value: 'game', emoji: { name: '🎲' }, default: category === 'game' },
          { label: 'Info', value: 'info', emoji: { name: 'ℹ️' }, default: category === 'info' },
        ],
        placeholder: category === 'game' ? 'Game' : 'Info',
        min_values: 1,
        max_values: 1,
        disabled: false,
      },
    ],
  };

  const navRow = new ActionRowBuilder().setComponents([
    new ButtonBuilder().setCustomId('help:first').setLabel('⏪').setStyle(ButtonStyle.Secondary).setDisabled(safePage === 1),
    new ButtonBuilder().setCustomId('help:prev').setLabel('◀️').setStyle(ButtonStyle.Secondary).setDisabled(safePage === 1),
    new ButtonBuilder().setCustomId('help:pages').setLabel(`${safePage}/${totalPages}`).setStyle(ButtonStyle.Secondary).setDisabled(true),
    new ButtonBuilder().setCustomId('help:next').setLabel('▶️').setStyle(ButtonStyle.Secondary).setDisabled(safePage === totalPages),
    new ButtonBuilder().setCustomId('help:last').setLabel('⏩').setStyle(ButtonStyle.Secondary).setDisabled(safePage === totalPages),
  ]);

  const container = new ContainerBuilder()
    .setColor(0x8b5cf6)
    .setComponents([
      new TextDisplayBuilder().setContent('Help'),
      new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true),
      new TextDisplayBuilder().setContent(`</help:${commandId}> Show bot help, optionally for a specific command.`),
      new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true),
      new TextDisplayBuilder().setContent(contentLines || 'No commands in this category.'),
      new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true),
      selectMenu,
      navRow,
    ]);

  return container;
}

async function handleHelp(interaction, ctx) {
  const cmd = interaction.options.getString('command');
  if (cmd) {
    const embed = buildHelpDetailEmbed(cmd);
    if (!embed) {
      await interaction.reply({ content: `No detailed help for \`${cmd}\`, fr. Try \`/help\` for the full list.`, flags: MessageFlags.Ephemeral });
      return;
    }
    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    return;
  }

  const commandId = interaction.commandId;
  const container = buildHelpContainer('game', 1, commandId);
  const reply = await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });

  HELP_SESSIONS.set(reply.id, { category: 'game', page: 1, commandId });

  const collector = reply.createMessageComponentCollector({
    componentType: [ComponentType.Button, ComponentType.StringSelect],
    time: 120_000,
  });

  collector.on('collect', async (i) => {
    const session = HELP_SESSIONS.get(reply.id);
    if (!session) return;
    if (i.user.id !== interaction.user.id) {
      await i.reply({ content: "Not your help menu, fr. Run `/help` yourself.", flags: MessageFlags.Ephemeral });
      return;
    }

    if (i.customId === 'help:category') {
      const newCategory = i.values[0];
      const newContainer = buildHelpContainer(newCategory, 1, session.commandId);
      HELP_SESSIONS.set(reply.id, { category: newCategory, page: 1, commandId: session.commandId });
      await i.update({ components: [newContainer] });
      return;
    }

    const id = i.customId;
    const items = COMMANDS_BY_CATEGORY[session.category] || COMMANDS_BY_CATEGORY.info;
    const totalPages = Math.max(1, Math.ceil(items.length / ITEMS_PER_PAGE));
    let newPage = session.page;

    if (id === 'help:first') newPage = 1;
    else if (id === 'help:prev') newPage = Math.max(1, session.page - 1);
    else if (id === 'help:next') newPage = Math.min(totalPages, session.page + 1);
    else if (id === 'help:last') newPage = totalPages;

    if (newPage !== session.page) {
      const newContainer = buildHelpContainer(session.category, newPage, session.commandId);
      HELP_SESSIONS.set(reply.id, { ...session, page: newPage });
      await i.update({ components: [newContainer] });
    }
  });

  collector.on('end', async () => {
    HELP_SESSIONS.delete(reply.id);
  });
}

module.exports = handleHelp;

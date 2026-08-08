// src/handlers/game.js
// Handles /start, /top, /daily, /guess

const { EmbedBuilder } = require('discord.js');
const { Paginator } = require('../paginator');
const {
  buildStartEmbed,
  buildTopEmbed,
  buildDailyEmbed,
  buildGuessEmbed,
  buildGuessComponents,
  newGuessRound,
} = require('../embeds');
const emojis = require('../emojis');
const { rarityLabel } = require('../helpers');
const data = require('../data');

async function handleStart(interaction, ctx) {
  const b = buildStartEmbed(ctx.client.user.id);
  if (MessageFlags && MessageFlags.IsComponentsV2) {
    await interaction.reply({ embeds: [b.embed], components: [b.v2Row], flags: MessageFlags.IsComponentsV2 });
  } else {
    await interaction.reply({ embeds: [b.embed], components: [b.row] });
  }
}

async function handleTop(interaction, ctx) {
  const stat = interaction.options.getString('by');
  const count = interaction.options.getInteger('count') ?? 10;
  if (count <= 10) {
    await interaction.reply({ embeds: [buildTopEmbed(stat, count)] });
    return;
  }
  const statLabel = stat.charAt(0).toUpperCase() + stat.slice(1);
  const sorted = require('../helpers').sortRotsByStat(stat).slice(0, count);
  const chunkSize = 10;
  const pages = [];
  for (let i = 0; i < sorted.length; i += chunkSize) {
    const chunk = sorted.slice(i, i + chunkSize);
    const lines = chunk.map((r, j) => {
      const idx = i + j;
      const v = stat === 'rarity' ? r.Rarity : r[require('../helpers').statKeyFor(stat)];
      const valStr = stat === 'rarity' ? `${rarityLabel(r.Rarity)} ${v.toFixed(2)}` : v.toFixed(2);
      const ex = r.IsExclusive ? ' ✨' : '';
      const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `**${idx + 1}.**`;
      const em = emojis.emojiFor(r.FullName);
      return `${medal} ${em} ${r.FullName} — ${valStr}${ex}`.trim();
    }).join('\n');
    const embed = new EmbedBuilder()
      .setTitle(`🏆 Top ${count} by ${statLabel} (page ${pages.length + 1})`)
      .setDescription(lines)
      .setColor(0xfacc15)
      .setThumbnail(`${data.ICON_BASE}/${sorted[0].Icon}`)
      .setFooter({ text: `Brainrot Bot • ranked by ${statLabel} • page ${pages.length + 1}/${Math.ceil(sorted.length / chunkSize)}` })
      .setTimestamp();
    pages.push(embed);
  }
  const paginator = new Paginator({ pages, mode: 'embed', userId: interaction.user.id, timeout: 120000 });
  await paginator.send(interaction);
}

async function handleDaily(interaction, ctx) {
  await interaction.reply({ embeds: [buildDailyEmbed()] });
}

async function handleGuess(interaction, ctx) {
  const round = newGuessRound();
  const embed = buildGuessEmbed(round);
  const rows = buildGuessComponents(round, false);
  if (MessageFlags && MessageFlags.IsComponentsV2) {
    await interaction.reply({ embeds: [embed], components: [rows.v2Row], flags: MessageFlags.IsComponentsV2 });
  } else {
    await interaction.reply({ embeds: [embed], components: [rows.row] });
  }
}

module.exports = {
  handleStart,
  handleTop,
  handleDaily,
  handleGuess,
};

// src/embeds.js
// All embed builder functions for Brainrot Bot.

const {
  rots,
  items,
  skins,
  _rotByName,
  _itemByName,
  _skinByName,
  _rotBySpecies,
  spawnKeys,
  rarityStars,
  pick,
  flavorFor,
  flavorForItem,
  flavorForSkin,
  ICON_BASE,
  APP_DIRECTORY_URL,


} = require('./data');

const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  SeparatorSpacingSize,
} = require('discord.js');
const { execFile: _execFile } = require('child_process');
const emojis = require('./emojis');
const { Paginator: _Paginator } = require('./paginator');
const helpers = require('./helpers');
// V2 action/button builders for optional Components V2 payloads
const { V2ActionRowBuilder, V2ButtonBuilder, V2ContainerBuilder: ContainerBuilder, V2SectionBuilder: SectionBuilder, V2TextDisplayBuilder: TextDisplayBuilder, V2ThumbnailBuilder: ThumbnailBuilder, V2SeparatorBuilder: SeparatorBuilder } = require('v2componentsbuilder');

const { rarityLabel, buildInventoryPages, brainrotSummary } = helpers;

// ---------- HELP ----------

const HELP = {
  info: {
    summary: 'Look up brainrot info — brainrot, hoverboard, item, spawn, or inventory.',
    usage: '/info <subcommand>',
    examples: ['/info brainrot', '/info hoverboard', '/info item', '/info spawn', '/info inventory'],
    notes: 'Subcommands: brainrot, hoverboard, item, spawn, inventory. Use autocomplete to find specific names.',
  },
  inventory: {
    summary: 'Look up a player live inventory from indieun.com/cab.',
    usage: '/info inventory user:<Roblox UID>',
    examples: ['/info inventory user:1559610713'],
    notes: 'Accepts either a numeric Roblox user ID or a username. The bot resolves usernames via the Roblox API.',
  },
  trade: {
    summary: 'Trade tools for brainrots.',
    usage: '/trade calculate a:<name> [a_iv:<0-100>] [a_level:<1-100>] b:<name> [b_iv:<0-100>] [b_level:<1-100>]',
    examples: ['/trade calculate a:Brr Brrr Patapim b:Ballerina Cappuccina', '/trade calculate a:Brr Brrr Patapim a_iv:91 a_level:25 b:Ballerina Cappuccina b_iv:80 b_level:30'],
    notes: 'Calculates a value score for each side based on rarity, IV%, level, exclusivity, and base stats. Verdict: fair / slightly one-sided / one-sided / rip-off.',
  },
  start: {
    summary: 'Launch the Brainrot Bot activity.',
    usage: '/start',
    examples: ['/start'],
    notes: 'Posts an embed with a Launch Activity button.',
  },
  spawn: {
    summary: 'Show brainrots that spawn at a given world/zone, or a random spawn location.',
    usage: '/info spawn [world:<1|2>] [zone:<1-3>] [random]',
    examples: ['/info spawn', '/info spawn world:2 zone:3', '/info spawn random'],
    notes: 'If you omit both world and zone, the bot picks a random spawn location. If you provide world but not zone (or vice versa), it picks a random matching location. Use `random` to force a random spawn.',
  },
  top: {
    summary: 'Show the top N brainrots by a chosen stat.',
    usage: '/top by:<rarity|attack|health|speed> [count:<1-25>]',
    examples: ['/top by:rarity', '/top by:attack count:5', '/top by:speed count:25'],
    notes: 'Defaults to count=10 if omitted.',
  },
  daily: {
    summary: 'Brainrot of the day — same for everyone, changes at 00:00 UTC.',
    usage: '/daily',
    examples: ['/daily'],
    notes: 'Picks a deterministic brainrot based on the current UTC date.',
  },
  guess: {
    summary: 'Mini-game: identify a brainrot from its icon. Pick from 4 choices.',
    usage: '/guess',
    examples: ['/guess'],
    notes: 'Bot posts an embed with a mystery icon and four buttons. Click the right one to win.',
  },
  tierlist: {
    summary: 'Generate a tier-list image from a player live inventory.',
    usage: '/tierlist user:<Roblox UID> [source:<team|pc>]',
    examples: ['/tierlist user:1559610713', '/tierlist user:1559610713 source:pc'],
    notes: 'Fetches the player inventory, scores each entry by IV% (60%) + Level (40%), buckets into tiers, and posts a PNG image.',
  },
  help: {
    summary: 'Show bot help, optionally for a specific command.',
    usage: '/help [command:<info|inventory|trade|spawn|top|daily|guess|tierlist|settings|battle|help>]',
    examples: ['/help', '/help command:trade'],
    notes: 'With no argument, shows all commands with a one-line summary.',
  },
  settings: {
    summary: 'Configure bot settings for this server — welcome message, spawn channel, spawn message, avatar, username, reset, nuke.',
    usage: '/settings <subcommand> [options]',
    examples: ['/settings welcomemessage', '/settings spawnchannel channel:#spawns', '/settings message message:A brainrot appeared!', '/settings avatar image:https://example.com/avatar.png', '/settings username name:Brainrot Bot', '/settings reset', '/settings nuke'],
    notes: 'Subcommands: welcomemessage, spawnchannel, message, avatar, username, reset, nuke.',
  },
  forcespawn: {
    summary: 'Force a brainrot to spawn now in this server (requires Manage Channels).',
    usage: '/admin forcespawn',
    examples: ['/admin forcespawn'],
    notes: 'Requires the Manage Channels permission. Spawns a random brainrot immediately in the configured spawn channel.',
  },
  ping: {
    summary: 'Check bot latency and API ping.',
    usage: '/ping',
    examples: ['/ping'],
    notes: 'Returns the round-trip latency and Discord API ping.',
  },
  'game 8ball': {
    summary: 'Ask the Magic 8-Ball a yes/no question.',
    usage: '/game 8ball question:<your question>',
    examples: ['/game 8ball question:Will I catch a legendary brainrot today?'],
    notes: 'Returns a random mystical answer from the 8-Ball.',
  },
  'game blackjack': {
    summary: 'Play a simplified game of blackjack against the system.',
    usage: '/game blackjack',
    examples: ['/game blackjack'],
    notes: 'Try to get as close to 21 as possible without going over.',
  },
  'game dice_roll': {
    summary: 'Roll one or more dice.',
    usage: '/game dice_roll [count:<number>]',
    examples: ['/game dice_roll', '/game dice_roll count:4'],
    notes: 'Defaults to 1 die. You can roll up to 10 dice at once.',
  },
  battle: {
    summary: 'Show the battle map for the current zone.',
    usage: '/battle',
    examples: ['/battle'],
    notes: 'Sends the battle map image for the current zone.',
  },
};

function buildHelpOverviewEmbed() {
  return new EmbedBuilder()
    .setTitle('Brainrot Bot — Help')
    .setDescription('Like cat bot, but for Italian brainrot characters. All commands are slash commands.')
    .setColor(0x8b5cf6)
    .addFields(
      { name: '/info', value: HELP.info.summary, inline: false },
      { name: '/inventory', value: HELP.inventory.summary, inline: false },
      { name: '/trade', value: HELP.trade.summary, inline: false },
      { name: '/info spawn', value: HELP.spawn.summary, inline: false },
      { name: '/top', value: HELP.top.summary, inline: false },
      { name: '/daily', value: HELP.daily.summary, inline: false },
      { name: '/guess', value: HELP.guess.summary, inline: false },
      { name: '/tierlist', value: HELP.tierlist.summary, inline: false },
      { name: '/settings', value: HELP.settings.summary, inline: false },
      { name: '/help', value: HELP.help.summary, inline: false },
      { name: '/ping', value: HELP.ping.summary, inline: false },
      { name: '/admin forcespawn', value: HELP.forcespawn.summary, inline: false },
      { name: '/game 8ball', value: HELP['game 8ball'].summary, inline: false },
      { name: '/game blackjack', value: HELP['game blackjack'].summary, inline: false },
      { name: '/game dice_roll', value: HELP['game dice_roll'].summary, inline: false },
      { name: '/battle', value: HELP.battle.summary, inline: false }
    )
    .setFooter({ text: 'Use /help command:<name> for detailed help on any command.' })
    .setTimestamp();
}

function buildHelpDetailEmbed(cmdKey) {
  const h = HELP[cmdKey];
  if (!h) return null;
  return new EmbedBuilder()
    .setTitle(`/help — ${cmdKey}`)
    .setColor(0x8b5cf6)
    .addFields(
      { name: 'Summary', value: h.summary, inline: false },
      { name: 'Usage', value: '`' + h.usage + '`', inline: false },
      { name: 'Examples', value: h.examples.map((e) => '`' + e + '`').join('\n'), inline: false },
      { name: 'Notes', value: h.notes, inline: false }
    )
    .setTimestamp();
}

// ---------- /info embeds ----------

function buildRotEmbed(rot) {
  const flavor = flavorFor(rot);
  const rarity = rarityLabel(rot.Rarity);
  const em = emojis.emojiFor(rot.FullName);
  const fields = [
    { name: 'Rarity', value: `${rarity} (${rot.Rarity.toFixed(2)}) ${rarityStars(rot.Rarity)}`, inline: true },
    { name: 'Attack', value: rot.Attack.toFixed(2), inline: true },
    { name: 'Health', value: rot.Health.toFixed(2), inline: true },
    { name: 'Speed', value: rot.Speed.toFixed(2), inline: true },
  ];
  if (rot.SpawnLocation) {
    fields.push({ name: 'Spawn', value: `World ${rot.SpawnLocation.World} • Zone ${rot.SpawnLocation.Zone}`, inline: true });
  }
  if (rot.IsExclusive) {
    fields.push({ name: 'Tag', value: '✨ Exclusive', inline: true });
  }
  return new EmbedBuilder()
    .setTitle(`${em} ${rot.FullName}`.trim())
    .setDescription(`*aka ${rot.ShortenedName || 'unknown'}*\n\n${flavor}`)
    .setThumbnail(`${ICON_BASE}/${rot.Icon}`)
    .setColor(0x8b5cf6)
    .addFields(fields)
    .setFooter({ text: 'Brainrot Bot • data from indieun.com/cab' })
    .setTimestamp();
}

function buildBagEmbed(item) {
  const flavor = flavorForItem(item);
  const em = emojis.emojiFor(item.Name);
  return new EmbedBuilder()
    .setTitle(`${em} ${item.Name}`.trim())
    .setDescription(`${flavor}\n\n*${item.Description || 'No description.'}*`)
    .setThumbnail(`${ICON_BASE}/${item.Icon}`)
    .setColor(0xf59e0b)
    .setFooter({ text: 'Brainrot Bot • data from indieun.com/cab' })
    .setTimestamp();
}

function buildSkinEmbed(skin) {
  const flavor = flavorForSkin(skin);
  const em = emojis.emojiFor(skin.Name);
  return new EmbedBuilder()
    .setTitle(`${em} ${skin.Name} Skin`.trim())
    .setDescription(`${flavor}\n\n*${skin.Description || 'No description.'}*`)
    .setThumbnail(`${ICON_BASE}/${skin.Icon}`)
    .setColor(0x06b6d4)
    .addFields([{ name: 'Speed', value: `${skin.Speed}`, inline: true }])
    .setFooter({ text: 'Brainrot Bot • data from indieun.com/cab' })
    .setTimestamp();
}

function buildAboutEmbed() {
  return new EmbedBuilder()
    .setTitle('Brainrot Bot 🗿')
    .setDescription(
      'Like cat bot, but for Italian brainrot characters.\n' +
      'Pulls from a baked snapshot of indieun.com/cab for rot/item/skin info,\n' +
      'and fetches inventories live from `indieun.com/cab/inventory/<id>`.\n\n' +
      `**Inventory:** ${rots.length} brainrots • ${items.length} bag items • ${skins.length} skins`
    )
    .setColor(0x8b5cf6)
    .addFields([
      {
        name: 'Commands',
        value:
          '`/info brainrot [name:<x>]` — random or specific brainrot\n' +
          '`/info hoverboard [name:<x>] [random]` — random or specific hoverboard skin\n' +
          '`/info item [name:<x>] [random]` — random or specific bag item\n' +
          '`/info spawn [world] [zone] [random]` — brainrots at a location\n' +
          '`/info inventory user:<id>` — live player inventory\n' +
          '`/help [command:<x>]` — general help or per-command help\n' +
          '`/trade calculate a:<x> [a_iv] [a_level] b:<x> [b_iv] [b_level]` — trade fairness calculator\n' +
          '`/top by:<stat> [count]` — top N brainrots by rarity/attack/health/speed\n' +
          '`/daily` — brainrot of the day (same all day UTC)\n' +
          '`/guess` — mini-game: identify a brainrot from its icon\n' +
          '`/tierlist user:<id> [source]` — generate a tier-list image\n' +
          '`/settings` — configure server settings\n' +
          '`/ping` — check bot latency',
      },
    ])
    .setFooter({ text: 'stay sigma, fr fr' });
}

// ---------- Spawn embeds ----------

function buildSpawnEmbed(key, list) {
  const [w, z] = key.replace('W', '').split('.Z');
  const lines = list
    .slice(0, 25)
    .map((r, i) => {
      const stars = rarityStars(r.Rarity);
      const ex = r.IsExclusive ? ' ✨' : '';
      const em = emojis.emojiFor(r.FullName);
      return `**${i + 1}.** ${em} ${r.FullName} — ${rarityLabel(r.Rarity)} ${stars}${ex}`.trim();
    })
    .join('\n');
  return new EmbedBuilder()
    .setTitle(`📍 Spawns at World ${w} • Zone ${z}`)
    .setDescription(
      `${list.length} brainrot(s) spawn here, fr.\n\n${lines}\n\n` +
      '*Exclusives and certain rare brainrots have no fixed spawn — they won\'t appear in this list.*'
    )
    .setColor(0x22c55e)
    .setThumbnail(`${ICON_BASE}/${list[0].Icon}`)
    .setFooter({ text: `Brainrot Bot • ${list.length} spawns at W${w}.Z${z}` })
    .setTimestamp();
}

function buildRandomSpawnEmbed() {
  const key = pick(spawnKeys);
  const list = require('./data').spawnIndex.get(key);
  return buildSpawnEmbed(key, list);
}

function buildSpawnCatchEmbed(rot, catcher) {
  const em = emojis.emojiFor(rot.FullName);
  const stars = rarityStars(rot.Rarity);
  const rarity = rarityLabel(rot.Rarity);
  return new EmbedBuilder()
    .setTitle(`${em} ${catcher} caught ${rot.FullName}!`)
    .setDescription(
      `**${rarity} ${stars}**\n\n` +
      `${flavorFor(rot)}\n\n` +
      `Added to your inventory! Use \`/settings reset\` to clear your catches.`
    )
    .setThumbnail(`${ICON_BASE}/${rot.Icon}`)
    .setColor(0x22c55e)
    .setFooter({ text: `Brainrot Bot • caught by ${catcher}` })
    .setTimestamp();
}

// ---------- /top ----------

function statKeyFor(stat) {
  if (stat === 'rarity') return 'Rarity';
  if (stat === 'attack') return 'Attack';
  if (stat === 'health') return 'Health';
  return 'Speed';
}

function sortRotsByStat(stat) {
  const key = statKeyFor(stat);
  return [...rots].sort((a, b) => b[key] - a[key]);
}

function buildTopEmbed(stat, count) {
  const sorted = sortRotsByStat(stat);
  const top = sorted.slice(0, count);

  const statLabel = stat.charAt(0).toUpperCase() + stat.slice(1);
  const lines = top
    .map((r, i) => {
      const v = stat === 'rarity' ? r.Rarity : r[statKeyFor(stat)];
      const valStr = stat === 'rarity' ? `${rarityLabel(r.Rarity)} ${v.toFixed(2)}` : v.toFixed(2);
      const ex = r.IsExclusive ? ' ✨' : '';
      const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `**${i + 1}.**`;
      const em = emojis.emojiFor(r.FullName);
      return `${medal} ${em} ${r.FullName} — ${valStr}${ex}`.trim();
    })
    .join('\n');

  const topEm = emojis.emojiFor(top[0].FullName);
  return new EmbedBuilder()
    .setTitle(`🏆 Top ${count} by ${statLabel}`)
    .setDescription(lines)
    .setColor(0xfacc15)
    .setThumbnail(`${ICON_BASE}/${top[0].Icon}`)
    .addFields([
      { name: 'Top spot', value: `${topEm} ${top[0].FullName} (${top[0].ShortenedName || 'n/a'})`.trim(), inline: false },
    ])
    .setFooter({ text: `Brainrot Bot • ranked by ${statLabel} • out of ${rots.length} total` })
    .setTimestamp();
}

// ---------- /daily ----------

function dailyRot(date = new Date()) {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() + 1;
  const d = date.getUTCDate();
  const sorted = [...rots].sort((a, b) => a.FullName.localeCompare(b.FullName));
  const seed = (y * 10000 + m * 100 + d) % sorted.length;
  return { rot: sorted[seed], sorted, seed, dateStr: `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` };
}

function buildDailyEmbed() {
  const { rot, dateStr } = dailyRot();
  const em = emojis.emojiFor(rot.FullName);
  const flavor = `Today's brainrot is ${em} **${rot.FullName}**, fr. Come back tomorrow for a new one.`;
  return new EmbedBuilder()
    .setTitle(`📅 Brainrot of the Day — ${dateStr}`)
    .setDescription(flavor)
    .setColor(0xa855f7)
    .setThumbnail(`${ICON_BASE}/${rot.Icon}`)
    .addFields([
      { name: 'Rarity', value: `${rarityLabel(rot.Rarity)} (${rot.Rarity.toFixed(2)}) ${rarityStars(rot.Rarity)}`, inline: true },
      { name: 'Attack', value: rot.Attack.toFixed(2), inline: true },
      { name: 'Health', value: rot.Health.toFixed(2), inline: true },
      { name: 'Speed', value: rot.Speed.toFixed(2), inline: true },
      ...(rot.SpawnLocation ? [{ name: 'Spawn', value: `World ${rot.SpawnLocation.World} • Zone ${rot.SpawnLocation.Zone}`, inline: true }] : []),
      ...(rot.IsExclusive ? [{ name: 'Tag', value: '✨ Exclusive', inline: true }] : []),
    ])
    .setFooter({ text: 'Brainrot Bot • rotates at 00:00 UTC' })
    .setTimestamp();
}

// ---------- /guess ----------

function newGuessRound() {
  const answer = pick(rots);
  const distractors = [];
  while (distractors.length < 3) {
    const cand = pick(rots);
    if (cand.FullName === answer.FullName) continue;
    if (distractors.some((d) => d.FullName === cand.FullName)) continue;
    distractors.push(cand);
  }
  const options = [answer, ...distractors];
  for (let i = options.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [options[i], options[j]] = [options[j], options[i]];
  }
  return { answer, options };
}

function buildGuessEmbed(round) {
  return new EmbedBuilder()
    .setTitle('🤔 Guess the Brainrot')
    .setDescription('Who\'s this? Click the right button below to score, fr.')
    .setColor(0x3b82f6)
    .setThumbnail(`${ICON_BASE}/${round.answer.Icon}`)
    .setFooter({ text: 'Brainrot Bot • mini-game' })
    .setTimestamp();
}

function buildGuessComponents(round, disabled = false, revealedAnswer = null) {
  const components = [];
  for (const opt of round.options) {
    const isAnswer = opt.FullName === round.answer.FullName;
    let style = ButtonStyle.Secondary;
    let label = opt.ShortenedName || opt.FullName;
    if (disabled) {
      if (isAnswer) {
        style = ButtonStyle.Success;
        label = `✅ ${label}`;
      } else if (revealedAnswer && revealedAnswer.clicked === opt.FullName) {
        style = ButtonStyle.Danger;
        label = `❌ ${label}`;
      } else {
        style = ButtonStyle.Secondary;
      }
    }
    components.push(new V2ButtonBuilder().setCustomId(`guess:${opt.FullName}`).setLabel(label.slice(0, 80)).setStyle(style).setDisabled(disabled));
  }
  const row = new V2ActionRowBuilder().setComponents(components);
  return row;
}

function buildGuessContainer(round, disabled = false, revealedAnswer = null) {
  const section = new SectionBuilder()
    .setComponents([
      new TextDisplayBuilder().setContent('Guess the Brainrot'),
      new TextDisplayBuilder().setContent("Who's this? Click the right button below to score, fr."),
    ])
    .setAccessory(new ThumbnailBuilder().setURL(`${ICON_BASE}/${round.answer.Icon}`));

  const separator = new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true);

  const actionRow = buildGuessComponents(round, disabled, revealedAnswer);
  const actionRowJson = actionRow.toJSON();

  const container = new ContainerBuilder()
    .setColor(0x8b5cf6)
    .setComponents([section, separator, actionRowJson]);

  return container;
}

// ---------- /trade ----------

function tradeValue(rot, iv, level) {
  const rarityBase = rot.Rarity * 10;
  const ivBonus = (iv / 100) * 10;
  const levelBonus = level * 0.5;
  const exclusiveBonus = rot.IsExclusive ? 25 : 0;
  const statBonus = (rot.Attack + rot.Health + rot.Speed) * 3;
  const total = rarityBase + ivBonus + levelBonus + exclusiveBonus + statBonus;
  return { rarityBase, ivBonus, levelBonus, exclusiveBonus, statBonus, total };
}

function tradeVerdict(aTotal, bTotal) {
  const diff = Math.abs(aTotal - bTotal);
  const larger = Math.max(aTotal, bTotal);
  const pct = larger > 0 ? (diff / larger) * 100 : 0;
  if (pct < 5) return { icon: '✅', label: 'Fair trade', pct };
  if (pct < 15) return { icon: '⚠️', label: 'Slightly one-sided', pct };
  if (pct < 30) return { icon: '❌', label: 'One-sided trade', pct };
  return { icon: '🚫', label: 'Massive rip-off', pct };
}

function buildTradeEmbed(rotA, rotB, ivA, lvlA, ivB, lvlB) {
  const va = tradeValue(rotA, ivA, lvlA);
  const vb = tradeValue(rotB, ivB, lvlB);
  const verdict = tradeVerdict(va.total, vb.total);
  const winner = va.total > vb.total ? 'A' : vb.total > va.total ? 'B' : 'tie';

  const emA = emojis.emojiFor(rotA.FullName);
  const emB = emojis.emojiFor(rotB.FullName);

  const sideA = [
    { name: 'Rarity base', value: va.rarityBase.toFixed(1), inline: true },
    { name: 'IV bonus', value: `+${va.ivBonus.toFixed(1)} (IV ${ivA}%)`, inline: true },
    { name: 'Level bonus', value: `+${va.levelBonus.toFixed(1)} (Lvl ${lvlA})`, inline: true },
    { name: 'Exclusive', value: va.exclusiveBonus ? '+25' : '+0', inline: true },
    { name: 'Stat bonus', value: `+${va.statBonus.toFixed(1)}`, inline: true },
    { name: 'TOTAL', value: `**${va.total.toFixed(1)}**`, inline: true },
  ];
  const sideB = [
    { name: 'Rarity base', value: vb.rarityBase.toFixed(1), inline: true },
    { name: 'IV bonus', value: `+${vb.ivBonus.toFixed(1)} (IV ${ivB}%)`, inline: true },
    { name: 'Level bonus', value: `+${vb.levelBonus.toFixed(1)} (Lvl ${ivB})`, inline: true },
    { name: 'Exclusive', value: vb.exclusiveBonus ? '+25' : '+0', inline: true },
    { name: 'Stat bonus', value: `+${vb.statBonus.toFixed(1)}`, inline: true },
    { name: 'TOTAL', value: `**${vb.total.toFixed(1)}**`, inline: true },
  ];

  const winnerText =
    winner === 'tie'
      ? 'Both sides are worth the same — fair either way, fr.'
      : `Side ${winner} is winning by ${(Math.abs(va.total - vb.total)).toFixed(1)} points (${verdict.pct.toFixed(1)}%).`;

  return new EmbedBuilder()
    .setTitle(`🤝 Trade: ${emA} ${rotA.FullName} vs ${emB} ${rotB.FullName}`)
    .setDescription(`**Verdict: ${verdict.icon} ${verdict.label}**\n${winnerText}`)
    .setColor(0xef4444)
    .setThumbnail(`${ICON_BASE}/${rotA.Icon}`)
    .addFields(
      { name: `🅰️ Side A — ${emA} ${rotA.FullName}`, value: '\u200b', inline: false },
      ...sideA,
      { name: `🅱️ Side B — ${emB} ${rotB.FullName}`, value: '\u200b', inline: false },
      ...sideB
    )
    .setFooter({ text: 'Value formula: rarity×10 + IV×0.1 + level×0.5 + (exclusive?25:0) + stats×3' })
    .setTimestamp();
}

// ---------- /start ----------

function buildStartEmbed(appId) {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setLabel('🚀 Open App Directory')
      .setStyle(ButtonStyle.Link)
      .setURL(APP_DIRECTORY_URL(appId))
  );

  const embed = new EmbedBuilder()
    .setTitle('🚀 Launch Brainrot Bot Activity')
    .setDescription(
      'Two ways to launch the activity:\n\n' +
      '**1.** Tap the button below to open the app directory, then hit **Launch Activity**.\n\n' +
      '**2.** Join a voice channel → click the 🚀 rocket icon → pick **Brainrot Bot**.\n\n' +
      'If the activity doesn\'t appear, make sure the app is invited to your server with the `applications.commands` scope.'
    )
    .setColor(0x8b5cf6)
    .setFooter({ text: 'stay sigma, fr fr' })
    .setTimestamp();

  return { embed, row };
}

module.exports = {
  HELP,
  buildHelpOverviewEmbed,
  buildHelpDetailEmbed,
  buildRotEmbed,
  buildBagEmbed,
  buildSkinEmbed,
  buildAboutEmbed,
  buildSpawnEmbed,
  buildRandomSpawnEmbed,
  buildSpawnCatchEmbed,
  buildTopEmbed,
  buildDailyEmbed,
  buildGuessEmbed,
  buildGuessComponents,
  buildGuessContainer,
  newGuessRound,
  buildTradeEmbed,
  buildStartEmbed,
  buildInventoryPages,
  brainrotSummary,
  statKeyFor,
  sortRotsByStat,
};

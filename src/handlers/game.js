// src/handlers/game.js
// Handles /game 8ball, /game blackjack, /game dice_roll, /top, /daily, /guess

const { EmbedBuilder, ComponentType, MessageFlags, ButtonStyle } = require('discord.js');
const { V2TextDisplayBuilder: TextDisplayBuilder, V2ContainerBuilder: ContainerBuilder, V2SectionBuilder: SectionBuilder, V2ButtonBuilder: ButtonBuilder } = require('v2componentsbuilder');
const { Paginator } = require('../paginator');
const {
  buildTopEmbed,
  buildDailyEmbed,
  buildGuessEmbed,
  buildGuessComponents,
  buildGuessContainer,
  newGuessRound,
} = require('../embeds');
const emojis = require('../emojis');
const { rarityLabel } = require('../helpers');
const data = require('../data');

// ---------- Shared state for blackjack ----------

const blackjackGames = new Map();

function createDeck() {
  const suits = ['♠️', '♥️', '♦️', '♣️'];
  const values = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  const deck = [];
  for (const suit of suits) {
    for (const value of values) {
      deck.push({ suit, value });
    }
  }
  return deck;
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function cardValue(card) {
  if (['J', 'Q', 'K'].includes(card.value)) return 10;
  if (card.value === 'A') return 11;
  return parseInt(card.value, 10);
}

function handValue(hand) {
  let total = 0;
  let aces = 0;
  for (const card of hand) {
    total += cardValue(card);
    if (card.value === 'A') aces++;
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces--;
  }
  return total;
}

function handToString(hand, hideFirst = false) {
  if (hideFirst) {
    return `?? ${hand.slice(1).map(c => `${c.suit}${c.value}`).join(' ')}`;
  }
  return hand.map(c => `${c.suit}${c.value}`).join(' ');
}

// ---------- 8-Ball ----------

const EIGHT_BALL_RESPONSES = [
  'It is certain.',
  'It is decidedly so.',
  'Without a doubt.',
  'Yes definitely.',
  'You may rely on it.',
  'As I see it, yes.',
  'Most likely.',
  'Outlook good.',
  'Yes.',
  'Signs point to yes.',
  'Reply hazy, try again.',
  'Ask again later.',
  'Better not tell you now.',
  'Cannot predict now.',
  'Concentrate and ask again.',
  "Don't count on it.",
  'My reply is no.',
  'My sources say no.',
  'Outlook not so good.',
  'Very doubtful.',
];

async function handle8Ball(interaction) {
  try {
    const question = interaction.options.getString('question').trim();
    const answer = EIGHT_BALL_RESPONSES[Math.floor(Math.random() * EIGHT_BALL_RESPONSES.length)];
    const container = new ContainerBuilder()
      .setColor(0x8b5cf6)
      .setComponents([
        new SectionBuilder()
          .setComponents([new TextDisplayBuilder().setContent(`**Question:** ${question}`)])
          .setAccessory(new ButtonBuilder().setStyle(ButtonStyle.Secondary).setLabel('8-Ball').setCustomId('8ball').setDisabled(true)),
        new SectionBuilder()
          .setComponents([new TextDisplayBuilder().setContent(`**Answer:** ${answer}`)])
          .setAccessory(new ButtonBuilder().setStyle(ButtonStyle.Success).setLabel('Answer').setCustomId('answer').setDisabled(true)),
      ]);
    await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
  } catch (err) {
    await interaction.reply({ content: '❌ Failed to send 8-Ball response. Components V2 error.', flags: MessageFlags.Ephemeral });
  }
}

// ---------- Blackjack ----------

async function handleBlackjack(interaction) {
  try {
    const deck = shuffle(createDeck());
    const playerHand = [deck.pop(), deck.pop()];
    const dealerHand = [deck.pop(), deck.pop()];

    const playerTotal = handValue(playerHand);
    const dealerTotal = handValue(dealerHand);

    if (playerTotal === 21 && dealerTotal === 21) {
      await sendBlackjackResult(interaction, playerHand, dealerHand, false, 'Both have blackjack! Push.', 0x6b7280);
      return;
    }
    if (playerTotal === 21) {
      await sendBlackjackResult(interaction, playerHand, dealerHand, false, 'Blackjack! You win!', 0x22c55e);
      return;
    }
    if (dealerTotal === 21) {
      await sendBlackjackResult(interaction, playerHand, dealerHand, false, 'Dealer has blackjack. You lose.', 0xef4444);
      return;
    }

    const gameState = {
      deck,
      playerHand,
      dealerHand,
      finished: false,
    };

    const reply = await sendBlackjackState(interaction, playerHand, dealerHand, true, `Your turn: Hit or Stand? (${playerTotal})`, 0x3b82f6);
    blackjackGames.set(reply.id, gameState);

    const collector = reply.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: 60_000,
    });

    collector.on('collect', async (i) => {
      const game = blackjackGames.get(reply.id);
      if (!game || game.finished) {
        await i.reply({ content: 'This game has already ended.', flags: MessageFlags.Ephemeral });
        return;
      }
      if (i.user.id !== interaction.user.id) {
        await i.reply({ content: "Not your game, fr. Run the command yourself.", flags: MessageFlags.Ephemeral });
        return;
      }

      if (i.customId === 'bj:hit') {
        game.playerHand.push(game.deck.pop());
        const total = handValue(game.playerHand);
        if (total > 21) {
          game.finished = true;
          await sendBlackjackResult(i, game.playerHand, game.dealerHand, false, `Bust! You went over 21 with ${total}.`, 0xef4444);
          blackjackGames.delete(reply.id);
          return;
        }
        await sendBlackjackState(i, game.playerHand, game.dealerHand, true, `Your turn: Hit or Stand? (${total})`, 0x3b82f6);
        return;
      }

      if (i.customId === 'bj:stand') {
        game.finished = true;
        let dealerTotal = handValue(game.dealerHand);
        while (dealerTotal < 17) {
          game.dealerHand.push(game.deck.pop());
          dealerTotal = handValue(game.dealerHand);
        }
        const playerTotal = handValue(game.playerHand);
        let title, color;
        if (dealerTotal > 21) {
          title = `Dealer busts with ${dealerTotal}! You win!`;
          color = 0x22c55e;
        } else if (playerTotal > dealerTotal) {
          title = `You win! ${playerTotal} vs ${dealerTotal}`;
          color = 0x22c55e;
        } else if (playerTotal < dealerTotal) {
          title = `Dealer wins. ${playerTotal} vs ${dealerTotal}`;
          color = 0xef4444;
        } else {
          title = `Push! Both have ${playerTotal}.`;
          color = 0x6b7280;
        }
        await sendBlackjackResult(i, game.playerHand, game.dealerHand, false, title, color);
        blackjackGames.delete(reply.id);
        return;
      }
    });

    collector.on('end', async () => {
      const game = blackjackGames.get(reply.id);
      if (game && !game.finished) {
        game.finished = true;
        const playerTotal = handValue(game.playerHand);
        let dealerTotal = handValue(game.dealerHand);
        while (dealerTotal < 17) {
          game.dealerHand.push(game.deck.pop());
          dealerTotal = handValue(game.dealerHand);
        }
        let title, color;
        if (dealerTotal > 21) {
          title = `Dealer busts with ${dealerTotal}! You win!`;
          color = 0x22c55e;
        } else if (playerTotal > dealerTotal) {
          title = `You win! ${playerTotal} vs ${dealerTotal}`;
          color = 0x22c55e;
        } else if (playerTotal < dealerTotal) {
          title = `Dealer wins. ${playerTotal} vs ${dealerTotal}`;
          color = 0xef4444;
        } else {
          title = `Push! Both have ${playerTotal}.`;
          color = 0x6b7280;
        }
        try {
          await sendBlackjackResult(interaction, game.playerHand, game.dealerHand, false, title + ' (timed out)', color);
        } catch {}
        blackjackGames.delete(reply.id);
      }
    });
  } catch (err) {
    await interaction.reply({ content: '❌ Failed to start blackjack. Components V2 error.', flags: MessageFlags.Ephemeral });
  }
}

function buildBlackjackContainer(playerHand, dealerHand, hideDealer, status, color) {
  const playerStr = handToString(playerHand);
  const dealerStr = handToString(dealerHand, hideDealer);
  const playerTotal = handValue(playerHand);
  const dealerTotal = hideDealer ? '??' : handValue(dealerHand);
  const footer = hideDealer ? 'Choose Hit or Stand' : 'Game over';
  const container = new ContainerBuilder()
    .setColor(color)
    .setComponents([
      new SectionBuilder()
        .setComponents([new TextDisplayBuilder().setContent(`**Status:** ${status}`)])
        .setAccessory(new ButtonBuilder().setStyle(ButtonStyle.Secondary).setLabel('Status').setCustomId('bj:status').setDisabled(true)),
      new SectionBuilder()
        .setComponents([new TextDisplayBuilder().setContent(`**Your hand** (${playerTotal}): ${playerStr}`)])
        .setAccessory(new ButtonBuilder().setStyle(ButtonStyle.Primary).setLabel('Your Hand').setCustomId('bj:player').setDisabled(true)),
      new SectionBuilder()
        .setComponents([new TextDisplayBuilder().setContent(`**Dealer hand** (${dealerTotal}): ${dealerStr}`)])
        .setAccessory(new ButtonBuilder().setStyle(ButtonStyle.Danger).setLabel('Dealer Hand').setCustomId('bj:dealer').setDisabled(true)),
      new SectionBuilder()
        .setComponents([new TextDisplayBuilder().setContent(footer)])
        .setAccessory(new ButtonBuilder().setStyle(ButtonStyle.Secondary).setLabel('Info').setCustomId('bj:info').setDisabled(true)),
    ]);
  return container;
}

function buildBlackjackActionRow(disabled) {
  const row = new V2ActionRowBuilder().setComponents([
    new V2ButtonBuilder().setCustomId('bj:hit').setLabel('Hit').setStyle(ButtonStyle.Primary).setDisabled(disabled),
    new V2ButtonBuilder().setCustomId('bj:stand').setLabel('Stand').setStyle(ButtonStyle.Secondary).setDisabled(disabled),
  ]);
  return row;
}

async function sendBlackjackState(interaction, playerHand, dealerHand, hideDealer, status, color) {
  const container = buildBlackjackContainer(playerHand, dealerHand, hideDealer, status, color);
  const row = buildBlackjackActionRow(false);
  const payload = { components: [container, row], flags: MessageFlags.IsComponentsV2 };
  if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
    const reply = await interaction.reply(payload);
    return reply;
  }
  await interaction.update(payload);
  return interaction.message;
}

async function sendBlackjackResult(interaction, playerHand, dealerHand, hideDealer, status, color) {
  const container = buildBlackjackContainer(playerHand, dealerHand, hideDealer, status, color);
  const row = buildBlackjackActionRow(true);
  const payload = { components: [container, row], flags: MessageFlags.IsComponentsV2 };
  if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
    await interaction.reply(payload);
    return;
  }
  await interaction.update(payload);
}

// ---------- Dice Roll ----------

async function handleDiceRoll(interaction) {
  try {
    const count = interaction.options.getInteger('count') ?? 1;
    const rolls = [];
    for (let i = 0; i < count; i++) {
      rolls.push(Math.floor(Math.random() * 6) + 1);
    }
    const total = rolls.reduce((a, b) => a + b, 0);
    const diceEmojis = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
    const diceStr = rolls.map(r => diceEmojis[r - 1]).join(' ');
    const container = new ContainerBuilder()
      .setColor(0xf59e0b)
      .setComponents([
        new SectionBuilder()
          .setComponents([new TextDisplayBuilder().setContent(`Rolled **${count}** die${count > 1 ? 's' : ''}:\n${diceStr}`)])
          .setAccessory(new ButtonBuilder().setStyle(ButtonStyle.Secondary).setLabel('Dice').setCustomId('dice').setDisabled(true)),
        new SectionBuilder()
          .setComponents([new TextDisplayBuilder().setContent(`**Total:** ${total}`)])
          .setAccessory(new ButtonBuilder().setStyle(ButtonStyle.Success).setLabel('Total').setCustomId('total').setDisabled(true)),
      ]);
    await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
  } catch (err) {
    await interaction.reply({ content: '❌ Failed to roll dice. Components V2 error.', flags: MessageFlags.Ephemeral });
  }
}

// ---------- Existing handlers ----------

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
  const container = buildGuessContainer(round);
  await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
}

async function handleGame(interaction, ctx) {
  const sub = interaction.options.getSubcommand();
  switch (sub) {
    case '8ball':
      return handle8Ball(interaction);
    case 'blackjack':
      return handleBlackjack(interaction);
    case 'dice_roll':
      return handleDiceRoll(interaction);
    default:
      await interaction.reply({
        content: 'Unknown game subcommand, fr.',
        flags: MessageFlags.Ephemeral,
      });
  }
}

module.exports = {
  handle8Ball,
  handleBlackjack,
  handleDiceRoll,
  handleTop,
  handleDaily,
  handleGuess,
  handleGame,
};

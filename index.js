// index.js
// Brainrot Bot — thin entry point using modular handlers.

require('dotenv').config({ path: '.env' });
const env = process.env.NODE_ENV || 'development';
require('dotenv').config({ path: `.env.${env}`, override: true });

const { Client, GatewayIntentBits, Events, MessageFlags, EmbedBuilder, WebhookClient,
  TextDisplayBuilder, ThumbnailBuilder, SectionBuilder, SeparatorBuilder, SeparatorSpacingSize,
  ButtonBuilder, ButtonStyle, ContainerBuilder } = require('discord.js');
const { execFile: _execFile } = require('child_process');
const _path = require('path');
const _http = require('http');

const log = require('./src/logger');
const db = require('./src/database');
const data = require('./src/data');
const helpers = require('./src/helpers');
const embeds = require('./src/embeds');
const handlers = require('./src/handlers');

// ---------- Constants ----------

const SPAWN_INTERVAL_MS = 60 * 1000;
const SPAWN_DURATION_MS = 60 * 1000;
const activeSpawns = new Map();
const guildWebhooks = new Map();
const welcomeMessages = new Map();
const cooldownMap = new Map();

// ---------- Startup validation ----------

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;

if (!token) {
  log.error('❌ No DISCORD_TOKEN found. Copy .env.example to .env and paste your bot token.');
  process.exit(1);
}

if (!clientId) {
  log.error('❌ No DISCORD_CLIENT_ID found. Copy .env.example to .env and paste your application client ID.');
  process.exit(1);
}

if (!process.env.ROBLOX_API_KEY) {
  log.warn('⚠️  No ROBLOX_API_KEY found. Roblox username lookups will still work but may be rate-limited.');
}

// ---------- Webhook helpers ----------

async function ensureGuildAvatarWebhook(guild, avatarUrl) {
  let webhook = guildWebhooks.get(guild.id);
  if (webhook) {
    try {
      await webhook.edit({ avatar: avatarUrl });
      return webhook;
    } catch {
      guildWebhooks.delete(guild.id);
    }
  }
  const existing = await guild.fetchWebhooks().then((whs) => whs.find((wh) => wh.name === 'BrainrotBot-Avatar'));
  if (existing) {
    try {
      await existing.edit({ avatar: avatarUrl });
      guildWebhooks.set(guild.id, existing);
      db.setGuildSetting(guild.id, 'avatar_webhook_id', existing.id);
      db.setGuildSetting(guild.id, 'avatar_webhook_token', existing.token);
      return existing;
    } catch {
      // fall through to create new
    }
  }
  const webhookName = 'BrainrotBot-Avatar';
  const channel = guild.systemChannel || guild.channels.cache.find((c) => c.type === 0 && c.viewable && c.permissionsFor(guild.members.me)?.has('ManageWebhooks'));
  if (!channel) {
    throw new Error('No suitable channel found for webhook creation. Make sure the bot has Manage Webhooks permission.');
  }
  webhook = await channel.createWebhook({ name: webhookName, avatar: avatarUrl });
  guildWebhooks.set(guild.id, webhook);
  db.setGuildSetting(guild.id, 'avatar_webhook_id', webhook.id);
  db.setGuildSetting(guild.id, 'avatar_webhook_token', webhook.token);
  return webhook;
}

async function getGuildAvatarWebhook(guild) {
  let webhook = guildWebhooks.get(guild.id);
  if (webhook) return webhook;
  const webhookId = db.getGuildSetting(guild.id, 'avatar_webhook_id');
  const webhookToken = db.getGuildSetting(guild.id, 'avatar_webhook_token');
  if (!webhookId || !webhookToken) return null;
  try {
    webhook = new WebhookClient({ id: webhookId, token: webhookToken });

    guildWebhooks.set(guild.id, webhook);
    return webhook;
  } catch {
    return null;
  }
}

// ---------- Spawn system ----------

function checkExpiredSpawns() {
  for (const [guildId, spawn] of activeSpawns.entries()) {
    if (Date.now() > spawn.expiresAt) {
      db.clearSpawn(guildId);
      activeSpawns.delete(guildId);
      log.debug(`Spawn expired in guild ${guildId} (rot: ${spawn.rot?.FullName})`);

      // Edit the spawn embed to show it expired, then delete it shortly after.
      if (spawn.messageId && spawn.channelId) {
        const guild = client.guilds.cache.get(guildId);
        const channel = guild?.channels.cache.get(spawn.channelId);
        if (channel && channel.viewable) {
          channel.messages
            .fetch(spawn.messageId)
            .then(async (msg) => {
              const em = spawn.rot ? require('./src/emojis').emojiFor(spawn.rot.FullName) : '';
              const thumb = spawn.rot ? `${data.ICON_BASE}/${spawn.rot.Icon}` : '';
              const expired = new EmbedBuilder()
                .setTitle(`${em} ${spawn.rot?.FullName || 'A brainrot'} got away!`)
                .setDescription(`**⏰ Expired.** Nobody caught it in time, fr. A new one will spawn soon.`)
                .setThumbnail(thumb)
                .setColor(0x6b7280)
                .setFooter({ text: 'Brainrot Bot • expired' })
                .setTimestamp();
              await msg.edit({ embeds: [expired], components: [] }).catch(() => {});
              // Auto-delete shortly after so the channel doesn't clutter.
              setTimeout(() => msg.delete().catch(() => {}), 10000);
            })
            .catch(() => {});
        }
      }
    }
  }
}

async function spawnRotForGuild(guild) {
  const channelId = db.getGuildSetting(guild.id, 'spawn_channel');
  if (!channelId) return;
  const channel = guild.channels.cache.get(channelId);
  if (!channel || !channel.viewable || !channel.permissionsFor(guild.members.me)?.has('SendMessages')) return;

  const rot = data.pick(data.rotsWithSpawn);
  if (!rot) return;

  const em = require('./src/emojis').emojiFor(rot.FullName);
  const stars = data.rarityStars(rot.Rarity);
  const rarity = helpers.rarityLabel(rot.Rarity);
  const flavor = data.flavorFor(rot);

  const expiresAt = Date.now() + SPAWN_DURATION_MS;

  // Build Components V2 spawn message
  const section = (thumbnailUrl, titleLine, rarityLine, flavorLine) =>
    new SectionBuilder()
      .setThumbnailAccessory(new ThumbnailBuilder().setURL(thumbnailUrl))
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(titleLine),
        new TextDisplayBuilder().setContent(rarityLine),
        new TextDisplayBuilder().setContent(flavorLine),
      );

  // Also send a classic embed + action row as a reliable fallback so the
  // spawn always appears even if Components V2 isn't available in the guild.
  const spawnEmbed = new EmbedBuilder()
    .setTitle(`${em} ${rot.FullName} appeared!`)
    .setDescription(`**${rarity} ${stars}**\n\n${flavor}\n\nType the brainrot's name to catch it!`)
    .setThumbnail(`${data.ICON_BASE}/${rot.Icon}`)
    .setColor(0x22c55e)
    .setFooter({ text: `Brainrot Bot • expires in ${Math.round(SPAWN_DURATION_MS/1000)}s` })
    .setTimestamp();

  const row = new (require('discord.js').ActionRowBuilder)();
  row.addComponents(
    new (require('discord.js').ButtonBuilder)()
      .setCustomId(`spawn:catch:${guild.id}:${Math.floor(expiresAt/1000)}`)
      .setLabel('catch')
      .setStyle(ButtonStyle.Success)
  );

  const msg = await channel.send({ embeds: [spawnEmbed], components: [row] }).catch(() => null);
  if (!msg) return;

  activeSpawns.set(guild.id, { rot, expiresAt, messageId: msg.id, channelId });
  db.setActiveSpawn(guild.id, rot.FullName, Math.floor(expiresAt / 1000));
}

async function spawnTick() {
  checkExpiredSpawns();
  for (const guild of client.guilds.cache.values()) {
    const existing = activeSpawns.get(guild.id);
    if (existing) continue;
    await spawnRotForGuild(guild);
  }
}

// ---------- Context ----------

function createContext() {
  return {
    client,
    db,
    log,
    data,
    helpers,
    embeds,
    activeSpawns,
    guildWebhooks,
    welcomeMessages,
    cooldownMap,
    COOLDOWNS: data.COOLDOWNS,
    ensureGuildAvatarWebhook,
    getGuildAvatarWebhook,
    spawnRotForGuild,
    SPAWN_DURATION_MS,
  };
}

// ---------- Client ----------

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.MessageContent],
});

client.once(Events.ClientReady, async (c) => {
  log.info(`✅ Brainrot Bot online — logged in as ${c.user.tag}`);
  log.info(`   Loaded ${data.rots.length} rots, ${data.items.length} bag items, ${data.skins.length} skins.`);
  log.info(`   Spawn index: ${data.spawnKeys.length} locations, ${data.rotsWithSpawn.length} rots with spawns.`);

  try {
    const count = await require('./src/emojis').loadEmojis(process.env.DISCORD_TOKEN, process.env.DISCORD_CLIENT_ID);
    log.info(`   Loaded ${count} application emojis.`);
    for (const r of data.rots) require('./src/emojis').registerIconForEntity(r.Icon, r.FullName);
    for (const i of data.items) require('./src/emojis').registerIconForEntity(i.Icon, i.Name);
    for (const s of data.skins) require('./src/emojis').registerIconForEntity(s.Icon, s.Name);
  } catch (err) {
    log.warn(`   ⚠️  Could not load application emojis: ${err.message}`);
  }

  c.user.setActivity('Italian brainrots', { type: 3 });

  try {
    db.init();
    log.info('   Database initialized.');
  } catch (err) {
    log.error('   ❌ Database init failed:', err);
  }

  const healthPort = process.env.PORT || process.env.HEALTH_CHECK_PORT;
  if (healthPort) {
    helpers.startHealthCheckServer(parseInt(healthPort, 10), log);
  }

  setInterval(spawnTick, SPAWN_INTERVAL_MS);
  log.info('   Spawn system started (1-minute interval).');
});

client.on(Events.GuildCreate, async (guild) => {
  log.info(`Joined new guild: ${guild.name} (${guild.id})`);
  const welcomeMsg = welcomeMessages.get(guild.id) ||
    'Hey! I\'m Brainrot Bot — like cat bot, but for Italian brainrot characters. Try `/info type:rot` or `/help` to get started, fr. 🗿';
  const systemChannel = guild.systemChannel;
  if (systemChannel && systemChannel.viewable) {
    await systemChannel.send(welcomeMsg).catch(() => {});
  } else {
    const channel = guild.channels.cache.find(
      (c) => c.type === 0 && c.viewable && c.permissionsFor(guild.members.me)?.has('SendMessages')
    );
    if (channel) {
      await channel.send(welcomeMsg).catch(() => {});
    }
  }
});

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;
  if (!message.guild) return;

  const guildId = message.guild.id;
  const spawn = activeSpawns.get(guildId);
  if (!spawn) return;
  if (message.channelId !== spawn.channelId) return;

  const content = message.content.trim().toLowerCase();
  const rot = spawn.rot;
  const fullName = rot.FullName.toLowerCase();
  const shortName = (rot.ShortenedName || '').toLowerCase();

  const isMatch =
    content === fullName ||
    content === shortName ||
    content.startsWith(fullName) ||
    (shortName && content.startsWith(shortName));

  if (!isMatch) return;

  db.addCatch(guildId, message.author.id, rot.FullName);

  const em = require('./src/emojis').emojiFor(rot.FullName);
  const stars = data.rarityStars(rot.Rarity);
  const rarity = helpers.rarityLabel(rot.Rarity);

  // Edit the original spawn embed to show it was caught
  const caughtEmbed = new EmbedBuilder()
    .setTitle(`${em} ${rot.FullName} was caught!`)
    .setDescription(`**${rarity} ${stars}**\n\n${data.flavorFor(rot)}\n\n🎉 **Caught by ${message.author.username}** (${message.author.tag})`)
    .setThumbnail(`${data.ICON_BASE}/${rot.Icon}`)
    .setColor(0x22c55e)
    .setFooter({ text: `Brainrot Bot • caught by ${message.author.tag}` })
    .setTimestamp();

  // Edit the original spawn message to show caught state
  if (spawn.messageId) {
    try {
      const spawnMsg = await message.channel.messages.fetch(spawn.messageId);
      await spawnMsg.edit({ embeds: [caughtEmbed], components: [] }).catch(() => {});
    } catch {
      // Message may already be deleted; ignore.
    }
  }

  // Send ephemeral confirmation to the catcher
  try {
    await message.reply({ 
      content: `✅ You caught ${rot.FullName}!`, 
      flags: MessageFlags.Ephemeral 
    });
  } catch (err) {
    log.warn(`Failed to send catch confirmation: ${err.message}`);
  }

  activeSpawns.delete(guildId);
  db.clearSpawn(guildId);

  log.info(`User ${message.author.tag} caught ${rot.FullName} in guild ${guildId}`);
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isAutocomplete()) {
      const cmd = interaction.commandName;
      if (cmd === 'info') {
        const type = interaction.options.getString('type');
        let pool = [];
        if (type === 'rot') {
          pool = data.rots.map((r) => ({ name: `${require('./src/emojis').emojiFor(r.FullName)} ${r.FullName}`.trim().slice(0, 100), value: r.FullName }));
        } else if (type === 'hoverboard') {
          pool = data.skins.map((s) => ({ name: `${require('./src/emojis').emojiFor(s.Name)} ${s.Name}`.trim().slice(0, 100), value: s.Name }));
        } else if (type === 'item') {
          pool = data.items.map((i) => ({ name: `${require('./src/emojis').emojiFor(i.Name)} ${i.Name}`.trim().slice(0, 100), value: i.Name }));
        } else {
          await interaction.respond([]).catch(() => {});
          return;
        }
        const focused = interaction.options.getFocused().toLowerCase().trim();
        const filtered = focused ? pool.filter((p) => p.value.toLowerCase().includes(focused)) : pool;
        await interaction.respond(filtered.slice(0, 25));
        return;
      }
      if (cmd === 'trade') {
        const focused = interaction.options.getFocused().toLowerCase().trim();
        const pool = data.rots.map((r) => ({ name: `${require('./src/emojis').emojiFor(r.FullName)} ${r.FullName}`.trim().slice(0, 100), value: r.FullName }));
        const filtered = focused ? pool.filter((p) => p.value.toLowerCase().includes(focused)) : pool;
        await interaction.respond(filtered.slice(0, 25));
        return;
      }
      return;
    }

    if (interaction.isButton()) {
      const id = interaction.customId;
      if (id.startsWith('guess:')) {
        const clickedName = id.slice('guess:'.length);
        const msg = interaction.message;
        const rotByIcon = new Map(data.rots.map((r) => [r.Icon, r]));
        const thumbUrl = msg.embeds[0]?.thumbnail?.url || '';
        const iconFile = thumbUrl.split('/').pop();
        const answerRot = rotByIcon.get(iconFile);
        if (!answerRot) {
          await interaction.reply({ content: 'Lost track of the answer, fr. Run `/guess` again for a fresh round.', flags: MessageFlags.Ephemeral });
          return;
        }
        const isCorrect = clickedName === answerRot.FullName;
        const round = embeds.newGuessRound();
        round.answer = answerRot;
        if (isCorrect) {
          await interaction.update({ embeds: [embeds.buildGuessEmbed(round)], components: [embeds.buildGuessComponents(round, true, { clicked: clickedName })] });
        } else {
          await interaction.update({ embeds: [embeds.buildGuessEmbed(round)], components: [embeds.buildGuessComponents(round, true, { clicked: clickedName })] });
        }
        return;
      }
      return;
    }

    const ctx = createContext();
    const handler = handlers[interaction.commandName];
    if (!handler) {
      await interaction.reply({ content: 'Unknown command, fr.', flags: MessageFlags.Ephemeral });
      return;
    }

    // Cooldown check
    const cooldownMs = data.COOLDOWNS[interaction.commandName] || 0;
    if (cooldownMs > 0) {
      const key = `${interaction.user.id}:${interaction.commandName}`;
      const last = cooldownMap.get(key) || 0;
      if (Date.now() - last < cooldownMs) {
        const remaining = Math.ceil((cooldownMs - (Date.now() - last)) / 1000);
        await interaction.reply({ content: `Slow down, fr. Try again in ${remaining}s.`, flags: MessageFlags.Ephemeral });
        return;
      }
      cooldownMap.set(key, Date.now());
    }

    await handler(interaction, ctx);
  } catch (err) {
    log.error('Interaction error:', err);
    if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: 'Something cooked itself, try again fr. 🗿', flags: MessageFlags.Ephemeral }).catch(() => {});
    } else if (interaction.isRepliable() && interaction.deferred) {
      await interaction.editReply({ content: 'Something cooked itself, try again fr. 🗿' }).catch(() => {});
    }
  }
});

// ---------- Graceful shutdown ----------

process.on('SIGINT', () => {
  log.info('\n👋 Shutting down Brainrot Bot...');
  client.destroy();
  process.exit(0);
});

client.login(token);

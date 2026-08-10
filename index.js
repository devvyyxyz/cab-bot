// index.js
// Brainrot Bot — thin entry point using modular handlers.

require('dotenv').config({ path: '.env' });
const env = process.env.NODE_ENV || 'development';
require('dotenv').config({ path: `.env.${env}`, override: true });

const { Client, GatewayIntentBits, Events, MessageFlags, WebhookClient, ButtonStyle, SeparatorSpacingSize } = require('discord.js');
const { V2TextDisplayBuilder: TextDisplayBuilder, V2ContainerBuilder: ContainerBuilder, V2SectionBuilder: SectionBuilder, V2ButtonBuilder: ButtonBuilder, V2SeparatorBuilder: SeparatorBuilder, V2ThumbnailBuilder: ThumbnailBuilder } = require('v2componentsbuilder');
const { execFile: _execFile } = require('child_process');
const _path = require('path');
const _http = require('http');

const log = require('./src/logger');
const db = require('./src/database');
const data = require('./src/data');
const helpers = require('./src/helpers');
const embeds = require('./src/embeds');
const handlers = require('./src/handlers');
const { getActivePaginator } = require('./src/paginator');

// ---------- Constants ----------

const SPAWN_INTERVAL_MS = 60 * 1000;
const SPAWN_DURATION_MS = 60 * 1000;
const SPAWN_COOLDOWN_MS = 60 * 1000;
const activeSpawns = new Map();
const lastSpawnEnd = new Map();
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
      lastSpawnEnd.set(guildId, Date.now());
      db.clearSpawn(guildId);
      activeSpawns.delete(guildId);
      log.debug(`Spawn expired in guild ${guildId} (rot: ${spawn.rot?.FullName})`);

      // Edit the spawn container to show it expired, then delete it shortly after.
      if (spawn.messageId && spawn.channelId) {
        const guild = client.guilds.cache.get(guildId);
        const channel = guild?.channels.cache.get(spawn.channelId);
        if (channel && channel.viewable) {
          channel.messages
            .fetch(spawn.messageId)
            .then(async (msg) => {
              const em = spawn.rot ? require('./src/emojis').emojiFor(spawn.rot.FullName) : '';
              const expiredContainer = new ContainerBuilder()
                .setColor(0x6b7280)
                .setComponents([
                  new TextDisplayBuilder().setContent(`${em} **${spawn.rot?.FullName || 'A brainrot'}** got away!`),
                  new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true),
                  new TextDisplayBuilder().setContent('**⏰ Expired.** Nobody caught it in time, fr. A new one will spawn soon.'),
                ]);
              await msg.edit({ components: [expiredContainer], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
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
  const flavor = data.flavorFor(rot);

  const container = new ContainerBuilder()
    .setColor(0x22c55e)
    .setComponents([
      new SectionBuilder()
        .setComponents([new TextDisplayBuilder().setContent(`${em} **${rot.FullName}** appeared!`)])
        .setAccessory(new ThumbnailBuilder().setURL(`${data.ICON_BASE}/${rot.Icon}`)),
      new TextDisplayBuilder().setContent(flavor),
      new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true),
      new TextDisplayBuilder().setContent("Click the button to catch it!"),
      new SectionBuilder()
        .setComponents([new TextDisplayBuilder().setContent("")])
        .setAccessory(new ButtonBuilder().setStyle(ButtonStyle.Success).setLabel('Catch').setEmoji({ name: '🎉' }).setCustomId('spawn:catch')),
    ]);

  const msg = await channel.send({ components: [container], flags: MessageFlags.IsComponentsV2 }).catch(() => null);
  if (!msg) return;

  const expiresAt = Date.now() + SPAWN_DURATION_MS;
  activeSpawns.set(guild.id, { rot, expiresAt, messageId: msg.id, channelId });
  db.setActiveSpawn(guild.id, rot.FullName, Math.floor(expiresAt / 1000));
}

async function spawnTick() {
  checkExpiredSpawns();
  for (const guild of client.guilds.cache.values()) {
    const existing = activeSpawns.get(guild.id);
    if (existing) continue;
    const lastEnd = lastSpawnEnd.get(guild.id);
    if (lastEnd && Date.now() - lastEnd < SPAWN_COOLDOWN_MS) continue;
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
    lastSpawnEnd,
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
    const details = {
      message: err && err.message ? err.message : String(err),
      code: err && err.code ? err.code : undefined,
      stack: err && err.stack ? err.stack : undefined,
    };
    log.error('   ❌ Database init failed:', details);
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
    'Hey! I\'m Brainrot Bot — like cat bot, but for Italian brainrot characters. Try `/info brainrot` or `/help` to get started, fr. 🗿';
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

async function catchSpawn(guildId, catcherId, catcherTag, catcherUsername) {
  const spawn = activeSpawns.get(guildId);
  if (!spawn) return false;
  const rot = spawn.rot;
  const em = require('./src/emojis').emojiFor(rot.FullName);

  db.addCatch(guildId, catcherId, rot.FullName);

  const caughtContainer = new ContainerBuilder()
    .setColor(0x22c55e)
    .setComponents([
      new SectionBuilder()
        .setComponents([new TextDisplayBuilder().setContent(`${em} **${rot.FullName}** was caught!`)])
        .setAccessory(new ThumbnailBuilder().setURL(`${data.ICON_BASE}/${rot.Icon}`)),
      new TextDisplayBuilder().setContent(data.flavorFor(rot)),
      new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true),
      new TextDisplayBuilder().setContent(`🎉 **Caught by ${catcherUsername}** (${catcherTag})`),
    ]);

  if (spawn.messageId && spawn.channelId) {
    const guild = client.guilds.cache.get(guildId);
    const channel = guild?.channels.cache.get(spawn.channelId);
    if (channel && channel.viewable) {
      channel.messages.fetch(spawn.messageId).then(async (msg) => {
        await msg.edit({ components: [caughtContainer], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
      }).catch(() => {});
    }
  }

  lastSpawnEnd.set(guildId, Date.now());
  activeSpawns.delete(guildId);
  db.clearSpawn(guildId);

  log.info(`User ${catcherTag} caught ${rot.FullName} in guild ${guildId}`);
  return true;
}

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

  const caught = await catchSpawn(guildId, message.author.id, message.author.tag, message.author.username);
  if (!caught) return;

  try {
    const confirmContainer = new ContainerBuilder()
      .setColor(0x22c55e)
      .setComponents([
        new TextDisplayBuilder().setContent(`✅ You caught **${spawn.rot.FullName}**!`),
      ]);
    await message.reply({ components: [confirmContainer], flags: MessageFlags.IsComponentsV2 });
  } catch (err) {
    log.warn(`Failed to send catch confirmation: ${err.message}`);
  }
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
        const container = msg.components[0];
        const section = container?.components?.[0];
        const thumbUrl = section?.accessory?.media?.url || '';
        const iconFile = thumbUrl.split('/').pop();
        const answerRot = rotByIcon.get(iconFile);
        if (!answerRot) {
          await interaction.reply({ content: 'Lost track of the answer, fr. Run `/guess` again for a fresh round.', flags: MessageFlags.Ephemeral });
          return;
        }
        const round = embeds.newGuessRound();
        round.answer = answerRot;
        await interaction.update({ components: [embeds.buildGuessContainer(round, true, { clicked: clickedName })] });
        return;
      }
      if (id === 'dice:reroll') {
        const count = 1;
        const rolls = [];
        for (let i = 0; i < count; i++) {
          rolls.push(Math.floor(Math.random() * 6) + 1);
        }
        const total = rolls.reduce((a, b) => a + b, 0);
        const container = require('./src/handlers/game').buildDiceContainer(count, rolls, total);
        await interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 });
        return;
      }
      if (id === 'spawn:catch') {
        const guildId = interaction.guildId;
        if (!guildId) {
          await interaction.reply({ content: 'Can only catch in a server, fr.', flags: MessageFlags.Ephemeral });
          return;
        }
        const spawn = activeSpawns.get(guildId);
        if (!spawn) {
          await interaction.reply({ content: 'No active spawn to catch, fr.', flags: MessageFlags.Ephemeral });
          return;
        }
        const rotName = spawn.rot.FullName;
        const caught = await catchSpawn(guildId, interaction.user.id, interaction.user.tag, interaction.user.username);
        if (!caught) {
          await interaction.reply({ content: 'No active spawn to catch, fr.', flags: MessageFlags.Ephemeral });
          return;
        }
        const confirmContainer = new ContainerBuilder()
          .setColor(0x22c55e)
          .setComponents([
            new TextDisplayBuilder().setContent(`✅ You caught **${rotName}**!`),
          ]);
        await interaction.reply({ components: [confirmContainer], flags: MessageFlags.IsComponentsV2 });
        return;
      }
      return;
    }

    if (interaction.isStringSelectMenu()) {
      const id = interaction.customId;
      if (id === 'inv:category') {
        const paginator = getActivePaginator(interaction.message.id);
        if (paginator) {
          const value = interaction.values[0];
          if (paginator.categoryRanges && paginator.categoryRanges[value]) {
            const [start] = paginator.categoryRanges[value];
            await paginator._update(interaction, start);
            return;
          }
        }
      }
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
    const details = {
      message: err && err.message ? err.message : String(err),
      code: err && err.code ? err.code : undefined,
      httpStatus: err && err.httpStatus ? err.httpStatus : undefined,
      stack: err && err.stack ? err.stack : undefined,
    };
    log.error('Interaction error:', details);
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

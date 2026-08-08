// index.js
// Brainrot Bot — thin entry point using modular handlers.

require('dotenv').config({ path: '.env' });
const env = process.env.NODE_ENV || 'development';
require('dotenv').config({ path: `.env.${env}`, override: true });

const { Client, GatewayIntentBits, Events, MessageFlags, EmbedBuilder, WebhookClient,
  ButtonBuilder, ButtonStyle } = require('discord.js');
// V2 components builders from shim (aliased to original names)
const { V2TextDisplayBuilder: TextDisplayBuilder, V2ThumbnailBuilder: ThumbnailBuilder, V2SectionBuilder: SectionBuilder, V2SeparatorBuilder: SeparatorBuilder, V2SeparatorSpacingSize: SeparatorSpacingSize, V2ContainerBuilder: ContainerBuilder } = require('v2componentsbuilder');
const { execFile: _execFile } = require('child_process');
const _path = require('path');
const _http = require('http');

const log = require('./src/logger');
const db = require('./src/database');
const data = require('./src/data');
const helpers = require('./src/helpers');
const embeds = require('./src/embeds');
const handlers = require('./src/handlers');
const defaults = require('./src/defaults');

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
                if (spawn.componentsV2) {
                  const expiredSection = new SectionBuilder()
                    .setAccessory(new ThumbnailBuilder().setURL(thumb))
                    .setComponents([
                      new TextDisplayBuilder().setContent(`${em} ${spawn.rot?.FullName || 'A brainrot'} got away!`),
                      new TextDisplayBuilder().setContent('**⏰ Expired.** Nobody caught it in time, fr. A new one will spawn soon.'),
                    ]);
                  const expiredContainer = new ContainerBuilder()
                    .setColor(0x6b7280)
                    .setComponents([
                      expiredSection,
                      new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true),
                    ]);
                  await msg.edit({ components: [expiredContainer] }).catch(() => {});
                } else {
                  const expired = new EmbedBuilder()
                    .setTitle(`${em} ${spawn.rot?.FullName || 'A brainrot'} got away!`)
                    .setDescription(`**⏰ Expired.** Nobody caught it in time, fr. A new one will spawn soon.`)
                    .setThumbnail(thumb)
                    .setColor(0x6b7280)
                    .setFooter({ text: 'Brainrot Bot • expired' })
                    .setTimestamp();
                  await msg.edit({ embeds: [expired], components: [] }).catch(() => {});
                }
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
      .setAccessory(new ThumbnailBuilder().setURL(thumbnailUrl))
      .setComponents([
        new TextDisplayBuilder().setContent(titleLine),
        new TextDisplayBuilder().setContent(rarityLine),
        new TextDisplayBuilder().setContent(flavorLine),
      ]);
  const actionSection = new SectionBuilder()
    .setAccessory(new ButtonBuilder().setStyle(ButtonStyle.Success).setLabel('catch').setCustomId(`spawn:catch:${guild.id}:${Math.floor(expiresAt/1000)}`))
    .setComponents([new TextDisplayBuilder().setContent("Type the brainrot's name to catch it!")]);
  const container = new ContainerBuilder().setColor(0x22c55e).setComponents([
    section(`${data.ICON_BASE}/${rot.Icon}`, `${em} ${rot.FullName} appeared!`, `**${rarity} ${stars}**`, flavor),
    new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true),
    actionSection,
  ]);

  // Also prepare a classic embed + action row fallback so the spawn always
  // appears even if Components V2 isn't available in the guild.
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

  // Prefer Components V2 if available in the runtime (MessageFlags.IsComponentsV2).
  let msg = null;
  let usedV2 = false;
  if (MessageFlags && MessageFlags.IsComponentsV2) {
    try {
      msg = await channel.send({ components: [container], flags: MessageFlags.IsComponentsV2 });
      usedV2 = true;
    } catch (e) {
      // fall back to embed
    }
  }
  if (!msg) {
    msg = await channel.send({ embeds: [spawnEmbed], components: [row] }).catch(() => null);
    usedV2 = false;
  }
  if (!msg) return;

  activeSpawns.set(guild.id, { rot, expiresAt, messageId: msg.id, channelId, componentsV2: usedV2 });
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
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// Discord.js v15 includes native Components V2 support; ensure you upgrade
// the `discord.js` dependency and run `npm install` to enable it.

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

  // Ensure default settings exist for all guilds we're in, and populate welcomeMessages cache.
  try {
    for (const guild of c.guilds.cache.values()) {
      // Apply defaults where missing
      for (const [k, v] of Object.entries(defaults)) {
        const cur = db.getGuildSetting(guild.id, k);
        if (cur === null || cur === undefined) {
          db.setGuildSetting(guild.id, k, v);
        }
      }
      const wm = db.getGuildSetting(guild.id, 'welcome_message') || defaults.welcome_message;
      welcomeMessages.set(guild.id, wm);
    }
  } catch (err) {
    log.warn('Failed to apply default guild settings:', err);
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
  // Ensure default settings are created for this guild
  try {
    for (const [k, v] of Object.entries(defaults)) {
      const cur = db.getGuildSetting(guild.id, k);
      if (cur === null || cur === undefined) db.setGuildSetting(guild.id, k, v);
    }
  } catch (err) { log.warn('Failed to set defaults for new guild:', err); }
  const welcomeMsg = welcomeMessages.get(guild.id) || db.getGuildSetting(guild.id, 'welcome_message') || defaults.welcome_message;
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
  // If user typed a shortcut but there's no active spawn, log why.
  if (!spawn) {
    const maybe = message.content.trim().toLowerCase();
    if (maybe === 'rot' || maybe === 'catch') {
      log.info(`User ${message.author.tag} said '${maybe}' but no active spawn in guild ${guildId}`);
    }
    return;
  }
  if (message.channelId !== spawn.channelId) {
    const maybe = message.content.trim().toLowerCase();
    if (maybe === 'rot' || maybe === 'catch') {
      log.info(`User ${message.author.tag} said '${maybe}' in channel ${message.channelId} but active spawn is in ${spawn.channelId}`);
    }
    return;
  }

  const content = message.content.trim().toLowerCase();
  const rot = spawn.rot;
  const fullName = rot.FullName.toLowerCase();
  const shortName = (rot.ShortenedName || '').toLowerCase();

  // More robust matching: exact, startsWith, contains, or reply shortcut ('rot'/'catch')
  const isExact = content === fullName || (shortName && content === shortName);
  const isStarts = content.startsWith(fullName) || (shortName && content.startsWith(shortName));
  const isContains = content.includes(fullName) || (shortName && content.includes(shortName));
  // Shortcut words: allow users to just say 'rot' or 'catch' in the spawn channel
  const isReplyShortcut = content === 'rot' || content === 'catch';
  const isMatch = isExact || isStarts || isContains || isReplyShortcut;

  if (!isMatch) return;

  const em = require('./src/emojis').emojiFor(rot.FullName);
  const stars = data.rarityStars(rot.Rarity);
  const rarity = helpers.rarityLabel(rot.Rarity);

  // Edit the original spawn embed to show it was caught (update UI first)
  const caughtEmbed = new EmbedBuilder()
    .setTitle(`${em} ${rot.FullName} was caught!`)
    .setDescription(`**${rarity} ${stars}**\n\n${data.flavorFor(rot)}\n\n🎉 **Caught by ${message.author.username}** (${message.author.tag})`)
    .setThumbnail(`${data.ICON_BASE}/${rot.Icon}`)
    .setColor(0x22c55e)
    .setFooter({ text: `Brainrot Bot • caught by ${message.author.tag}` })
    .setTimestamp();

  // Edit the original spawn message to show caught state (attempt UI update first)
  if (spawn.messageId) {
    try {
      const spawnMsg = await message.channel.messages.fetch(spawn.messageId);
      if (spawn.componentsV2) {
        const caughtSection = new SectionBuilder()
          .setAccessory(new ThumbnailBuilder().setURL(`${data.ICON_BASE}/${rot.Icon}`))
          .setComponents([
            new TextDisplayBuilder().setContent(`${em} ${rot.FullName} was caught!`),
            new TextDisplayBuilder().setContent(`**${rarity} ${stars}**`),
            new TextDisplayBuilder().setContent(`${data.flavorFor(rot)}\n\n🎉 **Caught by ${message.author.username}** (${message.author.tag})`),
          ]);
        const caughtContainer = new ContainerBuilder().setColor(0x22c55e).setComponents([caughtSection]);
        await spawnMsg.edit({ components: [caughtContainer] }).catch(() => {});
      } else {
        await spawnMsg.edit({ embeds: [caughtEmbed], components: [] }).catch(() => {});
      }
    } catch (err) {
      log.warn('Failed to edit spawn message on typed catch:', err);
    }
  }

  // Persist the catch (best-effort). Do this after updating UI so DB failures don't block visual feedback.
  try {
    db.addCatch(guildId, message.author.id, rot.FullName);
  } catch (err) {
    log.error('Failed to persist catch to DB (typed):', err);
  }

  // Send a regular (non-ephemeral) confirmation to the catcher; ephemeral flags don't apply to message replies.
  try {
    await message.reply({ content: `✅ You caught ${rot.FullName}!` });
  } catch (err) {
    log.warn('Failed to send catch confirmation:', err);
  }

  activeSpawns.delete(guildId);
  try { db.clearSpawn(guildId); } catch (err) { log.warn('Failed to clear spawn in DB (typed):', err); }

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
      // Handle spawn catch button clicks
      if (id.startsWith('spawn:catch:')) {
        const guildId = interaction.guildId;
        const spawn = activeSpawns.get(guildId);
        if (!spawn) {
          await interaction.reply({ content: 'No active brainrot to catch, fr.', flags: MessageFlags.Ephemeral });
          return;
        }
        // Ensure the button belongs to the active spawn message
        if (interaction.message?.id !== spawn.messageId) {
          await interaction.reply({ content: 'This spawn is no longer active, fr.', flags: MessageFlags.Ephemeral });
          return;
        }

        const rot = spawn.rot;
        const em = require('./src/emojis').emojiFor(rot.FullName);
        const stars = data.rarityStars(rot.Rarity);
        const rarity = helpers.rarityLabel(rot.Rarity);

        try {
          if (spawn.componentsV2) {
            const caughtSection = new SectionBuilder()
              .setAccessory(new ThumbnailBuilder().setURL(`${data.ICON_BASE}/${rot.Icon}`))
              .setComponents([
                new TextDisplayBuilder().setContent(`${em} ${rot.FullName} was caught!`),
                new TextDisplayBuilder().setContent(`**${rarity} ${stars}**`),
                new TextDisplayBuilder().setContent(`${data.flavorFor(rot)}\n\n🎉 **Caught by ${interaction.user.username}** (${interaction.user.tag})`),
              ]);
            const caughtContainer = new ContainerBuilder().setColor(0x22c55e).setComponents([caughtSection]);
            await interaction.update({ components: [caughtContainer], flags: MessageFlags.IsComponentsV2 });
          } else {
            const caughtEmbed = new EmbedBuilder()
              .setTitle(`${em} ${rot.FullName} was caught!`)
              .setDescription(`**${rarity} ${stars}**\n\n${data.flavorFor(rot)}\n\n🎉 **Caught by ${interaction.user.username}** (${interaction.user.tag})`)
              .setThumbnail(`${data.ICON_BASE}/${rot.Icon}`)
              .setColor(0x22c55e)
              .setFooter({ text: `Brainrot Bot • caught by ${interaction.user.tag}` })
              .setTimestamp();
            await interaction.update({ embeds: [caughtEmbed], components: [] });
          }
        } catch (e) {
          log.warn('Failed to update spawn message on catch:', e);
          try { await interaction.reply({ content: 'Caught it but failed to update message, fr.', flags: MessageFlags.Ephemeral }); } catch {};
        }

        // Persist and clear
        try {
          db.addCatch(guildId, interaction.user.id, rot.FullName);
        } catch (err) {
          log.error('Failed to persist catch to DB (button):', err);
        }
        activeSpawns.delete(guildId);
        try { db.clearSpawn(guildId); } catch (e) { log.warn('Failed to clear spawn in DB (button):', e); }

        try { await interaction.followUp({ content: `✅ You caught ${rot.FullName}!`, flags: MessageFlags.Ephemeral }); } catch (e) { /* ignore */ }
        log.info(`User ${interaction.user.tag} caught ${rot.FullName} in guild ${guildId} (button)`);
        return;
      }
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

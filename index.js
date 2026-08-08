// index.js
// Brainrot Bot — a Discord bot like "cat bot" but for Italian brainrot characters.
//
// Commands (all slash):
//   /info type:rot [name:<x>]            → random or specific brainrot
//   /info type:hoverboard [name:<x>]     → random or specific hoverboard skin
//   /info type:item [name:<x>]           → random or specific bag item
//   /info type:about                     → bot info
//   /inventory user:<id>                 → live player inventory from indieun.com/cab
//   /help [command:<x>]                  → general help or per-command help
//   /trade calculate a:<x> [a_iv] [a_level] b:<x> [b_iv] [b_level]
//                                        → calculate whether a trade is fair
//   /start                               → launch the Brainrot Bot activity
//   /spawn [world] [zone]                → brainrots that spawn at a location (or random)
//   /top by:<stat> [count]               → top N brainrots by rarity/attack/health/speed
//   /daily                               → brainrot of the day (same all day UTC)
//   /guess                               → mini-game: identify a brainrot from its icon
//   /tierlist user:<id> [source]         → generate a tier-list image from a live inventory

require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  AttachmentBuilder,
  TextDisplayBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  SeparatorBuilder,
  Events,
  MessageFlags,
} = require("discord.js");
const { execFile } = require("child_process");
const path = require("path");
const http = require("http");
const fs = require("fs");

const rotsData = require("./src/data/rots.json").Data;
const bagData = require("./src/data/bag.json").Data;
const skinsData = require("./src/data/skins.json").Data;

const {
  flavorFor,
  flavorForItem,
  flavorForSkin,
  rarityStars,
  pick,
} = require("./src/slang");

const emojis = require("./src/emojis");
const { Paginator } = require("./src/paginator");
const log = require("./src/logger");
const db = require("./src/database");

// ---------- Constants ----------

const ICON_BASE = "https://indieun.com/cab/icons";
const INVENTORY_URL = (id) => `https://indieun.com/cab/inventory/${encodeURIComponent(id)}`;
const APP_DIRECTORY_URL = (appId) => `https://discord.com/application-directory/${appId}`;
const TIERLIST_SCRIPT = path.join(__dirname, "src", "tierlist.py");
const TIERLIST_OUT_DIR = path.join(__dirname, "tierlists");

// ---------- Cooldowns ----------
// Per-command cooldown: maps commandName to ms. Prevents spam.
const COOLDOWNS = {
  guess: 5000,
  inventory: 10000,
  tierlist: 15000,
  info: 0,
  trade: 0,
  spawn: 0,
  top: 0,
  daily: 0,
  start: 0,
  help: 0,
};
const cooldownMap = new Map(); // "userId:commandName" -> timestamp

// Per-guild welcome message overrides (in-memory, resets on restart).
const welcomeMessages = new Map();

// ---------- Data load ----------

const rots = Object.values(rotsData);
const items = Object.values(bagData);
const skins = Object.values(skinsData);

// Lookup maps for fast name → entry (case-insensitive).
const rotByName = new Map(rots.map((r) => [r.FullName.toLowerCase(), r]));
const itemByName = new Map(items.map((i) => [i.Name.toLowerCase(), i]));
const skinByName = new Map(skins.map((s) => [s.Name.toLowerCase(), s]));

// rotBySpecies: lookup by Species name (used when matching inventory entries
// where Species may equal FullName). Same as rotByName but explicit alias.
const rotBySpecies = rotByName; // species == FullName in this dataset

// Spawn data: rots with a SpawnLocation, grouped by world.zone for /spawn.
const rotsWithSpawn = rots.filter((r) => r.SpawnLocation);
const spawnIndex = new Map(); // "W1.Z1" → [rot, ...]
for (const r of rotsWithSpawn) {
  const k = `W${r.SpawnLocation.World}.Z${r.SpawnLocation.Zone}`;
  if (!spawnIndex.has(k)) spawnIndex.set(k, []);
  spawnIndex.get(k).push(r);
}
const spawnKeys = Array.from(spawnIndex.keys()).sort();

// ---------- Helpers ----------

function findRot(query) {
  if (!query) return null;
  const q = query.toLowerCase().trim();
  let hit = rotByName.get(q);
  if (hit) return hit;
  hit = rots.find(
    (r) =>
      r.FullName.toLowerCase().startsWith(q) ||
      (r.ShortenedName || "").toLowerCase().startsWith(q)
  );
  if (hit) return hit;
  hit = rots.find(
    (r) =>
      r.FullName.toLowerCase().includes(q) ||
      (r.ShortenedName || "").toLowerCase().includes(q)
  );
  return hit || null;
}

function findItem(query) {
  if (!query) return null;
  const q = query.toLowerCase().trim();
  let hit = itemByName.get(q);
  if (hit) return hit;
  hit = items.find((i) => i.Name.toLowerCase().startsWith(q));
  if (hit) return hit;
  hit = items.find((i) => i.Name.toLowerCase().includes(q));
  return hit || null;
}

function findSkin(query) {
  if (!query) return null;
  const q = query.toLowerCase().trim();
  let hit = skinByName.get(q);
  if (hit) return hit;
  hit = skins.find((s) => s.Name.toLowerCase().startsWith(q));
  if (hit) return hit;
  hit = skins.find((s) => s.Name.toLowerCase().includes(q));
  return hit || null;
}

function rarityLabel(rarity) {
  if (rarity >= 4.5) return "Mythical";
  if (rarity >= 3.5) return "Legendary";
  if (rarity >= 2.5) return "Epic";
  if (rarity >= 1.5) return "Rare";
  return "Common";
}

function cleanUserInput(raw) {
  if (!raw) return null;
  let s = String(raw).trim();
  if (s.startsWith("@")) s = s.slice(1);
  return s;
}

function looksLikeUserId(s) {
  return /^\d{1,20}$/.test(s);
}

// Resolve a Roblox username to a numeric user ID via the Roblox API.
// If the input is already numeric, returns it directly.
async function resolveRobloxUser(input) {
  if (looksLikeUserId(input)) return { userId: input };
  const url = "https://users.roblox.com/v2/users/username/by-username";
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "User-Agent": "BrainrotBot/1.0 (Discord bot)",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ usernames: [input], excludeBannedUsers: false }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return { error: `Roblox API returned HTTP ${res.status}` };
    const json = await res.json();
    if (!json.data || json.data.length === 0) {
      return { error: `No Roblox user found with username \`${input}\`.` };
    }
    const user = json.data.find((u) => !u.userId);
    if (user && user.error) {
      return { error: `Roblox API error: ${user.error}` };
    }
    const found = json.data.find((u) => u.userId);
    if (!found) {
      return { error: `No Roblox user found with username \`${input}\`.` };
    }
    return { userId: String(found.userId) };
  } catch (err) {
    if (err.name === "TimeoutError" || err.name === "AbortError") {
      return { error: "Roblox API timed out — try again in a moment, fr." };
    }
    return { error: `network error: ${err.message}` };
  }
}

// ---------- Inventory fetch ----------

async function fetchInventory(userId) {
  const url = INVENTORY_URL(userId);
  let res;
  try {
    res = await fetch(url, {
      headers: { "User-Agent": "BrainrotBot/1.0 (Discord bot)" },
      signal: AbortSignal.timeout(10000),
    });
  } catch (err) {
    if (err.name === "TimeoutError" || err.name === "AbortError") {
      return { error: "indieun.com timed out — try again in a moment, fr." };
    }
    return { error: `network error: ${err.message}` };
  }
  if (res.status === 404) {
    const body = await res.json().catch(() => ({}));
    if (body && body.Error) return { error: body.Error };
    return { error: "no data for that user" };
  }
  if (!res.ok) return { error: `indieun.com returned HTTP ${res.status}` };
  const json = await res.json();
  if (json.Error) return { error: json.Error };
  if (!json.Data) return { error: "unexpected response shape" };
  return { data: json.Data };
}

// ---------- Embed builders ----------

function buildRotEmbed(rot) {
  const flavor = flavorFor(rot);
  const rarity = rarityLabel(rot.Rarity);
  const em = emojis.emojiFor(rot.FullName);
  const fields = [
    { name: "Rarity", value: `${rarity} (${rot.Rarity.toFixed(2)}) ${rarityStars(rot.Rarity)}`, inline: true },
    { name: "Attack", value: rot.Attack.toFixed(2), inline: true },
    { name: "Health", value: rot.Health.toFixed(2), inline: true },
    { name: "Speed", value: rot.Speed.toFixed(2), inline: true },
  ];
  if (rot.SpawnLocation) {
    fields.push({
      name: "Spawn",
      value: `World ${rot.SpawnLocation.World} • Zone ${rot.SpawnLocation.Zone}`,
      inline: true,
    });
  }
  if (rot.IsExclusive) {
    fields.push({ name: "Tag", value: "✨ Exclusive", inline: true });
  }
  return new EmbedBuilder()
    .setTitle(`${em} ${rot.FullName}`.trim())
    .setDescription(`*aka ${rot.ShortenedName || "unknown"}*\n\n${flavor}`)
    .setThumbnail(`${ICON_BASE}/${rot.Icon}`)
    .setColor(0x8b5cf6)
    .addFields(fields)
    .setFooter({ text: "Brainrot Bot • data from indieun.com/cab" })
    .setTimestamp();
}

function buildBagEmbed(item) {
  const flavor = flavorForItem(item);
  const em = emojis.emojiFor(item.Name);
  return new EmbedBuilder()
    .setTitle(`${em} ${item.Name}`.trim())
    .setDescription(`${flavor}\n\n*${item.Description || "No description."}*`)
    .setThumbnail(`${ICON_BASE}/${item.Icon}`)
    .setColor(0xf59e0b)
    .setFooter({ text: "Brainrot Bot • data from indieun.com/cab" })
    .setTimestamp();
}

function buildSkinEmbed(skin) {
  const flavor = flavorForSkin(skin);
  const em = emojis.emojiFor(skin.Name);
  return new EmbedBuilder()
    .setTitle(`${em} ${skin.Name} Skin`.trim())
    .setDescription(`${flavor}\n\n*${skin.Description || "No description."}*`)
    .setThumbnail(`${ICON_BASE}/${skin.Icon}`)
    .setColor(0x06b6d4)
    .addFields([{ name: "Speed", value: `${skin.Speed}`, inline: true }])
    .setFooter({ text: "Brainrot Bot • data from indieun.com/cab" })
    .setTimestamp();
}

function buildAboutEmbed() {
  return new EmbedBuilder()
    .setTitle("Brainrot Bot 🗿")
    .setDescription(
      "Like cat bot, but for Italian brainrot characters.\n" +
      "Pulls from a baked snapshot of [indieun.com/cab](https://indieun.com/cab) for rot/item/skin info,\n" +
      "and fetches inventories live from `indieun.com/cab/inventory/<id>`.\n\n" +
      `**Inventory:** ${rots.length} brainrots • ${items.length} bag items • ${skins.length} skins`
    )
    .setColor(0x8b5cf6)
    .addFields([
      {
        name: "Commands",
        value:
          "`/info type:rot [name:<x>]` — random or specific brainrot\n" +
          "`/info type:hoverboard [name:<x>]` — random or specific hoverboard skin\n" +
          "`/info type:item [name:<x>]` — random or specific bag item\n" +
          "`/info type:about` — this message\n" +
          "`/inventory user:<id>` — live player inventory\n" +
          "`/help [command:<x>]` — show help\n" +
          "`/trade calculate a:<x> b:<x>` — trade fairness calculator\n" +
          "`/spawn [world] [zone]` — brainrots at a spawn location\n" +
          "`/top by:<stat>` — top brainrots by rarity/atk/hp/spd\n" +
          "`/daily` — brainrot of the day (UTC)\n" +
          "`/guess` — icon mini-game\n" +
          "`/tierlist user:<id>` — generate a tier-list image\n" +
          "`/start` — launch the Brainrot Bot activity\n" +
          "`/settings welcomemessage [msg]` — configure server welcome message\n" +
          "`/settings spawnchannel [channel]` — set the catch-game spawn channel\n" +
          "`/settings message [msg]` — set the spawn announcement message\n" +
          "`/settings avatar [url]` — set the bot's avatar\n" +
          "`/settings username [name]` — set the bot's username\n" +
          "`/settings reset` — reset your personal catch inventory\n" +
          "`/settings nuke` — wipe all bot data for this server\n"

      },
    ])
    .setFooter({ text: "stay sigma, fr fr" });
}

// Format a single inventory entry as a one-line summary (used in MediaGallery captions).
function brainrotSummary(entry) {
  const iv = Math.round((entry.IV ?? 0) * 100);
  const nick = entry.Nickname || entry.Species || "Unknown";
  const lvl = entry.Level ?? "?";
  const em = emojis.emojiFor(entry.Species || entry.Nickname || "");
  return `${em} **${nick}** — Lvl ${lvl} • IV ${iv}%`.trim();
}

// ---------- /inventory (Components V2) ----------
//
// Builds a paginated Components V2 response. Each page is an array of
// component builders (Container, TextDisplay, MediaGallery, Section, etc.).
// Pages:
//   1. Overview + Team (MediaGallery of team brainrot icons)
//   2. Hoverboards (MediaGallery + list)
//   3+. PC entries (8 per page, MediaGallery + summaries)
//   Last. Bag (all items with counts)

function buildInventoryPages(userId, inv) {
  const bag = inv.Bag || {};
  const hoverboards = inv.Hoverboards || [];
  const pc = inv.PC || [];
  const team = inv.Team || [];

  const bagEntries = Object.entries(bag).sort((a, b) => b[1] - a[1]);
  const bagCount = bagEntries.length;
  const totalItems = bagEntries.reduce((s, [, q]) => s + q, 0);

  const pages = [];

  // Helper: build a MediaGallery from an array of icon URLs.
  // Returns null if no URLs were added (so caller can skip pushing it).
  function buildGallery(urls) {
    const valid = urls.filter(Boolean);
    if (valid.length === 0) return null;
    const gallery = new MediaGalleryBuilder();
    for (const url of valid) {
      gallery.addItems(new MediaGalleryItemBuilder().setURL(url));
    }
    return gallery;
  }

  // ---- Page 1: Overview + Team ----
  const page1 = [];
  page1.push(new TextDisplayBuilder().setContent(
    `# 🎒 Inventory for ${userId}\n` +
    `Live snapshot from \`indieun.com/cab\`. ` +
    `**${team.length}/6** team • **${pc.length}** in PC • **${hoverboards.length}** hoverboards • **${bagCount}** item types (**${totalItems}** total)`
  ));

  if (team.length > 0) {
    page1.push(new SeparatorBuilder());
    page1.push(new TextDisplayBuilder().setContent(`## ⚔️ Active Team (${team.length}/6)`));
    const urls = team.slice(0, 6).map((t) => {
      const rot = rotBySpecies.get((t.Species || "").toLowerCase());
      return rot ? `${ICON_BASE}/${rot.Icon}` : null;
    });
    const gallery = buildGallery(urls);
    if (gallery) page1.push(gallery);
    // Captions under each icon — list them as a single text block.
    const captions = team.slice(0, 6).map((t, i) => `${i + 1}. ${brainrotSummary(t)}`).join("\n");
    page1.push(new TextDisplayBuilder().setContent(captions));
    // Detailed movesets
    const moves = team.slice(0, 6).map((t, i) => {
      const m = (t.Moveset || []).join(", ") || "none";
      return `${i + 1}. *Moves:* ${m}`;
    }).join("\n");
    page1.push(new TextDisplayBuilder().setContent(moves));
  } else {
    page1.push(new TextDisplayBuilder().setContent("## ⚔️ Active Team\n(no active team)"));
  }
  pages.push(page1);

  // ---- Page 2: Hoverboards ----
  const page2 = [];
  page2.push(new TextDisplayBuilder().setContent(`# 🛹 Hoverboards (${hoverboards.length})`));
  if (hoverboards.length > 0) {
    const urls = hoverboards.slice(0, 10).map((h) => {
      const meta = skinByName.get((h.Name || "").toLowerCase());
      return meta ? `${ICON_BASE}/${meta.Icon}` : null;
    });
    const gallery = buildGallery(urls);
    if (gallery) page2.push(gallery);
    const lines = hoverboards.map((h, i) => {
      const meta = skinByName.get((h.Name || "").toLowerCase());
      const spd = meta ? meta.Speed : "?";
      const em = emojis.emojiFor(h.Name || "");
      return `${i + 1}. ${em} **${h.Name}** — speed ${spd}`.trim();
    }).join("\n");
    page2.push(new TextDisplayBuilder().setContent(lines));
  } else {
    page2.push(new TextDisplayBuilder().setContent("(no hoverboards owned)"));
  }
  pages.push(page2);

  // ---- Pages 3+: PC (8 entries per page) ----
  if (pc.length > 0) {
    const pcSorted = [...pc].sort((a, b) => (b.IV ?? 0) - (a.IV ?? 0));
    const topIV = pcSorted[0];
    const pageSize = 8;
    const totalPages = Math.ceil(pcSorted.length / pageSize);
    for (let p = 0; p < totalPages; p++) {
      const slice = pcSorted.slice(p * pageSize, (p + 1) * pageSize);
      const pageComponents = [];
      pageComponents.push(new TextDisplayBuilder().setContent(
        `# 💻 PC — page ${p + 1}/${totalPages} (${pc.length} total)\n` +
        (topIV ? `**Highest IV:** ${emojis.emojiFor(topIV.Species || "")} ${topIV.Nickname || topIV.Species} at ${Math.round((topIV.IV ?? 0) * 100)}%` : "")
      ));
      const urls = slice.map((e) => {
        const rot = rotBySpecies.get((e.Species || "").toLowerCase());
        return rot ? `${ICON_BASE}/${rot.Icon}` : null;
      });
      const gallery = buildGallery(urls);
      if (gallery) pageComponents.push(gallery);
      // Numbered captions matching the gallery order.
      const offset = p * pageSize;
      const captions = slice.map((e, i) => `${offset + i + 1}. ${brainrotSummary(e)} • ${e.Box || "?"}`).join("\n");
      pageComponents.push(new TextDisplayBuilder().setContent(captions));
      // Movesets (compact)
      const moves = slice.map((e, i) => `${offset + i + 1}. *Moves:* ${(e.Moveset || []).join(", ") || "none"}`).join("\n");
      pageComponents.push(new TextDisplayBuilder().setContent(moves));
      pages.push(pageComponents);
    }
  }

  // ---- Last page: Bag ----
  const bagPage = [];
  bagPage.push(new TextDisplayBuilder().setContent(
    `# 🎒 Bag (${bagCount} types, ${totalItems} total)`
  ));
  if (bagEntries.length > 0) {
    // MediaGallery showing the top items (by count) — up to 10.
    const urls = bagEntries.slice(0, 10).map(([name]) => {
      const item = itemByName.get(name.toLowerCase());
      return item ? `${ICON_BASE}/${item.Icon}` : null;
    });
    const gallery = buildGallery(urls);
    if (gallery) bagPage.push(gallery);
    // List everything with counts (in a code block for alignment).
    const bagStr = bagEntries.map(([name, qty]) => `${qty.toString().padStart(4)} × ${name}`).join("\n");
    // TextDisplay supports markdown — use a code block.
    bagPage.push(new TextDisplayBuilder().setContent("```\n" + bagStr + "\n```"));
  } else {
    bagPage.push(new TextDisplayBuilder().setContent("(empty bag)"));
  }
  pages.push(bagPage);

  return pages;
}

// ---------- /help ----------

const HELP = {
  info: {
    summary: "Look up brainrot info — rot, hoverboard, item, or about.",
    usage: "/info type:<rot|hoverboard|item|about> [name:<query>]",
    examples: [
      "/info type:rot",
      "/info type:rot name:Brr Brrr Patapim",
      "/info type:hoverboard name:UFO",
      "/info type:item name:Infinity Box",
      "/info type:about",
    ],
    notes:
      "Omitting name returns a random entry for any type (rot, hoverboard, or item). Use autocomplete to find a specific one.",
  },
  inventory: {
    summary: "Look up a player's live inventory from indieun.com/cab.",
    usage: "/inventory user:<Roblox UID>",
    examples: ["/inventory user:1559610713"],
    notes:
      "Accepts either a numeric Roblox user ID (e.g. 1559610713) or a username (e.g. YourUsername). The bot resolves usernames via the Roblox API. The reply shows Team, Hoverboards, PC, and Bag in one embed.",
  },
  trade: {
    summary: "Trade tools for brainrots.",
    usage: "/trade calculate a:<name> [a_iv:<0-100>] [a_level:<1-100>] b:<name> [b_iv:<0-100>] [b_level:<1-100>]",
    examples: [
      "/trade calculate a:Brr Brrr Patapim b:Ballerina Cappuccina",
      "/trade calculate a:Brr Brrr Patapim a_iv:91 a_level:25 b:Ballerina Cappuccina b_iv:80 b_level:30",
    ],
    notes:
      "Calculates a value score for each side based on rarity, IV%, level, exclusivity, and base stats. Verdict: ✅ fair / ⚠️ slightly one-sided / ❌ one-sided / 🚫 rip-off. IV and level default to 50% and 10 if omitted.",
  },
  start: {
    summary: "Launch the Brainrot Bot activity.",
    usage: "/start",
    examples: ["/start"],
    notes:
      "Posts an embed with a Launch Activity button. Alternatively, open any voice channel → click the rocket icon → pick Brainrot Bot.",
  },
  spawn: {
    summary: "Show brainrots that spawn at a given world/zone, or a random spawn location.",
    usage: "/spawn [world:<1|2>] [zone:<1-3>]",
    examples: [
      "/spawn",
      "/spawn world:2 zone:3",
      "/spawn world:1",
    ],
    notes:
      "If you omit both world and zone, the bot picks a random spawn location. If you provide world but not zone (or vice versa), it picks a random matching location. Note: 32 of the 90 brainrots have no fixed spawn (mostly exclusives) — those won't appear here.",
  },
  top: {
    summary: "Show the top N brainrots by a chosen stat.",
    usage: "/top by:<rarity|attack|health|speed> [count:<1-25>]",
    examples: [
      "/top by:rarity",
      "/top by:attack count:5",
      "/top by:speed count:25",
    ],
    notes:
      "Defaults to count=10 if omitted. Lists brainrots ranked by the chosen stat with their value, rarity stars, and an icon thumbnail on the top entry.",
  },
  daily: {
    summary: "Brainrot of the day — same for everyone, changes at 00:00 UTC.",
    usage: "/daily",
    examples: ["/daily"],
    notes:
      "Picks a deterministic brainrot based on the current UTC date — so everyone in every server sees the same one today. Use it to start a daily discussion thread.",
  },
  guess: {
    summary: "Mini-game: identify a brainrot from its icon. Pick from 4 choices.",
    usage: "/guess",
    examples: ["/guess"],
    notes:
      "Bot posts an embed with a mystery icon and four buttons (random brainrot names). Click the right one to win. After clicking, the buttons disable and reveal the answer. Play as many times as you want.",
  },
  tierlist: {
    summary: "Generate a tier-list image from a player's live inventory.",
    usage: "/tierlist user:<Roblox UID> [source:<team|pc>]",
    examples: [
      "/tierlist user:1559610713",
      "/tierlist user:1559610713 source:pc",
    ],
    notes:
      "Fetches the player's inventory (by UID or username), scores each entry by IV% (60%) + Level (40%), buckets into S/A/B/C/D tiers, and posts a PNG image with icons + stats. Source defaults to team (the 6 active brainrots); use source:pc to tier everything in their PC.",
  },
  help: {
    summary: "Show bot help, optionally for a specific command.",
    usage: "/help [command:<info|inventory|trade|start|spawn|top|daily|guess|tierlist|settings|help>]",
    examples: ["/help", "/help command:trade"],
    notes: "With no argument, shows all commands with a one-line summary. With a command name, shows full usage and examples.",
  },
  settings: {
    summary: "Configure bot settings for this server — welcome message, spawn channel, spawn message, avatar, username, reset, nuke.",
    usage: "/settings <subcommand> [options]",
    examples: [
      "/settings welcomemessage",
      "/settings welcomemessage message:Welcome to my server, brainrot fans!",
      "/settings spawnchannel channel:#spawns",
      "/settings message message:A brainrot appeared! Type its name to catch it!",
      "/settings avatar image:https://example.com/avatar.png",
      "/settings username name:Brainrot Bot",
      "/settings reset",
      "/settings nuke",
    ],
    notes:
      "Subcommands: `welcomemessage` (set/view join message), `spawnchannel` (set/view the catch-game channel), `message` (set/view the spawn announcement), `avatar` (set/view bot avatar), `username` (set/view bot username), `reset` (clear your personal catch inventory), `nuke` (wipe ALL bot data for this server). The spawn system spawns a random brainrot every minute in the configured channel — type the rot's name to catch it!",
  },

};

function buildHelpOverviewEmbed() {
  return new EmbedBuilder()
    .setTitle("Brainrot Bot — Help")
    .setDescription("Like cat bot, but for Italian brainrot characters. All commands are slash commands.")
    .setColor(0x8b5cf6)
    .addFields(
      { name: "/info", value: HELP.info.summary, inline: false },
      { name: "/inventory", value: HELP.inventory.summary, inline: false },
      { name: "/trade", value: HELP.trade.summary, inline: false },
      { name: "/spawn", value: HELP.spawn.summary, inline: false },
      { name: "/top", value: HELP.top.summary, inline: false },
      { name: "/daily", value: HELP.daily.summary, inline: false },
      { name: "/guess", value: HELP.guess.summary, inline: false },
      { name: "/tierlist", value: HELP.tierlist.summary, inline: false },
      { name: "/start", value: HELP.start.summary, inline: false },
      { name: "/settings", value: HELP.settings.summary, inline: false },
      { name: "/help", value: HELP.help.summary, inline: false }
    )
    .setFooter({ text: "Use /help command:<name> for detailed help on any command." })
    .setTimestamp();
}

function buildHelpDetailEmbed(cmdKey) {
  const h = HELP[cmdKey];
  if (!h) return null;
  return new EmbedBuilder()
    .setTitle(`/help — ${cmdKey}`)
    .setColor(0x8b5cf6)
    .addFields(
      { name: "Summary", value: h.summary, inline: false },
      { name: "Usage", value: "`" + h.usage + "`", inline: false },
      { name: "Examples", value: h.examples.map((e) => "`" + e + "`").join("\n"), inline: false },
      { name: "Notes", value: h.notes, inline: false }
    )
    .setTimestamp();
}

// ---------- /trade calculate ----------

// Compute a trade value score for a brainrot.
// rot: entry from rots.json (has Rarity, Attack, Health, Speed, IsExclusive)
// iv: 0-100 (defaults to 50)
// level: 1-100 (defaults to 10)
function tradeValue(rot, iv, level) {
  const rarityBase = rot.Rarity * 10;            // 10–50
  const ivBonus = (iv / 100) * 10;               // 0–10
  const levelBonus = level * 0.5;                // 0.5–50
  const exclusiveBonus = rot.IsExclusive ? 25 : 0;
  const statBonus = (rot.Attack + rot.Health + rot.Speed) * 3; // ~3–18
  const total = rarityBase + ivBonus + levelBonus + exclusiveBonus + statBonus;
  return { rarityBase, ivBonus, levelBonus, exclusiveBonus, statBonus, total };
}

function tradeVerdict(aTotal, bTotal) {
  const diff = Math.abs(aTotal - bTotal);
  const larger = Math.max(aTotal, bTotal);
  const pct = larger > 0 ? (diff / larger) * 100 : 0;
  if (pct < 5) return { icon: "✅", label: "Fair trade", pct };
  if (pct < 15) return { icon: "⚠️", label: "Slightly one-sided", pct };
  if (pct < 30) return { icon: "❌", label: "One-sided trade", pct };
  return { icon: "🚫", label: "Massive rip-off", pct };
}

function buildTradeEmbed(rotA, rotB, ivA, lvlA, ivB, lvlB) {
  const va = tradeValue(rotA, ivA, lvlA);
  const vb = tradeValue(rotB, ivB, lvlB);
  const verdict = tradeVerdict(va.total, vb.total);
  const winner = va.total > vb.total ? "A" : vb.total > va.total ? "B" : "tie";

  const emA = emojis.emojiFor(rotA.FullName);
  const emB = emojis.emojiFor(rotB.FullName);

  const sideA = [
    { name: "Rarity base", value: va.rarityBase.toFixed(1), inline: true },
    { name: "IV bonus", value: `+${va.ivBonus.toFixed(1)} (IV ${ivA}%)`, inline: true },
    { name: "Level bonus", value: `+${va.levelBonus.toFixed(1)} (Lvl ${lvlA})`, inline: true },
    { name: "Exclusive", value: va.exclusiveBonus ? "+25" : "+0", inline: true },
    { name: "Stat bonus", value: `+${va.statBonus.toFixed(1)}`, inline: true },
    { name: "TOTAL", value: `**${va.total.toFixed(1)}**`, inline: true },
  ];
  const sideB = [
    { name: "Rarity base", value: vb.rarityBase.toFixed(1), inline: true },
    { name: "IV bonus", value: `+${vb.ivBonus.toFixed(1)} (IV ${ivB}%)`, inline: true },
    { name: "Level bonus", value: `+${vb.levelBonus.toFixed(1)} (Lvl ${lvlB})`, inline: true },
    { name: "Exclusive", value: vb.exclusiveBonus ? "+25" : "+0", inline: true },
    { name: "Stat bonus", value: `+${vb.statBonus.toFixed(1)}`, inline: true },
    { name: "TOTAL", value: `**${vb.total.toFixed(1)}**`, inline: true },
  ];

  const winnerText =
    winner === "tie"
      ? "Both sides are worth the same — fair either way, fr."
      : `Side ${winner} is winning by ${(Math.abs(va.total - vb.total)).toFixed(1)} points (${verdict.pct.toFixed(1)}%).`;

  return new EmbedBuilder()
    .setTitle(`🤝 Trade: ${emA} ${rotA.FullName} vs ${emB} ${rotB.FullName}`)
    .setDescription(`**Verdict: ${verdict.icon} ${verdict.label}**\n${winnerText}`)
    .setColor(0xef4444)
    .setThumbnail(`${ICON_BASE}/${rotA.Icon}`)
    .addFields(
      { name: `🅰️ Side A — ${emA} ${rotA.FullName}`, value: "\u200b", inline: false },
      ...sideA,
      { name: `🅱️ Side B — ${emB} ${rotB.FullName}`, value: "\u200b", inline: false },
      ...sideB
    )
    .setFooter({ text: "Value formula: rarity×10 + IV×0.1 + level×0.5 + (exclusive?25:0) + stats×3" })
    .setTimestamp();
}

// ---------- /start ----------

function buildStartEmbed(appId) {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setLabel("🚀 Open App Directory")
      .setStyle(ButtonStyle.Link)
      .setURL(APP_DIRECTORY_URL(appId))
  );

  const embed = new EmbedBuilder()
    .setTitle("🚀 Launch Brainrot Bot Activity")
    .setDescription(
      "Two ways to launch the activity:\n\n" +
      "**1.** Tap the button below to open the app directory, then hit **Launch Activity**.\n\n" +
      "**2.** Join a voice channel → click the 🚀 rocket icon → pick **Brainrot Bot**.\n\n" +
      "If the activity doesn't appear, make sure the app is invited to your server with the `applications.commands` scope."
    )
    .setColor(0x8b5cf6)
    .setFooter({ text: "stay sigma, fr fr" })
    .setTimestamp();

  return { embed, row };
}

// ---------- /spawn ----------

function buildSpawnEmbed(key, list) {
  const [w, z] = key.replace("W", "").split(".Z");
  const lines = list
    .slice(0, 25) // Discord embed field value limit safety
    .map((r, i) => {
      const stars = rarityStars(r.Rarity);
      const ex = r.IsExclusive ? " ✨" : "";
      const em = emojis.emojiFor(r.FullName);
      return `**${i + 1}.** ${em} ${r.FullName} — ${rarityLabel(r.Rarity)} ${stars}${ex}`.trim();
    })
    .join("\n");
  return new EmbedBuilder()
    .setTitle(`📍 Spawns at World ${w} • Zone ${z}`)
    .setDescription(
      `${list.length} brainrot(s) spawn here, fr.\n\n${lines}\n\n` +
      "*Exclusives and certain rare brainrots have no fixed spawn — they won't appear in this list.*"
    )
    .setColor(0x22c55e)
    .setThumbnail(`${ICON_BASE}/${list[0].Icon}`)
    .setFooter({ text: `Brainrot Bot • ${list.length} spawns at W${w}.Z${z}` })
    .setTimestamp();
}

function buildRandomSpawnEmbed() {
  const key = pick(spawnKeys);
  const list = spawnIndex.get(key);
  return buildSpawnEmbed(key, list);
}

// ---------- /top ----------

// Resolve a /top stat choice to the corresponding rots.json property name.
function statKeyFor(stat) {
  if (stat === "rarity") return "Rarity";
  if (stat === "attack") return "Attack";
  if (stat === "health") return "Health";
  return "Speed";
}

// Sort all rots by a stat, descending. Returns a new array.
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
      const v = stat === "rarity" ? r.Rarity : r[statKeyFor(stat)];
      const valStr = stat === "rarity" ? `${rarityLabel(r.Rarity)} ${v.toFixed(2)}` : v.toFixed(2);
      const ex = r.IsExclusive ? " ✨" : "";
      const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `**${i + 1}.**`;
      const em = emojis.emojiFor(r.FullName);
      return `${medal} ${em} ${r.FullName} — ${valStr}${ex}`.trim();
    })
    .join("\n");

  const topEm = emojis.emojiFor(top[0].FullName);
  return new EmbedBuilder()
    .setTitle(`🏆 Top ${count} by ${statLabel}`)
    .setDescription(lines)
    .setColor(0xfacc15)
    .setThumbnail(`${ICON_BASE}/${top[0].Icon}`)
    .addFields([
      { name: "Top spot", value: `${topEm} ${top[0].FullName} (${top[0].ShortenedName || "n/a"})`.trim(), inline: false },
    ])
    .setFooter({ text: `Brainrot Bot • ranked by ${statLabel} • out of ${rots.length} total` })
    .setTimestamp();
}

// ---------- /daily ----------

// Deterministic pick based on UTC date — same for everyone on a given day.
function dailyRot(date = new Date()) {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() + 1;
  const d = date.getUTCDate();
  // Simple hash → index into rots array (sorted alphabetically for stability).
  const sorted = [...rots].sort((a, b) => a.FullName.localeCompare(b.FullName));
  const seed = (y * 10000 + m * 100 + d) % sorted.length;
  return { rot: sorted[seed], sorted, seed, dateStr: `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}` };
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
      { name: "Rarity", value: `${rarityLabel(rot.Rarity)} (${rot.Rarity.toFixed(2)}) ${rarityStars(rot.Rarity)}`, inline: true },
      { name: "Attack", value: rot.Attack.toFixed(2), inline: true },
      { name: "Health", value: rot.Health.toFixed(2), inline: true },
      { name: "Speed", value: rot.Speed.toFixed(2), inline: true },
      ...(rot.SpawnLocation ? [{ name: "Spawn", value: `World ${rot.SpawnLocation.World} • Zone ${rot.SpawnLocation.Zone}`, inline: true }] : []),
      ...(rot.IsExclusive ? [{ name: "Tag", value: "✨ Exclusive", inline: true }] : []),
    ])
    .setFooter({ text: "Brainrot Bot • rotates at 00:00 UTC" })
    .setTimestamp();
}

// ---------- /guess ----------

// Pick 4 random brainrots: 1 answer + 3 distractors.
function newGuessRound() {
  const answer = pick(rots);
  const distractors = [];
  while (distractors.length < 3) {
    const cand = pick(rots);
    if (cand.FullName === answer.FullName) continue;
    if (distractors.some((d) => d.FullName === cand.FullName)) continue;
    distractors.push(cand);
  }
  // Shuffle the 4 options.
  const options = [answer, ...distractors];
  for (let i = options.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [options[i], options[j]] = [options[j], options[i]];
  }
  return { answer, options };
}

function buildGuessEmbed(round) {
  return new EmbedBuilder()
    .setTitle("🤔 Guess the Brainrot")
    .setDescription("Who's this? Click the right button below to score, fr.")
    .setColor(0x3b82f6)
    .setThumbnail(`${ICON_BASE}/${round.answer.Icon}`)
    .setFooter({ text: "Brainrot Bot • mini-game" })
    .setTimestamp();
}

function buildGuessComponents(round, disabled = false, revealedAnswer = null) {
  const row = new ActionRowBuilder();
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
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`guess:${opt.FullName}`)
        .setLabel(label.slice(0, 80))
        .setStyle(style)
        .setDisabled(disabled)
    );
  }
  return row;
}

// ---------- /tierlist ----------

function runTierlistScript(payload) {
  return new Promise((resolve) => {
    const args = [TIERLIST_SCRIPT];
    const env = { ...process.env, PYTHONUNBUFFERED: "1", TIERLIST_OUT_DIR };
    const child = execFile("python3", args, {
      env,
      maxBuffer: 10 * 1024 * 1024,
      timeout: 30000,
    }, (err, stdout, stderr) => {
      if (err) {
        resolve({ ok: false, error: `python error: ${err.message}`, stderr });
        return;
      }
      try {
        const result = JSON.parse(stdout.trim().split("\n").pop());
        resolve(result);
      } catch (e) {
        resolve({ ok: false, error: `parse error: ${e.message}`, stdout, stderr });
      }
    });
    // Write payload to stdin.
    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
  });
}

// Map an inventory entry → tierlist payload entry, looking up the rot's icon.
function entryToTierlistEntry(e) {
  const species = e.Species || e.Nickname || "";
  const rot = rotBySpecies.get(species.toLowerCase());
  return {
    nickname: e.Nickname || species || "Unknown",
    species,
    level: e.Level || 1,
    iv: e.IV || 0,
    icon_url: rot ? `${ICON_BASE}/${rot.Icon}` : null,
  };
}

// ---------- Health check server ----------
// Lightweight HTTP server for hosting platforms (Railway, Render, etc.).
function startHealthCheckServer(port) {
  const server = http.createServer((req, res) => {
    if (req.url === "/health" || req.url === "/healthz") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", bot: "Brainrot Bot", uptime: process.uptime() }));
    } else {
      res.writeHead(404);
      res.end("Not found");
    }
  });
  server.listen(port, () => {
    log.info(`Health check server listening on port ${port}`);
  });
  return server;
}

// ---------- Spawn system ----------
// A rot spawns every SPAWN_INTERVAL_MS in the configured channel.
// Users catch it by typing the rot's FullName or ShortenedName.
const SPAWN_INTERVAL_MS = 60 * 1000; // 1 minute
const SPAWN_DURATION_MS = 60 * 1000; // 1 minute to catch
const activeSpawns = new Map(); // guildId → { rot, expiresAt, messageId, channelId }

// Build the embed shown when a rot spawns.
function buildSpawnCatchEmbed(rot) {
  const em = emojis.emojiFor(rot.FullName);
  const stars = rarityStars(rot.Rarity);
  const rarity = rarityLabel(rot.Rarity);
  const flavor = flavorFor(rot);
  return new EmbedBuilder()
    .setTitle(`${em} ${rot.FullName} — spawned!`.trim())
    .setDescription(
      `**${rarity} ${stars}**\n\n${flavor}\n\n` +
      `Type \`${rot.FullName}\` or \`${rot.ShortenedName || "n/a"}\` to catch it! You have 60 seconds, fr.`
    )
    .setThumbnail(`${ICON_BASE}/${rot.Icon}`)
    .setColor(0x22c55e)
    .setFooter({ text: "Brainrot Bot • catch it before it disappears!" })
    .setTimestamp();
}

// Spawn a new rot in a guild's configured channel.
async function spawnRotForGuild(guild) {
  const guildId = guild.id;
  const channelId = db.getGuildSetting(guildId, "spawn_channel");
  if (!channelId) return; // no spawn channel configured

  const channel = guild.channels.cache.get(channelId);
  if (!channel || !channel.viewable) return;
  if (!channel.permissionsFor(guild.members.me)?.has("SendMessages")) return;

  // Pick a random rot (any rot, not just ones with spawn locations).
  const rot = pick(rots);
  const expiresAt = Math.floor(Date.now() / 1000) + Math.floor(SPAWN_DURATION_MS / 1000);

  // Store in DB and in-memory.
  db.setActiveSpawn(guildId, rot.FullName, expiresAt);
  activeSpawns.set(guildId, {
    rot,
    expiresAt,
    channelId,
  });

  // Send the spawn message.
  const spawnMsg = db.getGuildSetting(guildId, "spawn_message") ||
    "A wild brainrot appeared! Type its name to catch it, fr.";
  try {
    const embed = buildSpawnCatchEmbed(rot);
    const sent = await channel.send({ content: spawnMsg, embeds: [embed] });
    activeSpawns.get(guildId).messageId = sent.id;
  } catch (err) {
    log.warn(`Failed to send spawn message in guild ${guildId}: ${err.message}`);
    activeSpawns.delete(guildId);
  }
}

// Check for expired spawns and clean them up.
function checkExpiredSpawns() {
  const now = Math.floor(Date.now() / 1000);
  for (const [guildId, spawn] of activeSpawns) {
    if (spawn.expiresAt <= now) {
      // Spawn expired — remove it.
      db.clearSpawn(guildId);
      activeSpawns.delete(guildId);
      log.debug(`Spawn expired in guild ${guildId} (rot: ${spawn.rot?.FullName})`);
    }
  }
}

// Run the spawn tick: check for expired spawns, then spawn new ones.
async function spawnTick() {
  checkExpiredSpawns();
  for (const guild of client.guilds.cache.values()) {
    // Only spawn if there's no active spawn in this guild.
    const existing = activeSpawns.get(guild.id);
    if (existing) continue;
    await spawnRotForGuild(guild);
  }
}

// ---------- Client ----------

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.MessageContent],
});



client.once(Events.ClientReady, async (c) => {
  log.info(`✅ Brainrot Bot online — logged in as ${c.user.tag}`);
  log.info(`   Loaded ${rots.length} rots, ${items.length} bag items, ${skins.length} skins.`);
  log.info(`   Spawn index: ${spawnKeys.length} locations, ${rotsWithSpawn.length} rots with spawns.`);

  // Load application emojis and build the icon → emoji map.
  try {
    const count = await emojis.loadEmojis(process.env.DISCORD_TOKEN, process.env.DISCORD_CLIENT_ID);
    log.info(`   Loaded ${count} application emojis.`);
    // Register icon → entity name mappings so emojiForIconFile("61.png") works.
    for (const r of rots) emojis.registerIconForEntity(r.Icon, r.FullName);
    for (const i of items) emojis.registerIconForEntity(i.Icon, i.Name);
    for (const s of skins) emojis.registerIconForEntity(s.Icon, s.Name);
  } catch (err) {
    log.warn(`   ⚠️  Could not load application emojis: ${err.message}`);
    log.warn(`       Emoji features will be disabled. Make sure the bot token has access to the application emojis endpoint.`);
  }

  c.user.setActivity("Italian brainrots", { type: 3 }); // ActivityType.Watching = 3

  // Initialize the database.
  try {
    db.init();
    log.info("   Database initialized.");
  } catch (err) {
    log.error("   ❌ Database init failed:", err);
  }

  // Start health check server if port is configured.
  const healthPort = process.env.PORT || process.env.HEALTH_CHECK_PORT;
  if (healthPort) {
    startHealthCheckServer(parseInt(healthPort, 10));
  }

  // Start the spawn interval (rot spawns every minute in configured channels).
  setInterval(spawnTick, SPAWN_INTERVAL_MS);
  log.info("   Spawn system started (1-minute interval).");
});


// Welcome message when the bot joins a new guild.
client.on(Events.GuildCreate, async (guild) => {
  log.info(`Joined new guild: ${guild.name} (${guild.id})`);
  const welcomeMsg = welcomeMessages.get(guild.id) ||
    "Hey! I'm Brainrot Bot — like cat bot, but for Italian brainrot characters. Try `/info type:rot` or `/help` to get started, fr. 🗿";
  // Try system channel first, then fall back to first viewable text channel.
  const systemChannel = guild.systemChannel;
  if (systemChannel && systemChannel.viewable) {
    await systemChannel.send(welcomeMsg).catch(() => {});
  } else {
    const channel = guild.channels.cache.find(
      (c) => c.type === 0 && c.viewable && c.permissionsFor(guild.members.me)?.has("SendMessages")
    );
    if (channel) {
      await channel.send(welcomeMsg).catch(() => {});
    }
  }
});

// ---------- Spawn catch handler ----------
// When a user sends a message in a channel with an active spawn, check if
// the message matches the spawned rot's FullName or ShortenedName.
client.on(Events.MessageCreate, async (message) => {
  // Ignore bots (including ourselves).
  if (message.author.bot) return;
  if (!message.guild) return;

  const guildId = message.guild.id;
  const spawn = activeSpawns.get(guildId);
  if (!spawn) return;

  // Only check messages in the spawn channel.
  if (message.channelId !== spawn.channelId) return;

  const content = message.content.trim().toLowerCase();
  const rot = spawn.rot;
  const fullName = rot.FullName.toLowerCase();
  const shortName = (rot.ShortenedName || "").toLowerCase();

  // Check if the message matches the rot's name (exact or starts-with).
  const isMatch =
    content === fullName ||
    content === shortName ||
    content.startsWith(fullName) ||
    (shortName && content.startsWith(shortName));

  if (!isMatch) return;

  // User caught the rot!
  const userId = message.author.id;
  db.addCatch(guildId, userId, rot.FullName);

  // Build a catch confirmation embed.
  const em = emojis.emojiFor(rot.FullName);
  const stars = rarityStars(rot.Rarity);
  const rarity = rarityLabel(rot.Rarity);
  const catchEmbed = new EmbedBuilder()
    .setTitle(`${em} ${message.author.username} caught ${rot.FullName}!`)
    .setDescription(
      `**${rarity} ${stars}**\n\n` +
      `${flavorFor(rot)}\n\n` +
      `Added to your inventory! Use \`/settings reset\` to clear your catches.`
    )
    .setThumbnail(`${ICON_BASE}/${rot.Icon}`)
    .setColor(0x22c55e)
    .setFooter({ text: `Brainrot Bot • caught by ${message.author.tag}` })
    .setTimestamp();

  // Send the catch message.
  try {
    await message.reply({ embeds: [catchEmbed] });
  } catch (err) {
    log.warn(`Failed to send catch message: ${err.message}`);
  }

  // Remove the spawn and delete the original spawn message.
  activeSpawns.delete(guildId);
  db.clearSpawn(guildId);
  if (spawn.messageId) {
    try {
      const spawnMsg = await message.channel.messages.fetch(spawn.messageId);
      await spawnMsg.delete().catch(() => {});
    } catch (err) {
      // Message may already be deleted; ignore.
    }
  }

  log.info(`User ${message.author.tag} caught ${rot.FullName} in guild ${guildId}`);
});


client.on(Events.InteractionCreate, async (interaction) => {
  try {
    // ---------------- Autocomplete ----------------
    if (interaction.isAutocomplete()) {
      const cmd = interaction.commandName;

      if (cmd === "info") {
        const type = interaction.options.getString("type");
        let pool = [];
        if (type === "rot") {
          pool = rots.map((r) => ({
            name: `${emojis.emojiFor(r.FullName)} ${r.FullName}`.trim().slice(0, 100),
            value: r.FullName,
          }));
        } else if (type === "hoverboard") {
          pool = skins.map((s) => ({
            name: `${emojis.emojiFor(s.Name)} ${s.Name}`.trim().slice(0, 100),
            value: s.Name,
          }));
        } else if (type === "item") {
          pool = items.map((i) => ({
            name: `${emojis.emojiFor(i.Name)} ${i.Name}`.trim().slice(0, 100),
            value: i.Name,
          }));
        } else {
          // type is about or null — no suggestions.
          await interaction.respond([]).catch(() => {});
          return;
        }
        const focused = interaction.options.getFocused().toLowerCase().trim();
        // Filter on the underlying value (entity name), not the display name
        // (which now includes the emoji prefix).
        const filtered = focused
          ? pool.filter((p) => p.value.toLowerCase().includes(focused))
          : pool;
        await interaction.respond(filtered.slice(0, 25));
        return;
      }

      if (cmd === "trade") {
        // Autocomplete applies to the `a` and `b` options of the calculate subcommand.
        const focused = interaction.options.getFocused().toLowerCase().trim();
        const pool = rots.map((r) => ({
          name: `${emojis.emojiFor(r.FullName)} ${r.FullName}`.trim().slice(0, 100),
          value: r.FullName,
        }));
        const filtered = focused
          ? pool.filter((p) => p.value.toLowerCase().includes(focused))
          : pool;
        await interaction.respond(filtered.slice(0, 25));
        return;
      }

      return;
    }

    // ---------------- Button interactions (for /guess) ----------------
    if (interaction.isButton()) {
      const id = interaction.customId;
      if (id.startsWith("guess:")) {
        const clickedName = id.slice("guess:".length);
        // Fetch the original message embed to figure out the answer.
        // We stored the answer as the thumbnail URL's icon, but we don't have
        // a name↔icon map readily... Actually, easier: we encoded the answer
        // in the message's embed footer? No — let's re-derive from the buttons.
        // The message has 4 buttons; the one whose customId matches the
        // embed's thumbnail is the answer. We can read the message's components
        // to reconstruct the round.
        const msg = interaction.message;
        // Find the answer by looking at the thumbnail icon? Simpler: we can't
        // easily get back from icon to FullName without a reverse map. Build one.
        const rotByIcon = new Map(rots.map((r) => [r.Icon, r]));
        const thumbUrl = msg.embeds[0]?.thumbnail?.url || "";
        const iconFile = thumbUrl.split("/").pop();
        const answerRot = rotByIcon.get(iconFile);
        if (!answerRot) {
          await interaction.reply({
            content: "Lost track of the answer, fr. Run `/guess` again for a fresh round.",
            ephemeral: true,
          });
          return;
        }
        const isCorrect = clickedName === answerRot.FullName;
        // Reconstruct the options from the existing buttons (preserving order).
        const existingButtons = msg.components[0]?.components || [];
        const options = existingButtons.map((b) => {
          const fullName = b.customId.replace("guess:", "");
          return rotByName.get(fullName.toLowerCase()) || { FullName: fullName, ShortenedName: fullName };
        });
        const round = { answer: answerRot, options };
        const newRow = buildGuessComponents(round, true, { clicked: clickedName });

        const resultText = isCorrect
          ? `✅ Correct! That was **${answerRot.FullName}** (${answerRot.ShortenedName || "n/a"}). W rizz.`
          : `❌ Nope — that was **${answerRot.FullName}** (${answerRot.ShortenedName || "n/a"}). Touch grass bro.`;

        await interaction.update({
          content: resultText,
          embeds: msg.embeds,
          components: [newRow],
        });
        return;
      }
      return;
    }

    if (!interaction.isChatInputCommand()) return;

    // ---------------- Cooldown check ----------------
    const cooldown = COOLDOWNS[interaction.commandName];
    if (cooldown > 0) {
      const key = `${interaction.user.id}:${interaction.commandName}`;
      const last = cooldownMap.get(key);
      if (last && Date.now() - last < cooldown) {
        const remaining = Math.ceil((cooldown - (Date.now() - last)) / 1000);
        await interaction.reply({
          content: `Chill out, bro — \`${interaction.commandName}\` is on cooldown for ${remaining}s, fr.`,
          ephemeral: true,
        });
        return;
      }
      cooldownMap.set(key, Date.now());
      setTimeout(() => cooldownMap.delete(key), cooldown);
    }

    // ---------------- /info ----------------
    if (interaction.commandName === "info") {
      const type = interaction.options.getString("type");

      if (type === "rot") {
        const query = interaction.options.getString("name");
        const random = interaction.options.getBoolean("random");
        const rot = (random || !query) ? pick(rots) : findRot(query);
        if (!rot) {
          await interaction.reply({
            content: `Couldn't find a brainrot matching \`${query}\`, bro. Try again or just run \`/info type:rot\` for a random one fr.`,
            ephemeral: true,
          });
          return;
        }
        await interaction.reply({ embeds: [buildRotEmbed(rot)] });
        return;
      }

      if (type === "hoverboard") {
        const query = interaction.options.getString("name");
        const random = interaction.options.getBoolean("random");
        const skin = (random || !query) ? pick(skins) : findSkin(query);
        if (!skin) {
          await interaction.reply({
            content: `Couldn't find a hoverboard matching \`${query}\`, fr. Try the autocomplete.`,
            ephemeral: true,
          });
          return;
        }
        await interaction.reply({ embeds: [buildSkinEmbed(skin)] });
        return;
      }

      if (type === "item") {
        const query = interaction.options.getString("name");
        const random = interaction.options.getBoolean("random");
        const item = (random || !query) ? pick(items) : findItem(query);
        if (!item) {
          await interaction.reply({
            content: `Couldn't find an item matching \`${query}\`, fr. Try the autocomplete.`,
            ephemeral: true,
          });
          return;
        }
        await interaction.reply({ embeds: [buildBagEmbed(item)] });
        return;
      }

      if (type === "about") {
        await interaction.reply({ embeds: [buildAboutEmbed()] });
        return;
      }

      await interaction.reply({
        content: "Unknown info type, fr. Pick rot / hoverboard / item / about.",
        ephemeral: true,
      });
      return;
    }

    // ---------------- /inventory ----------------
    if (interaction.commandName === "inventory") {
      const rawUser = interaction.options.getString("user");
      const userId = cleanUserInput(rawUser);
      if (!userId) {
        await interaction.reply({
          content: "Give me a user ID or username, bro. `/inventory user:1559610713` or `/inventory user:YourUsername` for example.",
          ephemeral: true,
        });
        return;
      }
      await interaction.deferReply();
      // Resolve username to UID if needed.
      let resolvedId = userId;
      if (!looksLikeUserId(userId)) {
        const resolved = await resolveRobloxUser(userId);
        if (resolved.error) {
          await interaction.editReply({
            content: `Couldn't resolve \`${userId}\` to a Roblox user, fr. ${resolved.error}`,
          });
          return;
        }
        resolvedId = resolved.userId;
      }
      const result = await fetchInventory(resolvedId);
      if (result.error) {
        await interaction.editReply({
          content:
            `Couldn't pull inventory for \`${userId}\` — ${result.error}.\n` +
            "Double-check the UID is a real Roblox user with brainrot progress, ong.",
        });
        return;
      }
      // Build paginated Components V2 response.
      const pages = buildInventoryPages(userId, result.data);
      const paginator = new Paginator({
        pages,
        mode: "components",
        userId: interaction.user.id,
        timeout: 120000,
      });
      await paginator.send(interaction);
      return;
    }

    // ---------------- /help ----------------
    if (interaction.commandName === "help") {
      const cmd = interaction.options.getString("command");
      if (!cmd) {
        await interaction.reply({ embeds: [buildHelpOverviewEmbed()] });
        return;
      }
      const detail = buildHelpDetailEmbed(cmd);
      if (!detail) {
        await interaction.reply({
          content: `No help available for \`${cmd}\`, fr. Try one of: info, inventory, trade, start, help.`,
          ephemeral: true,
        });
        return;
      }
      await interaction.reply({ embeds: [detail] });
      return;
    }

    // ---------------- /trade ----------------
    if (interaction.commandName === "trade") {
      const sub = interaction.options.getSubcommand();
      if (sub !== "calculate") {
        await interaction.reply({
          content: "Unknown trade subcommand. Use `/trade calculate`.",
          ephemeral: true,
        });
        return;
      }
      const aName = interaction.options.getString("a");
      const bName = interaction.options.getString("b");
      const aIv = interaction.options.getInteger("a_iv") ?? 50;
      const bIv = interaction.options.getInteger("b_iv") ?? 50;
      const aLvl = interaction.options.getInteger("a_level") ?? 10;
      const bLvl = interaction.options.getInteger("b_level") ?? 10;

      const rotA = findRot(aName);
      const rotB = findRot(bName);
      if (!rotA) {
        await interaction.reply({
          content: `Couldn't find side A brainrot \`${aName}\`. Use the autocomplete to pick a real one, fr.`,
          ephemeral: true,
        });
        return;
      }
      if (!rotB) {
        await interaction.reply({
          content: `Couldn't find side B brainrot \`${bName}\`. Use the autocomplete to pick a real one, fr.`,
          ephemeral: true,
        });
        return;
      }
      if (rotA.FullName === rotB.FullName) {
        await interaction.reply({
          content: "Trading the same brainrot for itself? Bro, that's not a trade fr. Pick two different ones.",
          ephemeral: true,
        });
        return;
      }
      await interaction.reply({
        embeds: [buildTradeEmbed(rotA, rotB, aIv, aLvl, bIv, bLvl)],
      });
      return;
    }

    // ---------------- /settings ----------------
    if (interaction.commandName === "settings") {
      const sub = interaction.options.getSubcommand();
      const guildId = interaction.guildId;

      if (sub === "welcomemessage") {
        const msg = interaction.options.getString("message");
        if (msg) {
          welcomeMessages.set(guildId, msg);
          await interaction.reply({
            content: `✅ Welcome message set for this server, fr. New message:\n> ${msg}`,
            ephemeral: true,
          });
        } else {
          const current = welcomeMessages.get(guildId) || "(default welcome message)";
          await interaction.reply({
            content: `Current welcome message for this server:\n> ${current}\n\nTo change it, use \`/settings welcomemessage message:<your message>\`.`,
            ephemeral: true,
          });
        }
        return;
      }

      if (sub === "spawnchannel") {
        const channel = interaction.options.getChannel("channel");
        if (channel) {
          db.setGuildSetting(guildId, "spawn_channel", channel.id);
          await interaction.reply({
            content: `✅ Spawn channel set to <#${channel.id}>, fr. Brainrots will now spawn there every minute.`,
            ephemeral: true,
          });
        } else {
          const current = db.getGuildSetting(guildId, "spawn_channel");
          if (current) {
            await interaction.reply({
              content: `Current spawn channel: <#${current}>. To change it, use \`/settings spawnchannel channel:<channel>\`.`,
              ephemeral: true,
            });
          } else {
            await interaction.reply({
              content: "No spawn channel set yet. Use `/settings spawnchannel channel:<channel>` to set one.",
              ephemeral: true,
            });
          }
        }
        return;
      }

      if (sub === "message") {
        const msg = interaction.options.getString("message");
        if (msg) {
          db.setGuildSetting(guildId, "spawn_message", msg);
          await interaction.reply({
            content: `✅ Spawn message set for this server, fr. New message:\n> ${msg}`,
            ephemeral: true,
          });
        } else {
          const current = db.getGuildSetting(guildId, "spawn_message") || "(default spawn message)";
          await interaction.reply({
            content: `Current spawn message for this server:\n> ${current}\n\nTo change it, use \`/settings message message:<your message>\`.`,
            ephemeral: true,
          });
        }
        return;
      }

      if (sub === "avatar") {
        const image = interaction.options.getString("image");
        if (image) {
          // Could be an attachment URL or a direct URL.
          let avatarUrl = image;
          // Check if it's an attachment reference (starts with attachment://)
          if (image.startsWith("attachment://")) {
            // Try to get the actual attachment from the interaction.
            const attachments = interaction.options.getAttachments("image");
            if (attachments && attachments.length > 0) {
              avatarUrl = attachments[0].url;
            }
          }
          try {
            await client.user.setAvatar(avatarUrl);
            db.setGuildSetting(guildId, "avatar", avatarUrl);
            await interaction.reply({
              content: `✅ Bot avatar updated, fr.`,
              ephemeral: true,
            });
          } catch (err) {
            await interaction.reply({
              content: `❌ Couldn't set avatar: ${err.message}. Make sure the URL is a valid image.`,
              ephemeral: true,
            });
          }
        } else {
          const current = db.getGuildSetting(guildId, "avatar");
          if (current) {
            await interaction.reply({
              content: `Current bot avatar URL:\n> ${current}\n\nTo change it, use \`/settings avatar image:<url>\`.`,
              ephemeral: true,
            });
          } else {
            await interaction.reply({
              content: "No custom avatar set. Use `/settings avatar image:<url>` to set one.",
              ephemeral: true,
            });
          }
        }
        return;
      }

      if (sub === "username") {
        const name = interaction.options.getString("name");
        if (name) {
          try {
            await client.user.setUsername(name);
            db.setGuildSetting(guildId, "username", name);
            await interaction.reply({
              content: `✅ Bot username set to \`${name}\`, fr.`,
              ephemeral: true,
            });
          } catch (err) {
            await interaction.reply({
              content: `❌ Couldn't set username: ${err.message}. Discord limits username changes.`,
              ephemeral: true,
            });
          }
        } else {
          const current = db.getGuildSetting(guildId, "username") || client.user.username;
          await interaction.reply({
            content: `Current bot username: \`${current}\`\n\nTo change it, use \`/settings username name:<name>\`.`,
            ephemeral: true,
          });
        }
        return;
      }

      if (sub === "reset") {
        const userId = interaction.user.id;
        db.clearUserInventory(guildId, userId);
        await interaction.reply({
          content: `✅ Your catch inventory has been reset for this server, fr. All caught brainrots are gone.`,
          ephemeral: true,
        });
        return;
      }

      if (sub === "nuke") {
        // Require confirmation via a follow-up — but since we can't do interactive
        // confirmation easily in a single reply, we'll just do it with a warning.
        db.nukeGuild(guildId);
        // Also clear in-memory state.
        welcomeMessages.delete(guildId);
        activeSpawns.delete(guildId);
        await interaction.reply({
          content: `💥 **NUKED.** All bot data for this server has been wiped — spawns, inventory, settings, everything. The bot will need to be reconfigured with \`/settings\` commands.`,
          ephemeral: false,
        });
        return;
      }

      await interaction.reply({ content: "Unknown settings subcommand.", ephemeral: true });
      return;
    }


    // ---------------- /start ----------------
    if (interaction.commandName === "start") {
      const { embed, row } = buildStartEmbed(client.user.id);
      await interaction.reply({ embeds: [embed], components: [row] });
      return;
    }

    // ---------------- /spawn ----------------
    if (interaction.commandName === "spawn") {
      const world = interaction.options.getInteger("world");
      const zone = interaction.options.getInteger("zone");

      if (!world && !zone) {
        // Random spawn location
        await interaction.reply({ embeds: [buildRandomSpawnEmbed()] });
        return;
      }

      if ((world && !zone) || (zone && !world)) {
        await interaction.reply({
          content:
            "Give me both `world` and `zone`, bro — or leave both blank for a random spawn. " +
            "Like `/spawn world:2 zone:3`.",
          ephemeral: true,
        });
        return;
      }

      const key = `W${world}.Z${zone}`;
      const list = spawnIndex.get(key);
      if (!list || list.length === 0) {
        await interaction.reply({
          content: `No brainrots spawn at W${world}.Z${zone}, fr. Valid zones: ${spawnKeys.join(", ")}.`,
          ephemeral: true,
        });
        return;
      }
      await interaction.reply({ embeds: [buildSpawnEmbed(key, list)] });
      return;
    }

    // ---------------- /top ----------------
    if (interaction.commandName === "top") {
      const stat = interaction.options.getString("by");
      const count = interaction.options.getInteger("count") ?? 10;
      // For counts > 10, paginate the results 10 per page.
      if (count <= 10) {
        await interaction.reply({ embeds: [buildTopEmbed(stat, count)] });
        return;
      }
      // Build paginated embeds.
      const statLabel = stat.charAt(0).toUpperCase() + stat.slice(1);
      const sorted = sortRotsByStat(stat).slice(0, count);
      const chunkSize = 10;
      const pages = [];
      for (let i = 0; i < sorted.length; i += chunkSize) {
        const chunk = sorted.slice(i, i + chunkSize);
        const lines = chunk.map((r, j) => {
          const idx = i + j;
          const v = stat === "rarity" ? r.Rarity : r[statKeyFor(stat)];
          const valStr = stat === "rarity" ? `${rarityLabel(r.Rarity)} ${v.toFixed(2)}` : v.toFixed(2);
          const ex = r.IsExclusive ? " ✨" : "";
          const medal = idx === 0 ? "🥇" : idx === 1 ? "🥈" : idx === 2 ? "🥉" : `**${idx + 1}.**`;
          const em = emojis.emojiFor(r.FullName);
          return `${medal} ${em} ${r.FullName} — ${valStr}${ex}`.trim();
        }).join("\n");
        const embed = new EmbedBuilder()
          .setTitle(`🏆 Top ${count} by ${statLabel} (page ${pages.length + 1})`)
          .setDescription(lines)
          .setColor(0xfacc15)
          .setThumbnail(`${ICON_BASE}/${sorted[0].Icon}`)
          .setFooter({ text: `Brainrot Bot • ranked by ${statLabel} • page ${pages.length + 1}/${Math.ceil(sorted.length / chunkSize)}` })
          .setTimestamp();
        pages.push(embed);
      }
      const paginator = new Paginator({
        pages,
        mode: "embed",
        userId: interaction.user.id,
        timeout: 120000,
      });
      await paginator.send(interaction);
      return;
    }

    // ---------------- /daily ----------------
    if (interaction.commandName === "daily") {
      await interaction.reply({ embeds: [buildDailyEmbed()] });
      return;
    }

    // ---------------- /guess ----------------
    if (interaction.commandName === "guess") {
      const round = newGuessRound();
      const embed = buildGuessEmbed(round);
      const row = buildGuessComponents(round, false);
      await interaction.reply({ embeds: [embed], components: [row] });
      return;
    }

    // ---------------- /tierlist ----------------
    if (interaction.commandName === "tierlist") {
      const rawUser = interaction.options.getString("user");
      const userId = cleanUserInput(rawUser);
      const source = interaction.options.getString("source") || "team";
      if (!userId) {
        await interaction.reply({
          content: "Give me a user ID or username, bro. `/tierlist user:1559610713` or `/tierlist user:YourUsername` for example.",
          ephemeral: true,
        });
        return;
      }
      await interaction.deferReply();
      // Resolve username to UID if needed.
      let resolvedId = userId;
      if (!looksLikeUserId(userId)) {
        const resolved = await resolveRobloxUser(userId);
        if (resolved.error) {
          await interaction.editReply({
            content: `Couldn't resolve \`${userId}\` to a Roblox user, fr. ${resolved.error}`,
          });
          return;
        }
        resolvedId = resolved.userId;
      }
      const result = await fetchInventory(resolvedId);
      if (result.error) {
        await interaction.editReply({
          content:
            `Couldn't pull inventory for \`${userId}\` — ${result.error}.\n` +
            "Double-check the UID is a real Roblox user with brainrot progress, ong.",
        });
        return;
      }
      const inv = result.data;
      const rawEntries = source === "pc" ? inv.PC || [] : inv.Team || [];
      if (!rawEntries.length) {
        await interaction.editReply({
          content: `Player \`${userId}\` has no entries in their ${source.toUpperCase()}, fr. Try the other source?`,
        });
        return;
      }
      const entries = rawEntries.map(entryToTierlistEntry);
      const payload = { user: userId, source, entries };
      const tierResult = await runTierlistScript(payload);
      if (!tierResult.ok) {
        log.error("Tierlist script error", tierResult);
        const isMissingPython = tierResult.stderr && /not found|No such file|ENOENT|python3.*not/.test(tierResult.stderr);
        const hint = isMissingPython
          ? "Make sure Python 3 and Pillow (`pip install Pillow`) are installed on the server."
          : "Try again in a moment, fr.";
        await interaction.editReply({
          content: `Tierlist generation failed: ${tierResult.error || "unknown error"}. ${hint}`,
        });
        return;
      }
      const attachment = new AttachmentBuilder(tierResult.path, { name: `tierlist_${userId}_${source}.png` });
      const tierSummary = Object.entries(tierResult.tiers || {})
        .filter(([, names]) => names && names.length)
        .map(([t, names]) => `**${t}** (${names.length}): ${names.slice(0, 5).join(", ")}${names.length > 5 ? ", …" : ""}`)
        .join("\n");
      const embed = new EmbedBuilder()
        .setTitle(`📊 Tier List — ${userId} (${source.toUpperCase()})`)
        .setDescription(
          `Scored ${tierResult.total} entr${tierResult.total === 1 ? "y" : "ies"} by IV% (60%) + Level (40%).\n\n${tierSummary}`
        )
        .setColor(0x8b5cf6)
        .setImage(`attachment://tierlist_${userId}_${source}.png`)
        .setFooter({ text: "Brainrot Bot • live data from indieun.com/cab" })
        .setTimestamp();
      await interaction.editReply({ embeds: [embed], files: [attachment] });
      // Clean up the PNG after sending (don't accumulate on disk).
      try { require("fs").unlinkSync(tierResult.path); } catch {}
      return;
    }
  } catch (err) {
    log.error("Interaction error:", err);
    if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
      await interaction
        .reply({ content: "Something cooked itself, try again fr. 🗿", ephemeral: true })
        .catch(() => {});
    } else if (interaction.isRepliable() && interaction.deferred) {
      await interaction
        .editReply({ content: "Something cooked itself, try again fr. 🗿" })
        .catch(() => {});
    }
  }
});

// Graceful shutdown.
process.on("SIGINT", () => {
  log.info("\n👋 Shutting down Brainrot Bot...");
  client.destroy();
  process.exit(0);
});

const token = process.env.DISCORD_TOKEN;
if (!token) {
  log.error("❌ No DISCORD_TOKEN found. Copy .env.example to .env and paste your bot token.");
  process.exit(1);
}

client.login(token);

// src/helpers.js
// Pure helper functions for Brainrot Bot.

const {
  rots,
  items,
  skins,
  rotByName,
  itemByName,
  skinByName,
  rotBySpecies,
  _spawnIndex,
  _spawnKeys,
  _rarityStars,
  pick,
  _flavorFor,
  _flavorForItem,
  _flavorForSkin,
  ICON_BASE,
  INVENTORY_URL,
  TIERLIST_SCRIPT,
  TIERLIST_OUT_DIR,
} = require('./data');

// V2 components builders are provided by the v2 shim
const { V2TextDisplayBuilder: TextDisplayBuilder, V2MediaGalleryBuilder: MediaGalleryBuilder, V2MediaGalleryItemBuilder: MediaGalleryItemBuilder, V2SeparatorBuilder: SeparatorBuilder, V2ContainerBuilder: ContainerBuilder, V2SectionBuilder: SectionBuilder, V2ButtonBuilder: ButtonBuilder } = require('v2componentsbuilder');
const { execFile } = require('child_process');
const { ButtonStyle } = require('discord.js');
const emojis = require('./emojis');

// ---------- Lookup helpers ----------

function findRot(query) {
  if (!query) return null;
  const q = query.toLowerCase().trim();
  let hit = rotByName.get(q);
  if (hit) return hit;
  hit = rots.find((r) => r.FullName.toLowerCase().startsWith(q) || (r.ShortenedName || '').toLowerCase().startsWith(q));
  if (hit) return hit;
  hit = rots.find((r) => r.FullName.toLowerCase().includes(q) || (r.ShortenedName || '').toLowerCase().includes(q));
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
  if (rarity >= 4.5) return 'Mythical';
  if (rarity >= 3.5) return 'Legendary';
  if (rarity >= 2.5) return 'Epic';
  if (rarity >= 1.5) return 'Rare';
  return 'Common';
}

function cleanUserInput(raw) {
  if (!raw) return null;
  let s = String(raw).trim();
  if (s.startsWith('@')) s = s.slice(1);
  return s;
}

function looksLikeUserId(s) {
  return /^\d{1,20}$/.test(s);
}

// ---------- Roblox API ----------

const robloxUserCache = new Map();

async function resolveRobloxUser(input) {
  if (looksLikeUserId(input)) return { userId: input };

  const cached = robloxUserCache.get(input.toLowerCase());
  if (cached && cached.expiresAt > Date.now()) {
    return { userId: cached.userId };
  }

  // Try a series of Roblox endpoints so the lookup is robust even if the
  // Open Cloud API key lacks the right scopes. Each returns { userId } on
  // success, { error } on failure, or null if the response shape was unusable.
  async function tryV2() {
    const url = 'https://users.roblox.com/v2/users/username/by-username';
    const robloxApiKey = process.env.ROBLOX_API_KEY;
    const headers = {
      'User-Agent': 'BrainrotBot/1.0 (Discord bot)',
      'Content-Type': 'application/json',
    };
    if (robloxApiKey) headers['x-api-key'] = robloxApiKey;
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ usernames: [input], excludeBannedUsers: false }),
      signal: AbortSignal.timeout(10000),
    });
    // 401/403 => key present but wrong scopes; 404 => endpoint/name not found.
    return { status: res.status, ok: res.ok, res };
  }

  async function tryV1Public() {
    const url = 'https://users.roblox.com/v1/usernames/users';
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'User-Agent': 'BrainrotBot/1.0 (Discord bot)',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ usernames: [input], excludeBannedUsers: false }),
      signal: AbortSignal.timeout(10000),
    });
    return { status: res.status, ok: res.ok, res };
  }

  // Try the singular v1 username lookup (GET) which some keys/scopes may allow.
  async function tryV1ByUsername() {
    const url = `https://users.roblox.com/v1/users/username?username=${encodeURIComponent(input)}`;
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': 'BrainrotBot/1.0 (Discord bot)',
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(10000),
    });
    return { status: res.status, ok: res.ok, res };
  }

  async function tryLegacy() {
    // Try the legacy API as a last resort. Use GET with query param where supported,
    // fallback to form-POST if necessary.
    const urlGet = `https://api.roblox.com/Users/GetByUsername?username=${encodeURIComponent(input)}`;
    try {
      const res = await fetch(urlGet, {
        method: 'GET',
        headers: {
          'User-Agent': 'BrainrotBot/1.0 (Discord bot)',
        },
        signal: AbortSignal.timeout(10000),
      });
      return { status: res.status, ok: res.ok, res };
    } catch (e) {
      const url = 'https://api.roblox.com/Users/GetByUsername';
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'User-Agent': 'BrainrotBot/1.0 (Discord bot)',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: `username=${encodeURIComponent(input)}`,
        signal: AbortSignal.timeout(10000),
      });
      return { status: res.status, ok: res.ok, res };
    }
  }

  // Parse a successful response into a userId across all three shapes.
  async function parseResult(tryResult) {
    if (!tryResult.ok) return null;
    const json = await tryResult.res.json().catch(() => null);
    if (!json) return null;
    // v2 / v1: data array with { userId|id, error? }
    if (Array.isArray(json.data)) {
      const bad = json.data.find((u) => u.error);
      if (bad) return { error: `Roblox API error: ${bad.error}` };
      const found = json.data.find((u) => u.userId || u.id);
      if (found) return { userId: String(found.userId || found.id) };
      return null;
    }
    // Legacy: { Id, Username }
    if (json.Id) return { userId: String(json.Id) };
    return null;
  }

  // Run v2 first and capture its status/result.
  let v2;
  try {
    v2 = await tryV2();
  } catch (err) {
    v2 = { status: err.name === 'TimeoutError' || err.name === 'AbortError' ? 'timeout' : 'network', ok: false };
  }
  const v2Result = v2.ok ? await parseResult(v2).catch(() => null) : null;
  if (v2Result && v2Result.userId) {
    robloxUserCache.set(input.toLowerCase(), { userId: v2Result.userId, expiresAt: Date.now() + 86400000 });
    return { userId: v2Result.userId };
  }

  // If v2 specifically returned 401/403, that's most likely an API key scope problem.
  if (v2.status === 401 || v2.status === 403) {
    return {
      error:
        `The Roblox API key appears to be present but missing the required \'users:read\' (Open Cloud) permission, so username lookups couldn't be performed. ` +
        `Please provide a numeric Roblox ID instead, e.g. \`/inventory user:1559610713\`, or fix the \`ROBLOX_API_KEY\` scopes.
`,
    };
  }

  // If v2 returned a 404 (username not found) try some alternate endpoints before giving up.
  try {
    if (v2.status === 404) {
      const byName = await tryV1ByUsername();
      const byNameResult = byName.ok ? await parseResult(byName).catch(() => null) : null;
      if (byNameResult && byNameResult.userId) {
        robloxUserCache.set(input.toLowerCase(), { userId: byNameResult.userId, expiresAt: Date.now() + 86400000 });
        return { userId: byNameResult.userId };
      }
      const v1 = await tryV1Public();
      const v1Result = v1.ok ? await parseResult(v1).catch(() => null) : null;
      if (v1Result && v1Result.userId) {
        robloxUserCache.set(input.toLowerCase(), { userId: v1Result.userId, expiresAt: Date.now() + 86400000 });
        return { userId: v1Result.userId };
      }
      const legacy = await tryLegacy();
      const legacyResult = legacy.ok ? await parseResult(legacy).catch(() => null) : null;
      if (legacyResult && legacyResult.userId) {
        robloxUserCache.set(input.toLowerCase(), { userId: legacyResult.userId, expiresAt: Date.now() + 86400000 });
        return { userId: legacyResult.userId };
      }
      // Nothing found: definite username miss.
      return { error: `No Roblox user found with username \`${input}\`. Double-check the spelling, or provide a numeric Roblox ID (e.g. \`/inventory user:1559610713\`).` };
    }

    // v2 timed out or network error: still try public/legacy endpoints as they may work.
    if (v2.status === 'network' || v2.status === 'timeout') {
      const v1 = await tryV1Public();
      const v1Result = v1.ok ? await parseResult(v1).catch(() => null) : null;
      if (v1Result && v1Result.userId) {
        robloxUserCache.set(input.toLowerCase(), { userId: v1Result.userId, expiresAt: Date.now() + 86400000 });
        return { userId: v1Result.userId };
      }
      const legacy = await tryLegacy();
      const legacyResult = legacy.ok ? await parseResult(legacy).catch(() => null) : null;
      if (legacyResult && legacyResult.userId) {
        robloxUserCache.set(input.toLowerCase(), { userId: legacyResult.userId, expiresAt: Date.now() + 86400000 });
        return { userId: legacyResult.userId };
      }
      return { error: `Couldn't reach the Roblox API to confirm username \`${input}\` (network or timeout). Provide a numeric Roblox ID instead, e.g. \`/inventory user:1559610713\`.` };
    }

    // For any other non-OK v2 response, try the public v1 and legacy endpoints as a fallback.
    const v1 = await tryV1Public();
    const v1Result = v1.ok ? await parseResult(v1).catch(() => null) : null;
    if (v1Result && v1Result.userId) {
      robloxUserCache.set(input.toLowerCase(), { userId: v1Result.userId, expiresAt: Date.now() + 86400000 });
      return { userId: v1Result.userId };
    }
    const legacy = await tryLegacy();
    const legacyResult = legacy.ok ? await parseResult(legacy).catch(() => null) : null;
    if (legacyResult && legacyResult.userId) {
      robloxUserCache.set(input.toLowerCase(), { userId: legacyResult.userId, expiresAt: Date.now() + 86400000 });
      return { userId: legacyResult.userId };
    }
  } catch (e) {
    // ignore and fall through to friendly message below
  }

  // Build a distinct, helpful message based on what we saw.
  const keyIssue = v2.status === 403 || v2.status === 401;
  if (keyIssue) {
    return {
      error:
        `The Roblox API key is missing the \`users:read\` (Open Cloud) permission, so username lookups couldn't be performed. ` +
        `Please provide a numeric Roblox ID instead, e.g. \`/inventory user:1559610713\`, or fix the \`ROBLOX_API_KEY\` scopes.`,
    };
  }
  if (v2.status === 404 || v2.status === 'network' || v2.status === 'timeout') {
    return {
      error:
        `Couldn't confirm the username \`${input}\` (Roblox API returned HTTP ${v2.status === 'network' ? 'network error' : v2.status === 'timeout' ? 'timeout' : v2.status}). ` +
        `Double-check the username, or provide a numeric Roblox ID instead, e.g. \`/inventory user:1559610713\`.`,
    };
  }
  return { error: `No Roblox user found with username \`${input}\`.` };
}

async function fetchInventory(userId) {
  const url = INVENTORY_URL(userId);
  let res;
  try {
    res = await fetch(url, {
      headers: { 'User-Agent': 'BrainrotBot/1.0 (Discord bot)' },
      signal: AbortSignal.timeout(10000),
    });
  } catch (err) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      return { error: 'indieun.com timed out — try again in a moment, fr.' };
    }
    return { error: `network error: ${err.message}` };
  }
  if (res.status === 404) {
    const body = await res.json().catch(() => ({}));
    if (body && body.Error) return { error: body.Error };
    return { error: 'no data for that user' };
  }
  if (!res.ok) return { error: `indieun.com returned HTTP ${res.status}` };
  const json = await res.json();
  if (json.Error) return { error: json.Error };
  if (!json.Data) return { error: 'unexpected response shape' };
  return { data: json.Data };
}

// ---------- Trade helpers ----------

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

// ---------- Guess game ----------

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

// ---------- Daily ----------

function dailyRot(date = new Date()) {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() + 1;
  const d = date.getUTCDate();
  const sorted = [...rots].sort((a, b) => a.FullName.localeCompare(b.FullName));
  const seed = (y * 10000 + m * 100 + d) % sorted.length;
  return { rot: sorted[seed], sorted, seed, dateStr: `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` };
}

function brainrotSummary(entry) {
  const iv = Math.round((entry.IV ?? 0) * 100);
  const nick = entry.Nickname || entry.Species || 'Unknown';
  const lvl = entry.Level ?? '?';
  const em = emojis.emojiFor(entry.Species || entry.Nickname || '');
  return `${em} **${nick}** — Lvl ${lvl} • IV ${iv}%`.trim();
}

function buildInventoryPages(userId, inv) {
  const bag = inv.Bag || {};
  const hoverboards = inv.Hoverboards || [];
  const pc = inv.PC || [];
  const team = inv.Team || [];

  const bagEntries = Object.entries(bag).sort((a, b) => b[1] - a[1]);
  const bagCount = bagEntries.length;
  const totalItems = bagEntries.reduce((s, [, q]) => s + q, 0);

  const pages = [];

  function buildGallery(urls) {
    const valid = urls.filter(Boolean);
    if (valid.length === 0) return null;
    const gallery = new MediaGalleryBuilder();
    for (const url of valid) {
      gallery.addItems(new MediaGalleryItemBuilder().setURL(url));
    }
    return gallery;
  }

  const page1 = [];
  page1.push(new TextDisplayBuilder().setContent(`# 🎒 Inventory for ${userId}
` + `Live snapshot from \`indieun.com/cab\`. ` + `**${team.length}/6** team • **${pc.length}** in PC • **${hoverboards.length}** hoverboards • **${bagCount}** item types (**${totalItems}** total)`));

  if (team.length > 0) {
    page1.push(new SeparatorBuilder());
    page1.push(new TextDisplayBuilder().setContent(`## ⚔️ Active Team (${team.length}/6)`));
    const urls = team.slice(0, 6).map((t) => {
      const rot = rotBySpecies.get((t.Species || '').toLowerCase());
      return rot ? `${ICON_BASE}/${rot.Icon}` : null;
    });
    const gallery = buildGallery(urls);
    if (gallery) page1.push(gallery);
    const captions = team.slice(0, 6).map((t, i) => `${i + 1}. ${brainrotSummary(t)}`).join('\n');
    page1.push(new TextDisplayBuilder().setContent(captions));
    const moves = team.slice(0, 6).map((t, i) => {
      const m = (t.Moveset || []).join(', ') || 'none';
      return `${i + 1}. *Moves:* ${m}`;
    }).join('\n');
    page1.push(new TextDisplayBuilder().setContent(moves));
  } else {
    page1.push(new TextDisplayBuilder().setContent('## ⚔️ Active Team\n(no active team)'));
  }
  pages.push(page1);

  const page2 = [];
  page2.push(new TextDisplayBuilder().setContent(`# 🛹 Hoverboards (${hoverboards.length})`));
  if (hoverboards.length > 0) {
    const urls = hoverboards.slice(0, 10).map((h) => {
      const meta = skinByName.get((h.Name || '').toLowerCase());
      return meta ? `${ICON_BASE}/${meta.Icon}` : null;
    });
    const gallery = buildGallery(urls);
    if (gallery) page2.push(gallery);
    const lines = hoverboards.map((h, i) => {
      const meta = skinByName.get((h.Name || '').toLowerCase());
      const spd = meta ? meta.Speed : '?';
      const em = emojis.emojiFor(h.Name || '');
      return `${i + 1}. ${em} **${h.Name}** — speed ${spd}`.trim();
    }).join('\n');
    page2.push(new TextDisplayBuilder().setContent(lines));
  } else {
    page2.push(new TextDisplayBuilder().setContent('(no hoverboards owned)'));
  }
  pages.push(page2);

  if (pc.length > 0) {
    const pcSorted = [...pc].sort((a, b) => (b.IV ?? 0) - (a.IV ?? 0));
    const topIV = pcSorted[0];
    const pageSize = 8;
    const totalPages = Math.ceil(pcSorted.length / pageSize);
    for (let p = 0; p < totalPages; p++) {
      const slice = pcSorted.slice(p * pageSize, (p + 1) * pageSize);
      const pageComponents = [];
      pageComponents.push(new TextDisplayBuilder().setContent(`# 💻 PC — page ${p + 1}/${totalPages} (${pc.length} total)
` + (topIV ? `**Highest IV:** ${emojis.emojiFor(topIV.Species || '')} ${topIV.Nickname || topIV.Species} at ${Math.round((topIV.IV ?? 0) * 100)}%` : '')));
      const urls = slice.map((e) => {
        const rot = rotBySpecies.get((e.Species || '').toLowerCase());
        return rot ? `${ICON_BASE}/${rot.Icon}` : null;
      });
      const gallery = buildGallery(urls);
      if (gallery) pageComponents.push(gallery);
      const offset = p * pageSize;
      const captions = slice.map((e, i) => `${offset + i + 1}. ${brainrotSummary(e)} • ${e.Box || '?'}`).join('\n');
      pageComponents.push(new TextDisplayBuilder().setContent(captions));
      const moves = slice.map((e, i) => `${offset + i + 1}. *Moves:* ${(e.Moveset || []).join(', ') || 'none'}`).join('\n');
      pageComponents.push(new TextDisplayBuilder().setContent(moves));
      pages.push(pageComponents);
    }
  }

  const bagPage = [];
  bagPage.push(new TextDisplayBuilder().setContent(`# 🎒 Bag (${bagCount} types, ${totalItems} total)`));
  if (bagEntries.length > 0) {
    const urls = bagEntries.slice(0, 10).map(([name]) => {
      const item = itemByName.get(name.toLowerCase());
      return item ? `${ICON_BASE}/${item.Icon}` : null;
    });
    const gallery = buildGallery(urls);
    if (gallery) bagPage.push(gallery);
    const bagStr = bagEntries.map(([name, qty]) => `${qty.toString().padStart(4)} × ${name}`).join('\n');
    bagPage.push(new TextDisplayBuilder().setContent('```\n' + bagStr + '\n```'));
  } else {
    bagPage.push(new TextDisplayBuilder().setContent('(empty bag)'));
  }
  pages.push(bagPage);

  return pages;
}

// Embed-styled version of the inventory report rendered with Components V2.
// Returns an array of pages; each page is an array of v2 component builders
// (a ContainerBuilder with Section/TextDisplay/Separator cards), for use with
// Paginator mode "components" (sends with IsComponentsV2 flag).
function buildInventoryEmbeds(userId, inv) {
  const bag = inv.Bag || {};
  const hoverboards = inv.Hoverboards || [];
  const pc = inv.PC || [];
  const team = inv.Team || [];

  const bagEntries = Object.entries(bag).sort((a, b) => b[1] - a[1]);
  const bagCount = bagEntries.length;
  const totalItems = bagEntries.reduce((s, [, q]) => s + q, 0);

  // Small reusable builders.
  const text = (content) => new TextDisplayBuilder().setContent(content);
  const section = (button, ...contents) => {
    return new SectionBuilder().setAccessory(button).setComponents(contents.map((c) => text(c)));
  };
  const divider = () => new SeparatorBuilder().setDivider(true);
  const boardButton = (label, emoji) => new ButtonBuilder().setStyle(ButtonStyle.Success).setLabel(label).setEmoji({ name: emoji }).setCustomId(`inv:${label}`);

  const pages = [];

  // ---- Page 1: Overview + Team ----
  const p1 = new ContainerBuilder().setColor(0x8b5cf6).setComponents([
    section(boardButton('Summary', '🎒'), `🎒 Inventory — ${userId}`),
    section(boardButton('info', 'ℹ️'), `**${team.length}/6** team • **${pc.length}** in PC • **${hoverboards.length}** hoverboards • ${bagCount} item types (**${totalItems}** total)`),
    divider(),
    section(boardButton('info', 'ℹ️'), `⚔️ Active Team (${team.length}/6)`),
  ]);
  if (team.length > 0) {
    const lines = team.slice(0, 6).map((t, i) => {
      const m = (t.Moveset || []).join(', ') || 'none';
      return `${i + 1}. ${brainrotSummary(t)}\nMoves: ${m}`;
    }).join('\n');
    p1.setComponents([...(p1.setComponents ? [] : []), section(boardButton('info', 'ℹ️'), lines)]);
  } else {
    p1.setComponents([...(p1.setComponents ? [] : []), section(boardButton('info', 'ℹ️'), '(no active team)')]);
  }
  pages.push([p1]);

  // ---- Page 2: Hoverboards ----
  const p2 = new ContainerBuilder().setColor(0x06b6d4).setComponents([
    section(boardButton('boards', '🛹'), `🛹 Hoverboards (${hoverboards.length})`),
  ]);
  if (hoverboards.length > 0) {
    const lines = hoverboards.map((h, i) => {
      const meta = skinByName.get((h.Name || '').toLowerCase());
      const spd = meta ? meta.Speed : '?';
      const em = emojis.emojiFor(h.Name || '');
      return `${i + 1}. ${em} **${h.Name}** — speed ${spd}`.trim();
    }).join('\n');
      p2.setComponents([section(boardButton('info', 'ℹ️'), lines)]);
  } else {
    p2.setComponents([
      section(boardButton('boards', '🛹'), `🛹 Hoverboards (${hoverboards.length})`),
      section(boardButton('info', 'ℹ️'), '(no hoverboards owned)'),
    ]);
  }
  pages.push([p2]);

  // ---- Pages 3+: PC (8 per page) ----
  if (pc.length > 0) {
    const pcSorted = [...pc].sort((a, b) => (b.IV ?? 0) - (a.IV ?? 0));
    const topIV = pcSorted[0];
    const pageSize = 8;
    const totalPages = Math.ceil(pcSorted.length / pageSize);
    for (let p = 0; p < totalPages; p++) {
      const slice = pcSorted.slice(p * pageSize, (p + 1) * pageSize);
      const header =
        `# 💻 PC — page ${p + 1}/${totalPages} (${pc.length} total)` +
        (topIV ? `\n**Highest IV:** ${emojis.emojiFor(topIV.Species || '')} ${topIV.Nickname || topIV.Species} at ${Math.round((topIV.IV ?? 0) * 100)}%` : '');
      const c = new ContainerBuilder().setColor(0x22c55e).setComponents([
        section(boardButton('pc', '💻'), header),
      ]);
      const desc = slice
        .map((e, i) => {
          const offset = p * pageSize;
          const moves = (e.Moveset || []).join(', ') || 'none';
          const em = emojis.emojiFor(e.Species || e.Nickname || '');
          return `${offset + i + 1}. ${em} **${e.Nickname || e.Species}** — Lvl ${e.Level ?? '?'} • IV ${Math.round((e.IV ?? 0) * 100)}%\nMoves: ${moves}${e.Box ? ` • Box ${e.Box}` : ''}`;
        })
        .join('\n\n');
      c.setComponents([
        section(boardButton('pc', '💻'), header),
        section(boardButton('info', 'ℹ️'), desc),
      ]);
      pages.push([c]);
    }
  }

  // ---- Last page: Bag ----
  const pBag = new ContainerBuilder().setColor(0xf59e0b).setComponents([
    section(boardButton('bag', '🎒'), `🎒 Bag (${bagCount} types, ${totalItems} total)`),
  ]);
  if (bagEntries.length > 0) {
    const bagStr = bagEntries.map(([name, qty]) => `${qty.toString().padStart(4)} × ${name}`).join('\n');
      pBag.setComponents([
        section(boardButton('bag', '🎒'), `🎒 Bag (${bagCount} types, ${totalItems} total)`),
        section(boardButton('info', 'ℹ️'), '```\n' + bagStr + '\n```'),
      ]);
  } else {
      pBag.setComponents([
        section(boardButton('bag', '🎒'), `🎒 Bag (${bagCount} types, ${totalItems} total)`),
        section(boardButton('info', 'ℹ️'), '(empty bag)'),
      ]);
  }
  pages.push([pBag]);

  return pages;
}

// ---------- Tierlist ----------

function entryToTierlistEntry(e) {
  const species = e.Species || e.Nickname || '';
  const rot = rotBySpecies.get(species.toLowerCase());
  return {
    nickname: e.Nickname || species || 'Unknown',
    species,
    level: e.Level || 1,
    iv: e.IV || 0,
    icon_url: rot ? `${ICON_BASE}/${rot.Icon}` : null,
  };
}

function runTierlistScript(payload) {
  return new Promise((resolve) => {
    const args = [TIERLIST_SCRIPT];
    const env = { ...process.env, PYTHONUNBUFFERED: '1', TIERLIST_OUT_DIR };
    const child = execFile('python3', args, {
      env,
      maxBuffer: 10 * 1024 * 1024,
      timeout: 30000,
    }, (err, stdout, stderr) => {
      if (err) {
        resolve({ ok: false, error: `python error: ${err.message}`, stderr });
        return;
      }
      try {
        const result = JSON.parse(stdout.trim().split('\n').pop());
        resolve(result);
      } catch (e) {
        resolve({ ok: false, error: `parse error: ${e.message}`, stdout, stderr });
      }
    });
    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
  });
}

module.exports = {
  findRot,
  findItem,
  findSkin,
  rarityLabel,
  cleanUserInput,
  looksLikeUserId,
  resolveRobloxUser,
  fetchInventory,
  statKeyFor,
  sortRotsByStat,
  tradeValue,
  tradeVerdict,
  newGuessRound,
  dailyRot,
  brainrotSummary,
  buildInventoryPages,
  buildInventoryEmbeds,
  entryToTierlistEntry,
  runTierlistScript,
};

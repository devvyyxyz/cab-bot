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

const { TextDisplayBuilder, MediaGalleryBuilder, MediaGalleryItemBuilder, SeparatorBuilder, ContainerBuilder, SectionBuilder, ButtonBuilder, ButtonStyle, SeparatorSpacingSize } = require('discord.js');
const { execFile } = require('child_process');
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

  const url = 'https://users.roblox.com/v2/users/username/by-username';
  const robloxApiKey = process.env.ROBLOX_API_KEY;
  try {
    const headers = {
      'User-Agent': 'BrainrotBot/1.0 (Discord bot)',
      'Content-Type': 'application/json',
    };
    if (robloxApiKey) {
      headers['x-api-key'] = robloxApiKey;
    }
    const res = await fetch(url, {
      method: 'POST',
      headers,
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
    const userId = String(found.userId);
    robloxUserCache.set(input.toLowerCase(), { userId, expiresAt: Date.now() + 86400000 });
    return { userId };
  } catch (err) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      return { error: 'Roblox API timed out — try again in a moment, fr.' };
    }
    return { error: `network error: ${err.message}` };
  }
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

// ---------- Inventory pages ----------

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
    let s = new SectionBuilder().setButtonAccessory(button);
    for (const c of contents) s = s.addTextDisplayComponents(text(c));
    return s;
  };
  const divider = () =>
    new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true);
  const boardButton = (label, emoji) =>
    new ButtonBuilder().setStyle(ButtonStyle.Success).setLabel(label).setEmoji({ name: emoji }).setCustomId(`inv:${label}`);

  const pages = [];

  // ---- Page 1: Overview + Team ----
  const p1 = new ContainerBuilder()
    .setAccentColor(0x8b5cf6)
    .addSectionComponents(
      section(
        boardButton('Summary', '🎒'),
        `🎒 Inventory — ${userId}`,
      ),
    )
    .addTextDisplayComponents(text(
      `**${team.length}/6** team • **${pc.length}** in PC • **${hoverboards.length}** hoverboards • ${bagCount} item types (**${totalItems}** total)`,
    ))
    .addSeparatorComponents(divider())
    .addTextDisplayComponents(text(`⚔️ Active Team (${team.length}/6)`));
  if (team.length > 0) {
    const lines = team.slice(0, 6).map((t, i) => {
      const m = (t.Moveset || []).join(', ') || 'none';
      return `${i + 1}. ${brainrotSummary(t)}\nMoves: ${m}`;
    }).join('\n');
    p1.addTextDisplayComponents(text(lines));
  } else {
    p1.addTextDisplayComponents(text('(no active team)'));
  }
  pages.push([p1]);

  // ---- Page 2: Hoverboards ----
  const p2 = new ContainerBuilder()
    .setAccentColor(0x06b6d4)
    .addSectionComponents(
      section(boardButton('boards', '🛹'), `🛹 Hoverboards (${hoverboards.length})`),
    );
  if (hoverboards.length > 0) {
    const lines = hoverboards.map((h, i) => {
      const meta = skinByName.get((h.Name || '').toLowerCase());
      const spd = meta ? meta.Speed : '?';
      const em = emojis.emojiFor(h.Name || '');
      return `${i + 1}. ${em} **${h.Name}** — speed ${spd}`.trim();
    }).join('\n');
    p2.addTextDisplayComponents(text(lines));
  } else {
    p2.addTextDisplayComponents(text('(no hoverboards owned)'));
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
      const c = new ContainerBuilder()
        .setAccentColor(0x22c55e)
        .addSectionComponents(section(boardButton('pc', '💻'), header));
      const desc = slice
        .map((e, i) => {
          const offset = p * pageSize;
          const moves = (e.Moveset || []).join(', ') || 'none';
          const em = emojis.emojiFor(e.Species || e.Nickname || '');
          return `${offset + i + 1}. ${em} **${e.Nickname || e.Species}** — Lvl ${e.Level ?? '?'} • IV ${Math.round((e.IV ?? 0) * 100)}%\nMoves: ${moves}${e.Box ? ` • Box ${e.Box}` : ''}`;
        })
        .join('\n\n');
      c.addTextDisplayComponents(text(desc));
      pages.push([c]);
    }
  }

  // ---- Last page: Bag ----
  const pBag = new ContainerBuilder()
    .setAccentColor(0xf59e0b)
    .addSectionComponents(section(boardButton('bag', '🎒'), `🎒 Bag (${bagCount} types, ${totalItems} total)`));
  if (bagEntries.length > 0) {
    const bagStr = bagEntries.map(([name, qty]) => `${qty.toString().padStart(4)} × ${name}`).join('\n');
    pBag.addTextDisplayComponents(text('```\n' + bagStr + '\n```'));
  } else {
    pBag.addTextDisplayComponents(text('(empty bag)'));
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

// src/slang.js
// Random flavor-comment generators. Tone: "mostly normal + brainrot slang sprinkled in".
// Each function returns a string the embed can drop under the brainrot's stats.

const OPENERS = [
  "Bro showed up uninvited, fr.",
  "Certified hood classic, ngl.",
  "Spotted this absolute unit in the wild.",
  "W rizz stats if you ask me.",
  "Caught one finally, took forever bro.",
  "This one's giving sigma grindset energy.",
  "Yeah this guy cooks, no cap.",
  "Unboxed him earlier, he's kinda goated.",
  "Don't sleep on this one, ong.",
  "Bro is built different tbh.",
  "Found him lurking in zone 1, classic.",
  "Pulled him and immediately regretted it lmao.",
  "He do be sliding though.",
  "Awfully skibidi of him to appear now.",
  "Bro has zero chill and I respect that.",
];

const EXCLUSIVE_OPENERS = [
  "Exclusive drop, bro is basically mythical fr.",
  "Good luck pulling this one, it's a whole grind.",
  "Yeah he's exclusive — bro earned his spot.",
  "Rare as heck. Touch grass before you find one.",
  "Sigma-tier exclusive right here, no cap.",
];

const HIGH_RARITY_OPENERS = [
  "Bro's rarity is off the charts, ggs.",
  "This one's a certified rarity tax dodge.",
  "If you got this legit, you're built different.",
  "Rarity so high it's giving mythical fr fr.",
];

const LOW_RARITY_OPENERS = [
  "He's common af but he tries his best fr.",
  "Spawns basically everywhere, bro is friendly.",
  "Starter-tier brainrot but we love him anyway.",
  "Everyone's got one of these, no shame.",
];

const SUFFIXES = [
  "fr fr",
  "ngl",
  "no cap",
  "tbh",
  "on god",
  "lowkey",
  "and that's on periodt",
  "🗿",
  "🍷",
  "respectfully",
];

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// Build a flavor comment for a brainrot entry.
// rot = { FullName, ShortenedName, Attack, Health, Speed, Rarity, IsExclusive, SpawnLocation }
function flavorFor(rot) {
  const parts = [];

  if (rot.IsExclusive) {
    parts.push(pick(EXCLUSIVE_OPENERS));
  } else if (rot.Rarity >= 4) {
    parts.push(pick(HIGH_RARITY_OPENERS));
  } else if (rot.Rarity <= 1.5) {
    parts.push(pick(LOW_RARITY_OPENERS));
  } else {
    parts.push(pick(OPENERS));
  }

  // 30% chance to add a stat-flavored quip
  if (Math.random() < 0.3) {
    if (rot.Attack >= 2) {
      parts.push(`Attack of ${rot.Attack.toFixed(2)} is genuinely goated.`);
    } else if (rot.Speed >= 2) {
      parts.push(`Speed ${rot.Speed.toFixed(2)}? Bro zoomin.`);
    } else if (rot.Health >= 1.5) {
      parts.push(`Health ${rot.Health.toFixed(2)}, bro tankier than my sleep schedule.`);
    }
  }

  // 25% chance to append a suffix
  if (Math.random() < 0.25) {
    parts.push(pick(SUFFIXES));
  }

  return parts.join(" ");
}

// Flavor for bag items.
function flavorForItem(item) {
  const lines = [
    `Pulled a **${item.Name}** from the bag.`,
    `Bag yielded a **${item.Name}**, kinda based.`,
    `Got a **${item.Name}**, fr fr that's a pull.`,
    `Cracked the bag open, found a **${item.Name}**.`,
    `One **${item.Name}** for the inventory, on god.`,
  ];
  return pick(lines);
}

// Flavor for skins.
function flavorForSkin(skin) {
  const lines = [
    `Equipped the **${skin.Name}** skin, speed ${skin.Speed}.`,
    `Rolled a **${skin.Name}** skin — ${skin.Speed} speed, kinda slick ngl.`,
    `Skin drop: **${skin.Name}**. ${skin.Speed} speed, bro flies.`,
    `Got the **${skin.Name}** look. Speed ${skin.Speed}, drip check passed.`,
  ];
  return pick(lines);
}

// Rarity → star string for display.
// Uses custom Discord emojis: <:star:...> for filled, <:Star_grey:...> for empty.
const STAR_FILLED = "<:star:1535073093784178768>";
const STAR_EMPTY = "<:Star_grey:1535073096329859174>";
function rarityStars(rarity) {
  // Typical range is ~1–5, clamp.
  const clamped = Math.max(0, Math.min(5, rarity));
  const filled = Math.round(clamped);
  return STAR_FILLED.repeat(filled) + STAR_EMPTY.repeat(5 - filled);
}

module.exports = {
  flavorFor,
  flavorForItem,
  flavorForSkin,
  rarityStars,
  pick,
};

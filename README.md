# 🗿 Brainrot Bot

A Discord bot like "cat bot", but for **Italian brainrot characters** — Brr Brrr Patapim, Ballerina Cappuccina, Bobrito Bandito, and 87 more. Built with Node.js + discord.js v14, slash commands only, no database.

Rot/bag/skin info comes from a baked JSON snapshot pulled from [`indieun.com/cab`](https://indieun.com/cab). Inventory lookups are fetched **live** at query time from `indieun.com/cab/inventory/<id>`.

---

## What it does

All info queries are condensed into a single `/info` command with a `type` choice:

| Command                       | What you get                                              |
| ----------------------------- | -------------------------------------------------------- |
| `/info type:rot`              | A random brainrot character — icon, stats, slang flavor  |
| `/info type:rot name:<x>`     | Look up a specific brainrot by name (autocomplete helps) |
| `/info type:hoverboard`       | A random hoverboard skin                                 |
| `/info type:hoverboard name:<x>` | A specific hoverboard skin (autocomplete helps)       |
| `/info type:item`             | A random item from the bag (boxes, eggs, currency…)      |
| `/info type:item name:<x>`    | A specific bag item (autocomplete helps)                 |
| `/info type:about`            | Bot info + command list                                  |
| `/inventory user:<id>`        | Live player inventory — team, hoverboards, PC, bag       |
| `/settings welcomemessage`  | Configure the server welcome message                     |

The bot speaks mostly-normal English with brainrot slang sprinkled in ("fr", "ngl", "sigma", "goated", etc.). Each response is randomized so repeats feel fresh.

### `/inventory` details

Takes a **Roblox user ID** (numeric, e.g. `1559610713`) or a **username** (e.g. `YourUsername`). The bot resolves usernames via the Roblox API. Usernames are — indieun.com/cab keys inventories by Roblox UID. The reply is a paginated Components V2 response with four sections:

- **Team (N/6)** — current active team with level, nickname, IV%, box, and moveset
- **Hoverboards (N)** — all owned hoverboards with their speed stat
- **PC (N)** — PC count, highest-IV highlight, and a 3-entry preview
- **Bag (N types, N total)** — every bag item with its quantity, sorted by count

If the user doesn't exist or has no brainrot progress, the bot replies with a clear error message.

---

## Setup (5 minutes)

### 1. Create the Discord application

1. Go to <https://discord.com/developers/applications> → **New Application**.
2. Open the **Bot** tab → click **Reset Token** → copy the token.
3. Open **General Information** → copy the **Application ID**.
4. Open **OAuth2 → URL Generator**:
   - Scopes: `bot`, `applications.commands`
   - Bot Permissions: `Send Messages`, `Embed Links` (text permission integer `274877991936` works too, but minimal is better — just `Send Messages` + `Embed Links` = `2048 + 8192`? Actually just tick them in the UI)
   - Copy the generated URL and open it to invite the bot to your server.

### 2. Install + configure

```bash
cd brainrot-bot
npm install
cp .env.example .env
# Edit .env and paste your DISCORD_TOKEN + DISCORD_CLIENT_ID
```

### 3. Register slash commands (one-time, or whenever you change commands)

```bash
npm run deploy
```

### 4. Start the bot

```bash
npm start
```

You should see:

```
✅ Brainrot Bot online — logged in as YourBot#1234
   Loaded 90 rots, 33 bag items, 6 skins.
```

Go to your server, try `/info type:rot` or `/inventory user:1559610713`, and enjoy.

---

## Project layout

```
brainrot-bot/
├── index.js                # Main bot — login, event handlers, command logic
├── deploy-commands.js      # One-shot script to register slash commands
├── package.json
├── .env.example            # Copy to .env and fill in your token + app ID
├── .eslintrc.json        # ESLint config
├── Dockerfile              # Container image for easy deployment
├── README.md               # This file
└── src/
    ├── commands.js         # Slash command definitions
    ├── emojis.js           # Application emoji loader + lookup
    ├── logger.js           # Structured logger (timestamped, level-tagged)
    ├── paginator.js        # Reusable paginator (embed + Components V2)
    ├── slang.js            # Brainrot-flavored comment generator
    ├── tierlist.py         # Python script for tier-list image generation
    └── data/
        ├── rots.json       # 90 brainrot characters (snapshot from indieun.com/cab/rots)
        ├── bag.json        # 33 bag items
        └── skins.json      # 6 hoverboard skins
```

---

## Updating the data

The brainrot roster on `indieun.com/cab` may grow over time. To refresh the snapshot:

```bash
curl -sL https://indieun.com/cab/rots  -o src/data/rots.json
curl -sL https://indieun.com/cab/bag   -o src/data/bag.json
curl -sL https://indieun.com/cab/skins -o src/data/skins.json
npm run check   # syntax sanity check
npm start
```

Icons are fetched live from `https://indieun.com/cab/icons/<N>.png` at embed time, so the bot always shows the correct artwork even if the snapshot is stale.

### Refreshing application emojis

If you upload new emoji packs to the Discord Developer Portal (Application → Emojis), the bot will automatically pick them up on next boot — no code changes needed. Emojis are matched to brainrots/items/skins by name (case-insensitive, spaces stripped), so an emoji named `BrrBrrrPatapim` matches the brainrot `Brr Brrr Patapim`. If an emoji is missing for a given entity, the bot gracefully falls back to text-only display.

---

## Architecture notes

### Emojis (`src/emojis.js`)
At boot, the bot fetches all application emojis via Discord's `applicationEmojis` endpoint and builds two maps:
- **name → emoji**: for looking up by entity name (`emojiFor("Brr Brrr Patapim")` → `<:BrrBrrrPatapim:ID>`)
- **iconFile → emoji**: for looking up by icon filename (`emojiForIconFile("61.png")`)

All emoji features gracefully degrade to empty strings if emojis aren't loaded, so the bot still works without them.

### Paginator (`src/paginator.js`)
A reusable `Paginator` class that supports both modes:
- **`mode: "embed"`** — each page is an `EmbedBuilder`, replies with `{ embeds, components }`
- **`mode: "components"`** — each page is an array of component builders, replies with `{ components, flags: IsComponentsV2 }`

Provides 5 nav buttons (⏮️ ◀️ N/M ▶️ ⏭️), enforces user-locked navigation, and auto-disables buttons after a timeout (default 120s). Used by `/inventory` (components mode) and `/top` (embed mode for counts > 10).

### Components V2 (`/inventory`)
The `/inventory` command uses Discord's new Components V2 system (`MessageFlags.IsComponentsV2`). Instead of a single embed with text fields, it builds a paginated response where each page is a stack of components:
- `TextDisplayBuilder` for markdown headings and lists
- `MediaGalleryBuilder` to show up to 10 brainrot icons in a grid
- `SeparatorBuilder` for visual dividers

The team page shows 6 brainrot icons in a row, the PC pages show 8 per page (2 rows of 4), and the bag page shows the top 10 items as icons plus a full count list in a code block.

---

## Command cooldowns

To prevent spam, some commands have a per-user cooldown:

| Command       | Cooldown |
| ------------- | -------- |
| `/guess`      | 5s       |
| `/inventory`  | 10s      |
| `/tierlist`   | 15s      |

All other commands are unrestricted.

## Logging

The bot uses a lightweight structured logger (`src/logger.js`) that outputs timestamped, level-tagged messages. Set `LOG_LEVEL=debug` in your `.env` for verbose output.

---

## Health check

Set the `PORT` (or `HEALTH_CHECK_PORT`) environment variable to enable a lightweight HTTP server that responds to `GET /health` with a JSON status. This is useful for hosting platforms like Railway, Render, or Fly.io that require a health check endpoint.

```json
{"status":"ok","bot":"Brainrot Bot","uptime":123.45}
```

## Server settings

The `/settings` command lets server admins configure bot behavior:

| Command | What it does |
| ------- | ------------ |
| `/settings welcomemessage` | View the current welcome message |
| `/settings welcomemessage message:<text>` | Set a custom welcome message |

When the bot joins a new server, it posts the welcome message in the system channel (or the first available text channel). The default message is:

> Hey! I'm Brainrot Bot — like cat bot, but for Italian brainrot characters. Try `/info type:rot` or `/help` to get started, fr. 🗿

Welcome messages are stored in-memory and reset on restart.

---

## Hosting

The bot is a plain Node process — host it anywhere:

- **Your own machine / VPS**: `npm start` (or use `pm2 start index.js --name brainrot-bot` for auto-restart)
- **Railway / Render / Fly.io**: point at the repo, set `DISCORD_TOKEN` + `DISCORD_CLIENT_ID` env vars, build command `npm install`, start command `npm start`
- **Replit**: works as-is, just add the secrets
- **Docker**: `docker build -t brainrot-bot . && docker run -d --restart unless-stopped --env-file .env brainrot-bot`

No port needs to be exposed — discord.js connects outbound to Discord's gateway.

---

## Customizing

- **Tone**: edit `src/slang.js` — add/remove lines from the `OPENERS`, `SUFFIXES`, etc. arrays.
- **Embed colors**: change the `.setColor(0xRRGGBB)` calls in `index.js`.
- **Add a /info subtype**: add a new choice to the `type` option in `src/commands.js`, then handle it in the `info` branch of `index.js`.
- **Add a brand-new command**: add a `SlashCommandBuilder` entry in `src/commands.js`, handle it in `index.js`, then re-run `npm run deploy`. The deploy script auto-deletes stale commands you no longer ship.
- **Inventory embed layout**: tweak the `buildInventoryPages` function in `index.js` — change which sections show, how many PC entries preview, sort order, etc.

Enjoy, stay sigma. 🗿🍷

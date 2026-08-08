# 🗿 Brainrot Bot

A Discord bot like "cat bot", but for **Italian brainrot characters** — Brr Brrr Patapim, Ballerina Cappuccina, Bobrito Bandito, and 87 more. Built with Node.js + discord.js v14, slash commands only, with a SQLite database for persistent settings and the catch game.

Rot/bag/skin info comes from a baked JSON snapshot pulled from [`indieun.com/cab`](https://indieun.com/cab). Inventory lookups are fetched **live** at query time from `indieun.com/cab/inventory/<id>`.

---

## What it does

All info queries are condensed into a single `/info` command with a `type` choice. The bot also supports a trading calculator, spawn-location lookup, tier-list generation, a guessing mini-game, and a server-wide catch game with a database-backed inventory.

| Command                       | What you get                                              |
| ----------------------------- | -------------------------------------------------------- |
| `/info type:rot [random]`     | Look up a specific brainrot or show a random one         |
| `/info type:hoverboard [random]` | Look up a specific hoverboard skin or show a random one |
| `/info type:item [random]`    | Look up a specific bag item or show a random one          |
| `/info type:about`            | Bot info + full command list                              |
| `/inventory user:<id>`        | Live player inventory — team, hoverboards, PC, bag       |
| `/trade calculate a:<rot> b:<rot>` | Trade fairness calculator with IV/level support     |
| `/spawn [world] [zone]`       | Brainrots that spawn at a location, or a random spawn    |
| `/top by:<stat> [count]`      | Top N brainrots by rarity/attack/health/speed            |
| `/daily`                      | Brainrot of the day (same for everyone, changes at UTC midnight) |
| `/guess`                      | Mini-game: identify a brainrot from its icon             |
| `/tierlist user:<id> [source]` | Generate a tier-list PNG image from a player's inventory |
| `/start`                      | Get a button to launch the Brainrot Bot activity         |
| `/settings <subcommand>`      | Configure welcome messages, spawn channel, avatar, etc. |
| `/help [command:<name>]`      | Show all commands or detailed help for a specific one    |

The bot speaks mostly-normal English with brainrot slang sprinkled in ("fr", "ngl", "sigma", "goated", etc.). Each response is randomized so repeats feel fresh.

### `/info`

Use `type` to pick a category (rot, hoverboard, item, or about), and optionally a `name` to look up a specific entry (autocomplete helps). Add `random:true` for an explicit random pick, or just omit the name.

### `/inventory`

Takes a **Roblox user ID** (numeric, e.g. `1559610713`) or a **username** (e.g. `YourUsername`). The bot resolves usernames via the Roblox API and fetches the player's live inventory. The reply is a paginated Components V2 response with four sections:

- **Team (N/6)** — current active team with level, nickname, IV%, moveset, and clickable icons
- **Hoverboards (N)** — all owned hoverboards with their speed stat
- **PC (N)** — paginated pages of 8 entries, sorted by IV%, with highest-IV highlight
- **Bag (N types, N total)** — top item icons + full count list in a code block

If the user doesn't exist or has no brainrot progress, the bot replies with a clear error message.

### `/trade calculate`

Compare two brainrots for trade fairness. Optionally specify `a_iv`, `a_level`, `b_iv`, `b_level` (IV 0–100, level 1–100). The bot computes a value score from rarity, IV, level, exclusivity, and base stats, then gives a verdict: ✅ fair / ⚠️ slightly one-sided / ❌ one-sided / 🚫 rip-off.

### `/spawn`

Show brainrots that spawn at a given world/zone (e.g. `/spawn world:2 zone:3`), or omit both arguments for a random spawn location. Note: 32 of 90 brainrots have no fixed spawn (mostly exclusives).

### `/top`

Show the top N brainrots by rarity, attack, health, or speed. Results are paginated (10 per page) when count exceeds 10.

### `/daily`

A deterministic brainrot of the day based on the UTC date — same for everyone in every server. Changes at 00:00 UTC.

### `/guess`

A mini-game: the bot posts a mystery brainrot icon and four name buttons. Click the right one to win! Buttons disable after a correct/incorrect answer, and a cooldown prevents spam.

### `/tierlist`

Generate a PNG tier-list image from a player's live inventory. Takes a user ID or username (resolved via Roblox API), and an optional `source` (team = active 6, or pc = PC). Brainrots are scored by IV% (60%) + Level (40%) and bucketed into S/A/B/C/D tiers. Requires Python 3 + Pillow on the host.

### Catch game (spawn system)

When a guild has a spawn channel configured via `/settings spawnchannel`, a random brainrot spawns there every minute. Users type the rot's **name** (or shortened name) to catch it before it disappears. Caught brainrots are stored in the SQLite database per-user, per-guild. Use `/settings reset` to clear your personal catches.

---

## Setup (5 minutes)

### 1. Create the Discord application

1. Go to <https://discord.com/developers/applications> → **New Application**.
2. Open the **Bot** tab → click **Reset Token** → copy the token.
3. Open **General Information** → copy the **Application ID**.
4. Under **Bot → Privileged Gateway Intents**, toggle on **Message Content Intent** (required for the spawn catch game).
5. Open **OAuth2 → URL Generator**:
   - Scopes: `bot`, `applications.commands`
   - Bot Permissions: `Send Messages`, `Embed Links`, `Manage Messages` (for spawn catch + deletion), `Change Nickname`, `Manage Webhooks` (for avatar), `View Channel`, `Read Message History`
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

> **Prefer Docker?** Skip steps 2–4 above and jump to the [Docker section](#docker) for a one-command deploy with persistent data.

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

## Docker

### Quick Start (Docker Compose)

1. Copy `.env.example` to `.env` and fill in your bot token + client ID.
2. Run `docker compose up -d --build` to build and start the bot.
3. Check logs with `docker compose logs -f`.

The bot's SQLite database (`/app/data/brainrot.db`) and tier-list images (`/app/tierlists`) are stored in named Docker volumes, so your data persists across container restarts and updates.

### Environment Variables

| Variable | Required | Description |
| -------- | -------- | ----------- |
| `DISCORD_TOKEN` | ✅ | Your bot's Discord token |
| `DISCORD_CLIENT_ID` | ✅ | Your application's client ID |
| `PORT` | ❌ | Port for the HTTP health-check endpoint (default: none) |
| `HEALTH_CHECK_PORT` | ❌ | Alternative to `PORT` |
| `LOG_LEVEL` | ❌ | Log verbosity: `info` (default), `debug`, `warn`, `error` |
| `DB_PATH` | ❌ | Override the SQLite database file path (default: `/app/data/brainrot.db`) |

### Manual Docker Build

If you prefer not to use Compose:

```bash
docker build -t brainrot-bot .
docker run -d \
  --name brainrot-bot \
  --restart unless-stopped \
  -p 3000:3000 \
  --env-file .env \
  -v brainrot_data:/app/data \
  -v brainrot_tierlists:/app/tierlists \
  brainrot-bot
```

## Server settings

The `/settings` command lets server admins configure bot behavior:

| Command | What it does |
| ------- | ------------ |
| `/settings welcomemessage` | View the current welcome message |
| `/settings welcomemessage message:<text>` | Set a custom welcome message |
| `/settings spawnchannel` | View the catch-game spawn channel |
| `/settings spawnchannel channel:<channel>` | Set the channel where brainrots spawn every minute |
| `/settings message` | View the current spawn announcement message |
| `/settings message message:<text>` | Set the message shown when a brainrot spawns |
| `/settings avatar` | View the current bot avatar URL |
| `/settings avatar image:<url>` | Upload a new avatar for the bot |
| `/settings username` | View the current bot username |
| `/settings username name:<name>` | Rename the bot |
| `/settings reset` | Clear your personal catch inventory for this server |
| `/settings nuke` | ⚠️ Wipe ALL bot data (spawns, inventory, settings) for this server |

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

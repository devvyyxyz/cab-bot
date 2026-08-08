// src/commands.js
// Slash command definitions for discord.js v14 REST registration.

const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");

const commands = [
  // ---------------------------------------------------------------- /info
  new SlashCommandBuilder()
    .setName("info")
    .setDescription("Look up brainrot info — rot, hoverboard, item, or about.")
    .addStringOption((opt) =>
      opt
        .setName("type")
        .setDescription("What kind of info?")
        .setRequired(true)
        .addChoices(
          { name: "rot", value: "rot" },
          { name: "hoverboard", value: "hoverboard" },
          { name: "item", value: "item" },
          { name: "spawnlocation", value: "spawnlocation" },
          { name: "inventory", value: "inventory" },
          { name: "about", value: "about" }
        )
    )
    .addStringOption((opt) =>
      opt
        .setName("user")
        .setDescription('Roblox user ID (e.g. "1559610713") or username. Used with type:inventory.')
        .setRequired(false)
    )
    .addStringOption((opt) =>
      opt
        .setName("name")
        .setDescription("Specific entry to look up (autocomplete).")
        .setRequired(false)
        .setAutocomplete(true)
    )
    .addBooleanOption((opt) =>
      opt
        .setName("random")
        .setDescription("Return a random entry instead of looking up a specific name.")
        .setRequired(false)
    )
    .addIntegerOption((opt) =>
      opt
        .setName("world")
        .setDescription("World number (1 or 2). Used with type:spawnlocation for a specific location.")
        .setRequired(false)
        .setMinValue(1)
        .setMaxValue(2)
    )
    .addIntegerOption((opt) =>
      opt
        .setName("zone")
        .setDescription("Zone number (1-3). Used with type:spawnlocation for a specific location.")
        .setRequired(false)
        .setMinValue(1)
        .setMaxValue(3)
    ),

  // ---------------------------------------------------------------- /settings
  new SlashCommandBuilder()
    .setName("settings")
    .setDescription("Configure bot settings for this server.")
    .addSubcommand((sub) =>
      sub
        .setName("welcomemessage")
        .setDescription("Set or view the welcome message shown when the bot joins a server.")
        .addStringOption((opt) =>
          opt
            .setName("message")
            .setDescription("The welcome message to set. Omit to view the current message.")
            .setRequired(false)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("spawnchannel")
        .setDescription("Set or view the channel where brainrots spawn for the catch game.")
        .addChannelOption((opt) =>
          opt
            .setName("channel")
            .setDescription("The text channel for spawns. Omit to view the current channel.")
            .setRequired(false)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("message")
        .setDescription("Set or view the message shown when a brainrot spawns.")
        .addStringOption((opt) =>
          opt
            .setName("message")
            .setDescription("The spawn message to set. Omit to view the current message.")
            .setRequired(false)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("avatar")
        .setDescription("Set or view the bot's avatar for this server.")
        .addStringOption((opt) =>
          opt
            .setName("image")
            .setDescription("An image URL or attachment to use as the bot's avatar. Omit to view the current avatar.")
            .setRequired(false)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("username")
        .setDescription("Set or view the bot's username for this server.")
        .addStringOption((opt) =>
          opt
            .setName("name")
            .setDescription("The username to set. Omit to view the current username.")
            .setRequired(false)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("reset")
        .setDescription("Reset your personal catch stats and inventory for this server.")
    )
    .addSubcommand((sub) =>
      sub
        .setName("nuke")
        .setDescription("⚠️ Wipe ALL bot data for this server (spawns, inventory, settings).")
    ),


  // Note: Inventory is now available via `/info type:inventory user:<id|username>`

  // ---------------------------------------------------------------- /ping
  new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Check bot latency and API ping."),

  // ---------------------------------------------------------------- /help
  new SlashCommandBuilder()
    .setName("help")
    .setDescription("Show bot help, optionally for a specific command.")
    .addStringOption((opt) =>
      opt
        .setName("command")
        .setDescription("Which command to get detailed help for?")
        .setRequired(false)
        .addChoices(
          { name: "info", value: "info" },
          { name: "inventory", value: "inventory" },
          { name: "trade", value: "trade" },
          { name: "start", value: "start" },
          { name: "help", value: "help" },
          { name: "spawnlocation", value: "spawnlocation" },
          { name: "top", value: "top" },
          { name: "daily", value: "daily" },
          { name: "guess", value: "guess" },
          { name: "tierlist", value: "tierlist" },
          { name: "settings", value: "settings" },
          { name: "forcespawn", value: "forcespawn" }
        )
    ),

  // ---------------------------------------------------------------- /trade
  new SlashCommandBuilder()
    .setName("trade")
    .setDescription("Trade tools for brainrots.")
    .addSubcommand((sub) =>
      sub
        .setName("calculate")
        .setDescription("Calculate whether a trade between two brainrots is fair.")
        .addStringOption((opt) =>
          opt.setName("a").setDescription("Brainrot on side A").setRequired(true).setAutocomplete(true)
        )
        .addStringOption((opt) =>
          opt.setName("b").setDescription("Brainrot on side B").setRequired(true).setAutocomplete(true)
        )
        .addIntegerOption((opt) =>
          opt.setName("a_iv").setDescription("Side A IV% (0-100). Default 50.").setRequired(false).setMinValue(0).setMaxValue(100)
        )
        .addIntegerOption((opt) =>
          opt.setName("a_level").setDescription("Side A Level (1-100). Default 10.").setRequired(false).setMinValue(1).setMaxValue(100)
        )
        .addIntegerOption((opt) =>
          opt.setName("b_iv").setDescription("Side B IV% (0-100). Default 50.").setRequired(false).setMinValue(0).setMaxValue(100)
        )
        .addIntegerOption((opt) =>
          opt.setName("b_level").setDescription("Side B Level (1-100). Default 10.").setRequired(false).setMinValue(1).setMaxValue(100)
        )
    ),

  // ---------------------------------------------------------------- /start
  new SlashCommandBuilder()
    .setName("start")
    .setDescription("Launch the Brainrot Bot activity."),

  // ---------------------------------------------------------------- /top
  new SlashCommandBuilder()
    .setName("top")
    .setDescription("Show the top N brainrots by a chosen stat.")
    .addStringOption((opt) =>
      opt
        .setName("by")
        .setDescription("Sort by which stat?")
        .setRequired(true)
        .addChoices(
          { name: "rarity", value: "rarity" },
          { name: "attack", value: "attack" },
          { name: "health", value: "health" },
          { name: "speed", value: "speed" }
        )
    )
    .addIntegerOption((opt) =>
      opt
        .setName("count")
        .setDescription("How many to show? Default 10, max 25.")
        .setRequired(false)
        .setMinValue(1)
        .setMaxValue(25)
    ),

  // ---------------------------------------------------------------- /daily
  new SlashCommandBuilder()
    .setName("daily")
    .setDescription("Brainrot of the day — same for everyone, changes at 00:00 UTC."),

  // ---------------------------------------------------------------- /guess
  new SlashCommandBuilder()
    .setName("guess")
    .setDescription("Mini-game: identify a brainrot from its icon. Pick from 4 choices."),

  // ---------------------------------------------------------------- /tierlist
  new SlashCommandBuilder()
    .setName("tierlist")
    .setDescription("Generate a tier-list image from a player's live inventory (by UID or username).")
    .addStringOption((opt) =>
      opt
        .setName("user")
        .setDescription('Roblox user ID (e.g. "1559610713") or username.')
        .setRequired(true)
    )
    .addStringOption((opt) =>
      opt
        .setName("source")
        .setDescription("Which inventory section to tier? Default: team.")
        .setRequired(false)
        .addChoices(
          { name: "team", value: "team" },
          { name: "pc", value: "pc" }
        )
    ),

  // ---------------------------------------------------------------- /forcespawn
  new SlashCommandBuilder()
    .setName("forcespawn")
    .setDescription("Force a brainrot to spawn now in this server (Manage Channels required).")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
].map((cmd) => cmd.toJSON());

module.exports = commands;

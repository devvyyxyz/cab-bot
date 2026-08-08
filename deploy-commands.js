// deploy-commands.js
// Registers the bot's slash commands with Discord (globally).
// Run once (or whenever you change command definitions):
//   node deploy-commands.js
//
// Behavior:
//   1. Fetch all existing global commands on the app.
//   2. DELETE any command whose name is NOT in our current `commands` array
//      AND that is a regular slash command (type 1). This cleans up commands
//      we previously owned but no longer ship (e.g. /rot, /bag, /skin, /about
//      after we consolidated into /info).
//   3. For non-type-1 commands we don't recognize (e.g. the auto-generated
//      `launch` Activity entry-point command, type 4), preserve them in the
//      bulk PUT — Discord forbids removing those via bulk update.
//   4. PUT our commands + preserved system commands.

require("dotenv").config({ path: ".env" });
const env = process.env.NODE_ENV || "development";
require("dotenv").config({ path: `.env.${env}`, override: true });
const { REST, Routes } = require("discord.js");
const commands = require("./src/commands");

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;

if (!token || !clientId) {
  console.error(
    "❌ Missing DISCORD_TOKEN or DISCORD_CLIENT_ID.\n" +
      "Copy .env.example → .env, paste your bot token, and put the bot's application ID (from the Discord Developer Portal)."
  );
  process.exit(1);
}

const rest = new REST({ version: "10" }).setToken(token);

(async () => {
  try {
    const ourNames = new Set(commands.map((c) => c.name));
    const existing = await rest.get(Routes.applicationCommands(clientId));
    console.log(`   Found ${existing.length} existing command(s) on the app.`);

    const preserved = [];
    const toDelete = [];

    for (const cmd of existing) {
      if (ourNames.has(cmd.name)) {
        // We own this name — its old definition will be replaced by ours in the PUT.
        continue;
      }
      if (cmd.type === 1) {
        // Stale slash command we used to own but no longer ship — delete it.
        toDelete.push(cmd);
      } else {
        // System-managed (Entry Point / Activity launch etc.). Preserve verbatim,
        // stripping immutable fields Discord rejects on PUT.
        const { id: _id, version: _version, ...restCmd } = cmd;
        preserved.push(restCmd);
        console.log(
          `   ℹ️  Preserving system-managed command "${cmd.name}" (type ${cmd.type}).`
        );
      }
    }

    // Delete stale slash commands one-by-one (bulk PUT can't drop arbitrary ones
    // cleanly when system-managed commands must be preserved).
    for (const cmd of toDelete) {
      try {
        await rest.delete(Routes.applicationCommand(clientId, cmd.id));
        console.log(`   🗑️  Deleted stale command "/${cmd.name}" (id ${cmd.id}).`);
      } catch (err) {
        console.error(`   ⚠️  Could not delete "/${cmd.name}" (id ${cmd.id}): ${err.message}`);
      }
    }

    const body = [...commands, ...preserved];
    console.log(
      `⏳ Registering ${commands.length} slash command(s) globally` +
        (preserved.length ? ` + preserving ${preserved.length} system command(s)` : "") +
        "…"
    );
    const data = await rest.put(Routes.applicationCommands(clientId), {
      body,
    });
    console.log(
      `✅ Total commands on app now: ${data.length}. ` +
        "(New global slash commands may take up to 1h to appear in all guilds.)"
    );
    console.log("   Our commands:", commands.map((c) => `/${c.name}`).join(", "));
  } catch (err) {
    console.error("❌ Failed to register commands:", err);
    process.exit(1);
  }
})();

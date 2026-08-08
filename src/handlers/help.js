// src/handlers/help.js

const { buildHelpOverviewEmbed, buildHelpDetailEmbed } = require('../embeds');

async function handleHelp(interaction, ctx) {
  const cmd = interaction.options.getString('command');
  if (cmd) {
    const embed = buildHelpDetailEmbed(cmd);
    if (!embed) {
      await interaction.reply({ content: `No detailed help for \`${cmd}\`, fr. Try \`/help\` for the full list.`, flags: MessageFlags.Ephemeral });
      return;
    }
    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    return;
  }
  await interaction.reply({ embeds: [buildHelpOverviewEmbed()], flags: MessageFlags.Ephemeral });
}

module.exports = handleHelp;

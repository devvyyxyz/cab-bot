// src/handlers/battle.js

const { AttachmentBuilder } = require('discord.js');

async function handleBattle(interaction) {
  const path = require('path');
  const filePath = path.join(__dirname, '..', '..', 'public', 'battle', 'World1Zone1.jpeg');
  const attachment = new AttachmentBuilder(filePath, { name: 'battle.png' });
  await interaction.reply({ files: [attachment] });
}

module.exports = handleBattle;

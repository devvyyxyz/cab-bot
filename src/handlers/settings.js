// src/handlers/settings.js

const { MessageFlags, WebhookClient } = require('discord.js');

async function handleSettings(interaction, ctx) {
  const sub = interaction.options.getSubcommand();
  const guildId = interaction.guildId;

  if (sub === 'welcomemessage') {
    const msg = interaction.options.getString('message');
    if (msg) {
      ctx.db.setGuildSetting(guildId, 'welcome_message', msg);
      ctx.welcomeMessages.set(guildId, msg);
      await interaction.reply({ content: '✅ Server welcome message saved, fr.', flags: MessageFlags.Ephemeral });
      return;
    }
    const current = ctx.db.getGuildSetting(guildId, 'welcome_message') || '(default welcome message)';
    await interaction.reply({
      content: `Current welcome message for this server:\n> ${current}\n\nTo change it, use \`/settings welcomemessage message:<your message>\`.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (sub === 'spawnchannel') {
    const channel = interaction.options.getChannel('channel');
    if (channel) {
      ctx.db.setGuildSetting(guildId, 'spawn_channel', channel.id);
      await interaction.reply({ content: `✅ Spawn channel set to ${channel}, fr.`, flags: MessageFlags.Ephemeral });
      return;
    }
    const current = ctx.db.getGuildSetting(guildId, 'spawn_channel');
    if (current) {
      await interaction.reply({
        content: `Current spawn channel for this server: <#${current}>\n\nTo change it, use \`/settings spawnchannel channel:<channel>\`.`,
        flags: MessageFlags.Ephemeral,
      });
    } else {
      await interaction.reply({ content: 'No spawn channel set for this server. Use `/settings spawnchannel channel:<channel>` to set one.', flags: MessageFlags.Ephemeral });
    }
    return;
  }

  if (sub === 'message') {
    const msg = interaction.options.getString('message');
    if (msg) {
      ctx.db.setGuildSetting(guildId, 'spawn_message', msg);
      await interaction.reply({ content: '✅ Spawn message saved for this server, fr.', flags: MessageFlags.Ephemeral });
      return;
    }
    const current = ctx.db.getGuildSetting(guildId, 'spawn_message') || '(default spawn message)';
    await interaction.reply({
      content: `Current spawn message for this server:\n> ${current}\n\nTo change it, use \`/settings message message:<your message>\`.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (sub === 'avatar') {
    const image = interaction.options.getString('image');
    if (image) {
      let avatarUrl = image;
      if (image.startsWith('attachment://')) {
        const attachments = interaction.options.getAttachments('image');
        if (attachments && attachments.length > 0) {
          avatarUrl = attachments[0].url;
        }
      }
      try {
        ctx.db.setGuildSetting(guildId, 'avatar', avatarUrl);
        const guild = interaction.guild;
        if (guild) {
          await ctx.ensureGuildAvatarWebhook(guild, avatarUrl);
        }
        await interaction.reply({ content: '✅ Bot avatar saved for this server, fr.', flags: MessageFlags.Ephemeral });
      } catch (err) {
        await interaction.reply({ content: `❌ Couldn't save avatar: ${err.message}. Make sure the URL is a valid image.`, flags: MessageFlags.Ephemeral });
      }
      return;
    }
    const current = ctx.db.getGuildSetting(guildId, 'avatar');
    if (current) {
      await interaction.reply({
        content: `Current server avatar URL:\n> ${current}\n\nTo change it, use \`/settings avatar image:<url>\`.`,
        flags: MessageFlags.Ephemeral,
      });
    } else {
      await interaction.reply({ content: 'No custom avatar set for this server. Use `/settings avatar image:<url>` to set one.', flags: MessageFlags.Ephemeral });
    }
    return;
  }

  if (sub === 'username') {
    const name = interaction.options.getString('name');
    const guild = interaction.guild;
    if (name) {
      try {
        if (guild) {
          await guild.members.me.setNickname(name);
        }
        ctx.db.setGuildSetting(guildId, 'username', name);
        await interaction.reply({ content: `✅ Bot nickname set to \`${name}\` for this server, fr.`, flags: MessageFlags.Ephemeral });
      } catch (err) {
        await interaction.reply({ content: `❌ Couldn't set nickname: ${err.message}. Make sure I have the Manage Nicknames permission.`, flags: MessageFlags.Ephemeral });
      }
      return;
    }
    let current = ctx.db.getGuildSetting(guildId, 'username');
    if (!current && guild) {
      current = guild.members.me.nickname || ctx.client.user.username;
    } else if (!current) {
      current = ctx.client.user.username;
    }
    await interaction.reply({
      content: `Current bot nickname for this server: \`${current}\`\n\nTo change it, use \`/settings username name:<name>\`.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (sub === 'reset') {
    const userId = interaction.user.id;
    ctx.db.clearUserInventory(guildId, userId);
    await interaction.reply({ content: '✅ Your catch inventory has been reset for this server, fr. All caught brainrots are gone.', flags: MessageFlags.Ephemeral });
    return;
  }

  if (sub === 'nuke') {
    ctx.db.nukeGuild(guildId);
    ctx.welcomeMessages.delete(guildId);
    ctx.activeSpawns.delete(guildId);
    await interaction.reply({ content: '💥 **NUKED.** All bot data for this server has been wiped — spawns, inventory, settings, everything. The bot will need to be reconfigured with `/settings` commands.' });
    return;
  }

  await interaction.reply({ content: 'Unknown settings subcommand.', flags: MessageFlags.Ephemeral });
}

module.exports = handleSettings;

const { Events } = require('discord.js');
const config = require('../config');
const { getGuideMessageId, REACTION_EMOJI } = require('../handlers/verification');
const logger = require('../handlers/logger');

module.exports = {
  name: Events.MessageReactionAdd,
  async execute(reaction, user) {
    if (user.bot) return;

    // Handle partials (uncached messages)
    if (reaction.partial) {
      try { await reaction.fetch(); } catch { return; }
    }

    // Only care about the guide message
    const guideId = getGuideMessageId();
    if (!guideId || reaction.message.id !== guideId) return;
    if (reaction.emoji.name !== REACTION_EMOJI) return;

    const guild = reaction.message.guild;
    if (!guild) return;

    const role = guild.roles.cache.find(r => r.name === config.VERIFIED_ROLE_NAME);
    if (!role) {
      console.warn(`Role "${config.VERIFIED_ROLE_NAME}" not found.`);
      return;
    }

    try {
      const member = await guild.members.fetch(user.id);
      await member.roles.add(role);
      await logger.log('verify', 'User Verified', `<@${user.id}> verified`);
    } catch (err) {
      console.error('Failed to add Verified role:', err.message);
    }
  },
};

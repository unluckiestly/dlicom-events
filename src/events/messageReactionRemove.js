const { Events } = require('discord.js');
const config = require('../config');
const { getGuideMessageId, REACTION_EMOJI } = require('../handlers/verification');

module.exports = {
  name: Events.MessageReactionRemove,
  async execute(reaction, user) {
    if (user.bot) return;

    if (reaction.partial) {
      try { await reaction.fetch(); } catch { return; }
    }

    const guideId = getGuideMessageId();
    if (!guideId || reaction.message.id !== guideId) return;
    if (reaction.emoji.name !== REACTION_EMOJI) return;

    const guild = reaction.message.guild;
    if (!guild) return;

    const role = guild.roles.cache.find(r => r.name === config.VERIFIED_ROLE_NAME);
    if (!role) return;

    try {
      const member = await guild.members.fetch(user.id);
      await member.roles.remove(role);
    } catch (err) {
      console.error('Failed to remove Verified role:', err.message);
    }
  },
};

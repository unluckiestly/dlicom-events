const { Events, MessageType } = require('discord.js');

module.exports = {
  name: Events.MessageCreate,
  async execute(message) {
    if (message.type === MessageType.ChannelPinnedMessage) {
      await message.delete().catch(() => {});
    }
  },
};

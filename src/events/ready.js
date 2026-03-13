const { Events } = require('discord.js');
const { refreshTournamentsEmbed } = require('../handlers/tournaments');
const { postHostPanel } = require('../handlers/hostPanel');
const { postGuideEmbed } = require('../handlers/verification');
const logger = require('../handlers/logger');

module.exports = {
  name: Events.ClientReady,
  once: true,
  async execute(client) {
    console.log(`Logged in as ${client.user.tag}`);
    await logger.init(client);
    await postGuideEmbed(client);
    await postHostPanel(client);
    await refreshTournamentsEmbed(client);
  },
};

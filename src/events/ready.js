const { Events } = require('discord.js');
const { refreshTournamentsEmbed } = require('../handlers/tournaments');
const { postHostPanel } = require('../handlers/hostPanel');

module.exports = {
  name: Events.ClientReady,
  once: true,
  async execute(client) {
    console.log(`Logged in as ${client.user.tag}`);
    await postHostPanel(client);
    await refreshTournamentsEmbed(client);
  },
};

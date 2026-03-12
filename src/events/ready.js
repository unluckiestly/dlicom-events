const { Events } = require('discord.js');
const db = require('../db');
const { refreshTournamentsEmbed } = require('../handlers/tournaments');

module.exports = {
  name: Events.ClientReady,
  once: true,
  async execute(client) {
    console.log(`Logged in as ${client.user.tag}`);

    // Refresh the persistent tournaments embed on startup
    await refreshTournamentsEmbed(client);
  },
};

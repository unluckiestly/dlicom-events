const { EmbedBuilder } = require('discord.js');
const config = require('../config');

// Color coding by event type
const COLORS = {
  tournament: 0x5865f2, // blurple
  team:       0x3498db, // blue
  player:     0x57f287, // green
  moderation: 0xed4245, // red
  verify:     0xfee75c, // yellow
};

let logsChannel = null;

async function init(client) {
  logsChannel = await client.channels.fetch(config.LOGS_CHANNEL_ID).catch(() => null);
  if (!logsChannel) {
    console.warn('Logs channel not found — logging disabled.');
  }
}

async function log(type, title, description) {
  if (!logsChannel) return;

  const embed = new EmbedBuilder()
    .setTitle(title)
    .setDescription(description)
    .setColor(COLORS[type] || 0x99aab5)
    .setTimestamp();

  await logsChannel.send({ embeds: [embed] }).catch(() => {});
}

module.exports = { init, log };

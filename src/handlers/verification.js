const { EmbedBuilder } = require('discord.js');
const db = require('../db');
const config = require('../config');

const REACTION_EMOJI = '✅';

async function postGuideEmbed(client) {
  const channel = await client.channels.fetch(config.HOW_IT_WORKS_CHANNEL_ID).catch(() => null);
  if (!channel) {
    console.warn('How-it-works channel not found — skipping guide embed.');
    return;
  }

  const embed = new EmbedBuilder()
    .setTitle('How It Works')
    .setDescription(
      '**How to participate in tournaments:**\n\n' +
      '1. React with ✅ below to get verified\n' +
      '2. Go to the tournaments channel\n' +
      '3. For team tournaments — click **Create Team**, invite players, then **Join Tournament**\n' +
      '4. For solo tournaments — click **Join Tournament** directly\n' +
      '5. Use **My Status** to track your progress\n\n' +
      '✅ **React below to verify and gain access to the server.**',
    )
    .setColor(0x57f287);

  const payload = { embeds: [embed] };

  // Edit existing or post new
  const stateRow = db.getState.get('guide_message_id');
  if (stateRow) {
    try {
      const msg = await channel.messages.fetch(stateRow.value);
      await msg.edit(payload);
      // Make sure reaction exists
      const existing = msg.reactions.cache.get(REACTION_EMOJI);
      if (!existing || !existing.me) {
        await msg.react(REACTION_EMOJI);
      }
      return;
    } catch { /* deleted — fall through */ }
  }

  const msg = await channel.send(payload);
  await msg.react(REACTION_EMOJI);
  db.setState.run('guide_message_id', msg.id);
}

function getGuideMessageId() {
  const row = db.getState.get('guide_message_id');
  return row ? row.value : null;
}

module.exports = { postGuideEmbed, getGuideMessageId, REACTION_EMOJI };

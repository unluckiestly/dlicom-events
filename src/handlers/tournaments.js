const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const db = require('../db');
const config = require('../config');

/**
 * Fetches all open/active tournaments, builds embeds + button rows,
 * and edits the persistent message in the tournaments channel.
 * Creates the message on first call and stores its id in bot_state.
 */
async function refreshTournamentsEmbed(client) {
  const channel = await client.channels.fetch(config.TOURNAMENTS_CHANNEL_ID).catch(() => null);
  if (!channel) return;

  const tournaments = db.getOpenActiveTournaments.all();

  const embeds = [];
  const rows = [];

  if (tournaments.length === 0) {
    embeds.push(
      new EmbedBuilder()
        .setTitle('Tournaments')
        .setDescription('No tournaments are currently open.')
        .setColor(0x5865f2)
        .setTimestamp(),
    );
  } else {
    for (const t of tournaments) {
      const typeBadge = t.type === 'solo' ? '🎮 Solo' : '👥 Team';
      const statusBadge = t.status === 'open' ? '🟢 Open' : '🟡 Active';
      const full = t.participant_count >= t.max_participants;

      embeds.push(
        new EmbedBuilder()
          .setTitle(`${t.name}`)
          .setDescription(
            `${typeBadge} · ${t.format} · ${statusBadge}\n` +
            `Participants: **${t.participant_count}/${t.max_participants}**\n` +
            (t.end_date ? `Ends: ${t.end_date}` : ''),
          )
          .setColor(t.status === 'open' ? 0x57f287 : 0xfee75c)
          .setFooter({ text: `ID: ${t.id}` }),
      );

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`join:${t.id}`)
          .setLabel('Join')
          .setStyle(ButtonStyle.Success)
          .setDisabled(full || t.status !== 'open'),
        new ButtonBuilder()
          .setCustomId(`bracket:${t.id}`)
          .setLabel('View Bracket')
          .setStyle(ButtonStyle.Primary)
          .setDisabled(t.status === 'open'),
        new ButtonBuilder()
          .setCustomId(`status:${t.id}`)
          .setLabel('My Status')
          .setStyle(ButtonStyle.Secondary),
      );
      rows.push(row);
    }
  }

  // Cap at 10 embeds / 5 action rows per message (Discord limits)
  const payload = {
    content: '',
    embeds: embeds.slice(0, 10),
    components: rows.slice(0, 5),
  };

  // Try to edit the cached persistent message
  const stateRow = db.getState.get('tournaments_message_id');
  if (stateRow) {
    try {
      const msg = await channel.messages.fetch(stateRow.value);
      await msg.edit(payload);
      return;
    } catch {
      // Message was deleted — fall through and post a new one
    }
  }

  // Post a new message and cache its id
  const msg = await channel.send(payload);
  db.setState.run('tournaments_message_id', msg.id);
  try { await msg.pin(); } catch { /* already pinned or no perms */ }
}

module.exports = { refreshTournamentsEmbed };

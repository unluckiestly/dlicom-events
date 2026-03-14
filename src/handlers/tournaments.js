const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
} = require('discord.js');
const db = require('../db');
const config = require('../config');


/**
 * Persistent embed in #tournaments.
 * Shows all open/active tournaments + generic action buttons + team buttons.
 */
async function refreshTournamentsEmbed(client) {
  const channel = await client.channels.fetch(config.TOURNAMENTS_CHANNEL_ID).catch(() => null);
  if (!channel) return;

  const tournaments = db.getOpenActiveTournaments.all();

  const embeds = [];

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

      embeds.push(
        new EmbedBuilder()
          .setTitle(t.name)
          .setDescription(
            `${typeBadge} · ${t.format} · ${statusBadge}\n` +
            `Participants: **${t.participant_count}/${t.max_participants}**` +
            (t.end_date ? `\nEnds: ${t.end_date}` : ''),
          )
          .setColor(t.status === 'open' ? 0x57f287 : 0xfee75c)
          .setFooter({ text: `ID: ${t.id}` }),
      );
    }
  }

  // Row 1: tournament actions
  const tournamentRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('t_join').setLabel('Join Tournament').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('t_participants').setLabel('Participants').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('t_status').setLabel('My Status').setStyle(ButtonStyle.Secondary),
  );

  // Row 2: team management + LFT
  const teamRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('team_create').setLabel('Create Team').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('team_my').setLabel('My Teams').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('t_lft').setLabel('Looking For Team').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('t_lft_list').setLabel('LFT List').setStyle(ButtonStyle.Secondary),
  );

  const payload = {
    content: '',
    embeds: embeds.slice(0, 10),
    components: [tournamentRow, teamRow],
  };

  // Edit existing or post new
  const stateRow = db.getState.get('tournaments_message_id');
  if (stateRow) {
    try {
      const msg = await channel.messages.fetch(stateRow.value);
      await msg.edit(payload);
      return;
    } catch { /* deleted — fall through */ }
  }

  const msg = await channel.send(payload);
  db.setState.run('tournaments_message_id', msg.id);
  try { await msg.pin(); } catch { /* already pinned or no perms */ }
}

// --- Player button handlers ---

async function showJoinSelect(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const tournaments = db.getOpenActiveTournaments.all().filter(t => {
    if (t.status !== 'open') return false;
    if (t.participant_count >= t.max_participants) return false;
    return true;
  });

  if (tournaments.length === 0) {
    return interaction.editReply('No tournaments open for registration right now.');
  }

  const row = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('t_join_select')
      .setPlaceholder('Select tournament')
      .addOptions(tournaments.map(t => ({
        label: `${t.name} — ${t.format} (${t.participant_count}/${t.max_participants})`,
        value: String(t.id),
      }))),
  );

  return interaction.editReply({ content: 'Which tournament do you want to join?', components: [row] });
}

async function handleJoin(interaction) {
  await interaction.deferUpdate();

  const tournamentId = parseInt(interaction.values[0], 10);
  const tournament = db.getTournament.get(tournamentId);
  if (!tournament) return interaction.editReply({ content: 'Tournament not found.', components: [] });
  if (tournament.status !== 'open') return interaction.editReply({ content: 'Not open.', components: [] });

  const count = db.getParticipantCount.get(tournamentId).count;
  if (count >= tournament.max_participants) return interaction.editReply({ content: 'Full.', components: [] });

  const existing = db.getParticipant.get(tournamentId, interaction.user.id);
  if (existing) return interaction.editReply({ content: 'Already registered.', components: [] });

  if (tournament.type === 'solo') {
    db.insertParticipant.run(tournamentId, interaction.user.id, null);
    await refreshTournamentsEmbed(interaction.client);
    return interaction.editReply({ content: `You joined **${tournament.name}**!`, components: [] });
  }

  // Team tournament — show team select
  const teams = db.getTeamsByUser.all(interaction.user.id);
  if (teams.length === 0) {
    return interaction.editReply({ content: 'You need a team first. Use **Create Team**.', components: [] });
  }

  const row = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`t_team_select:${tournamentId}`)
      .setPlaceholder('Select your team')
      .addOptions(teams.map(t => ({
        label: `${t.name} (${t.size} players)`,
        value: String(t.id),
      }))),
  );

  return interaction.editReply({ content: 'Select which team to register:', components: [row] });
}

async function handleTeamSelect(interaction, tournamentId) {
  await interaction.deferUpdate();

  const tid = parseInt(tournamentId, 10);
  const teamId = parseInt(interaction.values[0], 10);
  const tournament = db.getTournament.get(tid);
  if (!tournament) return interaction.editReply({ content: 'Tournament not found.', components: [] });

  // Check ALL team members — no one can be in the tournament already
  const members = db.getTeamMembers.all(teamId);
  const conflicts = members.filter(m => db.getParticipant.get(tid, m.user_id));
  if (conflicts.length > 0) {
    const names = conflicts.map(c => `<@${c.user_id}>`).join(', ');
    return interaction.editReply({ content: `Can't register — already in this tournament: ${names}`, components: [] });
  }

  // Register all team members
  for (const m of members) {
    db.insertParticipant.run(tid, m.user_id, teamId);
  }

  await refreshTournamentsEmbed(interaction.client);
  const team = db.getTeam.get(teamId);
  return interaction.editReply({ content: `Team **${team.name}** registered for **${tournament.name}**!`, components: [] });
}

// --- Participants list ---

async function showParticipantsSelect(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const tournaments = db.getOpenActiveTournaments.all();
  if (tournaments.length === 0) {
    return interaction.editReply('No tournaments right now.');
  }

  if (tournaments.length === 1) {
    return showParticipantsList(interaction, tournaments[0].id);
  }

  const row = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('t_participants_select')
      .setPlaceholder('Select tournament')
      .addOptions(tournaments.map(t => ({
        label: `${t.name} (${t.participant_count} participants)`,
        value: String(t.id),
      }))),
  );

  return interaction.editReply({ content: 'View participants for which tournament?', components: [row] });
}

async function handleParticipantsSelect(interaction) {
  await interaction.deferUpdate();
  const tournamentId = parseInt(interaction.values[0], 10);
  return showParticipantsList(interaction, tournamentId);
}

async function showParticipantsList(interaction, tournamentId) {
  const tournament = db.getTournament.get(tournamentId);
  if (!tournament) {
    return interaction.editReply({ content: 'Tournament not found.', components: [] });
  }

  const participants = db.getParticipantsByTournament.all(tournamentId);
  if (participants.length === 0) {
    return interaction.editReply({ content: `**${tournament.name}** — no participants yet.`, embeds: [], components: [] });
  }

  let description;
  if (tournament.type === 'team') {
    // Group by team
    const teamMap = {};
    for (const p of participants) {
      const key = p.team_id || 'no_team';
      if (!teamMap[key]) teamMap[key] = [];
      teamMap[key].push(p);
    }

    const lines = [];
    for (const [teamId, members] of Object.entries(teamMap)) {
      if (teamId === 'no_team') {
        lines.push('**No team:**');
        for (const m of members) lines.push(`  <@${m.user_id}>`);
      } else {
        const team = db.getTeam.get(parseInt(teamId, 10));
        const teamName = team ? team.name : `Team #${teamId}`;
        lines.push(`**${teamName}:**`);
        for (const m of members) lines.push(`  <@${m.user_id}>`);
      }
    }
    description = lines.join('\n');
  } else {
    description = participants.map(p => `<@${p.user_id}>`).join('\n');
  }

  const embed = new EmbedBuilder()
    .setTitle(`${tournament.name} — Participants (${participants.length})`)
    .setDescription(description.slice(0, 4096))
    .setColor(0x5865f2);

  return interaction.editReply({ content: '', embeds: [embed], components: [] });
}

// --- Status ---

async function showStatusSelect(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const all = db.getOpenActiveTournaments.all();
  const mine = all.filter(t => db.getParticipant.get(t.id, interaction.user.id));

  if (mine.length === 0) {
    return interaction.editReply('You are not registered in any active tournament.');
  }

  if (mine.length === 1) {
    const p = db.getParticipant.get(mine[0].id, interaction.user.id);
    const labels = { registered: '📋 Registered', active: '⚔️ In Bracket', eliminated: '❌ Eliminated', winner: '🏆 Winner' };
    return interaction.editReply(`**${mine[0].name}** — ${labels[p.status] || p.status}`);
  }

  const row = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('t_status_select')
      .setPlaceholder('Select tournament')
      .addOptions(mine.map(t => ({
        label: t.name,
        value: String(t.id),
      }))),
  );

  return interaction.editReply({ content: 'Check status for which tournament?', components: [row] });
}

async function handleStatus(interaction) {
  await interaction.deferUpdate();

  const tournamentId = parseInt(interaction.values[0], 10);
  const tournament = db.getTournament.get(tournamentId);
  if (!tournament) return interaction.editReply({ content: 'Tournament not found.', components: [] });

  const participant = db.getParticipant.get(tournamentId, interaction.user.id);
  if (!participant) return interaction.editReply({ content: 'Not registered.', components: [] });

  const labels = { registered: '📋 Registered', active: '⚔️ In Bracket', eliminated: '❌ Eliminated', winner: '🏆 Winner' };
  return interaction.editReply({ content: `**${tournament.name}** — ${labels[participant.status] || participant.status}`, components: [] });
}

// --- LFT (Looking For Team) ---

async function showLftSelect(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const tournaments = db.getOpenActiveTournaments.all().filter(t => t.status === 'open' && t.type === 'team');
  if (tournaments.length === 0) {
    return interaction.editReply('No open team tournaments right now.');
  }

  if (tournaments.length === 1) {
    return handleLftAdd(interaction, tournaments[0]);
  }

  const row = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('t_lft_select')
      .setPlaceholder('Select tournament')
      .addOptions(tournaments.map(t => ({
        label: t.name,
        value: String(t.id),
      }))),
  );

  return interaction.editReply({ content: 'Looking for team in which tournament?', components: [row] });
}

async function handleLftSelect(interaction) {
  await interaction.deferUpdate();

  const tournamentId = parseInt(interaction.values[0], 10);
  const tournament = db.getTournament.get(tournamentId);
  if (!tournament) return interaction.editReply({ content: 'Tournament not found.', components: [] });

  return handleLftAdd(interaction, tournament);
}

async function handleLftAdd(interaction, tournament) {
  const existing = db.getLft.get(tournament.id, interaction.user.id);
  if (existing) {
    // Toggle off
    db.removeLft.run(tournament.id, interaction.user.id);
    return interaction.editReply({ content: `You are no longer looking for a team in **${tournament.name}**.`, components: [] });
  }

  db.insertLft.run(tournament.id, interaction.user.id);
  return interaction.editReply({ content: `You are now listed as **Looking For Team** in **${tournament.name}**. Captains can see you in the LFT List and invite you.`, components: [] });
}

async function showLftListSelect(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const tournaments = db.getOpenActiveTournaments.all().filter(t => t.type === 'team');
  if (tournaments.length === 0) {
    return interaction.editReply('No team tournaments right now.');
  }

  if (tournaments.length === 1) {
    return showLftList(interaction, tournaments[0].id);
  }

  const row = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('t_lft_list_select')
      .setPlaceholder('Select tournament')
      .addOptions(tournaments.map(t => ({
        label: t.name,
        value: String(t.id),
      }))),
  );

  return interaction.editReply({ content: 'View LFT list for which tournament?', components: [row] });
}

async function handleLftListSelect(interaction) {
  await interaction.deferUpdate();
  const tournamentId = parseInt(interaction.values[0], 10);
  return showLftList(interaction, tournamentId);
}

async function showLftList(interaction, tournamentId) {
  const tournament = db.getTournament.get(tournamentId);
  if (!tournament) return interaction.editReply({ content: 'Tournament not found.', components: [] });

  const lftPlayers = db.getLftByTournament.all(tournamentId);
  if (lftPlayers.length === 0) {
    return interaction.editReply({ content: `**${tournament.name}** — no players looking for a team.`, embeds: [], components: [] });
  }

  const list = lftPlayers.map(p => `<@${p.user_id}>`).join('\n');

  const embed = new EmbedBuilder()
    .setTitle(`${tournament.name} — Looking For Team`)
    .setDescription(list)
    .setFooter({ text: `${lftPlayers.length} player(s)` })
    .setColor(0x57f287);

  return interaction.editReply({ content: '', embeds: [embed], components: [] });
}

module.exports = {
  refreshTournamentsEmbed,
  showJoinSelect,
  handleJoin,
  handleTeamSelect,
  showParticipantsSelect,
  handleParticipantsSelect,
  showStatusSelect,
  handleStatus,
  showLftSelect,
  handleLftSelect,
  showLftListSelect,
  handleLftListSelect,
};

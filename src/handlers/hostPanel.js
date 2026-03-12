const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  StringSelectMenuBuilder,
  ChannelType,
  PermissionFlagsBits,
} = require('discord.js');
const db = require('../db');
const config = require('../config');
const { refreshTournamentsEmbed } = require('./tournaments');
const { generateBracket, advanceWinner } = require('./bracket');

// --- Persistent host panel ---

async function postHostPanel(client) {
  const channel = await client.channels.fetch(config.STAFF_CHANNEL_ID).catch(() => null);
  if (!channel) {
    console.warn('Staff channel not found — skipping host panel.');
    return;
  }

  const embed = new EmbedBuilder()
    .setTitle('Host Panel')
    .setDescription(
      'Manage tournaments from here.\n\n' +
      '**Create** — open a new tournament\n' +
      '**Start** — lock registrations and generate bracket\n' +
      '**Result** — record the next match winner\n' +
      '**End** — force-close a tournament',
    )
    .setColor(0xed4245);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('host_create').setLabel('Create').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('host_start').setLabel('Start').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('host_result').setLabel('Result').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('host_end').setLabel('End').setStyle(ButtonStyle.Danger),
  );

  const payload = { embeds: [embed], components: [row] };

  // Edit existing or post new
  const stateRow = db.getState.get('host_panel_message_id');
  if (stateRow) {
    try {
      const msg = await channel.messages.fetch(stateRow.value);
      await msg.edit(payload);
      return;
    } catch { /* deleted — fall through */ }
  }

  const msg = await channel.send(payload);
  db.setState.run('host_panel_message_id', msg.id);
}

// --- Role check helper ---

function isHost(interaction) {
  const member = interaction.member;
  if (!member) return false;

  // If roles is a GuildMemberRoleManager (cached), check by name
  if (member.roles?.cache) {
    return member.roles.cache.some(r => r.name === config.HOST_ROLE_NAME);
  }

  // If roles is a raw array of role ID strings (uncached), check against guild roles
  if (Array.isArray(member.roles)) {
    const guild = interaction.guild;
    if (!guild) return false;
    return member.roles.some(roleId => {
      const role = guild.roles.cache.get(roleId);
      return role && role.name === config.HOST_ROLE_NAME;
    });
  }

  return false;
}

// --- Button handlers ---

function showCreateModal(interaction) {
  if (!isHost(interaction)) {
    return interaction.reply({ content: 'You need the **Host** role.', ephemeral: true });
  }

  const modal = new ModalBuilder()
    .setCustomId('modal_create_tournament')
    .setTitle('Create Tournament');

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('tournament_name')
        .setLabel('Name')
        .setStyle(TextInputStyle.Short)
        .setRequired(true),
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('tournament_type')
        .setLabel('Type (solo / team)')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('solo')
        .setRequired(true),
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('tournament_format')
        .setLabel('Format (e.g. 1v1, 2v2, FFA, etc.)')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('1v1')
        .setRequired(true),
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('tournament_max')
        .setLabel('Max Participants')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('16')
        .setRequired(true),
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('tournament_end_date')
        .setLabel('End Date (optional, e.g. 2026-04-01)')
        .setStyle(TextInputStyle.Short)
        .setRequired(false),
    ),
  );

  return interaction.showModal(modal);
}

async function showStartSelect(interaction) {
  if (!isHost(interaction)) {
    return interaction.reply({ content: 'You need the **Host** role.', ephemeral: true });
  }
  await interaction.deferReply({ ephemeral: true });

  const tournaments = db.getOpenActiveTournaments.all().filter(t => t.status === 'open');
  if (tournaments.length === 0) {
    return interaction.editReply('No open tournaments to start.');
  }

  const row = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('host_start_select')
      .setPlaceholder('Select tournament to start')
      .addOptions(tournaments.map(t => ({
        label: `${t.name} (${t.participant_count} participants)`,
        value: String(t.id),
      }))),
  );

  return interaction.editReply({ content: 'Which tournament to start?', components: [row] });
}

async function showResultSelect(interaction) {
  if (!isHost(interaction)) {
    return interaction.reply({ content: 'You need the **Host** role.', ephemeral: true });
  }
  await interaction.deferReply({ ephemeral: true });

  const tournaments = db.getOpenActiveTournaments.all().filter(t => t.status === 'active');
  if (tournaments.length === 0) {
    return interaction.editReply('No active tournaments.');
  }

  const row = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('host_result_select')
      .setPlaceholder('Select tournament')
      .addOptions(tournaments.map(t => ({
        label: t.name,
        value: String(t.id),
      }))),
  );

  return interaction.editReply({ content: 'Record result for which tournament?', components: [row] });
}

async function showEndSelect(interaction) {
  if (!isHost(interaction)) {
    return interaction.reply({ content: 'You need the **Host** role.', ephemeral: true });
  }
  await interaction.deferReply({ ephemeral: true });

  const tournaments = db.getOpenActiveTournaments.all();
  if (tournaments.length === 0) {
    return interaction.editReply('No open or active tournaments.');
  }

  const row = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('host_end_select')
      .setPlaceholder('Select tournament to close')
      .addOptions(tournaments.map(t => ({
        label: `${t.name} (${t.status})`,
        value: String(t.id),
      }))),
  );

  return interaction.editReply({ content: 'Which tournament to close?', components: [row] });
}

// --- Modal submit ---

async function handleCreateSubmit(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const name = interaction.fields.getTextInputValue('tournament_name');
  const type = interaction.fields.getTextInputValue('tournament_type').toLowerCase().trim();
  const format = interaction.fields.getTextInputValue('tournament_format').trim();
  const maxStr = interaction.fields.getTextInputValue('tournament_max');
  const endDate = interaction.fields.getTextInputValue('tournament_end_date') || null;

  if (!['solo', 'team'].includes(type)) {
    return interaction.editReply('Type must be **solo** or **team**.');
  }
  const max = parseInt(maxStr, 10);
  if (isNaN(max) || max < 2) {
    return interaction.editReply('Max participants must be at least 2.');
  }

  db.insertTournament.run({
    name,
    type,
    format,
    max_participants: max,
    end_date: endDate,
    host_id: interaction.user.id,
  });

  await refreshTournamentsEmbed(interaction.client);
  return interaction.editReply(`Tournament **${name}** created!`);
}

// --- Select menu handlers ---

async function handleStart(interaction) {
  await interaction.deferUpdate();

  const tournamentId = parseInt(interaction.values[0], 10);
  const tournament = db.getTournament.get(tournamentId);
  if (!tournament) return interaction.editReply({ content: 'Tournament not found.', components: [] });
  if (tournament.status !== 'open') return interaction.editReply({ content: 'Tournament is not open.', components: [] });

  const count = db.getParticipantCount.get(tournamentId).count;
  if (count < 2) return interaction.editReply({ content: 'Need at least 2 participants.', components: [] });

  db.updateTournamentStatus.run('active', tournamentId);
  generateBracket(tournamentId);

  // Create private voice channels for teams
  if (tournament.type === 'team') {
    await createTeamVoiceChannels(interaction.guild, tournament);
  }

  await refreshTournamentsEmbed(interaction.client);
  return interaction.editReply({ content: `**${tournament.name}** started!`, components: [] });
}

async function handleResultSelect(interaction) {
  await interaction.deferUpdate();

  const tournamentId = parseInt(interaction.values[0], 10);
  const match = db.getNextUncompletedMatch.get(tournamentId);
  if (!match) return interaction.editReply({ content: 'No pending matches.', components: [] });

  if (!match.participant_a || !match.participant_b) {
    return interaction.editReply({
      content: `Next match (Round ${match.round}, Match ${match.match_index + 1}): waiting for participants.`,
      components: [],
    });
  }

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`host_winner:${match.id}:${match.participant_a}`)
      .setLabel(match.participant_a)
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`host_winner:${match.id}:${match.participant_b}`)
      .setLabel(match.participant_b)
      .setStyle(ButtonStyle.Success),
  );

  return interaction.editReply({
    content: `**Round ${match.round}, Match ${match.match_index + 1}**\n\`${match.participant_a}\` vs \`${match.participant_b}\`\n\nPick the winner:`,
    components: [row],
  });
}

async function handleWinner(interaction, matchId, winnerId) {
  await interaction.deferUpdate();

  const match = db.getMatchById.get(parseInt(matchId, 10));
  if (!match) return interaction.editReply({ content: 'Match not found.', components: [] });
  if (match.completed) return interaction.editReply({ content: 'Match already completed.', components: [] });

  if (winnerId !== match.participant_a && winnerId !== match.participant_b) {
    return interaction.editReply({ content: 'Invalid winner.', components: [] });
  }

  db.updateMatchWinner.run(winnerId, match.id);

  const loserId = winnerId === match.participant_a ? match.participant_b : match.participant_a;
  if (loserId) {
    db.updateParticipantStatus.run('eliminated', match.tournament_id, loserId);
  }

  advanceWinner(match.tournament_id, { ...match, winner: winnerId });

  const remaining = db.getRemainingMatches.get(match.tournament_id).count;
  const tournament = db.getTournament.get(match.tournament_id);

  if (remaining === 0) {
    db.updateTournamentStatus.run('closed', match.tournament_id);
    db.updateParticipantStatus.run('winner', match.tournament_id, winnerId);
    await cleanupVoiceChannels(match.tournament_id, interaction.guild);
  }

  await refreshTournamentsEmbed(interaction.client);

  const msg = remaining === 0
    ? `**${tournament.name}** complete! Winner: <@${winnerId}>`
    : `Result recorded. ${remaining} match(es) remaining.`;
  return interaction.editReply({ content: msg, components: [] });
}

async function handleEnd(interaction) {
  await interaction.deferUpdate();

  const tournamentId = parseInt(interaction.values[0], 10);
  const tournament = db.getTournament.get(tournamentId);
  if (!tournament) return interaction.editReply({ content: 'Tournament not found.', components: [] });

  db.updateTournamentStatus.run('closed', tournamentId);
  await cleanupVoiceChannels(tournamentId, interaction.guild);

  await refreshTournamentsEmbed(interaction.client);
  return interaction.editReply({ content: `**${tournament.name}** closed.`, components: [] });
}

// --- Voice channel helpers ---

async function createTeamVoiceChannels(guild, tournament) {
  // Create category
  const category = await guild.channels.create({
    name: tournament.name,
    type: ChannelType.GuildCategory,
  });

  db.setState.run(`category:${tournament.id}`, category.id);

  // Get unique teams from participants
  const participants = db.getParticipantsByTournament.all(tournament.id);
  const teamIds = [...new Set(participants.map(p => p.team_id).filter(Boolean))];

  for (const teamId of teamIds) {
    const team = db.getTeam.get(teamId);
    if (!team) continue;

    const members = db.getTeamMembers.all(teamId);

    // Permission overwrites: deny everyone, allow team members
    const permissionOverwrites = [
      {
        id: guild.id, // @everyone
        deny: [PermissionFlagsBits.Connect, PermissionFlagsBits.ViewChannel],
      },
      ...members.map(m => ({
        id: m.user_id,
        allow: [PermissionFlagsBits.Connect, PermissionFlagsBits.ViewChannel],
      })),
    ];

    await guild.channels.create({
      name: team.name,
      type: ChannelType.GuildVoice,
      parent: category.id,
      permissionOverwrites,
    });
  }
}

async function cleanupVoiceChannels(tournamentId, guild) {
  const stateRow = db.getState.get(`category:${tournamentId}`);
  if (!stateRow) return;

  try {
    const category = await guild.channels.fetch(stateRow.value);
    if (!category) return;

    // Delete all children first
    for (const [, ch] of category.children.cache) {
      await ch.delete().catch(() => {});
    }
    await category.delete();
  } catch { /* already deleted */ }

  db.db.prepare('DELETE FROM bot_state WHERE key = ?').run(`category:${tournamentId}`);
}

module.exports = {
  postHostPanel,
  showCreateModal,
  showStartSelect,
  showResultSelect,
  showEndSelect,
  handleCreateSubmit,
  handleStart,
  handleResultSelect,
  handleWinner,
  handleEnd,
};

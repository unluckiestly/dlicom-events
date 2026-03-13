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
const logger = require('./logger');

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
      '**Edit** — edit an open tournament\n' +
      '**Start** — lock registrations and begin tournament\n' +
      '**End** — force-close a tournament',
    )
    .setColor(0xed4245);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('host_create').setLabel('Create').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('host_edit').setLabel('Edit').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('host_start').setLabel('Start').setStyle(ButtonStyle.Primary),
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

// --- Edit tournament ---

async function showEditSelect(interaction) {
  if (!isHost(interaction)) {
    return interaction.reply({ content: 'You need the **Host** role.', ephemeral: true });
  }
  await interaction.deferReply({ ephemeral: true });

  const tournaments = db.getOpenActiveTournaments.all().filter(t => t.status === 'open');
  if (tournaments.length === 0) {
    return interaction.editReply('No open tournaments to edit.');
  }

  const row = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('host_edit_select')
      .setPlaceholder('Select tournament to edit')
      .addOptions(tournaments.map(t => ({
        label: t.name,
        value: String(t.id),
      }))),
  );

  return interaction.editReply({ content: 'Which tournament to edit?', components: [row] });
}

async function handleEditSelect(interaction) {
  await interaction.deferUpdate();

  const tournamentId = parseInt(interaction.values[0], 10);
  const tournament = db.getTournament.get(tournamentId);
  if (!tournament) return interaction.editReply({ content: 'Tournament not found.', components: [] });

  const count = db.getParticipantCount.get(tournamentId).count;

  const embed = new EmbedBuilder()
    .setTitle(`Edit: ${tournament.name}`)
    .setDescription(
      `**Format:** ${tournament.format}\n` +
      `**Max participants:** ${tournament.max_participants}\n` +
      `**Registered:** ${count}\n` +
      `**End date:** ${tournament.end_date || 'not set'}`,
    )
    .setColor(0x5865f2);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`host_edit_open:${tournamentId}`)
      .setLabel('Edit Details')
      .setStyle(ButtonStyle.Primary),
  );

  return interaction.editReply({ content: '', embeds: [embed], components: [row] });
}

function showEditModal(interaction, tournamentId) {
  const tournament = db.getTournament.get(parseInt(tournamentId, 10));
  if (!tournament) {
    return interaction.reply({ content: 'Tournament not found.', ephemeral: true });
  }

  const modal = new ModalBuilder()
    .setCustomId(`modal_edit_tournament:${tournament.id}`)
    .setTitle('Edit Tournament');

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('tournament_name')
        .setLabel('Name')
        .setStyle(TextInputStyle.Short)
        .setValue(tournament.name)
        .setRequired(true),
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('tournament_format')
        .setLabel('Format')
        .setStyle(TextInputStyle.Short)
        .setValue(tournament.format)
        .setRequired(true),
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('tournament_max')
        .setLabel('Max Participants')
        .setStyle(TextInputStyle.Short)
        .setValue(String(tournament.max_participants))
        .setRequired(true),
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('tournament_end_date')
        .setLabel('End Date (optional)')
        .setStyle(TextInputStyle.Short)
        .setValue(tournament.end_date || '')
        .setRequired(false),
    ),
  );

  return interaction.showModal(modal);
}

async function handleEditSubmit(interaction, tournamentId) {
  await interaction.deferReply({ ephemeral: true });

  const tid = parseInt(tournamentId, 10);
  const tournament = db.getTournament.get(tid);
  if (!tournament) return interaction.editReply('Tournament not found.');
  if (tournament.status !== 'open') return interaction.editReply('Can only edit open tournaments.');

  const name = interaction.fields.getTextInputValue('tournament_name').trim();
  const format = interaction.fields.getTextInputValue('tournament_format').trim();
  const maxStr = interaction.fields.getTextInputValue('tournament_max').trim();
  const endDate = interaction.fields.getTextInputValue('tournament_end_date') || null;

  const max = parseInt(maxStr, 10);
  if (isNaN(max) || max < 2) {
    return interaction.editReply('Max participants must be at least 2.');
  }

  db.updateTournament.run({ id: tid, name, format, max_participants: max, end_date: endDate });

  await refreshTournamentsEmbed(interaction.client);
  await logger.log('tournament', 'Tournament Edited', `**${name}** edited by <@${interaction.user.id}>`);
  return interaction.editReply(`Tournament **${name}** updated!`);
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
  await logger.log('tournament', 'Tournament Created', `**${name}** (${type}, ${format}, max ${max})\nBy: <@${interaction.user.id}>`);
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

  // Mark all participants as active
  const participants = db.getParticipantsByTournament.all(tournamentId);
  for (const p of participants) {
    db.updateParticipantStatus.run('active', tournamentId, p.user_id);
  }

  // Create private voice channels for teams
  if (tournament.type === 'team') {
    await createTeamVoiceChannels(interaction.guild, tournament);
  }

  await refreshTournamentsEmbed(interaction.client);
  await logger.log('tournament', 'Tournament Started', `**${tournament.name}** (${count} participants)\nBy: <@${interaction.user.id}>`);
  return interaction.editReply({ content: `**${tournament.name}** started!`, components: [] });
}

async function handleEnd(interaction) {
  await interaction.deferUpdate();

  const tournamentId = parseInt(interaction.values[0], 10);
  const tournament = db.getTournament.get(tournamentId);
  if (!tournament) return interaction.editReply({ content: 'Tournament not found.', components: [] });

  db.updateTournamentStatus.run('closed', tournamentId);
  await cleanupVoiceChannels(tournamentId, interaction.guild);

  await refreshTournamentsEmbed(interaction.client);
  await logger.log('tournament', 'Tournament Closed', `**${tournament.name}** force-closed by <@${interaction.user.id}>`);
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
  showEditSelect,
  handleEditSelect,
  showEditModal,
  handleEditSubmit,
  showStartSelect,
  showEndSelect,
  handleCreateSubmit,
  handleStart,
  handleEnd,
};

const {
  SlashCommandBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  EmbedBuilder,
  PermissionFlagsBits,
} = require('discord.js');
const db = require('../db');
const config = require('../config');
const { refreshTournamentsEmbed } = require('../handlers/tournaments');
const { generateBracket, advanceWinner, formatBracket } = require('../handlers/bracket');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('host')
    .setDescription('Host tournament commands')
    .addSubcommand(sub =>
      sub.setName('create').setDescription('Create a new tournament'),
    )
    .addSubcommand(sub =>
      sub
        .setName('start')
        .setDescription('Start a tournament')
        .addIntegerOption(opt =>
          opt.setName('tournament_id').setDescription('Tournament ID').setRequired(true),
        ),
    )
    .addSubcommand(sub =>
      sub
        .setName('result')
        .setDescription('Record a match result')
        .addIntegerOption(opt =>
          opt.setName('tournament_id').setDescription('Tournament ID').setRequired(true),
        )
        .addStringOption(opt =>
          opt.setName('winner').setDescription('Winner user/team ID').setRequired(true),
        ),
    )
    .addSubcommand(sub =>
      sub
        .setName('end')
        .setDescription('Force close a tournament')
        .addIntegerOption(opt =>
          opt.setName('tournament_id').setDescription('Tournament ID').setRequired(true),
        ),
    ),

  async execute(interaction) {
    // Role check
    const hasRole = interaction.member.roles.cache.some(r => r.name === config.HOST_ROLE_NAME);
    if (!hasRole) {
      return interaction.reply({ content: 'You need the **Host** role to use this command.', ephemeral: true });
    }

    const sub = interaction.options.getSubcommand();

    if (sub === 'create') {
      return handleCreate(interaction);
    }
    if (sub === 'start') {
      return handleStart(interaction);
    }
    if (sub === 'result') {
      return handleResult(interaction);
    }
    if (sub === 'end') {
      return handleEnd(interaction);
    }
  },

  /** Handle the modal submit for tournament creation */
  async handleModalSubmit(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const name = interaction.fields.getTextInputValue('tournament_name');
    const type = interaction.fields.getTextInputValue('tournament_type').toLowerCase();
    const format = interaction.fields.getTextInputValue('tournament_format').toLowerCase();
    const maxStr = interaction.fields.getTextInputValue('tournament_max');
    const endDate = interaction.fields.getTextInputValue('tournament_end_date') || null;

    // Validate
    if (!['solo', 'team'].includes(type)) {
      return interaction.editReply('Type must be **solo** or **team**.');
    }
    if (!['1v1', 'battle-royale'].includes(format)) {
      return interaction.editReply('Format must be **1v1** or **battle-royale**.');
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
  },
};

async function handleCreate(interaction) {
  // Modals must be shown immediately — cannot defer first
  const modal = new ModalBuilder()
    .setCustomId('modal_create_tournament')
    .setTitle('Create Tournament');

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('tournament_name')
        .setLabel('Tournament Name')
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
        .setLabel('Format (1v1 / battle-royale)')
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

async function handleStart(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const tournamentId = interaction.options.getInteger('tournament_id');
  const tournament = db.getTournament.get(tournamentId);
  if (!tournament) return interaction.editReply('Tournament not found.');
  if (tournament.status !== 'open') return interaction.editReply('Tournament is not open.');

  const count = db.getParticipantCount.get(tournamentId).count;
  if (count < 2) return interaction.editReply('Need at least 2 participants to start.');

  // Update status
  db.updateTournamentStatus.run('active', tournamentId);

  // Generate bracket
  generateBracket(tournamentId);

  // Post bracket to #brackets
  const bracketChannel = await interaction.client.channels.fetch(config.BRACKETS_CHANNEL_ID).catch(() => null);
  if (bracketChannel) {
    const text = formatBracket(tournamentId);
    const embed = new EmbedBuilder()
      .setTitle(`Bracket: ${tournament.name}`)
      .setDescription(text)
      .setColor(0x5865f2);
    await bracketChannel.send({ embeds: [embed] });
  }

  await refreshTournamentsEmbed(interaction.client);
  return interaction.editReply(`Tournament **${tournament.name}** started! Bracket posted.`);
}

async function handleResult(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const tournamentId = interaction.options.getInteger('tournament_id');
  const winnerInput = interaction.options.getString('winner');

  const tournament = db.getTournament.get(tournamentId);
  if (!tournament) return interaction.editReply('Tournament not found.');
  if (tournament.status !== 'active') return interaction.editReply('Tournament is not active.');

  // Find next uncompleted match
  const match = db.getNextUncompletedMatch.get(tournamentId);
  if (!match) return interaction.editReply('No pending matches.');

  // Validate winner is one of the participants in this match
  if (winnerInput !== match.participant_a && winnerInput !== match.participant_b) {
    return interaction.editReply(
      `Winner must be one of: \`${match.participant_a}\` or \`${match.participant_b}\``,
    );
  }

  // Record result
  db.updateMatchWinner.run(winnerInput, match.id);

  // Mark loser as eliminated
  const loserId = winnerInput === match.participant_a ? match.participant_b : match.participant_a;
  if (loserId) {
    db.updateParticipantStatus.run('eliminated', tournamentId, loserId);
  }

  // Advance winner
  advanceWinner(tournamentId, { ...match, winner: winnerInput });

  // Check if tournament is complete
  const remaining = db.getRemainingMatches.get(tournamentId).count;
  if (remaining === 0) {
    db.updateTournamentStatus.run('closed', tournamentId);
    db.updateParticipantStatus.run('winner', tournamentId, winnerInput);

    // Post results
    const resultsChannel = await interaction.client.channels.fetch(config.RESULTS_CHANNEL_ID).catch(() => null);
    if (resultsChannel) {
      const embed = new EmbedBuilder()
        .setTitle(`🏆 ${tournament.name} — Results`)
        .setDescription(`Winner: <@${winnerInput}>`)
        .setColor(0xfee75c)
        .setTimestamp();
      await resultsChannel.send({ embeds: [embed] });
    }
  }

  await refreshTournamentsEmbed(interaction.client);

  const statusMsg = remaining === 0
    ? `Match recorded. **${tournament.name}** is now complete! Winner: <@${winnerInput}>`
    : `Match result recorded. ${remaining} match(es) remaining.`;
  return interaction.editReply(statusMsg);
}

async function handleEnd(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const tournamentId = interaction.options.getInteger('tournament_id');
  const tournament = db.getTournament.get(tournamentId);
  if (!tournament) return interaction.editReply('Tournament not found.');
  if (tournament.status === 'closed') return interaction.editReply('Tournament is already closed.');

  db.updateTournamentStatus.run('closed', tournamentId);

  // Post final state to #results
  const resultsChannel = await interaction.client.channels.fetch(config.RESULTS_CHANNEL_ID).catch(() => null);
  if (resultsChannel) {
    const bracketText = formatBracket(tournamentId);
    const embed = new EmbedBuilder()
      .setTitle(`${tournament.name} — Closed`)
      .setDescription(`Tournament was force-closed by a host.\n\n${bracketText}`)
      .setColor(0xed4245)
      .setTimestamp();
    await resultsChannel.send({ embeds: [embed] });
  }

  await refreshTournamentsEmbed(interaction.client);
  return interaction.editReply(`Tournament **${tournament.name}** has been closed.`);
}

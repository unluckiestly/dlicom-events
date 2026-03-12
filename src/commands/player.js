const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
} = require('discord.js');
const db = require('../db');
const { refreshTournamentsEmbed } = require('../handlers/tournaments');
const { formatBracket } = require('../handlers/bracket');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('player')
    .setDescription('Player commands')
    .addSubcommand(sub =>
      sub.setName('tournaments').setDescription('Refresh the tournaments list'),
    )
    .addSubcommand(sub =>
      sub
        .setName('join')
        .setDescription('Join a tournament')
        .addIntegerOption(opt =>
          opt.setName('tournament_id').setDescription('Tournament ID').setRequired(true),
        ),
    )
    .addSubcommand(sub =>
      sub
        .setName('status')
        .setDescription('Check your status in a tournament')
        .addIntegerOption(opt =>
          opt.setName('tournament_id').setDescription('Tournament ID').setRequired(true),
        ),
    )
    .addSubcommand(sub =>
      sub
        .setName('bracket')
        .setDescription('View the bracket for a tournament')
        .addIntegerOption(opt =>
          opt.setName('tournament_id').setDescription('Tournament ID').setRequired(true),
        ),
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'tournaments') return handleTournaments(interaction);
    if (sub === 'join') return handleJoin(interaction);
    if (sub === 'status') return handleStatus(interaction);
    if (sub === 'bracket') return handleBracket(interaction);
  },

  /** Handle team select menu for team tournament joins */
  async handleTeamSelect(interaction, tournamentId) {
    await interaction.deferUpdate();

    const teamId = parseInt(interaction.values[0], 10);
    const tournament = db.getTournament.get(parseInt(tournamentId, 10));
    if (!tournament) {
      return interaction.followUp({ content: 'Tournament not found.', ephemeral: true });
    }

    // Check if already registered
    const existing = db.getParticipant.get(tournament.id, interaction.user.id);
    if (existing) {
      return interaction.followUp({ content: 'You are already registered.', ephemeral: true });
    }

    // Register with team
    db.insertParticipant.run(tournament.id, interaction.user.id, teamId);

    // Also register all team members
    const members = db.getTeamMembers.all(teamId);
    for (const m of members) {
      if (m.user_id === interaction.user.id) continue;
      const alreadyIn = db.getParticipant.get(tournament.id, m.user_id);
      if (!alreadyIn) {
        db.insertParticipant.run(tournament.id, m.user_id, teamId);
      }
    }

    await refreshTournamentsEmbed(interaction.client);

    const team = db.getTeam.get(teamId);
    return interaction.editReply({
      content: `Team **${team.name}** registered for **${tournament.name}**!`,
      components: [],
    });
  },
};

async function handleTournaments(interaction) {
  await interaction.deferReply({ ephemeral: true });
  await refreshTournamentsEmbed(interaction.client);
  return interaction.editReply('Tournaments list updated.');
}

async function handleJoin(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const tournamentId = interaction.options.getInteger('tournament_id');
  const tournament = db.getTournament.get(tournamentId);
  if (!tournament) return interaction.editReply('Tournament not found.');
  if (tournament.status !== 'open') return interaction.editReply('Tournament is not open for registration.');

  const count = db.getParticipantCount.get(tournamentId).count;
  if (count >= tournament.max_participants) return interaction.editReply('Tournament is full.');

  const existing = db.getParticipant.get(tournamentId, interaction.user.id);
  if (existing) return interaction.editReply('You are already registered.');

  if (tournament.type === 'solo') {
    db.insertParticipant.run(tournamentId, interaction.user.id, null);
    await refreshTournamentsEmbed(interaction.client);
    return interaction.editReply(`You joined **${tournament.name}**!`);
  }

  // Team tournament — show team select menu
  // Determine required team size from format
  const sizeMap = { '1v1': 1, '2v2': 2, '3v3': 3, '5v5': 5 };
  // For team tournaments, we look at teams the user is on
  const teams = db.getTeamsByUser.all(interaction.user.id);
  if (teams.length === 0) {
    return interaction.editReply('You are not on any team. Create or join a team first.');
  }

  const options = teams.map(t => ({
    label: `${t.name} (${t.size}v${t.size})`,
    value: String(t.id),
  }));

  if (options.length === 0) {
    return interaction.editReply('None of your teams match the tournament requirements.');
  }

  const row = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`team_select:${tournamentId}`)
      .setPlaceholder('Select a team to register')
      .addOptions(options.slice(0, 25)),
  );

  return interaction.editReply({
    content: 'Select which team to register:',
    components: [row],
  });
}

async function handleStatus(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const tournamentId = interaction.options.getInteger('tournament_id');
  const tournament = db.getTournament.get(tournamentId);
  if (!tournament) return interaction.editReply('Tournament not found.');

  const participant = db.getParticipant.get(tournamentId, interaction.user.id);
  if (!participant) return interaction.editReply('You are not registered in this tournament.');

  const statusLabels = {
    registered: '📋 Registered',
    active: '⚔️ In Bracket',
    eliminated: '❌ Eliminated',
    winner: '🏆 Winner',
  };

  return interaction.editReply(
    `**${tournament.name}** — ${statusLabels[participant.status] || participant.status}`,
  );
}

async function handleBracket(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const tournamentId = interaction.options.getInteger('tournament_id');
  const tournament = db.getTournament.get(tournamentId);
  if (!tournament) return interaction.editReply('Tournament not found.');

  const text = formatBracket(tournamentId);
  const embed = new EmbedBuilder()
    .setTitle(`Bracket: ${tournament.name}`)
    .setDescription(text)
    .setColor(0x5865f2);

  return interaction.editReply({ embeds: [embed] });
}

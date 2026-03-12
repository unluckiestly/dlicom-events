const { Events } = require('discord.js');

module.exports = {
  name: Events.InteractionCreate,
  async execute(interaction) {
    // --- Slash commands ---
    if (interaction.isChatInputCommand()) {
      const command = interaction.client.commands.get(interaction.commandName);
      if (!command) return;

      try {
        await command.execute(interaction);
      } catch (error) {
        console.error(`Error executing /${interaction.commandName}:`, error);
        const reply = { content: 'Something went wrong.', ephemeral: true };
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp(reply).catch(() => {});
        } else {
          await interaction.reply(reply).catch(() => {});
        }
      }
      return;
    }

    // --- Modal submits ---
    if (interaction.isModalSubmit()) {
      if (interaction.customId === 'modal_create_tournament') {
        const host = require('../commands/host');
        return host.handleModalSubmit(interaction);
      }
      return;
    }

    // --- Buttons ---
    if (interaction.isButton()) {
      const [action, ...rest] = interaction.customId.split(':');
      const id = rest.join(':');

      // Tournament buttons from the persistent embed
      if (action === 'join') {
        return handleJoinButton(interaction, id);
      }
      if (action === 'bracket') {
        return handleBracketButton(interaction, id);
      }
      if (action === 'status') {
        return handleStatusButton(interaction, id);
      }

      // Team invite buttons
      if (action === 'team_accept' || action === 'team_decline') {
        const team = require('../commands/team');
        const buttonAction = action === 'team_accept' ? 'accept' : 'decline';
        return team.handleInviteButton(interaction, buttonAction, id);
      }
      return;
    }

    // --- Select menus ---
    if (interaction.isStringSelectMenu()) {
      const [action, ...rest] = interaction.customId.split(':');
      const id = rest.join(':');

      if (action === 'team_select') {
        const player = require('../commands/player');
        return player.handleTeamSelect(interaction, id);
      }
      return;
    }
  },
};

// --- Button handlers for the persistent tournaments embed ---

const db = require('../db');
const { refreshTournamentsEmbed } = require('../handlers/tournaments');
const { formatBracket } = require('../handlers/bracket');
const { EmbedBuilder } = require('discord.js');

async function handleJoinButton(interaction, tournamentId) {
  await interaction.deferReply({ ephemeral: true });

  const tid = parseInt(tournamentId, 10);
  const tournament = db.getTournament.get(tid);
  if (!tournament) return interaction.editReply('Tournament not found.');
  if (tournament.status !== 'open') return interaction.editReply('Tournament is not open.');

  const count = db.getParticipantCount.get(tid).count;
  if (count >= tournament.max_participants) return interaction.editReply('Tournament is full.');

  const existing = db.getParticipant.get(tid, interaction.user.id);
  if (existing) return interaction.editReply('You are already registered.');

  if (tournament.type === 'solo') {
    db.insertParticipant.run(tid, interaction.user.id, null);
    await refreshTournamentsEmbed(interaction.client);
    return interaction.editReply(`You joined **${tournament.name}**!`);
  }

  // Team tournament — prompt to use /player join for team selection
  return interaction.editReply(
    `This is a team tournament. Use \`/player join ${tid}\` to select which team to register.`,
  );
}

async function handleBracketButton(interaction, tournamentId) {
  await interaction.deferReply({ ephemeral: true });

  const tid = parseInt(tournamentId, 10);
  const tournament = db.getTournament.get(tid);
  if (!tournament) return interaction.editReply('Tournament not found.');

  const text = formatBracket(tid);
  const embed = new EmbedBuilder()
    .setTitle(`Bracket: ${tournament.name}`)
    .setDescription(text)
    .setColor(0x5865f2);

  return interaction.editReply({ embeds: [embed] });
}

async function handleStatusButton(interaction, tournamentId) {
  await interaction.deferReply({ ephemeral: true });

  const tid = parseInt(tournamentId, 10);
  const tournament = db.getTournament.get(tid);
  if (!tournament) return interaction.editReply('Tournament not found.');

  const participant = db.getParticipant.get(tid, interaction.user.id);
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

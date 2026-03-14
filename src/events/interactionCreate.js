const { Events } = require('discord.js');
const hostPanel = require('../handlers/hostPanel');
const tournaments = require('../handlers/tournaments');
const teamPanel = require('../handlers/teamPanel');

module.exports = {
  name: Events.InteractionCreate,
  async execute(interaction) {
    try {
      // --- Buttons ---
      if (interaction.isButton()) {
        return await routeButton(interaction);
      }

      // --- Select menus (string) ---
      if (interaction.isStringSelectMenu()) {
        return await routeStringSelect(interaction);
      }

      // --- Select menus (user) ---
      if (interaction.isUserSelectMenu()) {
        return await routeUserSelect(interaction);
      }

      // --- Modal submits ---
      if (interaction.isModalSubmit()) {
        return await routeModal(interaction);
      }
    } catch (error) {
      console.error(`Interaction error [${interaction.customId || interaction.type}]:`, error);
      const msg = { content: `Something went wrong: ${error.message}`, ephemeral: true };
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(msg).catch(() => {});
      } else {
        await interaction.reply(msg).catch(() => {});
      }
    }
  },
};

async function routeButton(interaction) {
  const id = interaction.customId;

  // Host panel
  if (id === 'host_create') return hostPanel.showCreateModal(interaction);
  if (id === 'host_edit') return hostPanel.showEditSelect(interaction);
  if (id === 'host_start') return hostPanel.showStartSelect(interaction);
  if (id === 'host_end') return hostPanel.showEndSelect(interaction);

  if (id === 'host_teams') return hostPanel.showAllTeams(interaction);
  if (id === 'host_edit_team') return hostPanel.showEditTeamSelect(interaction);
  if (id === 'host_manage_players') return hostPanel.showManagePlayersSelect(interaction);

  if (id.startsWith('host_edit_open:')) {
    return hostPanel.showEditModal(interaction, id.split(':')[1]);
  }
  if (id.startsWith('host_team_add:')) {
    return hostPanel.showTeamAddUser(interaction, id.split(':')[1]);
  }
  if (id.startsWith('host_team_kick:')) {
    return hostPanel.showTeamKickSelect(interaction, id.split(':')[1]);
  }
  if (id.startsWith('host_team_disband:')) {
    return hostPanel.handleTeamDisband(interaction, id.split(':')[1]);
  }

  if (id === 't_join') return tournaments.showJoinSelect(interaction);
  if (id === 't_participants') return tournaments.showParticipantsSelect(interaction);
  if (id === 't_status') return tournaments.showStatusSelect(interaction);
  if (id === 't_lft') return tournaments.showLftSelect(interaction);
  if (id === 't_lft_list') return tournaments.showLftListSelect(interaction);

  // Team panel
  if (id === 'team_create') return teamPanel.showCreateModal(interaction);
  if (id === 'team_my') return teamPanel.showMyTeams(interaction);

  if (id.startsWith('team_invite:')) {
    return teamPanel.showInviteUserSelect(interaction, id.split(':')[1]);
  }
  if (id.startsWith('team_kick:')) {
    return teamPanel.showKickSelect(interaction, id.split(':')[1]);
  }
  if (id.startsWith('team_leave:')) {
    return teamPanel.handleLeave(interaction, id.split(':')[1]);
  }
  if (id.startsWith('team_disband:')) {
    return teamPanel.handleDisband(interaction, id.split(':')[1]);
  }
  if (id.startsWith('team_accept:')) {
    return teamPanel.handleAccept(interaction, id.split(':')[1]);
  }
  if (id.startsWith('team_decline:')) {
    return teamPanel.handleDecline(interaction, id.split(':')[1]);
  }
}

async function routeStringSelect(interaction) {
  const id = interaction.customId;

  // Host selects
  if (id === 'host_edit_select') return hostPanel.handleEditSelect(interaction);
  if (id === 'host_start_select') return hostPanel.handleStart(interaction);
  if (id === 'host_end_select') return hostPanel.handleEnd(interaction);
  if (id === 'host_manage_tournament_select') return hostPanel.handleManageTournamentSelect(interaction);
  if (id.startsWith('host_remove_participant:')) {
    return hostPanel.handleRemoveParticipant(interaction, id.split(':')[1]);
  }

  // Player tournament selects
  if (id === 't_join_select') return tournaments.handleJoin(interaction);
  if (id === 't_participants_select') return tournaments.handleParticipantsSelect(interaction);
  if (id === 't_status_select') return tournaments.handleStatus(interaction);
  if (id === 't_lft_select') return tournaments.handleLftSelect(interaction);
  if (id === 't_lft_list_select') return tournaments.handleLftListSelect(interaction);

  if (id.startsWith('t_team_select:')) {
    return tournaments.handleTeamSelect(interaction, id.split(':')[1]);
  }

  // Host team selects
  if (id === 'host_team_select') return hostPanel.handleTeamSelect(interaction);
  if (id.startsWith('host_team_kick_select:')) {
    return hostPanel.handleTeamKick(interaction, id.split(':')[1]);
  }

  // Team selects
  if (id === 'team_action_select') return teamPanel.showTeamActions(interaction);

  if (id.startsWith('team_kick_select:')) {
    return teamPanel.handleKick(interaction, id.split(':')[1]);
  }
}

async function routeUserSelect(interaction) {
  const id = interaction.customId;

  if (id.startsWith('team_invite_user:')) {
    return teamPanel.handleInviteUser(interaction, id.split(':')[1]);
  }
  if (id.startsWith('host_team_add_user:')) {
    return hostPanel.handleTeamAddUser(interaction, id.split(':')[1]);
  }
}

async function routeModal(interaction) {
  const id = interaction.customId;

  if (id === 'modal_create_tournament') return hostPanel.handleCreateSubmit(interaction);
  if (id === 'modal_create_team') return teamPanel.handleCreateSubmit(interaction);

  if (id.startsWith('modal_edit_tournament:')) {
    return hostPanel.handleEditSubmit(interaction, id.split(':')[1]);
  }
}

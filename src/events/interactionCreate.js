const { Events } = require('discord.js');
const hostPanel = require('../handlers/hostPanel');
const tournaments = require('../handlers/tournaments');
const teamPanel = require('../handlers/teamPanel');
const config = require('../config');

const VERIFY_DENIED = 'You need to verify first — react ✅ in the how-it-works channel.';

function isVerified(interaction) {
  const member = interaction.member;
  if (!member) return false;
  if (member.roles?.cache) {
    return member.roles.cache.some(r => r.name === config.VERIFIED_ROLE_NAME);
  }
  if (Array.isArray(member.roles)) {
    const guild = interaction.guild;
    if (!guild) return false;
    return member.roles.some(roleId => {
      const role = guild.roles.cache.get(roleId);
      return role && role.name === config.VERIFIED_ROLE_NAME;
    });
  }
  return false;
}

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
  if (id === 'host_result') return hostPanel.showResultSelect(interaction);
  if (id === 'host_end') return hostPanel.showEndSelect(interaction);

  if (id.startsWith('host_edit_open:')) {
    return hostPanel.showEditModal(interaction, id.split(':')[1]);
  }
  if (id.startsWith('host_winner:')) {
    const parts = id.split(':');
    return hostPanel.handleWinner(interaction, parts[1], parts[2]);
  }

  // Tournament player actions (require Verified)
  if (id === 't_join' || id === 't_participants' || id === 't_status' ||
      id === 't_lft' || id === 't_lft_list' ||
      id === 'team_create' || id === 'team_my') {
    if (!isVerified(interaction)) {
      return interaction.reply({ content: VERIFY_DENIED, ephemeral: true });
    }
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
  if (id === 'host_result_select') return hostPanel.handleResultSelect(interaction);
  if (id === 'host_end_select') return hostPanel.handleEnd(interaction);

  // Player tournament selects
  if (id === 't_join_select') return tournaments.handleJoin(interaction);
  if (id === 't_participants_select') return tournaments.handleParticipantsSelect(interaction);
  if (id === 't_status_select') return tournaments.handleStatus(interaction);
  if (id === 't_lft_select') return tournaments.handleLftSelect(interaction);
  if (id === 't_lft_list_select') return tournaments.handleLftListSelect(interaction);

  if (id.startsWith('t_team_select:')) {
    return tournaments.handleTeamSelect(interaction, id.split(':')[1]);
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
}

async function routeModal(interaction) {
  const id = interaction.customId;

  if (id === 'modal_create_tournament') return hostPanel.handleCreateSubmit(interaction);
  if (id === 'modal_create_team') return teamPanel.handleCreateSubmit(interaction);

  if (id.startsWith('modal_edit_tournament:')) {
    return hostPanel.handleEditSubmit(interaction, id.split(':')[1]);
  }
}

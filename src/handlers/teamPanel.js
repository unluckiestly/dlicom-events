const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  UserSelectMenuBuilder,
  StringSelectMenuBuilder,
} = require('discord.js');
const db = require('../db');
const teamsHandler = require('./teams');
const { refreshTournamentsEmbed } = require('./tournaments');


// --- Button: Create Team → Modal ---

function showCreateModal(interaction) {
  const modal = new ModalBuilder()
    .setCustomId('modal_create_team')
    .setTitle('Create Team');

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('team_name')
        .setLabel('Team Name')
        .setStyle(TextInputStyle.Short)
        .setRequired(true),
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('team_size')
        .setLabel('Team Size (number of players)')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('2')
        .setRequired(true),
    ),
  );

  return interaction.showModal(modal);
}

async function handleCreateSubmit(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const name = interaction.fields.getTextInputValue('team_name').trim();
  const sizeStr = interaction.fields.getTextInputValue('team_size').trim();
  const size = parseInt(sizeStr, 10);

  if (!name) return interaction.editReply('Team name cannot be empty.');
  if (isNaN(size) || size < 2) return interaction.editReply('Team size must be at least 2.');

  const existing = db.getTeamByName.get(name);
  if (existing) return interaction.editReply('A team with that name already exists.');

  teamsHandler.createTeam(name, size, interaction.user.id);
  return interaction.editReply(`Team **${name}** (${size} players) created! You are the captain.`);
}

// --- Button: My Teams → Select menu ---

async function showMyTeams(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const teams = db.getTeamsByUser.all(interaction.user.id);
  if (teams.length === 0) {
    return interaction.editReply('You are not on any team. Use **Create Team** to make one.');
  }

  const row = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('team_action_select')
      .setPlaceholder('Select a team')
      .addOptions(teams.map(t => ({
        label: `${t.name} (${t.size} players)${t.captain_id === interaction.user.id ? ' ★' : ''}`,
        description: t.captain_id === interaction.user.id ? 'Captain' : 'Member',
        value: String(t.id),
      }))),
  );

  return interaction.editReply({ content: 'Your teams:', components: [row] });
}

// --- Select: Pick team → show info + actions ---

async function showTeamActions(interaction) {
  await interaction.deferUpdate();

  const teamId = parseInt(interaction.values[0], 10);
  const team = db.getTeam.get(teamId);
  if (!team) return interaction.editReply({ content: 'Team not found.', components: [] });

  const members = db.getTeamMembers.all(teamId);
  const memberList = members
    .map(m => `<@${m.user_id}> ${m.role === 'captain' ? '(Captain)' : ''}`)
    .join('\n');

  const embed = new EmbedBuilder()
    .setTitle(team.name)
    .setDescription(
      `**Size:** ${team.size} players\n` +
      `**Members (${members.length}/${team.size}):**\n${memberList}\n` +
      `**Created:** ${team.created_at}`,
    )
    .setColor(0x5865f2);

  const isCaptain = team.captain_id === interaction.user.id;
  const buttons = [
    new ButtonBuilder()
      .setCustomId(`team_leave:${teamId}`)
      .setLabel('Leave')
      .setStyle(ButtonStyle.Secondary),
  ];

  if (isCaptain) {
    buttons.unshift(
      new ButtonBuilder()
        .setCustomId(`team_invite:${teamId}`)
        .setLabel('Invite')
        .setStyle(ButtonStyle.Success),
    );
    if (members.length > 1) {
      buttons.push(
        new ButtonBuilder()
          .setCustomId(`team_kick:${teamId}`)
          .setLabel('Kick')
          .setStyle(ButtonStyle.Danger),
      );
    }
    buttons.push(
      new ButtonBuilder()
        .setCustomId(`team_disband:${teamId}`)
        .setLabel('Disband')
        .setStyle(ButtonStyle.Danger),
    );
  }

  const row = new ActionRowBuilder().addComponents(...buttons);

  return interaction.editReply({ content: '', embeds: [embed], components: [row] });
}

// --- Button: Invite → User select menu ---

async function showInviteUserSelect(interaction, teamId) {
  await interaction.deferUpdate();

  const team = db.getTeam.get(parseInt(teamId, 10));
  if (!team) return interaction.editReply({ content: 'Team not found.', components: [] });
  if (team.captain_id !== interaction.user.id) {
    return interaction.editReply({ content: 'Only the captain can invite.', components: [] });
  }

  const members = db.getTeamMembers.all(team.id);
  if (members.length >= team.size) {
    return interaction.editReply({ content: 'Team is full.', components: [] });
  }

  const row = new ActionRowBuilder().addComponents(
    new UserSelectMenuBuilder()
      .setCustomId(`team_invite_user:${team.id}`)
      .setPlaceholder('Select a user to invite')
      .setMinValues(1)
      .setMaxValues(1),
  );

  return interaction.editReply({ content: `Invite someone to **${team.name}**:`, embeds: [], components: [row] });
}

// --- User select: send DM invite ---

async function handleInviteUser(interaction, teamId) {
  await interaction.deferUpdate();

  const tid = parseInt(teamId, 10);
  const team = db.getTeam.get(tid);
  if (!team) return interaction.editReply({ content: 'Team not found.', components: [] });

  const targetId = interaction.values[0];
  if (targetId === interaction.user.id) {
    return interaction.editReply({ content: "You can't invite yourself.", components: [] });
  }

  const existing = db.getTeamMember.get(tid, targetId);
  if (existing) {
    return interaction.editReply({ content: 'That user is already on the team.', components: [] });
  }

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`team_accept:${tid}`)
      .setLabel('Accept')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`team_decline:${tid}`)
      .setLabel('Decline')
      .setStyle(ButtonStyle.Danger),
  );

  try {
    const target = await interaction.client.users.fetch(targetId);
    await target.send({
      content: `**${interaction.user.username}** invited you to join team **${team.name}** (${team.size} players).`,
      components: [row],
    });
    return interaction.editReply({ content: `Invite sent to <@${targetId}>.`, embeds: [], components: [] });
  } catch {
    return interaction.editReply({ content: 'Could not DM that user — they may have DMs disabled.', embeds: [], components: [] });
  }
}

// --- DM buttons: Accept / Decline ---

async function handleAccept(interaction, teamId) {
  await interaction.deferUpdate();

  const tid = parseInt(teamId, 10);
  const team = db.getTeam.get(tid);
  if (!team) return interaction.editReply({ content: 'Team no longer exists.', components: [] });

  const existing = db.getTeamMember.get(tid, interaction.user.id);
  if (existing) return interaction.editReply({ content: 'You are already on this team.', components: [] });

  const members = db.getTeamMembers.all(tid);
  if (members.length >= team.size) return interaction.editReply({ content: 'Team is full.', components: [] });

  teamsHandler.addMember(tid, interaction.user.id);

  // Add to all tournaments the team is registered in
  const teamTournaments = db.getTournamentsByTeam.all(tid);
  for (const { tournament_id } of teamTournaments) {
    const already = db.getParticipant.get(tournament_id, interaction.user.id);
    if (!already) {
      db.insertParticipant.run(tournament_id, interaction.user.id, tid);
    }
  }
  if (teamTournaments.length > 0) {
    await refreshTournamentsEmbed(interaction.client);
  }

  try {
    const captain = await interaction.client.users.fetch(team.captain_id);
    await captain.send(`**${interaction.user.username}** accepted the invite to **${team.name}**.`);
  } catch { /* DMs closed */ }

  return interaction.editReply({ content: `You joined **${team.name}**!`, components: [] });
}

async function handleDecline(interaction, teamId) {
  await interaction.deferUpdate();

  const tid = parseInt(teamId, 10);
  const team = db.getTeam.get(tid);

  try {
    if (team) {
      const captain = await interaction.client.users.fetch(team.captain_id);
      await captain.send(`**${interaction.user.username}** declined the invite to **${team.name}**.`);
    }
  } catch { /* DMs closed */ }

  return interaction.editReply({ content: 'Invite declined.', components: [] });
}

// --- Button: Kick → select menu of members ---

async function showKickSelect(interaction, teamId) {
  await interaction.deferUpdate();

  const tid = parseInt(teamId, 10);
  const team = db.getTeam.get(tid);
  if (!team) return interaction.editReply({ content: 'Team not found.', embeds: [], components: [] });
  if (team.captain_id !== interaction.user.id) {
    return interaction.editReply({ content: 'Only the captain can kick.', embeds: [], components: [] });
  }

  const members = db.getTeamMembers.all(tid).filter(m => m.user_id !== interaction.user.id);
  if (members.length === 0) {
    return interaction.editReply({ content: 'No members to kick.', embeds: [], components: [] });
  }

  const row = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`team_kick_select:${tid}`)
      .setPlaceholder('Select member to kick')
      .addOptions(members.map(m => ({
        label: m.user_id,
        description: m.role,
        value: m.user_id,
      }))),
  );

  return interaction.editReply({ content: `Kick a member from **${team.name}**:`, embeds: [], components: [row] });
}

async function handleKick(interaction, teamId) {
  await interaction.deferUpdate();

  const tid = parseInt(teamId, 10);
  const team = db.getTeam.get(tid);
  if (!team) return interaction.editReply({ content: 'Team not found.', components: [] });
  if (team.captain_id !== interaction.user.id) {
    return interaction.editReply({ content: 'Only the captain can kick.', components: [] });
  }

  const targetId = interaction.values[0];
  teamsHandler.removeMember(tid, targetId);

  try {
    const target = await interaction.client.users.fetch(targetId);
    await target.send(`You were kicked from team **${team.name}**.`);
  } catch { /* DMs closed */ }

  return interaction.editReply({ content: `<@${targetId}> kicked from **${team.name}**.`, components: [] });
}

// --- Buttons: Leave / Disband ---

async function handleLeave(interaction, teamId) {
  await interaction.deferUpdate();

  const tid = parseInt(teamId, 10);
  const team = db.getTeam.get(tid);
  if (!team) return interaction.editReply({ content: 'Team not found.', embeds: [], components: [] });

  const result = teamsHandler.removeMember(tid, interaction.user.id);
  const msgs = {
    disbanded: `You left **${team.name}** and it was disbanded (no members left).`,
    transferred: `You left **${team.name}**. Captaincy transferred.`,
    removed: `You left **${team.name}**.`,
  };

  return interaction.editReply({ content: msgs[result] || 'Done.', embeds: [], components: [] });
}

async function handleDisband(interaction, teamId) {
  await interaction.deferUpdate();

  const tid = parseInt(teamId, 10);
  const team = db.getTeam.get(tid);
  if (!team) return interaction.editReply({ content: 'Team not found.', embeds: [], components: [] });

  const result = teamsHandler.disbandTeam(tid, interaction.user.id);
  if (result === 'not_captain') {
    return interaction.editReply({ content: 'Only the captain can disband.', embeds: [], components: [] });
  }

  return interaction.editReply({ content: `Team **${team.name}** disbanded.`, embeds: [], components: [] });
}

module.exports = {
  showCreateModal,
  handleCreateSubmit,
  showMyTeams,
  showTeamActions,
  showInviteUserSelect,
  handleInviteUser,
  showKickSelect,
  handleKick,
  handleAccept,
  handleDecline,
  handleLeave,
  handleDisband,
};

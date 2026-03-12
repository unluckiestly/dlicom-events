const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');
const db = require('../db');
const teamsHandler = require('../handlers/teams');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('team')
    .setDescription('Team management commands')
    .addSubcommand(sub =>
      sub
        .setName('create')
        .setDescription('Create a new team')
        .addStringOption(opt =>
          opt.setName('name').setDescription('Team name').setRequired(true),
        )
        .addIntegerOption(opt =>
          opt
            .setName('size')
            .setDescription('Team size')
            .setRequired(true)
            .addChoices(
              { name: '2v2', value: 2 },
              { name: '3v3', value: 3 },
              { name: '5v5', value: 5 },
            ),
        ),
    )
    .addSubcommand(sub =>
      sub
        .setName('invite')
        .setDescription('Invite a player to your team')
        .addUserOption(opt =>
          opt.setName('user').setDescription('User to invite').setRequired(true),
        ),
    )
    .addSubcommand(sub =>
      sub.setName('leave').setDescription('Leave your current team'),
    )
    .addSubcommand(sub =>
      sub.setName('disband').setDescription('Disband your team (captain only)'),
    )
    .addSubcommand(sub =>
      sub
        .setName('info')
        .setDescription('View team info')
        .addStringOption(opt =>
          opt.setName('name').setDescription('Team name').setRequired(true),
        ),
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'create') return handleCreate(interaction);
    if (sub === 'invite') return handleInvite(interaction);
    if (sub === 'leave') return handleLeave(interaction);
    if (sub === 'disband') return handleDisband(interaction);
    if (sub === 'info') return handleInfo(interaction);
  },

  /** Handle invite accept/decline button presses */
  async handleInviteButton(interaction, action, teamId) {
    await interaction.deferUpdate();

    const team = db.getTeam.get(parseInt(teamId, 10));
    if (!team) {
      return interaction.followUp({ content: 'Team no longer exists.', ephemeral: true });
    }

    if (action === 'accept') {
      const existing = db.getTeamMember.get(team.id, interaction.user.id);
      if (existing) {
        return interaction.followUp({ content: 'You are already on this team.', ephemeral: true });
      }

      const members = db.getTeamMembers.all(team.id);
      if (members.length >= team.size) {
        return interaction.followUp({ content: 'Team is full.', ephemeral: true });
      }

      teamsHandler.addMember(team.id, interaction.user.id);

      // Notify captain
      try {
        const captain = await interaction.client.users.fetch(team.captain_id);
        await captain.send(`**${interaction.user.username}** accepted the invite to **${team.name}**.`);
      } catch { /* DMs closed */ }

      return interaction.editReply({
        content: `You joined **${team.name}**!`,
        components: [],
      });
    }

    if (action === 'decline') {
      // Notify captain
      try {
        const captain = await interaction.client.users.fetch(team.captain_id);
        await captain.send(`**${interaction.user.username}** declined the invite to **${team.name}**.`);
      } catch { /* DMs closed */ }

      return interaction.editReply({
        content: 'Invite declined.',
        components: [],
      });
    }
  },
};

async function handleCreate(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const name = interaction.options.getString('name');
  const size = interaction.options.getInteger('size');

  const existing = db.getTeamByName.get(name);
  if (existing) {
    return interaction.editReply('A team with that name already exists.');
  }

  teamsHandler.createTeam(name, size, interaction.user.id);
  return interaction.editReply(`Team **${name}** (${size}v${size}) created! You are the captain.`);
}

async function handleInvite(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const target = interaction.options.getUser('user');
  if (target.id === interaction.user.id) {
    return interaction.editReply("You can't invite yourself.");
  }

  // Find a team where the user is captain
  const teams = db.getTeamsByUser.all(interaction.user.id);
  const captainTeam = teams.find(t => t.captain_id === interaction.user.id);
  if (!captainTeam) {
    return interaction.editReply('You are not a captain of any team.');
  }

  const members = db.getTeamMembers.all(captainTeam.id);
  if (members.length >= captainTeam.size) {
    return interaction.editReply('Your team is full.');
  }

  // Send DM with accept/decline buttons
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`team_accept:${captainTeam.id}`)
      .setLabel('Accept')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`team_decline:${captainTeam.id}`)
      .setLabel('Decline')
      .setStyle(ButtonStyle.Danger),
  );

  try {
    await target.send({
      content: `**${interaction.user.username}** invited you to join team **${captainTeam.name}** (${captainTeam.size}v${captainTeam.size}).`,
      components: [row],
    });
    return interaction.editReply(`Invite sent to **${target.username}**.`);
  } catch {
    return interaction.editReply(`Could not DM ${target.username}. They may have DMs disabled.`);
  }
}

async function handleLeave(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const teams = db.getTeamsByUser.all(interaction.user.id);
  if (teams.length === 0) {
    return interaction.editReply('You are not on any team.');
  }

  const team = teams[0];
  const result = teamsHandler.removeMember(team.id, interaction.user.id);

  if (result === 'disbanded') {
    return interaction.editReply(`You left **${team.name}** and it was disbanded (no members remaining).`);
  }
  if (result === 'transferred') {
    return interaction.editReply(`You left **${team.name}**. Captaincy has been transferred.`);
  }
  return interaction.editReply(`You left **${team.name}**.`);
}

async function handleDisband(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const teams = db.getTeamsByUser.all(interaction.user.id);
  const captainTeam = teams.find(t => t.captain_id === interaction.user.id);
  if (!captainTeam) {
    return interaction.editReply('You are not a captain of any team.');
  }

  teamsHandler.disbandTeam(captainTeam.id, interaction.user.id);
  return interaction.editReply(`Team **${captainTeam.name}** has been disbanded.`);
}

async function handleInfo(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const name = interaction.options.getString('name');
  const team = db.getTeamByName.get(name);
  if (!team) {
    return interaction.editReply('Team not found.');
  }

  const members = db.getTeamMembers.all(team.id);
  const memberList = members
    .map(m => `<@${m.user_id}> ${m.role === 'captain' ? '(Captain)' : ''}`)
    .join('\n');

  const embed = new EmbedBuilder()
    .setTitle(team.name)
    .setDescription(
      `**Size:** ${team.size}v${team.size}\n` +
      `**Members (${members.length}/${team.size}):**\n${memberList}\n` +
      `**Created:** ${team.created_at}`,
    )
    .setColor(0x5865f2);

  return interaction.editReply({ embeds: [embed] });
}

const db = require('../db');

function createTeam(name, size, captainId) {
  const info = db.insertTeam.run({ name, size, captain_id: captainId });
  db.insertTeamMember.run(info.lastInsertRowid, captainId, 'captain');
  return info.lastInsertRowid;
}

function addMember(teamId, userId) {
  db.insertTeamMember.run(teamId, userId, 'member');
}

function removeMember(teamId, userId) {
  const team = db.getTeam.get(teamId);
  if (!team) return 'not_found';

  db.removeTeamMember.run(teamId, userId);

  // If the captain left, transfer or disband
  if (team.captain_id === userId) {
    const remaining = db.getTeamMembers.all(teamId);
    if (remaining.length === 0) {
      db.deleteTeam.run(teamId);
      return 'disbanded';
    }
    const newCaptain = remaining[0];
    db.updateTeamCaptain.run(newCaptain.user_id, teamId);
    db.updateTeamMemberRole.run('captain', teamId, newCaptain.user_id);
    return 'transferred';
  }
  return 'removed';
}

function disbandTeam(teamId, requesterId) {
  const team = db.getTeam.get(teamId);
  if (!team) return 'not_found';
  if (team.captain_id !== requesterId) return 'not_captain';
  db.deleteTeam.run(teamId);
  return 'disbanded';
}

module.exports = { createTeam, addMember, removeMember, disbandTeam };

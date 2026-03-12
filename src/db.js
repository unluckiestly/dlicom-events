const Database = require('better-sqlite3');
const path = require('node:path');

const db = new Database(path.join(__dirname, '..', 'tournaments.db'));

// Enable WAL mode for better concurrent read performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// --- Schema ---

db.exec(`
  CREATE TABLE IF NOT EXISTS tournaments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('solo', 'team')),
    format TEXT NOT NULL CHECK(format IN ('1v1', 'battle-royale')),
    max_participants INTEGER NOT NULL,
    end_date TEXT,
    status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'active', 'closed')),
    host_id TEXT NOT NULL,
    message_id TEXT,
    channel_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS teams (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    size INTEGER NOT NULL,
    captain_id TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS team_members (
    team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'member',
    joined_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (team_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS participants (
    tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL,
    team_id INTEGER REFERENCES teams(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'registered' CHECK(status IN ('registered', 'active', 'eliminated', 'winner')),
    registered_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (tournament_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS bracket_matches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
    round INTEGER NOT NULL,
    match_index INTEGER NOT NULL,
    participant_a TEXT,
    participant_b TEXT,
    winner TEXT,
    completed INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS bot_state (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

// --- Tournament queries ---

const insertTournament = db.prepare(`
  INSERT INTO tournaments (name, type, format, max_participants, end_date, host_id)
  VALUES (@name, @type, @format, @max_participants, @end_date, @host_id)
`);

const getTournament = db.prepare(`SELECT * FROM tournaments WHERE id = ?`);

const getOpenActiveTournaments = db.prepare(`
  SELECT t.*, COUNT(p.user_id) AS participant_count
  FROM tournaments t
  LEFT JOIN participants p ON p.tournament_id = t.id
  WHERE t.status IN ('open', 'active')
  GROUP BY t.id
  ORDER BY t.created_at DESC
`);

const updateTournamentStatus = db.prepare(`
  UPDATE tournaments SET status = ? WHERE id = ?
`);

// --- Participant queries ---

const insertParticipant = db.prepare(`
  INSERT INTO participants (tournament_id, user_id, team_id) VALUES (?, ?, ?)
`);

const getParticipant = db.prepare(`
  SELECT * FROM participants WHERE tournament_id = ? AND user_id = ?
`);

const getParticipantsByTournament = db.prepare(`
  SELECT * FROM participants WHERE tournament_id = ?
`);

const getParticipantCount = db.prepare(`
  SELECT COUNT(*) AS count FROM participants WHERE tournament_id = ?
`);

const updateParticipantStatus = db.prepare(`
  UPDATE participants SET status = ? WHERE tournament_id = ? AND user_id = ?
`);

// --- Team queries ---

const insertTeam = db.prepare(`
  INSERT INTO teams (name, size, captain_id) VALUES (@name, @size, @captain_id)
`);

const getTeam = db.prepare(`SELECT * FROM teams WHERE id = ?`);

const getTeamByName = db.prepare(`SELECT * FROM teams WHERE name = ?`);

const getTeamsByUser = db.prepare(`
  SELECT t.* FROM teams t
  JOIN team_members tm ON tm.team_id = t.id
  WHERE tm.user_id = ?
`);

const getTeamsByUserAndSize = db.prepare(`
  SELECT t.* FROM teams t
  JOIN team_members tm ON tm.team_id = t.id
  WHERE tm.user_id = ? AND t.size = ?
`);

const deleteTeam = db.prepare(`DELETE FROM teams WHERE id = ?`);

// --- Team member queries ---

const insertTeamMember = db.prepare(`
  INSERT INTO team_members (team_id, user_id, role) VALUES (?, ?, ?)
`);

const getTeamMembers = db.prepare(`
  SELECT * FROM team_members WHERE team_id = ?
`);

const getTeamMember = db.prepare(`
  SELECT * FROM team_members WHERE team_id = ? AND user_id = ?
`);

const removeTeamMember = db.prepare(`
  DELETE FROM team_members WHERE team_id = ? AND user_id = ?
`);

const updateTeamCaptain = db.prepare(`
  UPDATE teams SET captain_id = ? WHERE id = ?
`);

const updateTeamMemberRole = db.prepare(`
  UPDATE team_members SET role = ? WHERE team_id = ? AND user_id = ?
`);

// --- Bracket queries ---

const insertBracketMatch = db.prepare(`
  INSERT INTO bracket_matches (tournament_id, round, match_index, participant_a, participant_b)
  VALUES (?, ?, ?, ?, ?)
`);

const getBracketMatches = db.prepare(`
  SELECT * FROM bracket_matches WHERE tournament_id = ? ORDER BY round, match_index
`);

const getNextUncompletedMatch = db.prepare(`
  SELECT * FROM bracket_matches WHERE tournament_id = ? AND completed = 0 ORDER BY round, match_index LIMIT 1
`);

const updateMatchWinner = db.prepare(`
  UPDATE bracket_matches SET winner = ?, completed = 1 WHERE id = ?
`);

const getMatchById = db.prepare(`SELECT * FROM bracket_matches WHERE id = ?`);

const getMatchesByRound = db.prepare(`
  SELECT * FROM bracket_matches WHERE tournament_id = ? AND round = ? ORDER BY match_index
`);

const getRemainingMatches = db.prepare(`
  SELECT COUNT(*) AS count FROM bracket_matches WHERE tournament_id = ? AND completed = 0
`);

// --- Bot state queries ---

const getState = db.prepare(`SELECT value FROM bot_state WHERE key = ?`);

const setState = db.prepare(`
  INSERT INTO bot_state (key, value) VALUES (?, ?)
  ON CONFLICT(key) DO UPDATE SET value = excluded.value
`);

module.exports = {
  db,
  insertTournament,
  getTournament,
  getOpenActiveTournaments,
  updateTournamentStatus,
  insertParticipant,
  getParticipant,
  getParticipantsByTournament,
  getParticipantCount,
  updateParticipantStatus,
  insertTeam,
  getTeam,
  getTeamByName,
  getTeamsByUser,
  getTeamsByUserAndSize,
  deleteTeam,
  insertTeamMember,
  getTeamMembers,
  getTeamMember,
  removeTeamMember,
  updateTeamCaptain,
  updateTeamMemberRole,
  insertBracketMatch,
  getBracketMatches,
  getNextUncompletedMatch,
  updateMatchWinner,
  getMatchById,
  getMatchesByRound,
  getRemainingMatches,
  getState,
  setState,
};

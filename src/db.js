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
    format TEXT NOT NULL,
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

  CREATE TABLE IF NOT EXISTS lft (
    tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (tournament_id, user_id)
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

const updateTournament = db.prepare(`
  UPDATE tournaments SET name = @name, format = @format, max_participants = @max_participants, end_date = @end_date
  WHERE id = @id
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

// --- LFT queries ---

const insertLft = db.prepare(`
  INSERT OR IGNORE INTO lft (tournament_id, user_id) VALUES (?, ?)
`);

const removeLft = db.prepare(`
  DELETE FROM lft WHERE tournament_id = ? AND user_id = ?
`);

const getLftByTournament = db.prepare(`
  SELECT * FROM lft WHERE tournament_id = ?
`);

const getLft = db.prepare(`
  SELECT * FROM lft WHERE tournament_id = ? AND user_id = ?
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
  updateTournament,
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
  insertLft,
  removeLft,
  getLftByTournament,
  getLft,
  getState,
  setState,
};

const db = require('../db');

/**
 * Generate a single-elimination bracket from registered participants.
 * Shuffles participants, pairs them up, and inserts round-1 matches.
 * If odd count, last participant gets a bye (auto-advances).
 */
function generateBracket(tournamentId) {
  const participants = db.getParticipantsByTournament.all(tournamentId);
  if (participants.length < 2) return null;

  // Shuffle (Fisher-Yates)
  const shuffled = [...participants];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  // Determine participant identifier: team_id for team tournaments, user_id for solo
  const tournament = db.getTournament.get(tournamentId);
  const isSolo = tournament.type === 'solo';
  const ids = shuffled.map(p => isSolo ? p.user_id : String(p.team_id));

  // Mark all participants as active
  for (const p of participants) {
    db.updateParticipantStatus.run('active', tournamentId, p.user_id);
  }

  // Create round 1 matches
  const matches = [];
  for (let i = 0; i < ids.length; i += 2) {
    const a = ids[i];
    const b = ids[i + 1] || null; // bye
    const matchIndex = Math.floor(i / 2);

    db.insertBracketMatch.run(tournamentId, 1, matchIndex, a, b);

    // Auto-complete bye matches
    if (!b) {
      const inserted = db.getBracketMatches.all(tournamentId);
      const byeMatch = inserted.find(m => m.round === 1 && m.match_index === matchIndex);
      if (byeMatch) {
        db.updateMatchWinner.run(a, byeMatch.id);
      }
    }

    matches.push({ round: 1, matchIndex, a, b });
  }

  // Pre-create empty slots for subsequent rounds
  const totalRound1 = Math.ceil(ids.length / 2);
  let prevRoundCount = totalRound1;
  let round = 2;
  while (prevRoundCount > 1) {
    const thisRoundCount = Math.ceil(prevRoundCount / 2);
    for (let m = 0; m < thisRoundCount; m++) {
      db.insertBracketMatch.run(tournamentId, round, m, null, null);
    }
    prevRoundCount = thisRoundCount;
    round++;
  }

  return matches;
}

/**
 * After recording a match winner, advance them to the next round.
 */
function advanceWinner(tournamentId, match) {
  const allMatches = db.getBracketMatches.all(tournamentId);
  const nextRound = match.round + 1;
  const nextMatchIndex = Math.floor(match.match_index / 2);

  const nextMatch = allMatches.find(
    m => m.tournament_id === tournamentId && m.round === nextRound && m.match_index === nextMatchIndex,
  );

  if (!nextMatch) return; // This was the final

  // Slot into a or b depending on even/odd match_index
  if (match.match_index % 2 === 0) {
    db.db.prepare('UPDATE bracket_matches SET participant_a = ? WHERE id = ?').run(match.winner, nextMatch.id);
  } else {
    db.db.prepare('UPDATE bracket_matches SET participant_b = ? WHERE id = ?').run(match.winner, nextMatch.id);
  }

  // If opponent is already set and one side is a bye (null won't happen here), auto-complete
  const updated = db.getMatchById.get(nextMatch.id);
  if (updated.participant_a && !updated.participant_b) {
    // Only one participant — auto-advance (bye in later rounds if odd bracket)
    // Don't auto-complete; wait for the other match to finish
  }
}

/**
 * Format bracket matches into a readable text block.
 */
function formatBracket(tournamentId, client) {
  const matches = db.getBracketMatches.all(tournamentId);
  if (matches.length === 0) return 'No bracket generated yet.';

  const rounds = {};
  for (const m of matches) {
    if (!rounds[m.round]) rounds[m.round] = [];
    rounds[m.round].push(m);
  }

  const lines = [];
  for (const [round, roundMatches] of Object.entries(rounds)) {
    lines.push(`**Round ${round}**`);
    for (const m of roundMatches) {
      const a = m.participant_a || 'TBD';
      const b = m.participant_b || 'BYE';
      const winner = m.winner ? ` → Winner: ${m.winner}` : '';
      lines.push(`  Match ${m.match_index + 1}: ${a} vs ${b}${winner}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

module.exports = { generateBracket, advanceWinner, formatBracket };

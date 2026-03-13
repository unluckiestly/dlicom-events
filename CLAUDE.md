# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm start` — run the bot (`node src/index.js`)
- `npm run deploy` — clear guild slash commands (`node src/deploy.js`)
- `npm install` — install dependencies

No test suite exists. To reset the database, delete `tournaments.db` and restart.

## Architecture

Discord bot for tournament/event management using Discord.js v14 and better-sqlite3. **No slash commands** — all interaction is through persistent embeds with buttons, select menus, and modals.

### Event flow

1. **`src/index.js`** — creates Client, loads all files from `src/events/` as event listeners
2. **`src/events/ready.js`** — on startup, posts/updates persistent embeds (host panel in #staff, tournament list in #tournaments, verification guide in #how-it-works)
3. **`src/events/interactionCreate.js`** — central router that dispatches by `customId` prefix to handler functions. Checks `Verified` role before allowing player/team actions.
4. **`src/events/messageReactionAdd.js` / `messageReactionRemove.js`** — verification via ✅ reaction → grants/removes Verified role

### Handlers (src/handlers/)

| Handler | Responsibility |
|---|---|
| `hostPanel.js` | Host-only panel: create/edit/start/end tournaments, voice channel lifecycle |
| `tournaments.js` | Player-facing: join, participants list, status, LFT system |
| `teamPanel.js` | Team UI: create, invite (DM-based), kick, leave, disband |
| `teams.js` | Team DB operations (create, add/remove member, transfer captain) |
| `verification.js` | Verification guide embed + reaction role logic |
| `logger.js` | Color-coded log embeds to #logs channel |

### Persistent UI pattern

All main embeds (host panel, tournament list, verification guide) use an edit-or-create pattern: message IDs are stored in the `bot_state` table, and on startup the bot tries to edit the existing message before creating a new one.

### CustomId routing convention

- Buttons: `action` or `action:param` (e.g., `t_join`, `team_invite:123`)
- Select menus: `action_select` or `action_select:param`
- Modals: `modal_action` or `modal_action:param`

## Database

SQLite via better-sqlite3 with WAL mode and foreign keys ON. Schema defined inline in `src/db.js`. All queries are prepared statements exported from `db.js`.

Tables: `tournaments`, `teams`, `team_members`, `participants`, `lft`, `bot_state`.

Tournament statuses: `open` → `active` → `closed`. Participant statuses: `registered`, `active`, `eliminated`, `winner`.

## Configuration

- **`src/config.js`** — Discord channel IDs and role names (hardcoded per server)
- **`.env`** — `DISCORD_TOKEN`, `CLIENT_ID`, `GUILD_ID`

## Key conventions

- All interactions are deferred before processing (`deferReply({ ephemeral: true })` or `deferUpdate()`)
- Role checks (`isHost()`, `isVerified()`) handle both cached `GuildMemberRoleManager` and raw role ID arrays
- Voice channels are created per team when a team tournament starts, deleted when it ends
- Team invitations use DMs with Accept/Decline buttons
- Log embed colors: tournament=0x5865f2, team=0x3498db, player=0x57f287, moderation=0xed4245, verify=0xfee75c
- No bracket/seeding system — hosts manage matches manually

# ONE IN A KRILLION — Best Manager Edition

A mobile-first, seven-question, live multiplayer rarity game with host control, projector view, persistent SQLite results, manual review of unexpected answers, and CSV exports.

## Quick start
1. Install Node.js 20 or newer.
2. Run `npm install`.
3. Copy `.env.example` to `.env` and change HOST_PASSWORD and SESSION_SECRET.
4. Run `npm start` and visit http://localhost:3000.
5. Host: `/host`; Players: `/`; Projection: `/screen?pin=YOUR_PIN`.

Deploy this Node application to a host with persistent disk and HTTPS for an event. **GitHub Pages cannot run the server.**

## Event workflow
Host logs in and creates a room; contestants enter name, college and ID. The host runs seven timed questions. Known answers are scored automatically; unknown answers await manual host review. After the host finalizes each round, scores are revealed and rankings update. Host can export complete player scores and submissions and review historical games.

## Answer data and limitations
`questions.json` contains seven seed questions and two tie-breakers. **These are editorial starter lists, not comprehensive externally verified datasets.** Seed rarity scores are estimates, not measured survey frequencies. This version does not automatically browse external databases or use live AI to score unexpected answers: it uses human host review.

## Testing and security
Run `npm test` to test scoring. Rehearse with multiple phones before using the game for actual awards. Keep host credentials secret, use HTTPS for deployment, and back up the SQLite file. Server enforces timed submissions and one immutable answer per player per question.

## URLs
- `/`: player
- `/host`: host and results
- `/screen?pin=123456`: projector
- `/api/health`: health

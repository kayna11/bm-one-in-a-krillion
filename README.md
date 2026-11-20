# KRILLION — Best Manager Dive

A Krillion-inspired, **self-paced**, seven-question rarity game for a college Best Manager round.

## How it works

1. The organiser opens `/host`, signs in, and clicks **Generate new game PIN**.
2. Players visit the website, enter the PIN, name, college and registration ID.
3. **Each player advances through all seven questions at their own pace**. No host-driven timer, round controls or reveal button.
4. Recognised answers immediately reveal the rarity tier and points (10, 15, 30, 60, 85 or 100), and the participant can continue instantly.
5. Answers missing from the curated bank are saved as **Pending Review**, allowing the player to continue. Host review adjusts their scores automatically.
6. After question seven, players receive a detailed seven-round scorecard and a leaderboard of completed players.
7. The host can check scores, contestant progress and individual submissions at any time, and download CSV reports.

## Visual style

Original retro pixel-art ocean-dive theme, using the classic rare-answer diving concept as inspiration. No copied game art or proprietary assets.

## Deploying to Railway

The project uses Node.js 20+, Express, Socket.IO and SQLite.

Set the following Railway environment variables:

```
NODE_ENV=production
HOST_PASSWORD=(your private strong password)
SESSION_SECRET=(random secret of at least 32 characters)
DATABASE_PATH=/data/game.sqlite
```

Attach a **persistent Railway Volume** at `/data`. If a persistent disk is not mounted, scores may be lost when the service is rebuilt or redeployed.

Build: `npm install`
Start: `npm start`

### Routes
- `/` – mobile-first player game
- `/host` – organiser dashboard (new PIN, all results, pending reviews, CSV exports)
- `/screen?pin=123456` – optional passive results display
- `/api/health` – health endpoint

## Important limitations before competition use

- Answer banks in `questions.json` are **small curated seeds**, not exhaustive verified datasets or survey-based rarity measures. Expand and verify them before running a serious competition.
- Unknown answers are **not automatically checked by an external AI**. They need human organiser review. Player scores remain provisional until the host completes reviews.
- A registered player can continue on the original browser using their saved session; self-service recovery onto another device is not implemented.
- The base game uses 7 main questions. Extra tie-breaker questions are stored in the dataset but not part of the self-paced player flow.
- The host scoreboard shows every participant, including players who have not yet completed all seven questions. Ranking should be considered provisional while games are active.
- The app should be load-tested with your expected number of contestants before the event.

## Development

```sh
npm install
npm test
npm start
```

Example questions and starter rarity estimates may be edited in `questions.json` before the database is first created. After initial launch, existing question data lives in SQLite; changing the JSON file alone will not update a populated database.

## Data privacy

Only the password-protected host dashboard shows individual submissions, registration IDs and complete results exports. The optional presentation board and player leaderboard show publicly visible player names, colleges and totals of completed participants.

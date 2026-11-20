# KRILLION — Clean Rebuild (v2)

A self-paced seven-question game for Best Manager competitions. **This is a new application**, stored in `v2/` and launched by the root `npm start` command. The old version remains as unused source files for reference only.

## How to play

1. Host opens `/host` and logs in with `HOST_PASSWORD`.
2. Host clicks **Generate New Game PIN**.
3. Host shares the resulting link or six-digit PIN.
4. Each participant enters **Full Name** and **PRO Number** (no college field).
5. Each participant answers all seven questions **at their own pace**. There is no timer, no host-led reveal, and no waiting for other participants.
6. Recognised answers receive an immediate rarity-tier score.
7. Answers outside the starter database are marked **Pending Review**; the player moves on, and the organiser can award points later.
8. On completion, the participant sees their question-by-question scorecard. The organiser sees every participant's scores and submissions at any time, and can export CSV.

## How to deploy on Railway

- GitHub source: `kayna11/bm-one-in-a-krillion`, branch `main`
- Install/build: `npm install` (the new runtime has **zero external dependencies**)
- Start command: `npm start`
- Runtime: Node.js 20+
- Required environment variables:
  - `NODE_ENV=production`
  - `HOST_PASSWORD` — a private strong organiser password
  - `SESSION_SECRET` — a private random value of **32+ characters**
  - `DATABASE_PATH=/data/krillion-v2.json` — only after attaching a Railway volume at `/data`

**Important:** The new game stores data as JSON, **not SQLite**. Never point `DATABASE_PATH` to an old `.sqlite` file. Without a persistent volume, game PINs and results may be lost on deployment.

## Pages

- `/` – player registration and game.
- `/host` – organiser PIN generator, participant scoreboard, review and exports.
- `/api/health` – expected response: `{"ok":true,"version":2,"mode":"self-paced"}`.

## Tests

Run `npm test`. The test starts the **real Node server** and verifies host login, PIN creation, registration, seven consecutive answers, instant scoring, unfamiliar-answer review, CSV export, and state surviving a server restart.

## Before the actual fest

- Test using several real mobile devices and inspect the Railway logs.
- Expand and verify the answer bank in `questions.json`. The included lists are **limited editorial examples**, not exhaustive verified databases or survey-measured rarity frequencies.
- Keep the Railway volume backed up and keep organiser credentials private.
- Unknown answers still need human review, which can change final rankings.

## Why rebuild?

The old application combined Express, Socket.IO, SQLite and several incremental gameplay patches. This replacement uses a single Node HTTP server and standalone player/host scripts with no third-party runtime packages, reducing deployment and browser startup dependencies.

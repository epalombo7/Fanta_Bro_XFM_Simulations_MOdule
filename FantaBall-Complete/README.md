# FantaBall — consolidated handover

This package reconstructs and consolidates the app source, skills and instructions created in the conversation. Earlier generated archives were not available in this execution session. This is a reconstructed handover, not a byte-for-byte copy of those archives.

## Contents
- mobile/: Expo WebView wrapper and functional mobile-web demo.
- server/: optional Claude chat server with server-side credentials.
- skills/: ten SKILL.md contracts covering configuration, forecasts, calendar, prices, Monte Carlo, alternatives, updates, validation and both chat modes.
- docs/: portable Claude project instructions, original project context, model, design, production architecture, monetization and deployment guides.
- tests/: engine tests (`node tests/engine.test.js`).
- pipeline/ and data/: downloaders for every data source (history from 2015-16) and calibration scripts; see data/README.md. `python pipeline/update.py` refreshes everything; no API keys needed.

## Quick preview
From mobile/ run `python -m http.server 8080`, then open http://localhost:8080/assets/index.html . Or open the HTML directly; local storage/network behaviour can differ with file URLs.

## Mobile build
From mobile/: `npm install` and `npm start` (this first runs `npm run build:webview`, which inlines `assets/engine.js` into the generated `assets/webview.html` loaded by the app). Targets Expo SDK 54; use compatible Expo Go/development build or upgrade dependencies together. Native wrapper and network/keyboard/accessibility behaviour require device testing.

## AI chat
From bundle root: `pip install -r server/requirements.txt`. Set ANTHROPIC_API_KEY and ANTHROPIC_MODEL in your server environment. Run `uvicorn server.main:app --host 0.0.0.0 --port 8000`. Set the reachable development server URL in the demo settings. Configure DEV_ALLOWED_ORIGINS for the browser origin. Never expose this development server publicly without authentication, quotas, HTTPS and authoritative state validation.

Customers should not enter provider keys or server URLs in production: configure your hosted endpoint in the app and keep all AI credentials server-side. See docs/PRODUCTION.md.

## What is executable
`mobile/assets/engine.js` is the only copy of the simulation engine; the web page loads it and the Expo build inlines it. It is a team-based, match-by-match Monte Carlo of the remaining calendar (20 synthetic clubs, double round robin): availability (injuries, yellow/red suspensions), lineups chosen by competition for formation slots, substitutions and minutes, match scores from team attack/defence and home advantage, goals and assists handed to the players on the pitch, and votes driven by the match result, goal difference, a shared team-performance shock, goals/assists and goals conceded. Outputs per player: xFM (mean fantavoto per rated game) with a P10–P90 band, rated appearances with a band, expected season points, average vote, goals, assists, integrità and titolarità. The simulation does not compute prices.

**Two modules.** `runSeason` plays the remaining season N times and records what happened (minutes, starts, votes for every provider, goals, penalties, own goals, assists, cards, conceded, clean sheets) with no league rules involved; `serializeSeason` saves it as a season file. `scoreSeason` reads that record and turns it into xFM under any league's rules, in a fraction of a second, so changing the rules never needs a new simulation (`simulate` = both in one go). From the command line: `pipeline/run_season.js` and `pipeline/score_season.js`.

**League rules are settings.** Every scoring rule is an input: goal bonus per role, assist, penalty scored / missed / saved, own goal, yellow, red, goals conceded, clean-sheet bonus per role, fantavoto for sent-off or booked players without a vote, defence-modifier bands and minimum defenders, vote provider and Classic/Mantra. The app's setup form is pre-filled with a standard Fantacalcio Classic set (`RULES` in engine.js) and can be edited at any time ("Edit league and scoring rules"); every simulation re-runs with the user's rules. In code: `simulate({...league, rules: {...}}, {N, league, model})`, where `model` overrides any calibrated setting in `MODEL`. The app also has search/role filter, a budget and purchase ledger, opponent purchases, undo, squad summary and contextual chat. Offline chat is rules-based, not AI.

## Important limits
The app still simulates synthetic demo players and clubs: the real-data pipeline (pipeline/, data/) is in place and calibrates injuries, but the engine is not yet fed real players. No licensed data feed is included. No price model (removed from the simulation; to be rebuilt separately); the defence modifier is computed per team and as a function for lineups, but no lineup optimizer uses it yet; Mantra roles are carried but lineups use Classic roles; no formation optimizer, production database, auth, cloud sync, scheduled weekly automation, fully calibrated forecasting, subscription billing or app-store release is included. Model constants in `MODEL` (engine.js) are assumptions until fitted on real data; injury settings are calibrated by pipeline/calibrate_injuries.py. Skills specify the intended production behaviour beyond this demo's functionality.

The original Fanta_VOR.xlsx was a separate uploaded project file. Its binary was not available for inclusion here; upload it separately as legacy context if wanted.

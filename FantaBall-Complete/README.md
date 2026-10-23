# FantaBall — consolidated handover

This package reconstructs and consolidates the app source, skills and instructions created in the conversation. Earlier generated archives were not available in this execution session. This is a reconstructed handover, not a byte-for-byte copy of those archives.

## Contents
- mobile/: Expo WebView wrapper and functional mobile-web demo.
- server/: optional Claude chat server with server-side credentials.
- skills/: ten SKILL.md contracts covering configuration, forecasts, calendar, prices, Monte Carlo, alternatives, updates, validation and both chat modes.
- docs/: portable Claude project instructions, original project context, model, design, production architecture, monetization and deployment guides.
- tests/: engine tests (`node tests/engine.test.js`).

## Quick preview
From mobile/ run `python -m http.server 8080`, then open http://localhost:8080/assets/index.html . Or open the HTML directly; local storage/network behaviour can differ with file URLs.

## Mobile build
From mobile/: `npm install` and `npm start` (this first runs `npm run build:webview`, which inlines `assets/engine.js` into the generated `assets/webview.html` loaded by the app). Targets Expo SDK 54; use compatible Expo Go/development build or upgrade dependencies together. Native wrapper and network/keyboard/accessibility behaviour require device testing.

## AI chat
From bundle root: `pip install -r server/requirements.txt`. Set ANTHROPIC_API_KEY and ANTHROPIC_MODEL in your server environment. Run `uvicorn server.main:app --host 0.0.0.0 --port 8000`. Set the reachable development server URL in the demo settings. Configure DEV_ALLOWED_ORIGINS for the browser origin. Never expose this development server publicly without authentication, quotas, HTTPS and authoritative state validation.

Customers should not enter provider keys or server URLs in production: configure your hosted endpoint in the app and keep all AI credentials server-side. See docs/PRODUCTION.md.

## What is executable
`mobile/assets/engine.js` is the only copy of the simulation engine; the web page loads it and the Expo build inlines it. It is a team-based, match-by-match Monte Carlo of the remaining calendar (20 synthetic clubs, double round robin): availability (injuries, yellow/red suspensions), lineups chosen by competition for formation slots, substitutions and minutes, match scores from team attack/defence and home advantage, goals and assists handed to the players on the pitch, and votes driven by the match result, goal difference, a shared team-performance shock, goals/assists and goals conceded. Outputs per player: xFM (mean fantavoto per rated game) with a P10–P90 band, rated appearances with a band, expected season points, average vote, goals, assists, integrità and titolarità. The simulation does not compute prices. The app also has search/role filter, a budget and purchase ledger, opponent purchases, undo, squad summary and contextual chat. Offline chat is rules-based, not AI.

## Important limits
ALL demo names, teams, fixtures, injury inputs and forecasts are synthetic. No verified Serie A list or licensed data feed is included. No price model (removed from the simulation; to be rebuilt separately), no defence modifier, penalties, own-goal maluses, Mantra, formation optimizer, production database, auth, cloud sync, weekly automation, calibrated forecasting, subscription billing or app-store release is included. All model constants in `MODEL` (engine.js) are assumptions until fitted on real data. Skills specify the intended production behaviour beyond this demo's functionality.

The original Fanta_VOR.xlsx was a separate uploaded project file. Its binary was not available for inclusion here; upload it separately as legacy context if wanted.

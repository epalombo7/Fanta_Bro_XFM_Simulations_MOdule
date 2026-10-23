# FantaBall — consolidated handover

This package reconstructs and consolidates the app source, skills and instructions created in the conversation. Earlier generated archives were not available in this execution session. This is a reconstructed handover, not a byte-for-byte copy of those archives.

## Contents
- mobile/: Expo WebView wrapper and functional mobile-web demo.
- server/: optional Claude chat server with server-side credentials.
- skills/: ten SKILL.md contracts covering configuration, forecasts, calendar, prices, Monte Carlo, alternatives, updates, validation and both chat modes.
- docs/: portable Claude project instructions, original project context, model, design, production architecture, monetization and deployment guides.
- tests/: demo engine smoke tests.

## Quick preview
From mobile/ run `python -m http.server 8080`, then open http://localhost:8080/assets/index.html . Or open the HTML directly; local storage/network behaviour can differ with file URLs.

## Mobile build
From mobile/: `npm install` and `npx expo start`. Targets Expo SDK 54; use compatible Expo Go/development build or upgrade dependencies together. Native wrapper and network/keyboard/accessibility behaviour require device testing.

## AI chat
From bundle root: `pip install -r server/requirements.txt`. Set ANTHROPIC_API_KEY and ANTHROPIC_MODEL in your server environment. Run `uvicorn server.main:app --host 0.0.0.0 --port 8000`. Set the reachable development server URL in the demo settings. Configure DEV_ALLOWED_ORIGINS for the browser origin. Never expose this development server publicly without authentication, quotas, HTTPS and authoritative state validation.

Customers should not enter provider keys or server URLs in production: configure your hosted endpoint in the app and keep all AI credentials server-side. See docs/PRODUCTION.md.

## What is executable
Synthetic player database, search/role filter, actual fixture-aware Monte Carlo, price bands, appearance estimates and xFM, budget and purchase ledger, opponent exclusion, confirmation/undo, squad summary and contextual chat. Offline chat is rules-based, not AI. Optional Claude integration requires your server credentials.

## Important limits
ALL demo names, teams, fixtures, injury inputs and forecasts are synthetic. No verified Serie A list or licensed data feed is included. No defence modifier, Mantra, formation optimizer, production database, auth, cloud sync, weekly automation, calibrated forecasting, subscription billing or app-store release is included. Prices use a simplified positive-VOR allocation, not optimized squad marginal value. Alternative screening is not full package optimization. Simulations do not make independently drawn player goals coherent with team totals. Skills specify the intended production behaviour beyond this demo's functionality.

The original Fanta_VOR.xlsx was a separate uploaded project file. Its binary was not available for inclusion here; upload it separately as legacy context if wanted.

# FantaBall app — to-do list

Goal: the **phone app** (`mobile/`, Expo, engine in a webview) with four sections:
**Players** (event chances next to xFM) · **My team** (import by picking players) · **League rules** (how scoring works)
· **Next round** (best lineup, expected score, chance of each number of fantasy goals).

What already exists and is reused:
- the engine already simulates goals, assists, yellow and red cards per player per draw, and scores any rules
  (`mobile/assets/engine.js`: `RULES`, `leagueRules`, `scoreMatchdays`, outcome counts);
- the Giornata page (`pipeline/page/`), the stored squads (`data/teams/my_teams.json`);
- the lineup optimiser (`pipeline/best_lineup.js`), the head-to-head preview (`pipeline/match_preview.js`) and the
  counter-lineup search (`pipeline/counter_lineup.js`) — today run by hand in a session.

---

## 1 · Event chances separate from xFM (Players section)

- [ ] Per player for the next round, from the simulation (not derived from xFM):
  chance to **score** (≥ 1 goal, penalties included), chance of an **assist**, chance of a **yellow**, chance of a
  **red**; plus chance of a clean sheet (P, D), penalty scored / missed / saved (P).
- [ ] Compute them as exact shares of the 15,000 recorded seasons from the outcome counts (module 1 already stores
  them); add the columns to `matchday_xfm_latest.csv.gz` and to the page data.
- [ ] Show **xFM split into its parts**: base vote + goals + assists − cards + clean sheet (+ keeper goals conceded),
  so the reader sees where a player's number comes from.
- [ ] Page: new columns and sorts (% gol, % assist, % giallo, % rosso), filter "probable scorers"; in the player
  sheet a small bar per event. Keep the bookmakers' goal % next to the model's.
- [ ] Check calibration on the backtest and on each live round (`pipeline/evaluate_round.py`): forecast 20% scorers
  should score about 20% of the time; same for cards. Cards are not checked yet.

## 2 · My team: import by picking players

- [ ] Player picker: search by name / club, tap to add; role counts shown live (the league's squad numbers, default
  3 P · 8 D · 8 C · 6 A); warns when a role is full.
- [ ] Several teams per person, each with a name and its league rules (section 3).
- [ ] **Private on each phone** (decided): stored on the device only (app storage), nothing sent to a server. Export /
  import as a short code or file to move a team to another phone or send it to Claude. Seed with the two stored squads.
- [ ] Flag players who left Serie A or changed club when the weekly price list updates.

## 3 · League rules: every usual Fantacalcio Classic option (no Mantra), set by the user

Scoring (each value editable; "by role" = separate value for P, D, C, A):
- [ ] Goal, by role (standard +3) · penalty scored (often its own value, e.g. +2.5 or +3) · penalty missed (−3) ·
  penalty saved (P, +3) · own goal (−2)
- [ ] Assist (+1) · assist from a set piece (often a separate value) · *needs data: the votes we download record
  assists without saying which were from a set piece — check Fantacalcio's pages; until then one value for both*
- [ ] Yellow (−0.5) · red (−1)
- [ ] Keeper: per goal conceded (−1) · clean sheet / imbattibilità (+1; optionally also for defenders)
- [ ] Decisive goal: winning goal and equalising goal bonuses (off by default) · *engine work: record the order of
  goals in each simulated match so the winning / equalising scorer is known*
- [ ] Player of the match (Fantacalcio's "migliore in campo"; the votes data has it) · *engine work: simulate it*
- [ ] Captain modifier: bonus / malus by the captain's vote (the user picks a captain and a vice) · *engine work*
- [ ] Vote provider: Fantacalcio / Statistico / Italia
- [ ] No vote (s.v.): substitute the player, or give an official vote (and from how many minutes); keeper without a
  vote; booked or sent-off player without a vote

Lineup:
- [ ] Defence modifier on / off, its bands (default average ≥ 6 +1, ≥ 6.5 +3, ≥ 7 +6) and minimum defenders
- [ ] Allowed formations · cambio modulo on / off · number of substitutions (3 / 5 / unlimited) · substitutions role
  for role or free · bench size and order
- [ ] Home advantage (fattore campo): +0.5 to +5 to the home side of the fantasy match, off by default

Match:
- [ ] **Fantasy goal thresholds set by the user** (decided): first goal at (default 66), one more every (default 6);
  optional half-goal / custom bands
- [ ] Presets: Classic standard, Febbre da Rabiot's league, the second team's league; one-line help per field
- [ ] Every number in the app follows the chosen rules (xFM, ranges, expected points, lineup): module 2 runs on the
  phone from the per-draw data (section 5)

## 4 · Next round: best lineup and expected score

- [ ] Pick a team → the page proposes the **best 11, formation and bench order** under its league's rules
  (defence modifier, cambio modulo, substitutions), with the expected score and its middle-50% range.
- [ ] **Fantasy goals**: chance of scoring 0, 1, 2, 3, 4+ goals (from the simulated draws, not from the average).
- [ ] Optional opponent: paste or pick their lineup → chance of win / draw / loss and the counter-lineup that
  maximises match points.
- [ ] Late news: mark a player out → recompute at once.
- [ ] Explain each choice in one line (e.g. "Dybala starts: if he misses, Adams comes in").

## 5 · Data and engine work the sections need

- [ ] **Per-draw data on the phone.** Sections 3–4 need each player's simulated outcomes per draw (vote, goals,
  assists, cards, goals conceded, and for the new rules: goal order, player of the match), so any rules and any lineup
  can be scored on the device. 603 players × 15,000 draws is too big to download weekly: ship a packed sample (e.g.
  2,000 draws, a few MB, the same draws for every player so correlations hold), check its noise against the full run.
- [ ] Weekly download: the Friday run publishes the data file (e.g. to the GitHub repo); the app fetches it on open
  and keeps the last one offline. Team and rules never leave the phone.
- [ ] Move the lineup search from `best_lineup.js` into the engine (shared by page and pipeline); keep it fast on a
  phone (pre-rank by expected points, simulate the best few hundred).
- [ ] Tests: rules form → engine (every field changes the score as expected), optimiser vs the Node version,
  page under 16 MB and usable on a phone.

## 6 · Decisions (6 November 2026)

1. **Phone app** (Expo, `mobile/`), not the web page. The Giornata web page stays as the weekly share link.
2. **Teams private on each phone.**
3. **Rules:** all usual Fantacalcio Classic options (section 3); **no Mantra**.
4. **Fantasy goal thresholds set by each user.**

Still open: a phone to test the Expo build on (iPhone / Android), and whether the app is distributed through
Expo Go, TestFlight or a store.

## Prototype (6 November 2026, giornata 11)

Web prototype of the four sections, from the existing season file (no new simulation): `pipeline/page/build_app_data.js`
→ `pipeline/page/assemble_app.py` (template `app_template.html`). Player chances and xFM under any rules come from the
exact outcome counts (15,000 seasons); lineup, fantasy goals and opponent use the 255 complete simulated rounds stored in
the season file (about ±0.5 points of noise). Teams and rules stay in the phone's browser storage. Lineup criteria: average points, fantasy goals, one-sided risk (downside semivariance when cautious, upside when bold —
plain variance was dropped because it rewarded extra downside), chance of reaching a target score, and match points
against a chosen opponent. The round is re-simulated for the app with 2,550 complete matchdays (10 × 255, bootstrap
refits: `build_app_data.js --draws`), noise about ±0.25 points. Not yet: decisive goals, player of the match,
set-piece assist; weekly automatic data for the Expo app.

## Suggested order

1 (event chances, small) → 5 (per-draw data file + weekly download) → 3 (rules form, then the new engine rules:
decisive goals, player of the match, captain) → 2 (team import) → 4 (best lineup and fantasy goals) → opponent and
late news → test on a real phone.

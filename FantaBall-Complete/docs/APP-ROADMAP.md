# FantaBall app — to-do list

Goal: one page (the Giornata page, later the phone app) with four sections:
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

- [ ] Player picker: search by name / club, tap to add; role counts shown live (3 P · 8 D · 8 C · 6 A, or the
  league's own numbers); warns when a role is full or a player is in no squad list.
- [ ] Several teams per person, each with a name and its league (rules from section 3).
- [ ] Storage: on the device (works offline, private) plus **export / import as a short code or file**, so a team can
  be moved to another phone or sent to Claude. Seed with the two stored squads.
- [ ] Auto-flag players who left Serie A or changed club when the weekly price list updates.
- [ ] Decide: shared storage so friends see each other's teams? (needs the page's shared database; see Decisions).

## 3 · League rules (how scoring works)

- [ ] Form over every rule the engine supports: bonus per goal by role, assist, penalty scored / missed / saved,
  own goal, yellow, red, keeper per goal conceded, clean sheet by role (imbattibilità), fantavoto of a sent-off /
  booked player without a vote, vote provider (Fantacalcio / Statistico / Italia).
- [ ] Lineup rules: **defence modifier** on/off and its bands, **cambio modulo** on/off, allowed formations, number of
  substitutions, bench size.
- [ ] Match rules: fantasy goal thresholds (66 = 1 goal, +1 every 6 by default), optional "goal at 60/64", home bonus.
- [ ] Presets: Classic standard, the two current leagues; validate and explain each field in one line.
- [ ] Every number on the page follows the chosen rules (xFM, ranges, expected points): module 2 must run in the
  page. Today the page carries numbers under the standard rules only.

## 4 · Next round: best lineup and expected score

- [ ] Pick a team → the page proposes the **best 11, formation and bench order** under its league's rules
  (defence modifier, cambio modulo, substitutions), with the expected score and its middle-50% range.
- [ ] **Fantasy goals**: chance of scoring 0, 1, 2, 3, 4+ goals (from the simulated draws, not from the average).
- [ ] Optional opponent: paste or pick their lineup → chance of win / draw / loss and the counter-lineup that
  maximises match points.
- [ ] Late news: mark a player out → recompute at once.
- [ ] Explain each choice in one line (e.g. "Dybala starts: if he misses, Adams comes in").

## 5 · Data and engine work the sections need

- [ ] **Per-draw data in the page.** Sections 3–4 need each player's simulated outcomes per draw (vote, goals,
  assists, cards, goals conceded), so any rules and any lineup can be scored in the browser. 603 players × 15,000
  draws is too big for a page: ship a packed sample (e.g. 2,000 draws ≈ a few MB, the same draws for every player so
  correlations hold) and check its noise against the full run.
- [ ] Move the lineup search from `best_lineup.js` into the engine (shared by page and pipeline); keep it fast on a
  phone (pre-rank by expected points, simulate the best few hundred).
- [ ] Weekly run (Friday) publishes the new page data automatically.
- [ ] Tests: rules form → engine (every field changes the score as expected), optimiser vs the Node version,
  page under 16 MB and usable on a phone.

## 6 · Decisions needed from you

1. **Where it lives:** the web page (link you can share, works today) or the phone app (Expo build, `mobile/`)?
   Recommended: web page first, app later from the same engine.
2. **Who sees teams:** each person on their own device, or a shared list visible to friends?
3. **Other leagues' rules** you want as presets (send the rule pages or screenshots).
4. **Fantasy goal thresholds** in your leagues, if not 66 + 6.

## Suggested order

1 (event chances, small) → 3 (rules form) → 5 (per-draw data in the page) → 2 (team import) → 4 (best lineup and
goals) → opponent and late news.

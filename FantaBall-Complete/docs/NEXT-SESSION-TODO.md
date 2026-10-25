# FantaBall — to-do for the next session

State at the end of the session on 25 October 2026 (branch `claude/confident-galileo-knceb5`).

## 1. Finish what was started

- [x] **Run 20,000 simulated seasons, discard the first 5,000** — done; matchday intervals use all 15,000 (outcome counts).
- [ ] **Check the first Friday run (30 October, 07:38 Rome)**: that the scheduled session can clone and push the repo, and how long
  it takes once it runs 20,000 seasons.
- [ ] **Update the diagram and the workbook** for the two-module engine, correlations, matchday scoring and middle-50% bands.

## 2. What I need from you

- [ ] **`ODDS_API_KEY`** in the environment settings (Network secrets / API credentials) — then add odds to team strength.
- [ ] **Your league's rules**, if not the standard Classic defaults: vote provider, defence modifier, bonuses, Classic or Mantra.
- [ ] **Your league settings**: participants, budget, squad slots — needed for a squad-level backtest and a lineup optimizer.
- [ ] **Your squad** (or the auction ledger when it happens), for lineup and hedging advice from the correlation matrices.
- [ ] Optional: a **published projection export** (e.g. FantaLab) as an outside benchmark.
- [ ] A decision on **repo growth**: season files are 4–40 MB a week and stay in git history even after the keep-last-10 pruning.
  Options: Git LFS, GitHub release assets, or accept the growth.

## 3. Model improvements (from the backtest, biggest gain first)

- [x] **Role-specific substitutions — cause of the attacker overrating** (done 25 Oct: per-role and per-player off rates,
  real sub-minute deciles, same-role replacements; sub appearances D 1.15 / C 1.92 / A 1.05 vs real 1.16 / 1.98 / 1.38;
  attacker xFM bias +0.24 → +0.19. Remaining: attacker cameos still too rare, bench attackers 0.20 goals per rated game vs 0.11).
  Original note: The engine takes off a random outfield starter
  regardless of role; in reality attackers are subbed far more (sub appearances per team-match: A 1.38 real vs 0.72 model,
  C 1.98 vs 1.58, D 1.16 vs 1.70). Bench attackers then get few cameos, so most of their rated games are 90-minute fill-in
  starts: 0.21 goals per rated game vs 0.11 real, xFM +0.38 (rotation attackers +0.33, regular starters −0.10). Fix: per-role
  (then per-player) chance of being subbed off, real sub-minute distribution (median 19, 40% under 15), re-run the backtest.

- [ ] **Use Fantacalcio's price (QI) inside the model** — the price beat the model on season-points ranking (0.62 vs 0.57) and a
  50/50 blend reached 0.63.
- [ ] **Rated-games band far too narrow** (31% of outcomes inside an 80% band): add per-season uncertainty in a player's role and
  minutes, January transfer-out risk, coach-change risk. Re-check against the new 50% target.
- [ ] **Attacker bias**: xFM +0.27 too high, attackers' rated games −1.4, defenders' +1.2. Goal and assist shares from Understat
  xG / xA (needs Understat ↔ Fantacalcio name matching); starter slots from FotMob positions.
- [ ] **Team strength**: add closing odds and xG to the Poisson fit; let strength drift during the season.
- [ ] **Vote model**: xG-based performance, role-specific noise, team swing tied to the score.
- [ ] **Injuries**: raise FotMob ↔ Fantacalcio id matching above 75%; use FotMob's injury code for the length; fixture congestion
  and minutes load; higher risk right after a return.
- [ ] **Lineups**: rotation in congested weeks; probable-lineup % for the next 1–2 rounds (snapshots are collected weekly).
- [ ] **Still-guessed settings** to fit from data: player form spread (`playerSd`), share of goals with an assist, own-goal role
  weights, penalty-taker order, set pieces.
- [ ] **True preseason rosters**: save a dated copy of the Fantacalcio price list each week (the season file is overwritten today),
  so future backtests don't include January arrivals and departed players.
- [ ] **Matchday medians are two-humped for scorers** (about 6 without a goal, 9.5 with one), so the median jumps between rounds.
  Show the chance of a goal and the expected value next to the median.

## 4. Validation

- [ ] Re-run the backtest with the 50% band (target coverage 50%).
- [x] Matchday-by-matchday backtest (`pipeline/backtest_matchday.py`, results in `data/backtest/matchday_*`).
- [ ] **Matchday 50% interval too wide-looking**: 69% of real fantavoti fall inside P25–P75 (target 50%), partly because
  fantavoti are on a half-point grid and many land exactly on an edge. Report interval coverage with half-weight on edges and,
  if still above 50%, shrink vote noise per role.
- [ ] Backtest the correlations against real seasons.
- [ ] Add a squad-level benchmark (points of a draft built from each forecast) and a price + last-season benchmark.

## 5. Product

- [ ] Price model (parked on purpose).
- [ ] Lineup optimizer using matchday xFM, correlations and the defence modifier.
- [ ] Mantra slots.
- [ ] App: per-player matchday chart like the Malen / Martínez plot, filters by club, pair correlation lookup.
- [ ] Test the Expo build on a real phone.

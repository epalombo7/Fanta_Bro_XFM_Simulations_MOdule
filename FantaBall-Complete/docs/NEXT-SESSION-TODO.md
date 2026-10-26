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


- [ ] **Forecasts too spread (biggest fixable fantavoto error, 26 Oct, `data/backtest/fv_error_by_dimension_2026-10-26.txt`)**:
  real fantavoto moves only ~0.77 for each 1.0 the forecast moves, in every role. Match-up effects are ~40% too strong
  (attackers: +10% team attack → model +0.088, real +0.062; keepers vs opponent attack: model −0.15, real −0.09) and
  scorers' goal rates too spread (midfielders per +0.1 goalW: model +0.33, real +0.27). Shrinking out of sample: fantavoto
  error 0.970 → 0.952 (attackers 1.515 → 1.473). Fix at the source: stronger ridge on team strength (penalty 4 → tune), pull
  goal rates toward the role average more for high scorers, then re-check the slope. Keepers: model ignores the win effect
  (own attack +10% → real +0.047, model 0).

## 26 Oct tuning loop (stopped after 3 tries in a row without gain; log: `data/backtest/tuning_results.csv`, harness: `pipeline/tuning/`)

Tuned on 2021-22 to 2023-24, checked on 2024-25 and 2025-26.
- Accepted: mean-preserving team-strength uncertainty (was inflating goals ~3%); team strength recency (past season
  weight 0.6 → 0.4, current-season matches ×2.5); assist share calibrated (0.72, was a guess of 0.7).
- Rejected: late absence / flatter pecking order; player-rate spread; assist share 0.6; goal-rate prior strength 4 or 25;
  start-share cap 0.90 or prior 12.
- Holdout: fantavoto error 0.968 → 0.966, attacker bias +0.147 → +0.118, keeper bias −0.05 → +0.01 (keeper error
  1.435 → 1.449), RMSE and rankings unchanged. Gains are small: the remaining error is mostly luck (see the floor analysis).
- Not yet tried (need new data or bigger changes): Understat xG for goal shares, penalty-taker order, closing odds in team
  strength, probable-lineup % for the next round, keeper vote from shots on target faced.

## 4. Validation

- [ ] Re-run the backtest with the 50% band (target coverage 50%).
- [x] Matchday-by-matchday backtest (`pipeline/backtest_matchday.py`, results in `data/backtest/matchday_*`).
- [x] Matchday 50% interval checked: 26% strictly inside, 44% exactly on an edge (half-point grid, median width 1.0);
  counting edges as half gives 47.5%, close to the 50% target.
- [ ] **Matchday errors by role** (`data/backtest/matchday_by_role_2026-10-25.csv`): 76–95% of the round-points error is who
  plays, not how well. Fixes, biggest first:
  1. Chances of a vote are too extreme in every role: forecast 97% → real 88%, forecast 12% → real 17–21%. Add a late-absence
     chance for nailed starters (~9%), more random bench cameos, then recalibrate on the backtest; use the weekly probable-lineup
     snapshots and European-cup congestion for rotation.
  2. *(25 Oct, done: real substitution counts, cross-role replacements from single-sub pairs, per-player chance of coming
     on. Sub apps D 1.22 / C 1.92 / A 1.43 vs real 1.23 / 1.90 / 1.38. Matchday Brier 0.169 → 0.165, points RMSE 2.69 → 2.66,
     attacker points bias −0.16 → +0.02, attacker fantavoto bias +0.18 → +0.15; points MAE 1.98 → 2.06 because MAE rewards
     extreme probabilities. Remaining attacker fantavoto bias: goal rates from Understat xG/90, penalty takers.)*
     Attackers fantavoto +0.18 (goals +0.10, base vote +0.07, penalties +0.03): too many rated games are starts (model 71% vs
     real 64%), so cameo players get a starter's goal rate (real cameos 0.11 goals vs model mix 0.21). Fit a per-player sub-in
     rate; goal shares from Understat xG/90 (goal ranking corr only 0.16); penalty-taker order.
  3. Base vote ignores the result: real votes 5.6–5.7 in a defeat, 6.2–6.4 in a win (outfield). Tie the team swing to the
     simulated score (vote ranking corr only 0.16–0.21 now).
  4. Keepers: goals conceded 1.31 vs 1.25 real, reds 0.008 vs 0.003; sharpen with closing odds / xG in team strength; keeper vote
     from shots on target faced (vote ranking corr 0.05).
- [ ] Backtest the correlations against real seasons.
- [ ] Add a squad-level benchmark (points of a draft built from each forecast) and a price + last-season benchmark.

## 5. Product

- [ ] Price model (parked on purpose).
- [ ] Lineup optimizer using matchday xFM, correlations and the defence modifier.
- [ ] Mantra slots.
- [ ] App: per-player matchday chart like the Malen / Martínez plot, filters by club, pair correlation lookup.
- [ ] Test the Expo build on a real phone.

# FantaBall data

Downloaded by the scripts in `pipeline/` (run from the repo, Python 3 with `requests` and `pandas`):

```bash
python pipeline/update.py             # weekly: current season + today's snapshots + re-calibration
python pipeline/update.py --history   # also every past season (first run: a few hours, resumable)
```

No API keys are needed. Pages are cached in `data/cache/` (not committed), so an interrupted run resumes
where it stopped. Seasons covered: 2015-16 to the current season (Understat from 2014-15, FotMob from 2017-18).

## `raw/` — source tables (committed)

| File | Source | One row per | Main columns |
|---|---|---|---|
| `football_data/I1_<season>.csv` | football-data.co.uk | match | result, half-time, shots, shots on target, fouls, corners, cards, referee, 1X2 / over-under / Asian-handicap odds (opening and closing) |
| `football_data/upcoming/fixtures_<date>.csv` | football-data.co.uk | coming match | odds for the next matchday, saved on each run so odds history builds up |
| `openfootball/matches.csv` | openfootball (GitHub) | match | full calendar with dates and rounds, results |
| `understat/matches.csv` | Understat | match | goals and xG per side |
| `understat/team_matches.csv` | Understat | team-match | xG, xGA, npxG, deep completions, PPDA, points |
| `understat/player_seasons.csv` | Understat | player-season | games, minutes, goals, xG, npg, npxG, assists, xA, shots, key passes, cards, position |
| `understat/player_matches.csv.gz` | Understat | player-match | minutes, position (incl. `Sub`), goals, xG, assists, xA, shots, key passes, xGChain, xGBuildup |
| `fantacalcio/prices_<season>.csv` | Fantacalcio.it | player | Classic role, Mantra role(s), team, initial and current price, FVM |
| `fantacalcio/votes_<season>.csv.gz` | Fantacalcio.it | player-match with a vote or s.v. | vote and fantavoto from Fantacalcio, Statistico and Italia (blank = s.v.), yellow, red, goals, conceded, own goals, penalties scored / missed / saved, assists, player of the match |
| `fantacalcio/player_matchdays_<season>.csv.gz` | Fantacalcio.it | player-matchday | status (`started`, `sub_in`, `unused`, `suspended`, `injured`, `not_played`), minute subbed in / out, score. Note: the site keeps `injured` / `suspended` only for the live season; past seasons show those matchdays as `unused` |
| `fotmob/matches_<season>.csv` | FotMob | match | round, kick-off (UTC), score |
| `fotmob/squads_<season>.csv.gz` | FotMob | player in a matchday squad | starter or sub, formation, minute subbed in / out, rating, age, market value |
| `fotmob/unavailable_<season>.csv.gz` | FotMob | player listed unavailable for a match | type (injury / suspension), injury code, expected return, age (lists reliable from 2020-21) |
| `fantacalcio/snapshots/injuries_<date>.csv` | Fantacalcio.it | injured player today | injury description, parsed expected return date |
| `fantacalcio/snapshots/probable_lineups_<date>.csv` | Fantacalcio.it | player in next matchday's probable lineups | starter or reserve, probability of starting (%) |

Snapshots only exist from the first run onwards (the sites don't keep history of these pages), so each
weekly run adds one; backtests of the probable-lineup and injury-list inputs can use them as they accumulate.

## `forecasts/` — weekly outputs

| File | Contents |
|---|---|
| `xfm_<date>.csv`, `xfm_latest.csv` | per player: xFM and P10–P90, rated games and P10–P90, expected season points, vote, goals, assists, penalties, integrità, titolarità, matchdays still injured |
| `matchday_simulation_latest.csv.gz` | module 1's matchday table, no league rules: per player per remaining round the median vote per provider, chance to be fit / available / start / play / get a vote, and expected goals, penalties, own goals, assists, cards, goals conceded and clean sheets |
| `matchday_xfm_latest.csv.gz` | module 2's matchday-by-matchday scoring under the standard rules: chance of a fantavoto, expected fantavoto if he gets one, the round's expected points, and the median with the middle-50% interval (P25–P75) over all 15,000 recorded seasons |
| `correlation_matchday.csv.gz` | player-by-player correlation of fantavoto in the same round (players expected to get ≥ 5 votes, sorted by club and role). Positive = rise and fall together: risk if started together. Pairs need ≥ 100 shared simulated rounds |
| `correlation_head_to_head.csv.gz` | as above, but for players of different clubs only the rounds where the clubs meet (≥ 60 shared): the hedge, e.g. a keeper vs the striker he faces |
| `correlation_season.csv.gz` | correlation of each simulated season's xFM: do whole seasons go well together (auction squad building) |
| `correlation_pairs.csv` | per player: his 3 strongest same-club partners (`moves_with`) and 3 strongest head-to-head hedges |

All are under the standard rules; `pipeline/score_season.js <season file> <config> <out> --corr <prefix>`
recomputes them for any league's rules.

## `params/` — calibrated model inputs

| File | Built by | Contents |
|---|---|---|
| `injuries.csv` | `calibrate_injuries.py` | per player (FotMob id, Fantacalcio id where matched): `injuryRisk` (chance of a new injury per team match), `injuryGames` (mean matches missed per injury), `injuredFor` (matchdays still to miss now), role x age group, spells and exposure used |
| `injury_model.json` | `calibrate_injuries.py` | role x age-group averages, length dispersion (`injuryDispersion` for the engine), season decay, prior strength chosen by backtest, rolling backtest vs group- and league-average baselines |

## `sim/` — simulated seasons (committed, last 10 kept)

`pipeline/forecast.py` runs module 1 for 20,000 simulated seasons, discards the first 5,000 (burn-in) and saves the
other 15,000 as `sim/season_<season>_after_round_<n>.fbsim.br` (Brotli; copy in `sim/season_latest.fbsim.br`). No
league rules are applied. The file (format v4) holds:

- for every recorded season and player: rated games, vote totals for all three providers, goals, penalties scored /
  missed / saved, own goals, assists, cards, goals conceded and clean sheets in rated games, bookings / red cards
  without a vote — everything season xFM and its middle-50% band need under any rules;
- a matchday table per player per remaining round (chance to be fit / available / start / play / get a vote,
  expected events, vote histogram per provider for the median vote);
- outcome counts: per player per round, how many of the 15,000 seasons produced each exact match outcome (votes,
  events, cards, goals conceded). Module 2 scores each outcome under the rules, so matchday medians and intervals
  use every recorded season, exactly;
- per-match detail for 255 seasons (the correlation matrices);
- per club: goals for / against and the defence-modifier inputs.

```bash
node pipeline/run_season.js league.json <rounds_left> 15000 season.fbsim.br --burn-in 5000 --detail 255   # module 1
node pipeline/score_season.js season.fbsim.br config.json xfm.json --matchdays md.csv.gz --corr corr       # module 2
```

Each weekly run commits its file. Only the 10 most recent are kept in `sim/`; older ones are listed in
`sim/archive.csv` and removed from the folder, but stay in git history (`git log --all -- <path>` finds the
commit, `git show <commit>:<path> > file` restores it). `season_latest.fbsim.br` is an identical copy of the
newest file, which git stores only once. The simulation is seeded, so module 1 on the same league gives the
same file.

## Terms of use

The sources are free public websites whose terms restrict automated and commercial reuse. This data is for
personal, non-commercial use; a commercial product would need a licensed data feed.

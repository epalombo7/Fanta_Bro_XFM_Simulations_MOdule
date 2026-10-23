# FantaBall data

Downloaded by the scripts in `pipeline/` (run from the repo, Python 3 with `requests` and `pandas`):

```bash
python pipeline/update.py             # weekly: current season + today's snapshots + re-calibration
python pipeline/update.py --history   # also every past season (first run: a few hours, resumable)
```

No API keys are needed. Pages are cached in `data/cache/` (not committed), so an interrupted run resumes
where it stopped. Seasons covered: 2015-16 to the current season (Understat from 2014-15).

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
| `fantacalcio/player_matchdays_<season>.csv.gz` | Fantacalcio.it | player-matchday | status (`started`, `sub_in`, `unused`, `suspended`, `injured`, `not_played`), minute subbed in / out, score |
| `fantacalcio/snapshots/injuries_<date>.csv` | Fantacalcio.it | injured player today | injury description, parsed expected return date |
| `fantacalcio/snapshots/probable_lineups_<date>.csv` | Fantacalcio.it | player in next matchday's probable lineups | starter or reserve, probability of starting (%) |

Snapshots only exist from the first run onwards (the sites don't keep history of these pages), so each
weekly run adds one; backtests of the probable-lineup and injury-list inputs can use them as they accumulate.

## `params/` — calibrated model inputs

| File | Built by | Contents |
|---|---|---|
| `injuries.csv` | `calibrate_injuries.py` | per player: `injuryRisk` (chance of a new injury per matchday), `injuryGames` (mean matchdays missed per injury), `injuredFor` (matchdays still to miss now), spells and exposure used |
| `injury_model.json` | `calibrate_injuries.py` | role averages, length dispersion (`injuryDispersion` for the engine), season decay, rolling backtest vs role-average baseline |

## Terms of use

The sources are free public websites whose terms restrict automated and commercial reuse. This data is for
personal, non-commercial use; a commercial product would need a licensed data feed.

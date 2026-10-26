"""One command to bring FantaBall's data up to date.

  python pipeline/update.py             weekly refresh: current season from every source, today's injury,
                                        probable-lineup and goalscorer-odds snapshots, re-calibration and a new xFM forecast
                                        (no backtest; run pipeline/backtest.py separately when wanted)
  python pipeline/update.py --history   also (re)download every past season (first run takes a few hours;
                                        downloaded pages are cached, so an interrupted run resumes)
"""
import subprocess, sys, pathlib
import fetch_matches, fetch_understat, fetch_fantacalcio, fetch_fotmob, fetch_odds
from common import SEASONS, CURRENT

HERE = pathlib.Path(__file__).parent


def main():
    history = '--history' in sys.argv
    fetch_matches.football_data(); fetch_matches.openfootball()
    ids, active = fetch_understat.league()
    fetch_understat.player_logs(ids, active)
    fetch_fantacalcio.run(SEASONS[::-1] if history else [CURRENT])
    fetch_fotmob.run(range(fetch_fotmob.LAST, fetch_fotmob.FIRST - 1, -1) if history else [fetch_fotmob.LAST])
    fetch_fantacalcio.injuries_snapshot(); fetch_fantacalcio.lineups_snapshot()
    try:
        fetch_odds.goalscorer_snapshot()          # needs ODDS_API_KEY; a failure must not stop the weekly run
    except Exception as e:
        print('odds: skipped,', e)
    subprocess.run([sys.executable, str(HERE / 'calibrate_injuries.py'), '--no-backtest'], check=True, cwd=HERE)
    subprocess.run([sys.executable, str(HERE / 'forecast.py')], check=True, cwd=HERE)


if __name__ == '__main__':
    main()

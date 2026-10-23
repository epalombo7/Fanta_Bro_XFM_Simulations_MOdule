"""Match-level history: football-data.co.uk (results, shots, cards, odds) and openfootball (calendar)."""
import datetime, io, json
import pandas as pd
from common import SEASONS, get, out


def fd_code(season):
    return season[2:4] + season[5:7]          # '2015-16' -> '1516'


def football_data():
    for s in SEASONS:
        text = get(f'https://www.football-data.co.uk/mmz4281/{fd_code(s)}/I1.csv', max_age=None if s != SEASONS[-1] else 6 * 3600)
        if not text:
            print('football-data missing', s); continue
        df = pd.read_csv(io.StringIO(text.lstrip('﻿')), on_bad_lines='skip').dropna(how='all')
        df = pd.concat([pd.Series(s, index=df.index, name='Season'), df], axis=1)
        df.to_csv(out('football_data', f'I1_{s}.csv'), index=False)
        print('football-data', s, len(df), 'matches')
    # Odds for the coming matchday; kept as dated snapshots so they can be backtested later
    text = get('https://www.football-data.co.uk/fixtures.csv', cache=False)
    df = pd.read_csv(io.StringIO(text.lstrip('﻿')), on_bad_lines='skip')
    df = df[df['Div'] == 'I1']
    df.to_csv(out('football_data', 'upcoming', f'fixtures_{datetime.date.today()}.csv'), index=False)
    print('upcoming fixtures with odds', len(df))


def openfootball():
    rows = []
    for s in SEASONS:
        text = get(f'https://raw.githubusercontent.com/openfootball/football.json/master/{s}/it.1.json', delay=0.2, max_age=None if s != SEASONS[-1] else 6 * 3600)
        if not text:
            print('openfootball missing', s); continue
        for m in json.loads(text)['matches']:
            sc = m.get('score')
            ft = (sc.get('ft') if isinstance(sc, dict) else sc) or [m.get('score1'), m.get('score2')]
            rows.append({'season': s, 'round': m.get('round'), 'date': m.get('date'), 'time': m.get('time'),
                         'home': m['team1'], 'away': m['team2'], 'home_goals': ft[0], 'away_goals': ft[1]})
    pd.DataFrame(rows).to_csv(out('openfootball', 'matches.csv'), index=False)
    print('openfootball', len(rows), 'matches')


if __name__ == '__main__':
    football_data()
    openfootball()

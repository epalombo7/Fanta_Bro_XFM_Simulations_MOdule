"""FotMob: per-match squads and unavailable players (injuries, suspensions) with age, market value,
formation and substitution minutes. Injury lists are reliable from 2020-21; earlier seasons are sparse."""
import json, sys
import pandas as pd
from common import CURRENT, get, out

API = 'https://www.fotmob.com/api/data'
FIRST = 2017                                     # first season fetched (lists are sparse before 2020-21)
LAST = int(CURRENT[:4])
LIVE = 6 * 3600


def season_label(y):
    return f'{y}-{str(y + 1)[2:]}'


def run(years):
    for y in years:
        season, live = season_label(y), (y == LAST)
        fx = json.loads(get(f'{API}/leagues?id=55&season={y}%2F{y + 1}', max_age=LIVE if live else None))['fixtures']['allMatches']
        matches, squads, unavailable = [], [], []
        for m in fx:
            st = m['status']
            if not str(m.get('round', '')).isdigit():      # play-off matches (e.g. relegation 'final') are not league rounds
                continue
            matches.append({'season': season, 'match_id': m['id'], 'round': int(m['round']), 'utc': st.get('utcTime'),
                            'home': m['home']['name'], 'away': m['away']['name'], 'score': st.get('scoreStr'), 'finished': st.get('finished')})
            if not st.get('finished'):
                continue
            text = get(f'{API}/matchDetails?matchId={m["id"]}', delay=0.6)
            lu = (json.loads(text).get('content') or {}).get('lineup') or {}
            for side in ('homeTeam', 'awayTeam'):
                t = lu.get(side) or {}
                for kind in ('starters', 'subs'):
                    for p in t.get(kind) or []:
                        if 'id' not in p:
                            continue
                        ev = (p.get('performance') or {}).get('substitutionEvents') or []
                        squads.append({'season': season, 'match_id': m['id'], 'round': int(m['round']), 'team': t.get('name'), 'formation': t.get('formation'),
                                       'player_id': p['id'], 'name': p.get('name'), 'age': p.get('age'), 'starter': kind == 'starters',
                                       'sub_in': next((e['time'] for e in ev if e.get('type') == 'subIn'), None),
                                       'sub_out': next((e['time'] for e in ev if e.get('type') == 'subOut'), None),
                                       'rating': (p.get('performance') or {}).get('rating'), 'market_value': p.get('marketValue')})
                for p in t.get('unavailable') or []:
                    if 'id' not in p:                 # a few old entries have no player id
                        continue
                    u = p.get('unavailability') or {}
                    unavailable.append({'season': season, 'match_id': m['id'], 'round': int(m['round']), 'utc': st.get('utcTime'), 'team': t.get('name'),
                                        'player_id': p['id'], 'name': p.get('name'), 'age': p.get('age'), 'type': u.get('type'),
                                        'injury_id': u.get('injuryId'), 'expected_return': u.get('expectedReturn'), 'market_value': p.get('marketValue')})
        pd.DataFrame(matches).to_csv(out('fotmob', f'matches_{season}.csv'), index=False)
        pd.DataFrame(squads).to_csv(out('fotmob', f'squads_{season}.csv.gz'), index=False)
        pd.DataFrame(unavailable).to_csv(out('fotmob', f'unavailable_{season}.csv.gz'), index=False)
        print(season, 'matches', len(matches), 'squad rows', len(squads), 'unavailable', len(unavailable), flush=True)


if __name__ == '__main__':
    args = [int(a[:4]) for a in sys.argv[1:]]
    run(args or range(LAST, FIRST - 1, -1))

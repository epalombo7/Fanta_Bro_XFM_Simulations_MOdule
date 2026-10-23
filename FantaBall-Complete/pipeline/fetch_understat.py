"""Understat: team match xG, player season totals and per-match player logs (minutes, start/sub, goals, xG, assists, xA)."""
import json, sys
import pandas as pd
from common import SEASONS, get, out

HDR = {'X-Requested-With': 'XMLHttpRequest', 'Referer': 'https://understat.com/league/Serie_A'}
YEARS = range(2014, int(SEASONS[-1][:4]) + 1)   # Understat labels a season by its first year


def league():
    teams, matches, players = [], [], []
    for y in YEARS:
        d = json.loads(get(f'https://understat.com/getLeagueData/Serie_A/{y}', headers=HDR, max_age=None if y != YEARS[-1] else 6 * 3600))
        season = f'{y}-{str(y + 1)[2:]}'
        for t in d['teams'].values():
            for h in t['history']:
                teams.append({'season': season, 'team_id': t['id'], 'team': t['title'], **{k: v for k, v in h.items() if not isinstance(v, dict)},
                              'ppda_att': h['ppda']['att'], 'ppda_def': h['ppda']['def']})
        for m in d['dates']:
            matches.append({'season': season, 'match_id': m['id'], 'date': m['datetime'], 'home': m['h']['title'], 'away': m['a']['title'],
                            'home_goals': m['goals']['h'], 'away_goals': m['goals']['a'], 'home_xg': m['xG']['h'], 'away_xg': m['xG']['a'],
                            'played': m['isResult']})
        for p in d['players']:
            players.append({'season': season, **p})
        print('understat league', season, len(d['players']), 'players')
    pd.DataFrame(teams).to_csv(out('understat', 'team_matches.csv'), index=False)
    pd.DataFrame(matches).to_csv(out('understat', 'matches.csv'), index=False)
    pd.DataFrame(players).to_csv(out('understat', 'player_seasons.csv'), index=False)
    current = f'{YEARS[-1]}-{str(YEARS[-1] + 1)[2:]}'
    return sorted({p['id'] for p in players}, key=int), {p['id'] for p in players if p['season'] == current}


def player_logs(ids, active=()):
    """Per-match logs for every player; players active this season are re-downloaded after 6 hours."""
    rows, active = [], set(active)
    for i, pid in enumerate(ids):
        text = get(f'https://understat.com/getPlayerData/{pid}', headers=HDR, delay=0.8, max_age=6 * 3600 if pid in active else None)
        if not text:
            continue
        d = json.loads(text)
        name = d.get('player', {}).get('player_name') if isinstance(d.get('player'), dict) else None
        for m in d.get('matches', []):
            rows.append({'player_id': pid, 'player_name': name, **m})
        if i % 100 == 0:
            print('understat players', i, '/', len(ids), flush=True)
    df = pd.DataFrame(rows)
    df = df[df['season'].astype(int) >= YEARS[0]]
    df.to_csv(out('understat', 'player_matches.csv.gz'), index=False)
    print('understat player matches', len(df))


if __name__ == '__main__':
    ids, active = league()
    if '--league-only' not in sys.argv:
        player_logs(ids, active)

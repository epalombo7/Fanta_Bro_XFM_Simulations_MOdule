"""The Odds API: anytime-goalscorer odds for the coming Serie A matches, saved as a dated snapshot so a history
builds up for a later backtest (the API keeps no free history of player markets).

  python pipeline/fetch_odds.py          # matches kicking off in the next 8 days

Needs ODDS_API_KEY: an environment variable, or a line ODDS_API_KEY=... in FantaBall-Complete/.env (not committed);
without it the step is skipped. Cost: 1 request per match (UK bookmakers; free plan 500 requests a month)."""
import datetime, os
import pandas as pd
import requests
from common import out

API = 'https://api.the-odds-api.com/v4/sports/soccer_italy_serie_a'
DAYS = 8


def call(path, key, **params):
    # the key goes in params, never in a printed URL
    r = requests.get(f'{API}{path}', params={'apiKey': key, **params}, timeout=30)
    if r.status_code != 200:
        raise RuntimeError(f'Odds API {path.split("/")[1] if "/" in path else path}: HTTP {r.status_code} {r.text[:200]}')
    return r.json(), r.headers.get('x-requests-remaining')


def api_key():
    """ODDS_API_KEY from the environment, else from a .env file in the project folder (KEY=value lines; never committed)."""
    if os.environ.get('ODDS_API_KEY'):
        return os.environ['ODDS_API_KEY']
    env = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '.env')
    if os.path.exists(env):
        for line in open(env):
            k, _, v = line.strip().partition('=')
            if k.strip() == 'ODDS_API_KEY' and v.strip():
                return v.strip().strip('"').strip("'")
    return None


def goalscorer_snapshot():
    key = api_key()
    if not key:
        print('odds: ODDS_API_KEY not set, goalscorer odds skipped')
        return None
    now = datetime.datetime.now(datetime.timezone.utc)
    events, left = call('/events', key)
    soon = [e for e in events if datetime.datetime.fromisoformat(e['commence_time'].replace('Z', '+00:00')) < now + datetime.timedelta(days=DAYS)]
    rows = []
    for e in soon:
        d, left = call(f'/events/{e["id"]}/odds', key, regions='uk', markets='player_goal_scorer_anytime', oddsFormat='decimal')
        for b in d.get('bookmakers', []):
            for m in b['markets']:
                for o in m['outcomes']:
                    rows.append({'fetched_at': now.isoformat(timespec='seconds'), 'event_id': e['id'], 'commence_time': e['commence_time'],
                                 'home': e['home_team'], 'away': e['away_team'], 'bookmaker': b['key'], 'last_update': m.get('last_update'),
                                 'player': o.get('description'), 'outcome': o['name'], 'price': o['price']})
    df = pd.DataFrame(rows)
    f = out('odds_api', 'goalscorer', f'anytime_{now:%Y-%m-%d}.csv')
    df.to_csv(f, index=False)
    print(f'odds: {len(soon)} matches, {df.player.nunique() if len(df) else 0} players, {len(df)} prices -> {f.name} (requests left this month: {left})')
    return df


if __name__ == '__main__':
    goalscorer_snapshot()

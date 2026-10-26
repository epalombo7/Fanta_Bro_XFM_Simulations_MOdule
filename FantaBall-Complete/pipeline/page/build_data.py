"""Collect everything the matchday page shows into one JSON: next matchday forecast, season forecast, this season so far,
injuries, Fantacalcio probable lineups, bookmakers' anytime-goalscorer odds, correlation partners."""
import json, glob, math, re, sys, unicodedata, pathlib
import numpy as np, pandas as pd
R = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(R / 'pipeline'))
import calibrate as C, backtest as B
from common import CURRENT
F = R / 'data' / 'forecasts'
md = pd.read_csv(F / 'matchday_xfm_latest.csv.gz'); sim = pd.read_csv(F / 'matchday_simulation_latest.csv.gz')
nxt = int(md['round'].min())
md = md[md['round'] == nxt]; sim = sim[sim['round'] == nxt]
season = pd.read_csv(F / 'xfm_latest.csv').set_index('id')
d = md.merge(sim[['id', 'p_fit', 'p_avail', 'exp_yellow', 'exp_penScored', 'exp_conceded']], on='id', how='left')

# this season so far (standard rules, Fantacalcio votes)
v = C.votes(); v = B.actual_fv(v[v.season == CURRENT]); r = v[v.rated]
done = int(v['round'].max()) if len(v) else 0
cur = r.groupby('player_id').agg(fm=('fv', 'mean'), mv=('vote_fantacalcio', 'mean'), games=('fv', 'size'), goals=('goals', 'sum'), assists=('assists', 'sum'))

# injuries and probable lineups (latest snapshots)
snap = R / 'data' / 'raw' / 'fantacalcio' / 'snapshots'
inj = pd.read_csv(sorted(snap.glob('injuries_*.csv'))[-1]); inj_date = inj.date.iloc[0] if len(inj) else ''
lu_f = sorted(snap.glob('probable_lineups_*.csv')); lu = pd.read_csv(lu_f[-1]) if lu_f else pd.DataFrame(columns=['player_id', 'start_pct', 'list'])
lu_date = lu.date.iloc[0] if len(lu) else ''
lu = lu.drop_duplicates('player_id').set_index('player_id')

def key(s):
    s = unicodedata.normalize('NFKD', str(s)).encode('ascii', 'ignore').decode().lower()
    return re.sub(r'[^a-z ]', ' ', s).split()

# bookmakers: anytime goalscorer, average implied chance over bookmakers (no margin removal: shown as the bookmakers' price)
odds_f = sorted((R / 'data' / 'raw' / 'odds_api' / 'goalscorer').glob('anytime_*.csv'))
odds = {}
if odds_f:
    o = pd.read_csv(odds_f[-1]); o = o[o.outcome == 'Yes']
    o['p'] = 1 / o.price
    o = o.groupby(['player', 'home', 'away']).p.mean().reset_index()
    team_alias = {'AS Roma': 'Roma', 'AC Milan': 'Milan', 'Inter Milan': 'Inter', 'Atalanta BC': 'Atalanta', 'Hellas Verona': 'Verona'}
    for x in o.itertuples():
        for t in (x.home, x.away):
            odds.setdefault(team_alias.get(t, t).lower(), []).append((key(x.player), x.p))
odds_date = odds_f[-1].stem.split('_')[1] if odds_f else ''

def bookie(name, team):
    cand = odds.get(str(team).lower(), [])
    k = key(name)
    if not k: return None
    sur = [w for w in k if len(w) > 2] or k
    hits = [p for toks, p in cand if all(w in toks for w in sur)]
    if len(hits) == 1: return hits[0]
    hits = [p for toks, p in cand if sur[0] in toks]
    return hits[0] if len(hits) == 1 else None

# correlations within the next match, across the simulation draws of that round only
mc = json.loads((F / 'correlation_next_match.json').read_text())
assert mc['round'] == nxt, (mc['round'], nxt)
pairs = {int(k): {'moves_with': [e[:3] for e in x['with']], 'hedge_head_to_head': [e[:3] for e in x['hedge']]} for k, x in mc['players'].items()}

def n(x, k=2):
    return None if x is None or (isinstance(x, float) and (math.isnan(x) or math.isinf(x))) else round(float(x), k)

rows = []
for x in d.itertuples():
    s = season.loc[x.id] if x.id in season.index else None
    c = cur.loc[x.id] if x.id in cur.index else None
    ij = inj[(inj.name.map(lambda q: ' '.join(key(q))) == ' '.join(key(x.name))) & (inj.team.str.lower() == str(x.team).lower())]
    l = lu.loc[x.id] if x.id in lu.index else None
    g = x.exp_goals or 0
    rows.append({
        'id': int(x.id), 'name': x.name, 'team': x.team, 'role': x.role, 'opp': x.opponent, 'home': bool(x.home),
        'pPlay': n(x.p_play, 3), 'pVote': n(x.p_vote, 3), 'pStart': n(x.p_start, 3), 'pFit': n(x.p_fit, 3),
        'xfm': n(x.xfm_if_voted), 'exp': n(x.expected_points), 'med': n(x.fv_median, 1), 'lo': n(x.fv_p25, 1), 'hi': n(x.fv_p75, 1),
        'vote': n(x.median_vote, 1), 'pGoal': n(1 - math.exp(-g), 3) if g else 0, 'xG': n(g, 3), 'xA': n(x.exp_assists, 3),
        'cs': n(x.clean_sheet_if_voted, 3), 'conc': n(x.exp_conceded, 2) if x.role == 'P' else None,
        'bookie': n(bookie(x.name, x.team), 3),
        'sXfm': n(s.xfm) if s is not None else None, 'sLo': n(s.xfmLow) if s is not None else None, 'sHi': n(s.xfmHigh) if s is not None else None,
        'sGames': n(s.rated, 1) if s is not None else None, 'sPts': n(s.expected, 0) if s is not None else None,
        'sGoals': n(s.goals, 1) if s is not None else None, 'sAssists': n(s.assists, 1) if s is not None else None,
        'fm': n(c.fm) if c is not None else None, 'mv': n(c.mv) if c is not None else None, 'games': int(c.games) if c is not None else 0,
        'goals': int(c.goals) if c is not None else 0, 'assists': int(c.assists) if c is not None else 0,
        'out': int(s.injuredFor) if s is not None and not pd.isna(s.injuredFor) else 0,
        'inj': ij.text.iloc[0] if len(ij) else None, 'ret': (str(ij.expected_return.iloc[0]) if len(ij) and pd.notna(ij.expected_return.iloc[0]) else None),
        'fc': n(l.start_pct, 0) if l is not None and pd.notna(l.start_pct) else None,
        'with': pairs.get(x.id, {}).get('moves_with', [])[:3], 'hedge': pairs.get(x.id, {}).get('hedge_head_to_head', [])[:3],
    })
meta = {'round': nxt, 'played': done, 'season': CURRENT, 'n': len(rows), 'injDate': inj_date, 'luDate': lu_date, 'oddsDate': odds_date,
        'built': pd.Timestamp.now(tz='Europe/Rome').strftime('%d/%m/%Y, %H:%M'), 'sims': 15000,
        'bookieMatched': sum(r['bookie'] is not None for r in rows), 'corrDraws': mc['draws']}
out = pathlib.Path(__file__).parent / 'data.json'
out.write_text(json.dumps({'meta': meta, 'players': rows}, ensure_ascii=False, separators=(',', ':')))
print(meta, 'corr draws', mc['draws'])

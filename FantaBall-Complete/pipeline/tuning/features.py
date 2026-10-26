import json, glob, sys, pathlib, numpy as np, pandas as pd
R = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(R / 'pipeline'))
import calibrate as C
from common import SEASONS
OUT = R / 'data' / 'cache' / 'tuning'
pred = pd.concat([pd.read_pickle(R / f'data/cache/tuning/pred_final_{s}.pkl') for s in ['tune', 'holdout']])
rows = []
for tag, st in [('base2', 'tune'), ('new', 'holdout')]:
    for f in glob.glob(str(R / f'data/cache/tuning/{tag}/{st}/*.json')):
        L = json.load(open(f)); r = L['as_of_round']; T = L['teams']
        opp, home = {}, {}
        for h, a in L['fixtures'][r]: opp[h], home[h], opp[a], home[a] = a, 1, h, 0
        for p in L['players']:
            t = p['team']
            if t not in opp: continue
            o = opp[t]
            rows.append({'season': L['season'], 'round': r + 1, 'player_id': int(p['id']), 'team_name': T[t]['name'], 'opp_name': T[o]['name'],
                         'home': home[t], 'att': T[t]['att'], 'def': T[t]['def'], 'opp_att': T[o]['att'], 'opp_def': T[o]['def'],
                         'start_share': p['start'] / (1 + p['start']), 'qi': p.get('qi'), 'base': p['base'], 'goalW': p['goalW'], 'assistW': p['assistW'],
                         'penW': p.get('penW', 0), 'subW': p.get('subW'), 'offRate': p.get('offRate'), 'injuredFor': p.get('injuredFor', 0),
                         'injuryRisk': p.get('injuryRisk'), 'yellowRate': p.get('yellow')})
F = pd.DataFrame(rows)
d = pred.merge(F, on=['season', 'round', 'player_id'], how='left')
# history: rated games before this round (previous 3 seasons + this season so far)
v = C.votes(); vr = v[v.vote_fantacalcio.notna()].drop_duplicates(['season', 'round', 'player_id'])
si = {s: i for i, s in enumerate(SEASONS)}; vr = vr.assign(si=vr.season.map(si))
d['si'] = d.season.map(si)
cnt = []
for (s, r), g in d.groupby(['season', 'round']):
    i = si[s]; h = vr[((vr.si < i) & (vr.si >= i - 3)) | ((vr.si == i) & (vr['round'] < r))]
    c = h.groupby('player_id').size(); cs = vr[(vr.si == i) & (vr['round'] < r)].groupby('player_id').size()
    cnt.append(pd.DataFrame({'season': s, 'round': r, 'player_id': g.player_id, 'hist_votes': g.player_id.map(c).fillna(0).values, 'season_votes': g.player_id.map(cs).fillna(0).values}))
d = d.merge(pd.concat(cnt), on=['season', 'round', 'player_id'])
# new to club: club last season differs
pr = C.prices().drop_duplicates(['season', 'player_id'], keep='last')[['season', 'player_id', 'team_slug']]
pr['si'] = pr.season.map(si); prev = pr.assign(si=pr.si + 1).rename(columns={'team_slug': 'prev_club'})[['si', 'player_id', 'prev_club']]
d = d.merge(pr[['si', 'player_id', 'team_slug']], on=['si', 'player_id'], how='left').merge(prev, on=['si', 'player_id'], how='left')
d['club_status'] = np.where(d.prev_club.isna(), 'new to Serie A', np.where(d.prev_club != d.team_slug, 'changed club', 'same club'))
fd = C.results(); teams_by = fd.groupby('Season').apply(lambda x: set(x.HomeTeam))
d['promoted'] = [t not in teams_by.get(SEASONS[si[s] - 1], set()) for s, t in zip(d.season, d.team_name)]
# ex-post: status, minutes, events, result
md = pd.concat([pd.read_csv(R / f'data/raw/fantacalcio/player_matchdays_{s}.csv.gz') for s in d.season.unique()])
d = d.merge(md[['season', 'round', 'player_id', 'status', 'sub_in_min', 'sub_out_min']], on=['season', 'round', 'player_id'], how='left')
d = d.merge(v.drop_duplicates(['season', 'round', 'player_id'])[['season', 'round', 'player_id', 'goals', 'pen_scored', 'pen_missed', 'assists', 'yellow', 'red', 'own_goals', 'gf', 'ga', 'vote_fantacalcio']],
            on=['season', 'round', 'player_id'], how='left')
d.to_pickle(OUT / 'd.pkl'); print(len(d), d.rated.sum(), d.columns.tolist())

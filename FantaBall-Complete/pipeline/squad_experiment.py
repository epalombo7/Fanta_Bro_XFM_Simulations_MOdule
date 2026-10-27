"""Lineup experiment on a past season, using the matchday backtest (each round forecast with only what was known before it).

1,000 random 25-player squads (3 P, 8 D, 8 C, 6 A) are drawn from the players at the clubs at the start of the season,
with probability proportional to the Fantacalcio starting price, so squads look like auction squads. Every matchday
each squad fields 11 players with the best formation, by one of these rules:
  model        highest expected points next matchday (chance of a vote x xFM if he plays)
  model_xfm    highest xFM if he plays, ignoring the chance of playing
  form         highest fantamedia over the last 5 matchdays (players without a vote in them go last)
  random       random formation and players
Scoring: real fantavoto under standard rules; a starter without a vote is replaced by the first bench player of the
same role with a vote (bench ordered by the same rule), at most 3 substitutions. No defence modifier.

  python pipeline/squad_experiment.py [season] [n_squads]"""
import sys, pathlib
import numpy as np, pandas as pd
import calibrate as C, backtest as B
from common import SEASONS, DATA

FORMATIONS = [(3, 4, 3), (3, 5, 2), (4, 3, 3), (4, 4, 2), (4, 5, 1), (5, 3, 2), (5, 4, 1)]
SLOTS = {'P': 3, 'D': 8, 'C': 8, 'A': 6}
ROLES = ['P', 'D', 'C', 'A']


def load(season):
    pred = pd.read_pickle(DATA / 'cache' / 'tuning' / 'pred_final_holdout.pkl')
    pred = pred[pred.season == season]
    md = pd.read_csv(DATA / 'raw' / 'fantacalcio' / f'player_matchdays_{season}.csv.gz')
    at_start = set(md[(md['round'] <= 3) & md.status.isin(['started', 'sub_in', 'unused', 'injured', 'suspended'])].player_id)
    pr = C.prices(); pr = pr[pr.season == season].drop_duplicates('player_id', keep='last').set_index('player_id')
    pool = pr[pr.index.isin(at_start) & pr.index.isin(pred.player_id)][['name', 'role', 'qi']]
    # real fantavoto per round (NaN = no vote) and the forecasts, as player x round matrices
    i = SEASONS.index(season)
    v = pd.concat([B.actual_fv(C.votes()[C.votes().season == s]).assign(season=s) for s in (SEASONS[i - 1], season)])
    v = v[v.rated].drop_duplicates(['season', 'round', 'player_id'])
    ids = pool.index.to_numpy(); R = 38
    fv = v[v.season == season].pivot(index='player_id', columns='round', values='fv').reindex(index=ids, columns=range(1, R + 1)).to_numpy()
    p = pred.pivot(index='player_id', columns='round', values='p').reindex(index=ids, columns=range(1, R + 1)).fillna(0).to_numpy()
    x = pred.pivot(index='player_id', columns='round', values='xfm').reindex(index=ids, columns=range(1, R + 1)).to_numpy()
    prev = v[v.season == SEASONS[i - 1]].pivot(index='player_id', columns='round', values='fv').reindex(index=ids, columns=range(34, 39)).to_numpy()
    hist = np.concatenate([prev, fv], axis=1)                           # last 5 of last season, then this season
    form = np.full((len(ids), R), np.nan)
    for r in range(R):                                                  # FM over the 5 matchdays before round r+1
        w = hist[:, r:r + 5]
        with np.errstate(all="ignore"), __import__("warnings").catch_warnings():
            __import__("warnings").simplefilter("ignore")
            form[:, r] = np.nanmean(w, axis=1)
    scores = {'model': p * np.nan_to_num(x), 'model_xfm': np.nan_to_num(x), 'form': np.nan_to_num(form, nan=-1)}
    return pool, fv, scores


def lineup_points(sq_roles, order_by_role, fv_r, formation):
    """order_by_role: role -> squad indices best first. Returns real points of the 11 with up to 3 bench substitutions."""
    nD, nC, nA = formation; need = {'P': 1, 'D': nD, 'C': nC, 'A': nA}
    total, subs, missing = 0.0, 0, []
    for role in ROLES:
        o = order_by_role[role]; xi, bench = o[:need[role]], list(o[need[role]:])
        for i in xi:
            if not np.isnan(fv_r[i]): total += fv_r[i]
            else: missing.append(role)
        order_by_role[role + '_bench'] = bench
    for role in missing:                                                # bench in order, same role, max 3
        if subs >= 3: break
        for j, i in enumerate(order_by_role[role + '_bench']):
            if not np.isnan(fv_r[i]):
                total += fv_r[i]; subs += 1; order_by_role[role + '_bench'].pop(j); break
    return total


def run(season='2025-26', n=1000, seed=7):
    rng = np.random.default_rng(seed)
    pool, fv, scores = load(season)
    roles = pool.role.to_numpy(); qi = pool.qi.fillna(1).to_numpy().astype(float)
    res = {k: np.zeros((n, 38)) for k in ['model', 'model_xfm', 'form', 'random']}
    for s in range(n):
        sq = np.concatenate([rng.choice(np.where(roles == r)[0], SLOTS[r], replace=False, p=qi[roles == r] / qi[roles == r].sum()) for r in ROLES])
        sr = roles[sq]
        for r in range(38):
            f = fv[sq, r]
            for k in ['model', 'model_xfm', 'form']:
                sc = scores[k][sq, r]
                best = -1
                for fm in FORMATIONS:                                   # formation with the highest forecast total
                    need = dict(zip(['D', 'C', 'A'], fm)); need['P'] = 1
                    t = sum(np.sort(sc[sr == ro])[::-1][:need[ro]].sum() for ro in ROLES)
                    if t > best: best, bf = t, fm
                order = {ro: list(np.where(sr == ro)[0][np.argsort(-sc[sr == ro], kind='stable')]) for ro in ROLES}
                res[k][s, r] = lineup_points(sr, order, f, bf)
            order = {ro: list(rng.permutation(np.where(sr == ro)[0])) for ro in ROLES}
            res['random'][s, r] = lineup_points(sr, order, f, FORMATIONS[rng.integers(len(FORMATIONS))])
    return res


if __name__ == '__main__':
    season = sys.argv[1] if len(sys.argv) > 1 else '2025-26'; n = int(sys.argv[2]) if len(sys.argv) > 2 else 1000
    res = run(season, n)
    tab = pd.DataFrame({k: {'points per matchday': v.mean(), 'season total (mean)': v.sum(1).mean(),
                            'season total (P10)': np.percentile(v.sum(1), 10), 'season total (P90)': np.percentile(v.sum(1), 90)} for k, v in res.items()}).T
    for k in ['model_xfm', 'form', 'random']:
        tab.loc[k, 'model beats it: matchdays'] = (res['model'] > res[k]).mean() / max(1e-9, ((res['model'] != res[k]).mean())) if (res['model'] != res[k]).any() else np.nan
        tab.loc[k, 'model beats it: seasons'] = (res['model'].sum(1) > res[k].sum(1)).mean()
        tab.loc[k, 'model gain per matchday'] = (res['model'] - res[k]).mean()
    print(tab.round(3).to_string())
    ph = pd.DataFrame({k: [v[:, :5].mean(), v[:, 5:19].mean(), v[:, 19:].mean()] for k, v in res.items()}, index=['rounds 1-5', 'rounds 6-19', 'rounds 20-38'])
    print(ph.round(2).to_string())
    out = DATA / 'backtest'; tab.round(4).to_csv(out / f'squad_experiment_{season}.csv'); ph.round(3).to_csv(out / f'squad_experiment_{season}_by_phase.csv')

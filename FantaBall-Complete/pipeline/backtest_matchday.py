"""Matchday-by-matchday backtest. For each test season and each round r (1-38), the league is rebuilt with only
what was known before round r (earlier seasons, rounds already played, that round's injury list), round r alone
is simulated, and every player's forecast is scored against his real fantavoto that round (standard rules,
Fantacalcio votes). Run once, not weekly:

  python pipeline/backtest_matchday.py            # 5 seasons x 38 rounds, about an hour

Benchmarks for each player and round:
  form         this season so far: share of rounds with a vote and average fantavoto (last season before round 1)
  last_season  his previous season: share of rounds with a vote and average fantavoto
  role_avg     his role's average (from earlier seasons)
Measures (per round, then averaged): chance of a vote (Brier score), expected points = chance x expected fantavoto
(error and rank correlation against real points, 0 without a vote), expected fantavoto when he got a vote (error,
rank correlation), and how often the real fantavoto fell inside the middle-50% interval (target 50%)."""
import datetime, json, pathlib, subprocess, sys, tempfile
import numpy as np
import pandas as pd
import calibrate as C
import backtest as B
from common import SEASONS, DATA

TEST = ['2021-22', '2022-23', '2023-24', '2024-25', '2025-26']
N = 2000
HERE = pathlib.Path(__file__).parent
NODE = r"""
const fs=require('fs'),E=require(process.argv[2]),files=JSON.parse(fs.readFileSync(process.argv[3])),out=[];
for(const f of files){const L=JSON.parse(fs.readFileSync(f)),r=L.as_of_round;
  const lg={...L,fixtures:L.fixtures.slice(0,r+1)};                     // simulate only round r+1
  const S=E.runSeason({rounds:1},{N:+process.argv[4],league:lg,model:L.model,detailWorlds:0});
  const c={competition:'bt',season:L.season,teams:10,budget:500,min:1,rounds:1,P:3,D:8,C:8,A:6};
  for(const p of E.scoreMatchdays(S,c)){const m=p.matchdays[0];
    out.push({season:L.season,round:r+1,player_id:+p.id,role:p.role,p_vote:m.pVote,xfm:m.xfm,expected:m.expected,median:m.median,low:m.low,high:m.high})}}
fs.writeFileSync(process.argv[5],JSON.stringify(out));
"""


def actual(season):
    v = B.actual_fv(C.votes()[C.votes().season == season])
    return v[['round', 'player_id', 'rated', 'fv']]


def forecasts(season, rounds=range(38)):
    with tempfile.TemporaryDirectory() as d:
        d = pathlib.Path(d); files = []
        for r in rounds:
            lg = C.build_league(season, r)
            f = d / f'lg_{r}.json'; f.write_text(json.dumps(lg)); files.append(str(f))
            print(season, 'round', r + 1, 'league built', flush=True)
        (d / 'files.json').write_text(json.dumps(files)); (d / 'run.js').write_text(NODE)
        subprocess.run(['node', '--max-old-space-size=12000', str(d / 'run.js'), str(HERE.parent / 'mobile' / 'assets' / 'engine.js'),
                        str(d / 'files.json'), str(N), str(d / 'out.json')], check=True)
        return pd.DataFrame(json.loads((d / 'out.json').read_text()))


def benchmarks(season, fc):
    """form, last_season and role_avg forecasts for the same player-rounds."""
    i = SEASONS.index(season)
    cur, prev = actual(season), actual(SEASONS[i - 1])
    def summary(a, n_rounds):
        g = a.groupby('player_id')
        return pd.DataFrame({'p_vote': g.rated.sum() / n_rounds, 'fv': a[a.rated].groupby('player_id').fv.mean()})
    last = summary(prev, 38)
    hist = pd.concat([actual(s) for s in SEASONS[max(0, i - 3):i]])
    roles = C.prices().drop_duplicates('player_id', keep='last').set_index('player_id').role
    hist['role'] = hist.player_id.map(roles)
    role_fv = hist[hist.rated].groupby('role').fv.mean()
    role_pv = 0.45                                                        # average share of rounds with a vote, listed players
    out = []
    for r, g in fc.groupby('round'):
        so_far = cur[cur['round'] < r]
        form = summary(so_far, r - 1) if r > 1 else last
        x = g[['season', 'round', 'player_id', 'role']].copy()
        for name, src in (('form', form), ('last_season', last)):
            x[f'{name}_p_vote'] = x.player_id.map(src.p_vote).fillna(x.player_id.map(last.p_vote)).fillna(role_pv).clip(0, 1)
            x[f'{name}_xfm'] = x.player_id.map(src.fv).fillna(x.player_id.map(last.fv)).fillna(x.role.map(role_fv))
        x['role_avg_p_vote'] = role_pv; x['role_avg_xfm'] = x.role.map(role_fv)
        out.append(x)
    return pd.concat(out)


def spearman(a, b):
    ok = a.notna() & b.notna()
    return a[ok].rank().corr(b[ok].rank()) if ok.sum() > 10 else np.nan


def score(df):
    rows = []
    for m in ('model', 'form', 'last_season', 'role_avg'):
        pv, xf = df[f'{m}_p_vote'], df[f'{m}_xfm']
        exp = pv * xf.fillna(0)
        voted = df[df.act_rated]
        per_round = df.assign(e=exp).groupby(['season', 'round'])
        rows.append({'method': m,
                     'p_vote_brier': float(((pv - df.act_rated) ** 2).mean()),
                     'points_mae': float((exp - df.act_points).abs().mean()),
                     'points_rank_corr': float(per_round.apply(lambda g: spearman(g.e, g.act_points)).mean()),
                     'fv_mae_when_voted': float((voted[f'{m}_xfm'] - voted.act_fv).abs().mean()),
                     'fv_rank_corr_when_voted': float(voted.groupby(['season', 'round']).apply(lambda g: spearman(g[f'{m}_xfm'], g.act_fv)).mean())})
    v = df[df.act_rated & df.low.notna()]
    rows[0]['inside_middle_50'] = float(((v.act_fv >= v.low) & (v.act_fv <= v.high)).mean())
    rows[0]['median_abs_error'] = float((v.act_fv - v['median']).abs().mean())
    return pd.DataFrame(rows).set_index('method')


def run(seasons=TEST):
    allp = []
    for season in seasons:
        fc = forecasts(season)
        bm = benchmarks(season, fc)
        df = fc.merge(bm, on=['season', 'round', 'player_id', 'role'])
        a = actual(season).rename(columns={'rated': 'act_rated', 'fv': 'act_fv'})
        df = df.merge(a, on=['round', 'player_id'], how='left')
        df['act_rated'] = df.act_rated.fillna(False).astype(bool)
        df['act_points'] = df.act_fv.where(df.act_rated, 0.0).fillna(0.0)
        df = df.rename(columns={'p_vote': 'model_p_vote', 'xfm': 'model_xfm'})
        allp.append(df)
        print(season, 'scored', flush=True)
    df = pd.concat(allp)
    out = DATA / 'backtest'; out.mkdir(exist_ok=True); stamp = str(datetime.date.today())
    df.to_csv(out / f'matchday_predictions_{stamp}.csv.gz', index=False)
    overall = score(df)
    by_season = pd.concat({s: score(g) for s, g in df.groupby('season')})
    by_phase = pd.concat({ph: score(g) for ph, g in df.assign(ph=np.where(df['round'] <= 5, 'rounds 1-5', 'rounds 6-38')).groupby('ph')})
    overall.to_csv(out / f'matchday_summary_{stamp}.csv'); by_season.to_csv(out / f'matchday_by_season_{stamp}.csv'); by_phase.to_csv(out / f'matchday_by_phase_{stamp}.csv')
    print(overall.round(4).to_string()); print(by_phase.round(4).to_string())
    return df, overall


if __name__ == '__main__':
    run([a for a in sys.argv[1:]] or TEST)

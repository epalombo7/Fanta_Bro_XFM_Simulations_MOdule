"""python evalm.py <tag> <set> <label> [overrides.json] [engine.js]  -> metrics row appended to results.csv"""
import json, pathlib, subprocess, sys, tempfile, numpy as np, pandas as pd
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))
HERE = pathlib.Path(__file__).parent
CACHE = HERE.parents[1] / 'data' / 'cache' / 'tuning'
ENGINE = str(pathlib.Path(__file__).resolve().parents[2] / 'mobile' / 'assets' / 'engine.js')
N = 4000
_act = {}
def actual(seasons):
    import calibrate as C, backtest as B
    v = C.votes(); v = B.actual_fv(v[v.season.isin(seasons)])
    return v[['season', 'round', 'player_id', 'rated', 'fv']].drop_duplicates(['season', 'round', 'player_id'])
def metrics(df):
    d = df.copy(); d['xf'] = d.xfm.fillna(0); d['e'] = d.p * d.xf - d.pts; v = d[d.rated]
    m = {'n': len(d), 'brier': ((d.p - d.rated) ** 2).mean(), 'pts_rmse': np.sqrt((d.e ** 2).mean()), 'pts_mae': d.e.abs().mean(),
         'fv_mae': (v.xfm - v.fv).abs().mean(), 'fv_rmse': np.sqrt(((v.xfm - v.fv) ** 2).mean()),
         'pts_rank': np.nanmean([(g.p * g.xf).rank().corr(g.pts.rank()) for _, g in d.groupby(['season', 'round'])]),
         'fv_rank': np.nanmean([g.xfm.rank().corr(g.fv.rank()) for _, g in v.groupby(['season', 'round'])])}
    for r, g in d.groupby('role'):
        gv = g[g.rated]; m[f'brier_{r}'] = ((g.p - g.rated) ** 2).mean(); m[f'fvmae_{r}'] = (gv.xfm - gv.fv).abs().mean(); m[f'fvbias_{r}'] = (gv.xfm - gv.fv).mean()
        m[f'pbias_{r}'] = (g.p - g.rated).mean()
    return m
def run(tag, st, label, ov=None, engine=ENGINE, keep=False):
    files = sorted(str(f) for f in (CACHE / tag / st).glob('*.json'))
    shards = [files[i::4] for i in range(4)]
    with tempfile.TemporaryDirectory() as d:
        d = pathlib.Path(d); ovf = d / 'ov.json'; ovf.write_text(json.dumps(ov or {}))
        ps = []
        for k, sh in enumerate(shards):
            (d / f'f{k}.json').write_text(json.dumps(sh))
            ps.append(subprocess.Popen(['node', '--max-old-space-size=3500', str(HERE / 'run.js'), engine, str(d / f'f{k}.json'), str(N), str(d / f'o{k}.json'), str(ovf)]))
        for p in ps: assert p.wait() == 0
        rows = sum((json.loads((d / f'o{k}.json').read_text()) for k in range(4)), [])
    fc = pd.DataFrame(rows, columns=['season', 'round', 'player_id', 'role', 'p', 'xfm'])
    a = actual(sorted(fc.season.unique()))
    df = fc.merge(a, on=['season', 'round', 'player_id'], how='left')
    df['rated'] = df.rated.fillna(False).astype(bool); df['pts'] = df.fv.where(df.rated, 0).fillna(0)
    m = {'label': label, 'tag': tag, 'set': st, **metrics(df)}
    res = HERE.parents[1] / 'data' / 'backtest' / 'tuning_results.csv'
    pd.DataFrame([m]).to_csv(res, mode='a', header=not res.exists(), index=False)
    if keep: df.to_pickle(CACHE / f'pred_{label}_{st}.pkl')
    return m
if __name__ == '__main__':
    tag, st, label = sys.argv[1:4]
    ov = json.loads(pathlib.Path(sys.argv[4]).read_text()) if len(sys.argv) > 4 and sys.argv[4] != '-' else None
    m = run(tag, st, label, ov, sys.argv[5] if len(sys.argv) > 5 else ENGINE, keep=True)
    print(pd.Series(m).to_string())

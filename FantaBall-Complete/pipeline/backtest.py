"""Season-by-season backtest of the xFM simulation against simple benchmarks. Run once, not weekly:

  python pipeline/backtest.py            # seasons 2021-22 .. 2025-26, 300 simulated seasons each

For each test season the league is built with calibrate.build_league(season, 0): only data from before the
season. Forecasts are scored against what happened, with fantavoto recomputed under the standard rules (engine
RULES) from the actual votes and events, for:
  model        the simulation
  role_avg     every player gets his role's historical average
  last_season  each player's own previous-season numbers (role average if he wasn't in Serie A)
  price        Fantacalcio's preseason price (QI) turned into a forecast by a per-role straight line fitted
               on earlier seasons: the market's view
Caveat: Fantacalcio's archived price lists are end-of-season lists (they include January arrivals and players
who left), so test rosters are not pure preseason rosters; this affects every method alike."""
import datetime, json, subprocess, tempfile, pathlib
import numpy as np
import pandas as pd
import calibrate as C
from common import SEASONS, DATA

TEST = ['2021-22', '2022-23', '2023-24', '2024-25', '2025-26']
N = 300
HERE = pathlib.Path(__file__).parent
CONFIG = {'competition': 'Serie A', 'season': 'backtest', 'teams': 10, 'budget': 500, 'min': 1, 'rounds': 38, 'P': 3, 'D': 8, 'C': 8, 'A': 6}


def actual_fv(v):
    """Fantavoto under the engine's default rules from the recorded vote and events (Fantacalcio provider)."""
    rated = v.vote_fantacalcio.notna() | ((v.red == 1) & v.vote_fantacalcio.isna())
    fv = (v.vote_fantacalcio + 3 * v.goals + 3 * v.pen_scored - 3 * v.pen_missed + 3 * v.pen_saved - 2 * v.own_goals + v.assists
          - 0.5 * v.yellow - v.red - (v.role == 'P') * v.ga + ((v.role == 'P') & (v.ga == 0)) * 1.0)
    fv = fv.where(v.vote_fantacalcio.notna(), 4.0)      # sent off without a vote: 4
    return v.assign(rated=rated, fv=fv.where(rated))


def season_table(season):
    v = actual_fv(C.votes()[C.votes().season == season])
    r = v[v.rated]
    return r.groupby('player_id').agg(rated=('fv', 'size'), xfm=('fv', 'mean'), points=('fv', 'sum'))


def benchmarks(season, roster):
    """role_avg, last_season and price forecasts of xFM, rated games and season points for the roster."""
    i = SEASONS.index(season); past = SEASONS[max(0, i - C.WINDOW):i]
    pr = C.prices()
    hist = []
    for s in past:
        t = season_table(s).reset_index()
        lst = pr[pr.season == s].drop_duplicates('player_id', keep='last')[['player_id', 'role', 'qi']]
        hist.append(lst.merge(t, on='player_id', how='left').fillna({'rated': 0, 'points': 0}).assign(season=s))
    h = pd.concat(hist)
    out = roster[['player_id', 'role', 'qi']].copy()
    # Role average
    ra_x = h[h.rated >= 10].groupby('role').xfm.mean(); ra_r = h.groupby('role').rated.mean()
    out['role_avg_xfm'] = out.role.map(ra_x); out['role_avg_rated'] = out.role.map(ra_r)
    # Last season
    last = h[h.season == past[-1]].set_index('player_id')
    out['last_season_xfm'] = out.player_id.map(last[last.rated >= 5].xfm).fillna(out.role_avg_xfm)
    out['last_season_rated'] = out.player_id.map(last.rated).fillna(out.role_avg_rated)
    # Price: per-role lines on earlier seasons
    for role, g in h.groupby('role'):
        gx = g[g.rated >= 10]
        bx = np.polyfit(gx.qi, gx.xfm, 1) if len(gx) > 5 else [0, gx.xfm.mean()]
        br = np.polyfit(g.qi.fillna(1), g.rated, 1)
        m = out.role == role
        out.loc[m, 'price_xfm'] = np.polyval(bx, out.loc[m, 'qi'].fillna(1))
        out.loc[m, 'price_rated'] = np.clip(np.polyval(br, out.loc[m, 'qi'].fillna(1)), 0, 38)
    for b in ('role_avg', 'last_season', 'price'):
        out[f'{b}_points'] = out[f'{b}_xfm'] * out[f'{b}_rated']
    return out


def run_season(league, season_file, summary=None, n=None, burn_in=0, detail=None):
    """Module 1: simulate burn_in + n seasons, save the last n to the season file (rules-independent);
    optionally the per-player per-matchday summary table as CSV."""
    with tempfile.TemporaryDirectory() as d:
        lf = pathlib.Path(d) / 'league.json'; lf.write_text(json.dumps(league))
        extra = (['--summary', str(summary)] if summary else []) + ['--burn-in', str(burn_in)] + (['--detail', str(detail)] if detail else [])
        out = subprocess.run(['node', '--max-old-space-size=8192', str(HERE / 'run_season.js'), str(lf), str(CONFIG['rounds']), str(n or N), str(season_file), *extra],
                             check=True, capture_output=True, text=True)
        print(out.stdout.strip())


def score_season(season_file, config=None, corr_prefix=None, matchdays=None):
    """Module 2: xFM under the league rules in config (standard rules by default); optionally the
    correlation matrices too (written to corr_prefix_*)."""
    with tempfile.TemporaryDirectory() as d:
        cf, of = pathlib.Path(d) / 'config.json', pathlib.Path(d) / 'out.json'
        cf.write_text(json.dumps(config or CONFIG))
        extra = (['--corr', str(corr_prefix)] if corr_prefix else []) + (['--matchdays', str(matchdays)] if matchdays else [])
        subprocess.run(['node', '--max-old-space-size=8192', str(HERE / 'score_season.js'), str(season_file), str(cf), str(of), *extra], check=True)
        return pd.DataFrame(json.loads(of.read_text())['players'])


def simulate(league):
    with tempfile.TemporaryDirectory() as d:
        sf = pathlib.Path(d) / 'season.fbsim.br'
        run_season(league, sf)
        return score_season(sf)


def spearman(a, b):
    ok = a.notna() & b.notna()
    return float(a[ok].rank().corr(b[ok].rank())) if ok.sum() > 5 else np.nan


def top_overlap(pred, act, role, k):
    """Share of the actual top-k per role (by season points) that the forecast also put in its top-k."""
    hits, rng = [], np.random.default_rng(0)
    pred = pred + rng.uniform(0, 1e-6, len(pred))          # break ties at random (constant forecasts)
    for r, kk in k.items():
        m = role == r
        hits.append(len(set(pred[m].nlargest(kk).index) & set(act[m].nlargest(kk).index)) / kk)
    return float(np.mean(hits))


def score(df):
    rows = {}
    A = df[df.act_rated >= 10]
    topk = {'P': 10, 'D': 30, 'C': 30, 'A': 20}       # roughly the players a 10-team league drafts as starters
    for m in ('model', 'last_season', 'price', 'role_avg'):
        rows[m] = {'xfm_mae': float((A[f'{m}_xfm'] - A.act_xfm).abs().mean()),
                   'xfm_rank_corr': spearman(A[f'{m}_xfm'], A.act_xfm),
                   'rated_mae': float((df[f'{m}_rated'] - df.act_rated).abs().mean()),
                   'points_rank_corr': spearman(df[f'{m}_points'], df.act_points),
                   'points_rank_corr_within_role': float(np.nanmean([spearman(g[f'{m}_points'], g.act_points) for _, g in df.groupby('role')])),
                   'top_k_overlap': top_overlap(df[f'{m}_points'], df.act_points, df.role, topk)}
    rows['model']['xfm_band_coverage'] = float(((A.act_xfm >= A.xfmLow) & (A.act_xfm <= A.xfmHigh)).mean())
    rows['model']['rated_band_coverage'] = float(((df.act_rated >= df.glo) & (df.act_rated <= df.ghi)).mean())
    return rows


def run():
    all_rows, preds = [], []
    for season in TEST:
        lg = C.build_league(season, 0)
        sim = simulate(lg).assign(player_id=lambda d: d.id.astype(int))
        roster = pd.DataFrame(lg['players'])[['id', 'role', 'qi']].assign(player_id=lambda d: d.id.astype(int))
        df = benchmarks(season, roster).merge(sim[['player_id', 'xfm', 'xfmLow', 'xfmHigh', 'rated', 'glo', 'ghi', 'expected']], on='player_id')
        df = df.rename(columns={'xfm': 'model_xfm', 'rated': 'model_rated', 'expected': 'model_points'})
        act = season_table(season)
        df['act_rated'] = df.player_id.map(act.rated).fillna(0); df['act_xfm'] = df.player_id.map(act.xfm); df['act_points'] = df.player_id.map(act.points).fillna(0)
        df['season'] = season
        preds.append(df)
        for method, r in score(df).items():
            all_rows.append({'season': season, 'method': method, **r})
        print(season, 'done', flush=True)
    res = pd.DataFrame(all_rows)
    out = DATA / 'backtest'; out.mkdir(exist_ok=True)
    stamp = str(datetime.date.today())
    res.to_csv(out / f'scores_{stamp}.csv', index=False)
    pd.concat(preds).to_csv(out / f'predictions_{stamp}.csv.gz', index=False)
    summary = res.groupby('method').mean(numeric_only=True).round(4)
    summary.to_csv(out / f'summary_{stamp}.csv')
    print(summary.to_string())
    return res, summary


if __name__ == '__main__':
    run()

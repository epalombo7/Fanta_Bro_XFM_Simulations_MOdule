"""Injury risk and injury length per player, from Fantacalcio.it matchday statuses (no Transfermarkt).

A spell is a run of consecutive matchdays marked "Infortunato". For each player:
  injuryRisk  = new spells per matchday at risk (available or suspended), empirical-Bayes shrunk to the role average
  injuryGames = mean matchdays missed per spell, shrunk to the role average
Seasons are down-weighted with age. A rolling backtest compares the forecast with a role-average baseline."""
import datetime, glob, json, re
import numpy as np
import pandas as pd
from common import SEASONS, CURRENT, DATA, RAW

DECAY = 0.75          # weight of a season relative to the next one
PRIOR_SPELLS = 3      # pseudo-spells pulling a player's mean length towards the role mean
AT_RISK = {'started', 'sub_in', 'unused', 'suspended'}


def load():
    md = pd.concat([pd.read_csv(f) for f in sorted(glob.glob(str(RAW / 'fantacalcio' / 'player_matchdays_*.csv.gz')))])
    md = md[md.status.isin(AT_RISK | {'injured'})]
    roles = pd.concat([pd.read_csv(f)[['season', 'player_id', 'name', 'team', 'role']] for f in glob.glob(str(RAW / 'fantacalcio' / 'prices_*.csv'))])
    roles = roles.drop_duplicates(['season', 'player_id'], keep='last')
    return md.merge(roles, on=['season', 'player_id'], how='left')


def spells(md):
    """One row per player-season with exposure, plus one row per spell (length, censoring)."""
    expo, sp = [], []
    for (season, pid), g in md.sort_values('round').groupby(['season', 'player_id']):
        st, rounds = g.status.tolist(), g['round'].tolist()
        role = g.role.dropna().iloc[0] if g.role.notna().any() else None
        expo.append({'season': season, 'player_id': pid, 'role': role, 'exposure': sum(s in AT_RISK for s in st)})
        k = 0
        while k < len(st):
            if st[k] != 'injured':
                k += 1; continue
            j = k
            while j + 1 < len(st) and st[j + 1] == 'injured' and rounds[j + 1] == rounds[j] + 1:
                j += 1
            sp.append({'season': season, 'player_id': pid, 'role': role, 'start': rounds[k], 'length': j - k + 1,
                       'left_censored': k == 0,                                   # injured from his first matchday: start unknown
                       'right_censored': j == len(st) - 1 and (season == CURRENT or rounds[j] < 38)})
            k = j + 1
    return pd.DataFrame(expo), pd.DataFrame(sp)


def fit(expo, sp, upto):
    """Fit on seasons before `upto` (or all if None). Returns per-player table and role/league settings."""
    idx = {s: i for i, s in enumerate(SEASONS)}
    last = idx[upto] - 1 if upto else idx[CURRENT]
    e = expo[expo.season.map(idx) <= last].copy(); s = sp[sp.season.map(idx) <= last].copy()
    e['w'] = DECAY ** (last - e.season.map(idx)); s['w'] = DECAY ** (last - s.season.map(idx))
    new = s[~s.left_censored]
    done = s[~s.left_censored & ~s.right_censored]
    # League dispersion of (length - 1): negative binomial by moments, var = mu + mu^2/k
    x = done.length - 1
    k = float(x.mean() ** 2 / max(x.var() - x.mean(), 1e-6))
    per = e.groupby('player_id').agg(role=('role', 'last'), exposure=('exposure', lambda v: (v * e.loc[v.index, 'w']).sum()))
    per['spells'] = new.groupby('player_id').w.sum().reindex(per.index).fillna(0)
    per['len_sum'] = done.assign(wl=done.length * done.w).groupby('player_id').wl.sum().reindex(per.index).fillna(0)
    per['len_n'] = done.groupby('player_id').w.sum().reindex(per.index).fillna(0)
    roles = {}
    for role, g in per.groupby('role'):
        m = g.spells.sum() / g.exposure.sum()
        big = g[g.exposure >= 10]
        between = np.var(big.spells / big.exposure) - m * np.mean(1 / big.exposure) if len(big) > 20 else np.nan   # Poisson noise removed
        a = m * m / max(between, (0.3 * m) ** 2) if np.isfinite(between) else 2.0     # weak prior when data are thin
        dl = done[done.player_id.isin(g.index)]
        roles[role] = {'hazard': m, 'prior_a': a, 'prior_b': a / m, 'mean_games': float((dl.length * dl.w).sum() / dl.w.sum())}
    per['injuryRisk'] = [(roles[r]['prior_a'] + sp_) / (roles[r]['prior_b'] + ex) if r in roles else np.nan for r, sp_, ex in zip(per.role, per.spells, per.exposure)]
    per['injuryGames'] = [(PRIOR_SPELLS * roles[r]['mean_games'] + ls) / (PRIOR_SPELLS + n) if r in roles else np.nan for r, ls, n in zip(per.role, per.len_sum, per.len_n)]
    return per, roles, k


def backtest(expo, sp, md):
    """For each season, fit on earlier seasons and score that season's injury starts (log-loss per at-risk matchday)."""
    out = []
    for season in SEASONS[3:]:
        if season not in set(expo.season) or not (expo.season < season).any():
            continue
        per, roles, _ = fit(expo, sp, season)
        e = expo[expo.season == season].set_index('player_id')
        starts = sp[(sp.season == season) & ~sp.left_censored].groupby('player_id').size().reindex(e.index).fillna(0)
        h_model = per.injuryRisk.reindex(e.index)
        h_role = e.role.map({r: v['hazard'] for r, v in roles.items()})
        h_model = h_model.fillna(h_role)
        ok = h_role.notna() & (e.exposure > 0)
        def ll(h):
            h = h[ok].clip(1e-4, .5); n, y = e.exposure[ok], starts[ok]
            return float(-(y * np.log(h) + (n - y) * np.log(1 - h)).sum() / n.sum())
        out.append({'season': season, 'player_seasons': int(ok.sum()), 'injury_starts': int(starts[ok].sum()),
                    'logloss_model': ll(h_model), 'logloss_role_average': ll(h_role)})
    return pd.DataFrame(out)


def current_injuries(per):
    """Matches still to miss now: latest Fantacalcio injury list (expected return) else the player's current spell."""
    snaps = sorted(glob.glob(str(RAW / 'fantacalcio' / 'snapshots' / 'injuries_*.csv')))
    if not snaps:
        return pd.Series(dtype=float)
    inj = pd.read_csv(snaps[-1])
    prices = pd.read_csv(RAW / 'fantacalcio' / f'prices_{CURRENT}.csv')
    prices['key'] = prices.team_slug + '|' + prices.name.str.lower()
    inj['key'] = inj.team.str.lower().str.replace(' ', '-') + '|' + inj.name.str.lower()
    inj = inj.merge(prices[['key', 'player_id']], on='key', how='left')
    cal = pd.read_csv(RAW / 'openfootball' / 'matches.csv')
    # Matchdays still to come (by date: the calendar's results can lag) and before the expected return
    cal = pd.to_datetime(cal[cal.season == CURRENT].groupby('round').date.max())
    cal = cal[cal > pd.Timestamp(datetime.date.today())]
    def missed(ret):
        if pd.isna(ret):
            return np.nan
        return int((cal < pd.Timestamp(ret)).sum())
    inj['injuredFor'] = inj.expected_return.map(missed)
    # No return date given: expected remaining length of the spell
    inj['injuredFor'] = inj.injuredFor.fillna(inj.player_id.map(per.injuryGames).fillna(3)).round()
    return inj.dropna(subset=['player_id']).set_index('player_id').injuredFor


if __name__ == '__main__':
    md = load()
    expo, sp = spells(md)
    per, roles, k = fit(expo, sp, None)
    per['injuredFor'] = current_injuries(per).reindex(per.index).fillna(0)
    names = md.drop_duplicates('player_id', keep='last').set_index('player_id')[['name', 'team']]
    per = per.join(names)
    per[['name', 'team', 'role', 'injuryRisk', 'injuryGames', 'injuredFor', 'spells', 'exposure']].round(4).to_csv(DATA / 'params' / 'injuries.csv')
    bt = backtest(expo, sp, md)
    json.dump({'fitted': str(datetime.date.today()), 'seasons': sorted(set(expo.season)), 'decay': DECAY, 'prior_spells': PRIOR_SPELLS,
               'injuryDispersion': round(k, 3), 'roles': roles, 'spells_used': int((~sp.left_censored).sum()),
               'backtest': bt.to_dict('records')}, open(DATA / 'params' / 'injury_model.json', 'w'), indent=2, default=float)
    print(pd.Series(roles).apply(lambda r: {k_: round(v, 4) for k_, v in r.items()}).to_string())
    print('dispersion k', round(k, 3), '| spells', int((~sp.left_censored).sum()))
    print(bt.round(4).to_string())

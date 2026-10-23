"""Injury risk and injury length per player, from FotMob's per-match unavailable lists (no Transfermarkt).

For every team match FotMob lists the players out injured. A spell is a run of consecutive team matches in
which a player is listed injured and not in the matchday squad. For each player:
  injuryRisk  = new spells per team match at risk, empirical-Bayes shrunk to his role x age-group average
  injuryGames = mean matches missed per spell, shrunk to the same group average
Seasons are down-weighted with age. A rolling backtest compares the forecast with group- and league-average
baselines. Current injuries (matches still to miss) come from today's Fantacalcio.it injury list.
Fantacalcio.it's own matchday statuses only keep "injured" for the live season, so they can't give history."""
import datetime, glob, json, re, unicodedata
import numpy as np
import pandas as pd
from common import SEASONS, CURRENT, DATA, RAW

DECAY = 0.75          # weight of a season relative to the next one
PRIOR_SPELLS = 3      # pseudo-spells pulling a player's mean length towards the group mean
GROUP_PRIOR = 5000    # pseudo-matches pulling a role x age group's rate towards the league rate
MIN_LISTED = 0.8      # a season is used only if FotMob lists >= this many injured players per team per match
AGE_BANDS = [(0, 23, 'U24'), (24, 29, '24-29'), (30, 99, '30+')]


def norm(s):
    s = unicodedata.normalize('NFKD', str(s)).encode('ascii', 'ignore').decode().lower()
    return re.sub(r'[^a-z ]', ' ', s).split()


def band(age):
    for lo, hi, name in AGE_BANDS:
        if pd.notna(age) and lo <= age <= hi:
            return name
    return '24-29'


def load():
    """FotMob seasons whose injury lists are complete enough (older and live seasons are often sparse)."""
    read = lambda kind: pd.concat([pd.read_csv(f) for s in SEASONS for f in glob.glob(str(RAW / 'fotmob' / f'{kind}_{s}.csv*'))])
    matches, squads, unav = read('matches'), read('squads'), read('unavailable')
    played = matches[matches.finished == True].groupby('season').size() * 2
    listed = (unav[unav.type == 'injury'].groupby('season').size() / played).fillna(0)
    keep = sorted(listed[listed >= MIN_LISTED].index)
    print('injured listed per team-match:', listed.round(2).to_dict(), '-> using', keep)
    sel = lambda d: d[d.season.isin(keep)]
    return sel(matches), sel(squads), sel(unav)


def fantacalcio_ids(players):
    """Map FotMob (season, team, name) to Fantacalcio player_id and Classic role by team and surname."""
    prices = pd.concat([pd.read_csv(f) for f in glob.glob(str(RAW / 'fantacalcio' / 'prices_*.csv'))])
    votes = pd.concat([pd.read_csv(f, usecols=['season', 'team', 'team_slug']) for f in glob.glob(str(RAW / 'fantacalcio' / 'votes_*.csv.gz'))]).drop_duplicates()
    teams = {}
    for (season, slug), g in votes.groupby(['season', 'team_slug']):
        teams[(season, slug)] = g.team.iloc[0]
    out = {}
    by_team = {k: g for k, g in prices.groupby(['season', 'team_slug'])}
    for (season, team), g in players.groupby(['season', 'team']):
        t = norm(team)
        slug = next((s for (se, s), full in teams.items() if se == season and (set(norm(full)) & set(t) or s in ''.join(t))), None)
        cand = by_team.get((season, slug))
        if cand is None:
            continue
        for pid, name in g[['player_id', 'name']].drop_duplicates().itertuples(index=False):
            toks = norm(name)
            best = None
            for r in cand.itertuples():
                ft = norm(r.name)
                initial = [x for x in ft if len(x) == 1]
                sur = [x for x in ft if len(x) > 1]
                if sur and all(x in toks for x in sur) and (not initial or toks[0][0] == initial[0]):
                    best = r; break
            if best is not None:
                out[(season, pid)] = (best.player_id, best.role)
    return out


def spells(matches, squads, unav):
    """Exposure (team matches at risk) per player-season, and one row per injury spell."""
    matches = matches[matches.finished == True]
    order = {}
    for team in set(matches.home) | set(matches.away):
        for season, g in matches[(matches.home == team) | (matches.away == team)].groupby('season'):
            order[(season, team)] = g.sort_values('utc').match_id.tolist()
    inj = unav[unav.type == 'injury']
    in_squad = set(zip(squads.match_id, squads.player_id))
    inj = inj[[(m, p) not in in_squad for m, p in zip(inj.match_id, inj.player_id)]]   # listed but played: not injured
    injured = set(zip(inj.match_id, inj.player_id))
    seen = pd.concat([squads[['season', 'team', 'match_id', 'player_id', 'name', 'age']], inj[['season', 'team', 'match_id', 'player_id', 'name', 'age']]])
    expo, sp = [], []
    for (season, team, pid), g in seen.groupby(['season', 'team', 'player_id']):
        ms = order.get((season, team))
        if not ms:
            continue
        pos = sorted(ms.index(m) for m in g.match_id if m in ms)
        if not pos:
            continue
        span = ms[pos[0]:pos[-1] + 1]                      # from first to last appearance at this club
        st = [(m, pid) in injured for m in span]
        expo.append({'season': season, 'team': team, 'player_id': pid, 'name': g.name.iloc[-1], 'age': g.age.max(), 'exposure': st.count(False)})
        k = 0
        while k < len(st):
            if not st[k]:
                k += 1; continue
            j = k
            while j + 1 < len(st) and st[j + 1]:
                j += 1
            sp.append({'season': season, 'team': team, 'player_id': pid, 'length': j - k + 1, 'left_censored': k == 0,
                       'right_censored': j == len(st) - 1 and span[-1] == ms[-1]})
            k = j + 1
    return pd.DataFrame(expo), pd.DataFrame(sp)


def fit(expo, sp, upto=None, prior_a=None):
    """Fit on seasons before `upto` (or all). Returns per-player table, group settings and dispersion."""
    idx = {s: i for i, s in enumerate(SEASONS)}
    last = idx[upto] - 1 if upto else max(idx[s] for s in expo.season)
    e = expo[expo.season.map(idx) <= last].copy(); s = sp[sp.season.map(idx) <= last].copy()
    e['w'] = DECAY ** (last - e.season.map(idx)); s['w'] = DECAY ** (last - s.season.map(idx))
    new, done = s[~s.left_censored], s[~s.left_censored & ~s.right_censored]
    x = done.length - 1
    k = float(x.mean() ** 2 / max(x.var() - x.mean(), 1e-6))     # negative binomial: var = mu + mu^2/k
    e['wexp'] = e.exposure * e.w
    per = e.sort_values('season').groupby('player_id').agg(name=('name', 'last'), team=('team', 'last'), role=('role', 'last'), age=('age', 'last'), exposure=('wexp', 'sum'))
    per['group'] = per.role.fillna('?') + ' ' + per.age.map(band)
    per['spells'] = new.groupby('player_id').w.sum().reindex(per.index).fillna(0)
    per['len_sum'] = done.assign(wl=done.length * done.w).groupby('player_id').wl.sum().reindex(per.index).fillna(0)
    per['len_n'] = done.groupby('player_id').w.sum().reindex(per.index).fillna(0)
    league_mean_len = float((done.length * done.w).sum() / done.w.sum())
    # Group means, then one pooled prior strength: how much players really differ beyond Poisson noise
    league = per.spells.sum() / per.exposure.sum()
    means = {gname: league if gname.startswith('?') else (g.spells.sum() + GROUP_PRIOR * league) / (g.exposure.sum() + GROUP_PRIOR)
             for gname, g in per.groupby('group')}                                     # unmatched role: league rate
    big = per[per.exposure >= 15]
    m_i = big.group.map(means)
    rel = ((big.spells / big.exposure - m_i) ** 2 - m_i / big.exposure) / m_i ** 2     # excess variance / mean^2, per player
    cv2 = float(np.clip(np.average(rel, weights=big.exposure), 1 / 20, 2))
    a = prior_a or 1 / cv2                                                            # gamma prior shape (in pseudo-injuries)
    groups = {}
    for gname, g in per.groupby('group'):
        m = means[gname]
        groups[gname] = {'players': int(len(g)), 'hazard': float(m), 'prior_a': a, 'prior_b': a / m if m > 0 else 1e3,
                         'mean_games': float((g.len_sum.sum() + PRIOR_SPELLS * league_mean_len) / (g.len_n.sum() + PRIOR_SPELLS))}
    G = per.group.map(groups)
    per['injuryRisk'] = [(gr['prior_a'] + sp_) / (gr['prior_b'] + ex) for gr, sp_, ex in zip(G, per.spells, per.exposure)]
    per['injuryGames'] = [(PRIOR_SPELLS * gr['mean_games'] + ls) / (PRIOR_SPELLS + n) for gr, ls, n in zip(G, per.len_sum, per.len_n)]
    return per, groups, k, league_mean_len


def backtest(expo, sp, prior_a=None):
    """For each season, fit on earlier seasons and score that season's new injuries (log-loss per match at risk)."""
    rows = []
    for season in sorted(set(expo.season))[1:]:
        per, groups, _, mean_len = fit(expo, sp, season, prior_a)
        e = expo[expo.season == season].groupby('player_id').agg(exposure=('exposure', 'sum'), role=('role', 'last'), age=('age', 'last'))
        e['group'] = e.role.fillna('?') + ' ' + e.age.map(band)
        y = sp[(sp.season == season) & ~sp.left_censored].groupby('player_id').size().reindex(e.index).fillna(0)
        h_group = e.group.map({g: v['hazard'] for g, v in groups.items()})
        h_league = pd.Series(per.spells.sum() / per.exposure.sum(), index=e.index)
        h_model = per.injuryRisk.reindex(e.index).fillna(h_group)
        ok = h_group.notna() & (e.exposure > 0)
        def ll(h, relevel=False):
            h = h[ok]; n, k = e.exposure[ok], y[ok]
            if relevel:                      # rescale to the season's actual count: scores who gets injured, not how many
                h = h * k.sum() / (h * n).sum()
            h = h.clip(1e-4, .5)
            return float(-(k * np.log(h) + (n - k) * np.log(1 - h)).sum() / n.sum())
        done = sp[(sp.season == season) & ~sp.left_censored & ~sp.right_censored]
        pl = per.injuryGames.reindex(done.player_id).fillna(mean_len).values
        rows.append({'season': season, 'players': int(ok.sum()), 'new_injuries': int(y[ok].sum()),
                     'logloss_model': ll(h_model), 'logloss_group_avg': ll(h_group), 'logloss_league_avg': ll(h_league),
                     'relevel_model': ll(h_model, True), 'relevel_group_avg': ll(h_group, True), 'relevel_league_avg': ll(h_league, True),
                     'length_mae_model': float(np.mean(np.abs(done.length.values - pl))) if len(done) else None,
                     'length_mae_league_avg': float(np.mean(np.abs(done.length.values - mean_len))) if len(done) else None})
    return pd.DataFrame(rows)


def current_injuries():
    """Matches still to miss now, from the latest Fantacalcio.it injury list (expected return dates)."""
    snaps = sorted(glob.glob(str(RAW / 'fantacalcio' / 'snapshots' / 'injuries_*.csv')))
    if not snaps:
        return pd.Series(dtype=float)
    inj = pd.read_csv(snaps[-1])
    prices = pd.read_csv(RAW / 'fantacalcio' / f'prices_{CURRENT}.csv')
    prices['key'] = prices.team_slug + '|' + prices.name.str.lower()
    inj['key'] = inj.team.str.lower().str.replace(' ', '-') + '|' + inj.name.str.lower()
    inj = inj.merge(prices[['key', 'player_id']], on='key', how='left')
    cal = pd.read_csv(RAW / 'openfootball' / 'matches.csv')
    cal = pd.to_datetime(cal[cal.season == CURRENT].groupby('round').date.max())
    cal = cal[cal > pd.Timestamp(datetime.date.today())]          # matchdays still to come
    inj['injuredFor'] = inj.expected_return.map(lambda r: np.nan if pd.isna(r) else int((cal < pd.Timestamp(r)).sum()))
    return inj.dropna(subset=['player_id']).set_index('player_id').injuredFor


if __name__ == '__main__':
    matches, squads, unav = load()
    expo, sp = spells(matches, squads, unav)
    ids = fantacalcio_ids(expo)
    expo['fc_id'] = [ids.get((s, p), (None, None))[0] for s, p in zip(expo.season, expo.player_id)]
    expo['role'] = [ids.get((s, p), (None, None))[1] for s, p in zip(expo.season, expo.player_id)]
    # Prior strength chosen by backtest: the value with the best average level-adjusted score
    scores = {a: backtest(expo, sp, a).relevel_model.mean() for a in (0.5, 1, 2, 3, 5, 8, 12)}
    best_a = min(scores, key=scores.get)
    print('prior strength (pseudo-injuries) -> backtest score:', {a: round(v, 5) for a, v in scores.items()}, '-> using', best_a)
    per, groups, k, mean_len = fit(expo, sp, prior_a=best_a)
    per['fc_id'] = expo.sort_values('season').groupby('player_id').fc_id.last().reindex(per.index)
    now = current_injuries()
    per['injuredFor'] = per.fc_id.map(now)
    per['injuredFor'] = per.injuredFor.where(per.injuredFor.notna() | ~per.fc_id.isin(now.index), per.injuryGames).fillna(0).round()
    cols = ['fc_id', 'name', 'team', 'role', 'age', 'group', 'injuryRisk', 'injuryGames', 'injuredFor', 'spells', 'exposure']
    per.index.name = 'fotmob_id'
    per[cols].round(4).to_csv(DATA / 'params' / 'injuries.csv')
    bt = backtest(expo, sp, best_a)
    json.dump({'fitted': str(datetime.date.today()), 'source': 'FotMob unavailable lists (history), Fantacalcio.it injury list (current)',
               'seasons': sorted(set(expo.season)), 'decay': DECAY, 'prior_spells': PRIOR_SPELLS, 'prior_strength': best_a, 'prior_strength_scores': scores, 'injuryDispersion': round(k, 3),
               'mean_games_league': round(mean_len, 3), 'groups': groups, 'spells_used': int((~sp.left_censored).sum()),
               'fantacalcio_id_match_rate': round(float(expo.fc_id.notna().mean()), 3), 'backtest': bt.to_dict('records')},
              open(DATA / 'params' / 'injury_model.json', 'w'), indent=2, default=float)
    print(pd.DataFrame(groups).T.round(4).to_string())
    print('dispersion k', round(k, 3), '| spells', int((~sp.left_censored).sum()), '| Fantacalcio id match', round(float(expo.fc_id.notna().mean()), 3))
    print(bt.round(4).to_string())

"""Build the engine's real league for a season from the downloaded history.

build_league(season, as_of_round) uses only data known before that season starts plus rounds <= as_of_round
of the season itself, so the same code serves the weekly forecast (current season, played rounds) and the
backtest (past seasons, as_of_round=0). Output matches engine.js simulate(config, {league, model}):

  teams[]   name, att, def (goal multipliers), slots {P,D,C,A} (starters per role)
  players[] Fantacalcio id, name, team index, role, start (lineup weight), base vote per provider, goalW,
            assistW, penW (per-90 rates), yellow (per 90), injuryRisk, injuryGames, injuredFor, yellows
  fixtures  38 rounds of [home, away] team indices
  model     calibrated MODEL overrides (goals, home edge, penalties, subs, cards, vote model per provider)
"""
import glob, json, re
import numpy as np
import pandas as pd
from common import SEASONS, CURRENT, RAW, DATA
import calibrate_injuries as INJ

DECAY = 0.6            # weight of a past season relative to the next one (rosters change fast)
WINDOW = 3             # past seasons used
PROVIDERS = ['fantacalcio', 'statistico', 'italia']
ROLES = ['P', 'D', 'C', 'A']
FOTMOB_ALIAS = {'AC Milan': 'Milan', 'Hellas Verona': 'Verona', 'Chievo Verona': 'Chievo', 'SSC Napoli': 'Napoli',
                'Parma Calcio 1913': 'Parma', 'SPAL 2013': 'SPAL'}
_cache = {}


# ---------------------------------------------------------------- data loading
def _load(key, pattern, **kw):
    if key not in _cache:
        _cache[key] = pd.concat([pd.read_csv(f, **kw) for f in sorted(glob.glob(str(RAW / pattern)))], ignore_index=True)
    return _cache[key]


def votes():
    v = _load('votes', 'fantacalcio/votes_*.csv.gz')
    if 'gf' not in v:
        home = v.team == v.home
        v['gf'] = np.where(home, v.home_goals, v.away_goals); v['ga'] = np.where(home, v.away_goals, v.home_goals)
    return v


def matchdays():
    md = _load('md', 'fantacalcio/player_matchdays_*.csv.gz')
    if 'minutes' not in md:
        end = md.sub_out_min.fillna(90).clip(upper=90)
        md['minutes'] = np.where(md.status == 'started', end, np.where(md.status == 'sub_in', (end - md.sub_in_min.fillna(90)).clip(lower=0), 0))
    return md


def prices():
    return _load('prices', 'fantacalcio/prices_*.csv')


def results():
    fd = _load('fd', 'football_data/I1_*.csv', usecols=['Season', 'Date', 'HomeTeam', 'AwayTeam', 'FTHG', 'FTAG'])
    return fd.dropna(subset=['FTHG']).assign(HomeTeam=lambda d: d.HomeTeam.replace({'Spal': 'SPAL'}), AwayTeam=lambda d: d.AwayTeam.replace({'Spal': 'SPAL'}))


def fotmob(kind):
    return _load('fm_' + kind, f'fotmob/{kind}_*.csv*')


def history(season, as_of_round=0):
    """Seasons used and their weights: up to WINDOW past seasons, plus the season itself if rounds are played."""
    i = SEASONS.index(season)
    past = SEASONS[max(0, i - WINDOW):i]
    w = {s: DECAY ** (i - k) for k, s in enumerate(SEASONS) if s in past}
    if as_of_round > 0:
        w[season] = 1.0
    return w


def in_history(df, season, as_of_round, w):
    keep = df.season.isin([s for s in w if s != season]) | ((df.season == season) & (df['round'] <= as_of_round))
    d = df[keep].copy()
    d['w'] = d.season.map(w)
    return d


# ---------------------------------------------------------------- teams and calendar
def calendar(season):
    m = fotmob('matches')
    m = m[m.season == season].copy()
    m['home'] = m.home.replace(FOTMOB_ALIAS); m['away'] = m.away.replace(FOTMOB_ALIAS)
    teams = sorted(set(m.home) | set(m.away))
    idx = {t: k for k, t in enumerate(teams)}
    rounds = [[[idx[h], idx[a]] for h, a in zip(g.home, g.away)] for _, g in m.sort_values(['round', 'utc']).groupby('round')]
    dates = m.groupby('round').utc.min().tolist()
    return teams, rounds, dates


def team_strength(season, as_of_round, w, teams):
    """Poisson regression with ridge: log goals = mu + home + attack(team) + defence(opponent)."""
    fd = results()
    d = fd[fd.Season.isin([s for s in w if s != season])].copy()
    d['w'] = d.Season.map(w)
    if as_of_round > 0:          # current season: matches already played, by date order within the season
        cur = fd[fd.Season == season].copy(); cur['w'] = 1.0
        d = pd.concat([d, cur.iloc[:as_of_round * 10]])
    names = sorted(set(d.HomeTeam) | set(d.AwayTeam) | set(teams))
    k = {t: i for i, t in enumerate(names)}; n = len(names)
    rows, y, wt = [], [], []
    for r in d.itertuples():
        for att, opp, goals, home in ((r.HomeTeam, r.AwayTeam, r.FTHG, 1), (r.AwayTeam, r.HomeTeam, r.FTAG, 0)):
            x = np.zeros(2 + 2 * n); x[0] = 1; x[1] = home; x[2 + k[att]] = 1; x[2 + n + k[opp]] = 1
            rows.append(x); y.append(goals); wt.append(r.w)
    X, y, wt = np.array(rows), np.array(y, float), np.array(wt)
    P = np.diag([0, 0] + [4.0] * (2 * n))                      # ridge: team effects ~ N(0, 0.5^2)
    th = np.zeros(2 + 2 * n); th[0] = np.log(y.mean())
    for _ in range(40):
        lam = np.exp(X @ th)
        g = X.T @ (wt * (y - lam)) - P @ th
        H = X.T @ (X * (wt * lam)[:, None]) + P
        step = np.linalg.solve(H, g); th += step
        if np.abs(step).max() < 1e-8:
            break
    se = np.sqrt(np.diag(np.linalg.inv(H)))[2:]
    # Promoted clubs (no matches in the window) get the historical promoted-club average instead of 0
    prom_att, prom_def = promoted_prior(season)
    seen = set(d.HomeTeam) | set(d.AwayTeam)
    out = []
    for t in teams:
        if t in seen:
            out.append({'name': t, 'att': float(np.exp(th[2 + k[t]])), 'def': float(np.exp(th[2 + n + k[t]]))})
        else:
            out.append({'name': t, 'att': prom_att, 'def': prom_def})
    return out, float(th[0]), float(th[1]), float(np.mean(se))


def promoted_prior(season):
    """Goals for/against per match of newly promoted clubs relative to the league, in seasons before `season`."""
    fd = results(); ratios = []
    for s in [x for x in SEASONS if x < season and SEASONS.index(x) > 0]:
        cur, prev = fd[fd.Season == s], fd[fd.Season == SEASONS[SEASONS.index(s) - 1]]
        if cur.empty or prev.empty:
            continue
        mean = (cur.FTHG.sum() + cur.FTAG.sum()) / (2 * len(cur))
        for t in set(cur.HomeTeam) - set(prev.HomeTeam):
            h, a = cur[cur.HomeTeam == t], cur[cur.AwayTeam == t]
            gf = (h.FTHG.sum() + a.FTAG.sum()) / (len(h) + len(a)); ga = (h.FTAG.sum() + a.FTHG.sum()) / (len(h) + len(a))
            ratios.append((gf / mean, ga / mean))
    r = np.array(ratios) if ratios else np.array([[0.85, 1.15]])
    return float(r[:, 0].mean()), float(r[:, 1].mean())


# ---------------------------------------------------------------- league-level settings
def league_settings(v, md):
    played = v.groupby(['season', 'round', 'team']).agg(gf=('gf', 'first'), w=('w', 'first'))
    tm = played.w.sum()                                              # weighted team-matches
    pens = (v.pen_scored + v.pen_missed); W = v.w
    goals = (played.gf * played.w).sum()
    s = {'penaltyRate': float((pens * W).sum() / tm),
         'penaltyConversion': float((v.pen_scored * W).sum() / max((pens * W).sum(), 1e-9)),
         'penaltySavedShare': float(min(1, (v.pen_saved * W).sum() / max((v.pen_missed * W).sum(), 1e-9))),
         'ownGoal': float((v.own_goals * W).sum() / goals),
         'pen_goal_share': float((v.pen_scored * W).sum() / goals)}
    mins = (md.minutes * md.w).sum() / 90
    s['red'] = float((v.red * W).sum() / mins)
    subs = md[md.status == 'sub_in']
    per_match = subs.groupby(['season', 'round', 'player_id']).size().groupby(level=[0, 1]).size() / 20   # approx subs per team-match
    n_sub = float(np.clip(per_match.mean(), 2, 5))
    s['subs'] = [int(max(1, np.floor(n_sub - 1))), int(min(5, np.ceil(n_sub + 1)))]
    sm = subs.minutes[subs.minutes > 0]
    s['subMinutes'] = [int(np.percentile(sm, 10)), int(np.percentile(sm, 90))] if len(sm) else [10, 45]
    # Minutes below which a substitute usually gets no vote (Fantacalcio provider)
    j = subs.merge(v[['season', 'round', 'player_id', 'vote_fantacalcio', 'goals', 'assists', 'pen_scored', 'red']], on=['season', 'round', 'player_id'], how='left')
    j = j[(j.goals.fillna(0) + j.assists.fillna(0) + j.pen_scored.fillna(0) + j.red.fillna(0)) == 0]
    rated = j.groupby(j.minutes.clip(0, 45) // 5 * 5).apply(lambda g: g.vote_fantacalcio.notna().mean())
    s['subRatedMin'] = int(rated[rated >= 0.5].index.min()) if (rated >= 0.5).any() else 25
    return s


def vote_model(v, provider, qi):
    """Within-player regression of the vote on the match outcome and events; returns engine coefficients,
    each player's base vote (shrunk to a role x price prior) and the team / individual noise."""
    col = f'vote_{provider}'
    d = v[v[col].notna() & v.role.isin(ROLES)].copy()
    gd = (d.gf - d.ga).clip(-3, 3)
    P, D = (d.role == 'P').astype(float), (d.role == 'D').astype(float)
    cs = (d.ga == 0).astype(float)
    X = pd.DataFrame({'win': (d.gf > d.ga).astype(float), 'loss': (d.gf < d.ga).astype(float), 'goalDiff': gd,
                      'goal': d.goals + d.pen_scored, 'assist': d.assists, 'penMissed': d.pen_missed, 'penSaved': d.pen_saved,
                      'ownGoal': d.own_goals, 'red': d.red.astype(float), 'gkConceded': P * d.ga, 'gkClean': P * cs,
                      'defConceded': D * d.ga, 'defClean': D * cs})
    y, w, pid = d[col].values, d.w.values, d.player_id.values
    # Demean within player (weighted) so the coefficients aren't driven by who plays for good teams
    grp = pd.Series(range(len(d))).groupby(pid)
    def demean(a):
        a = pd.Series(a)
        m = (a * w).groupby(pid).transform('sum') / pd.Series(w).groupby(pid).transform('sum')
        return (a - m).values
    Xd = np.column_stack([demean(X[c].values) for c in X]); yd = demean(y)
    sw = np.sqrt(w)
    beta = np.linalg.lstsq(Xd * sw[:, None], yd * sw, rcond=None)[0]
    coef = dict(zip(X.columns, beta))
    resid = y - X.values @ beta
    eff = pd.DataFrame({'pid': pid, 'r': resid * w, 'w': w}).groupby('pid').sum()
    d['e'] = resid - pd.Series(pid).map(eff.r / eff.w).values
    tm = d.groupby(['season', 'round', 'team']).e.agg(['mean', 'var', 'size']).dropna()
    team_var = max(tm['mean'].var() - (tm['var'] / tm['size']).mean(), 0.0)
    indiv = max(d.e.var() - team_var, 0.01)
    # Prior for the player effect from his role and initial price (players with little or no history)
    eff['n'] = pd.DataFrame({'pid': pid, 'one': 1.0}).groupby('pid').one.sum()
    eff['mean'] = eff.r / eff.w
    roles = d.groupby('player_id').role.last()
    eff = eff.join(roles).join(qi.rename('qi'))
    prior = {}
    for role, g in eff[eff.n >= 5].groupby('role'):
        g = g.dropna(subset=['qi'])
        b = np.polyfit(g.qi, g['mean'], 1, w=np.sqrt(g.n)) if len(g) > 10 else np.array([0, g['mean'].mean()])
        prior[role] = b
    coef_out = {k: round(float(coef[k]), 4) for k in X.columns}
    coef_out.update({'draw': 0.0, 'teamSd': round(float(np.sqrt(team_var)), 4), 'indivSd': round(float(np.sqrt(indiv)), 4)})
    return coef_out, eff[['mean', 'n']], prior


# ---------------------------------------------------------------- players
def rate_prior(agg, col, qi_col='qi', min_minutes=450):
    """Per-role straight-line prior of a per-90 rate on the initial price (QI), fitted on players with minutes."""
    out = {}
    for role, g in agg[(agg.minutes >= min_minutes) & agg[qi_col].notna()].groupby('role'):
        r = g[col] / (g.minutes / 90)
        out[role] = np.polyfit(g[qi_col], r, 1, w=np.sqrt(g.minutes)) if len(g) > 10 else np.array([0, r.mean()])
    return out


def build_league(season, as_of_round=0, verbose=False):
    w = history(season, as_of_round)
    v = in_history(votes(), season, as_of_round, w)
    md = in_history(matchdays(), season, as_of_round, w)
    pr = prices()
    roster = pr[pr.season == season].drop_duplicates('player_id', keep='last').copy()
    # Each player's club this season: the club he voted for most recently, else the price list's club
    slug2team = votes()[votes().season == season].drop_duplicates('team_slug').set_index('team_slug').team.to_dict()
    teams, rounds, dates = calendar(season)
    roster['club'] = roster.team_slug.map(slug2team)
    if roster.club.isna().any():   # clubs without a vote yet this season (preseason): match the calendar by slug
        alias = {re.sub(r'[^a-z]', '', t.lower()): t for t in teams}
        roster['club'] = roster.club.fillna(roster.team_slug.str.replace('-', '').map(alias))
    roster = roster[roster.club.isin(teams)]
    qi = pr[pr.season.isin(list(w))].groupby(['season', 'player_id']).qi.last()
    qi_now = roster.set_index('player_id').qi

    # Team strength and league settings
    tstr, mu, home, team_se = team_strength(season, as_of_round, w, teams)
    s = league_settings(v, md)
    model = {'baseGoals': round(float(np.exp(mu + home / 2) * (1 - s['pen_goal_share'])), 4), 'home': round(float(np.exp(home / 2)), 4),
             'teamSd': round(team_se, 4), **{k: (round(x, 4) if isinstance(x, float) else x) for k, x in s.items() if k != 'pen_goal_share'}}

    # Player-season aggregates, weighted by season
    md['on'] = md.status.isin(['started', 'sub_in', 'unused', 'injured', 'suspended']).astype(float)
    md['st'] = (md.status == 'started').astype(float)
    a = md.groupby('player_id').apply(lambda g: pd.Series({'rounds': (g.on * g.w).sum(), 'starts': (g.st * g.w).sum(), 'minutes': (g.minutes * g.w).sum()}))
    ev = v.assign(pens=v.pen_scored + v.pen_missed)
    for c in ['goals', 'assists', 'pens', 'yellow']:
        ev[c + '_w'] = ev[c] * ev.w
    e = ev.groupby('player_id')[['goals_w', 'assists_w', 'pens_w', 'yellow_w']].sum()
    e.columns = ['goals', 'assists', 'pens', 'yellow']
    agg = a.join(e).fillna(0)
    agg['role'] = pr.drop_duplicates('player_id', keep='last').set_index('player_id').role.reindex(agg.index)
    agg['qi'] = qi.groupby(level=1).last().reindex(agg.index)
    priors = {c: rate_prior(agg, c) for c in ['goals', 'assists', 'pens', 'yellow']}
    # Start-share prior from price
    sp = {}
    for role, g in agg[(agg.rounds >= 10) & agg.qi.notna()].groupby('role'):
        sp[role] = np.polyfit(g.qi, g.starts / g.rounds, 1, w=np.sqrt(g.rounds))

    # Vote model per provider
    vote_coef, bases = {}, {}
    for prov in PROVIDERS:
        coef, eff, prior = vote_model(v, prov, qi_now.combine_first(agg.qi))
        vote_coef[prov], bases[prov] = coef, (eff, prior)
    model['voteByProvider'] = vote_coef
    model['vote'] = vote_coef['fantacalcio']

    # Injuries: FotMob fit with seasons before this one, matched to Fantacalcio ids
    inj = injuries_for(season, as_of_round, roster, teams, dates)

    # Starters per role for each club (from its recent lineups), league average for others
    started = md[md.st == 1].merge(pr.drop_duplicates(['season', 'player_id'], keep='last')[['season', 'player_id', 'role']], on=['season', 'player_id'], how='left')
    vt = v.drop_duplicates(['season', 'round', 'player_id'])[['season', 'round', 'player_id', 'team']]
    started = started.merge(vt, on=['season', 'round', 'player_id'], how='left').dropna(subset=['team', 'role'])
    per = started.groupby(['team', 'season', 'round', 'role']).size().unstack(fill_value=0)
    league_avg = per[['D', 'C', 'A']].mean()
    last = per.reset_index().sort_values('season').groupby('team').season.last()

    def slots(team):
        x = per.loc[(team, last[team])][['D', 'C', 'A']].mean() if team in last.index else league_avg
        x = x * 10 / x.sum(); base = np.floor(x).astype(int); rem = 10 - base.sum()
        for r in (x - base).sort_values(ascending=False).index[:rem]:
            base[r] += 1
        return {'P': 1, **{r: int(base[r]) for r in ['D', 'C', 'A']}}

    players = []
    tix = {t: i for i, t in enumerate(teams)}
    for r in roster.itertuples():
        pid, role, q = r.player_id, r.role, r.qi if pd.notna(r.qi) else 1
        h = agg.loc[pid] if pid in agg.index else None
        mins90 = (h.minutes / 90) if h is not None else 0.0
        def rate(col, n0=10):
            pri = max(0.0, float(np.polyval(priors[col].get(role, [0, 0]), q))) if role in priors[col] else 0.0
            return float(((h[col] if h is not None else 0) + n0 * pri) / (mins90 + n0))
        rounds_ = h.rounds if h is not None else 0
        s_pri = float(np.clip(np.polyval(sp.get(role, [0, 0.4]), q), 0.02, 0.95))
        share = float(np.clip(((h.starts if h is not None else 0) + 5 * s_pri) / (rounds_ + 5), 0.01, 0.97))
        base = {}
        for prov in PROVIDERS:
            eff, prior = bases[prov]
            pri = float(np.polyval(prior.get(role, [0, 6]), q))
            if pid in eff.index:
                n, m = eff.loc[pid, 'n'], eff.loc[pid, 'mean']
                base[prov] = round((m * n + pri * 5) / (n + 5), 3)
            else:
                base[prov] = round(pri, 3)
        ij = inj.get(pid, {})
        players.append({'id': str(pid), 'name': r.name, 'team': tix[r.club], 'role': role, 'qi': r.qi,
                        'start': round(share / (1 - share), 4),
                        'base': base['fantacalcio'], 'baseByProvider': base,
                        'goalW': round(rate('goals'), 5), 'assistW': round(rate('assists'), 5), 'penW': round(rate('pens', 5), 5),
                        'yellow': round(rate('yellow'), 4),
                        'injuryRisk': round(ij.get('injuryRisk', inj['_default_risk']), 5), 'injuryGames': round(ij.get('injuryGames', inj['_default_games']), 3),
                        'injuredFor': int(ij.get('injuredFor', 0)),
                        'yellows': int(v[(v.season == season) & (v.player_id == pid)].yellow.sum()) if as_of_round else 0})
    model['injuryDispersion'] = round(inj['_k'], 3)
    for t in tstr:
        t['slots'] = slots(t['name'])
    if verbose:
        print(season, 'as of round', as_of_round, '| teams', len(teams), '| players', len(players), '| model', {k: v_ for k, v_ in model.items() if k not in ('voteByProvider', 'vote')})
    return {'season': season, 'as_of_round': as_of_round, 'teams': tstr, 'players': players, 'fixtures': rounds, 'round_dates': dates, 'model': model}


def injuries_for(season, as_of_round, roster, teams, dates):
    """Per Fantacalcio id: injuryRisk / injuryGames from the FotMob fit on earlier seasons, and injuredFor now."""
    m, sq, un = INJ.load()
    expo, sp = INJ.spells(m, sq, un)
    ids = INJ.fantacalcio_ids(expo)
    expo['fc_id'] = [ids.get((s, p), (None, None))[0] for s, p in zip(expo.season, expo.player_id)]
    expo['role'] = [ids.get((s, p), (None, None))[1] for s, p in zip(expo.season, expo.player_id)]
    meta = json.load(open(DATA / 'params' / 'injury_model.json')) if (DATA / 'params' / 'injury_model.json').exists() else {}
    upto = season if season in set(expo.season) or season > max(expo.season) else None
    usable = expo[expo.season < season]
    if usable.empty:
        return {'_default_risk': 0.02, '_default_games': 2.3, '_k': 0.3}
    per, groups, k, mean_len = INJ.fit(usable, sp[sp.season < season], None, meta.get('prior_strength', 1))
    per['fc_id'] = usable.sort_values('season').groupby('player_id').fc_id.last().reindex(per.index)
    by_fc = per.dropna(subset=['fc_id']).drop_duplicates('fc_id', keep='last').set_index('fc_id')
    out = {int(i): {'injuryRisk': float(r.injuryRisk), 'injuryGames': float(r.injuryGames)} for i, r in by_fc.iterrows()}
    league_risk = per.spells.sum() / per.exposure.sum()
    # Injured now: preseason/backtest from FotMob's list before the next round, live season from Fantacalcio's list
    if season == CURRENT:
        for pid, n in INJ.current_injuries().items():
            out.setdefault(int(pid), {})['injuredFor'] = int(n) if pd.notna(n) else 2
    else:
        un_s = un[(un.season == season) & (un.type == 'injury') & (un['round'] == as_of_round + 1)]
        ids_s = INJ.fantacalcio_ids(un_s.assign(season=season)[['season', 'team', 'player_id', 'name']].drop_duplicates())
        for r in un_s.itertuples():
            fc = ids_s.get((season, r.player_id), (None,))[0]
            if fc is not None:
                out.setdefault(int(fc), {})['injuredFor'] = matches_until(r.expected_return, dates, as_of_round)
    out.update({'_default_risk': float(league_risk), '_default_games': float(mean_len), '_k': float(k)})
    return out


def matches_until(text, dates, as_of_round):
    """FotMob expected return ('Late October 2023', 'Out for season', 'Doubtful') to matches still to miss."""
    t = str(text or '')
    if 'season' in t.lower():
        return 38 - as_of_round
    mm = re.match(r'(Early|Mid|Late)?\s*([A-Za-z]+)\s+(\d{4})', t)
    if not mm:
        return 1
    day = {'Early': 5, 'Mid': 15, 'Late': 25}.get(mm.group(1), 15)
    try:
        ret = pd.Timestamp(f'{mm.group(3)}-{mm.group(2)}-{day}')
    except Exception:
        return 1
    ds = pd.to_datetime(pd.Series(dates[as_of_round:]), utc=True).dt.tz_localize(None)
    return int(max(1, (ds < ret).sum()))


if __name__ == '__main__':
    import sys
    season = sys.argv[1] if len(sys.argv) > 1 else CURRENT
    rnd = int(sys.argv[2]) if len(sys.argv) > 2 else 0
    lg = build_league(season, rnd, verbose=True)
    print(json.dumps(lg['model'], indent=1)[:1500])

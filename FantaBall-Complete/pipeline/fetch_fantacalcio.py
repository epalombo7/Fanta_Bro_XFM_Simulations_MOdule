"""Fantacalcio.it: price lists with roles, votes with bonus detail, per-player matchday status
(started / came on / suspended / injured / unused) with sub minutes, and dated snapshots of
current injuries and probable lineups. Parses the public HTML pages; the Excel exports need a login."""
import datetime, html, re, sys
import pandas as pd
from common import SEASONS, CURRENT, get, num, out

BASE = 'https://www.fantacalcio.it'
LINK = re.compile(r'href="https://www\.fantacalcio\.it/serie-a/squadre/([^/"]+)/([^/"]+)/(\d+)(?:/(\d{4}-\d{2}))?"')
BONUS = ['goals', 'conceded', 'own_goals', 'pen_scored', 'pen_missed', 'pen_saved', 'assists', 'motm']
PROVIDERS = ['fantacalcio', 'statistico', 'italia']
STATUS = {'Titolare': 'started', 'Entrato': 'sub_in', 'Squalificato': 'suspended', 'Infortunato': 'injured', 'Inutilizzato': 'unused'}
LIVE = 6 * 3600   # pages of the current season are re-downloaded after 6 hours


def text(s):
    return re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', ' ', s))).strip()


def age(season):
    return LIVE if season == CURRENT else None


def prices(season):
    page = get(f'{BASE}/quotazioni-fantacalcio/{season}', max_age=age(season))
    rows = []
    for r in re.findall(r'<tr class="player-row"(.*?)</tr>', page, re.S):
        link = LINK.search(r)
        cell = lambda k: num(re.search(rf'data-col-key="{k}">\s*([^<]*)<', r).group(1)) if re.search(rf'data-col-key="{k}"', r) else None
        rows.append({'season': season, 'player_id': int(link.group(3)), 'name': text(re.search(r'<span>(.*?)</span>', r, re.S).group(1)),
                     'team_slug': link.group(1), 'player_slug': link.group(2),
                     'team': text(re.search(r'data-col-key="sq">(.*?)<', r, re.S).group(1)),
                     'role': re.search(r'data-filter-role-classic="([^"]*)"', r).group(1).upper(),
                     'role_mantra': re.search(r'data-filter-role-mantra="([^"]*)"', r).group(1),
                     'qi': cell('c_qi'), 'qa': cell('c_qa'), 'fvm': cell('c_fvm'),
                     'qi_mantra': cell('m_qi'), 'qa_mantra': cell('m_qa'), 'fvm_mantra': cell('m_fvm')})
    return pd.DataFrame(rows)


def votes(season, rnd):
    page = get(f'{BASE}/voti-fantacalcio-serie-a/{season}/{rnd}', max_age=age(season))
    if not page:
        return []
    rows = []
    for block in re.findall(r'<li id="team-\d+" class="team-table">(.*?)</table>', page, re.S):
        head = [(c, t.strip()) for c, t in re.findall(r'<span(?: class="([^"]*)")?>([^<]*)</span>', block.split('</header>')[0])]
        if len(head) < 5:
            continue
        (hc, home), (_, hg), _, (ac, ag), (tc, away) = head[:5]
        team = home if 'current' in hc else away
        date = text(re.search(r'match-date[^>]*>(.*?)</div>', block, re.S).group(1))
        for tr in re.findall(r'<tr>(.*?)</tr>', block.split('<tbody>')[-1], re.S):
            role = re.search(r'class="role" data-value="([^"]*)"', tr)
            link = LINK.search(tr)
            if not role or not link or role.group(1) == 'all':     # skip coaches
                continue
            grades = re.findall(r'class="player-grade ([^"]*)" data-value="([^"]*)"', tr)
            fanta = re.findall(r'class="player-fanta-grade" data-value="([^"]*)"', tr)
            bonus = [num(v) for v in re.findall(r'class="player-bonus[^"]*" data-value="([^"]*)"', tr)]
            row = {'season': season, 'round': rnd, 'date': date, 'home': home, 'away': away, 'home_goals': num(hg), 'away_goals': num(ag),
                   'team': team, 'player_id': int(link.group(3)), 'name': text(re.search(r'<span>(.*?)</span>', tr, re.S).group(1)),
                   'team_slug': link.group(1), 'player_slug': link.group(2), 'role': role.group(1).upper(),
                   'yellow': int('yellow-card' in grades[0][0]) if grades else 0, 'red': int('red-card' in grades[0][0]) if grades else 0}
            for k, (g, f) in zip(PROVIDERS, zip(grades, fanta)):
                row[f'vote_{k}'] = None if g[1] == '55' else num(g[1])          # 55 = no vote (s.v.)
                row[f'fv_{k}'] = None if f == '55' else num(f)
            row.update(dict(zip(BONUS, bonus)))
            rows.append(row)
    return rows


def player_season(team_slug, player_slug, pid, season):
    page = get(f'{BASE}/serie-a/squadre/{team_slug}/{player_slug}/{pid}/{season}', delay=0.8, max_age=age(season))
    if not page:
        return []
    status = dict(re.findall(r'content="Stato (\d+)&#xAA; Giornata di Seria A">\s*<meta itemprop="value" content="([^"]+)"', page))
    detail = {}
    tbody = page[page.find('<tbody', page.find('Riepilogo stagione')):]
    for tr in re.findall(r'<tr>(.*?)</tr>', tbody.split('</tbody>')[0], re.S):
        wk = re.search(r'matchweek[^>]*>(\d+)<', tr)
        if not wk:
            continue
        sub_in = re.search(r'class="sub-in" data-minute="([^"]*)"', tr)
        sub_out = re.search(r'class="sub-out" data-minute="([^"]*)"', tr)
        detail[wk.group(1)] = {'sub_in_min': num(sub_in.group(1)) if sub_in else None, 'sub_out_min': num(sub_out.group(1)) if sub_out else None,
                               'score': text(re.search(r'match-score">([^<]*)<', tr).group(1)) if re.search(r'match-score">', tr) else None}
    return [{'season': season, 'player_id': pid, 'round': int(k), 'status': STATUS.get(v, v if 'non ancora' not in v else 'not_played'), **detail.get(k, {})}
            for k, v in sorted(status.items(), key=lambda kv: int(kv[0]))]


MONTHS = {m: i + 1 for i, m in enumerate(['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'])}
PART = {'inizio': 5, 'primi giorni': 5, 'prima metà': 8, 'metà': 15, 'seconda metà': 22, 'fine': 28}


def expected_return(desc, today):
    """Turn phrases like 'recuperabile dalla seconda metà di novembre' into a date estimate (None if absent)."""
    m = re.search(r"(?:recuperabil\w*|rientro|rientrare|torn\w*|disponibil\w*)[^.]*?(?:(inizio|primi giorni|prima metà|seconda metà|metà|fine)\s+(?:di\s+|del\s+mese\s+di\s+)?)?(gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)", desc.lower())
    if not m:
        return None
    month, day = MONTHS[m.group(2)], PART.get(m.group(1) or 'metà', 15)
    year = today.year + (1 if month < today.month - 1 else 0)
    return datetime.date(year, month, day)


def injuries_snapshot():
    page = get(f'{BASE}/indisponibili-serie-a', cache=False)
    today, rows = datetime.date.today(), []
    for card in page.split('class="card team-card"')[1:]:
        team = text(re.search(r'class="team-name">(.*?)</span>', card, re.S).group(1))
        for col in card.split('<div class="col">')[1:]:
            label = text(col.split('</header>')[0])
            for name, desc in re.findall(r'class="item-name">(.*?)</strong>\s*<div class="item-description">(.*?)</div>', col, re.S):
                d = text(desc)
                ret = expected_return(d, today) if 'nfortun' in label else None
                rows.append({'date': str(today), 'team': team, 'category': label, 'name': text(name), 'text': d,
                             'expected_return': str(ret) if ret else None})
    df = pd.DataFrame(rows)
    df.to_csv(out('fantacalcio', 'snapshots', f'injuries_{today}.csv'), index=False)
    return df


def lineups_snapshot():
    page = get(f'{BASE}/probabili-formazioni-serie-a', cache=False)
    rows = []
    for kind in ('starters', 'reserves'):
        for ul in re.findall(rf'<ul class="player-list {kind}">(.*?)</ul>', page, re.S):
            for li in re.findall(r'<li class="player-item[^"]*"[^>]*>(.*?)</li>', ul, re.S):
                link, role, pct = LINK.search(li), re.search(r'data-value="([a-z]+)"', li), re.search(r'progress-value">\s*(\d+)%', li)
                if link:
                    rows.append({'date': str(datetime.date.today()), 'team_slug': link.group(1), 'player_id': int(link.group(3)),
                                 'name': text(re.search(r'<span>(.*?)</span>', li, re.S).group(1)), 'role': role.group(1).upper() if role else None,
                                 'list': kind, 'start_pct': num(pct.group(1)) if pct else None})
    df = pd.DataFrame(rows)
    df.to_csv(out('fantacalcio', 'snapshots', f'probable_lineups_{datetime.date.today()}.csv'), index=False)
    return df


def run(seasons, with_players=True):
    for s in seasons:
        p = prices(s); p.to_csv(out('fantacalcio', f'prices_{s}.csv'), index=False)
        v = pd.DataFrame([r for rnd in range(1, 39) for r in votes(s, rnd)])
        v.to_csv(out('fantacalcio', f'votes_{s}.csv.gz'), index=False)
        print(s, 'prices', len(p), 'votes', len(v), flush=True)
        if not with_players:
            continue
        # Everyone in the season's price list or with a vote; the page URL needs that season's team slug
        who = pd.concat([v[['player_id', 'team_slug', 'player_slug']].drop_duplicates('player_id', keep='last') if len(v) else None,
                         p[['player_id', 'team_slug', 'player_slug']]]).drop_duplicates('player_id')
        rows = []
        for i, r in enumerate(who.itertuples()):
            rows += player_season(r.team_slug, r.player_slug, r.player_id, s)
            if i % 100 == 0:
                print(s, 'player pages', i, '/', len(who), flush=True)
        pd.DataFrame(rows).to_csv(out('fantacalcio', f'player_matchdays_{s}.csv.gz'), index=False)
        print(s, 'player matchdays', len(rows), flush=True)


if __name__ == '__main__':
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    if '--snapshots' in sys.argv:
        print('injuries', len(injuries_snapshot()), 'lineups', len(lineups_snapshot()))
    else:
        run(args or SEASONS[::-1], with_players='--no-players' not in sys.argv)

"""Assemble the FantaBall app page: python pipeline/page/assemble_app.py <app_data.json> <out.html>
Seeds the two stored squads (data/teams/my_teams.json) with their league rules."""
import json, pathlib, sys, unicodedata
H = pathlib.Path(__file__).parent; ROOT = H.parents[1]
data = json.loads(pathlib.Path(sys.argv[1]).read_text())
norm = lambda s: unicodedata.normalize('NFKD', s).encode('ascii', 'ignore').decode().lower().strip()
ids = {norm(p['name']): p['id'] for p in data['players']}
seeds = []
for t in json.loads((ROOT / 'data' / 'teams' / 'my_teams.json').read_text())['teams']:
    r = t['rules']
    rules = {'defMod': {'on': r['defenceModifier'], 'min': 4, 'bands': [[6, 1], [6.5, 3], [7, 6]]},
             'cs': {'P': 1 if r['keeperCleanSheet'] else 0, 'D': 0, 'C': 0, 'A': 0},
             'formationChange': r['formationChange'], 'maxSubs': r.get('maxSubs', 3)}
    seeds.append({'name': t['name'] if t['name'] != 'Second team' else 'Seconda squadra',
                  'ids': [ids[norm(n)] for n in t['players'] if norm(n) in ids], 'rules': rules})
html = (H / 'app_template.html').read_text().replace('/*DATA*/', json.dumps(data, separators=(',', ':')).replace('</', '<\\/'), 1) \
    .replace('/*SEEDS*/', json.dumps(seeds, ensure_ascii=False), 1)
pathlib.Path(sys.argv[2]).write_text(html); print('app page', sys.argv[2], len(html), 'bytes;', [(s['name'], len(s['ids'])) for s in seeds])

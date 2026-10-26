"""Build and cache leagues: python build.py <tag> <set>   (set: tune | holdout)"""
import json, pathlib, sys, multiprocessing as mp
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))
HERE = pathlib.Path(__file__).parent
CACHE = HERE.parents[1] / 'data' / 'cache' / 'tuning'
SETS = {'tune': [(s, r) for s in ['2021-22', '2022-23', '2023-24'] for r in range(0, 38, 2)],
        'holdout': [(s, r) for s in ['2024-25', '2025-26'] for r in range(38)]}
def one(a):
    s, r, out = a
    f = out / f'{s}_{r}.json'
    if f.exists(): return
    import calibrate as C, io, contextlib
    with contextlib.redirect_stdout(io.StringIO()):
        lg = C.build_league(s, r)
    f.write_text(json.dumps(lg))
if __name__ == '__main__':
    tag, st = sys.argv[1], sys.argv[2]
    out = CACHE / tag / st; out.mkdir(parents=True, exist_ok=True)
    with mp.Pool(4) as p: p.map(one, [(s, r, out) for s, r in SETS[st]], chunksize=1)
    print('built', tag, st, len(list(out.glob('*.json'))))

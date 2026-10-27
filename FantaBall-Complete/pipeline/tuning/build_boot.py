"""Bootstrap refits for the tuning harness: python pipeline/tuning/build_boot.py <tag> <K> [round_step]
Builds, for the tune seasons, K leagues per (season, round), each calibrated on a matchday-resampled history."""
import json, pathlib, sys, multiprocessing as mp
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))
HERE = pathlib.Path(__file__).parent
CACHE = HERE.parents[1] / 'data' / 'cache' / 'tuning'
def one(a):
    s, r, k, out = a
    f = out / f'{s}_{r}_b{k}.json'
    if f.exists(): return
    import calibrate as C, io, contextlib
    C.BOOT = k + 1
    with contextlib.redirect_stdout(io.StringIO()):
        lg = C.build_league(s, r)
    f.write_text(json.dumps(lg))
if __name__ == '__main__':
    tag, K = sys.argv[1], int(sys.argv[2]); step = int(sys.argv[3]) if len(sys.argv) > 3 else 4
    out = CACHE / tag / 'boot'; out.mkdir(parents=True, exist_ok=True)
    jobs = [(s, r, k, out) for s in ['2021-22', '2022-23', '2023-24'] for r in range(0, 38, step) for k in range(K)]
    with mp.Pool(4) as p: p.map(one, jobs, chunksize=1)
    print('built', len(list(out.glob('*.json'))))

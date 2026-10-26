"""Tuning harness for the matchday backtest (fast loop: cached leagues, 4 parallel workers).
  python pipeline/tuning/build.py <tag> tune|holdout                          # build and cache leagues (FB_* env vars change calibration)
  python pipeline/tuning/sweep.py <tag> tune <label> '{"teamSd":0.2}' ...     # engine setting overrides, one run each
Tune on 2021-22 to 2023-24 (every other round), check on 2024-25 and 2025-26 (holdout). Results: data/backtest/tuning_results.csv"""
import json, sys, evalm, pandas as pd
# python sweep.py tag set label '{"a":1}' '{"a":2}' ...
tag, st, lab = sys.argv[1:4]
for o in sys.argv[4:]:
    m = evalm.run(tag, st, f'{lab} {o}', json.loads(o))
    print(o, {k: round(m[k], 4) for k in ['brier', 'pts_rmse', 'fv_mae', 'pts_rank', 'fv_rank', 'fvbias_A', 'pbias_A', 'pbias_C']}, flush=True)

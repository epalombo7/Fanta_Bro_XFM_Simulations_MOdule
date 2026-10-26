"""Matchday page (Italian, mobile): python pipeline/page/build_data.py && python pipeline/page/assemble.py -> pipeline/page/fantaball-matchday.html"""
import pathlib
h=pathlib.Path(__file__).parent
t=(h/'template.html').read_text(); d=(h/'data.json').read_text().replace('</','<\\/')
(h/'fantaball-matchday.html').write_text(t.replace('/*DATA*/',d,1)); print('ok', len(t)+len(d))

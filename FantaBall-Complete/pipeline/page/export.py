"""Standalone copy of the matchday page (full HTML document, works offline): python pipeline/page/export.py <out.html>"""
import pathlib, re, sys
src = (pathlib.Path(__file__).parent / 'fantaball-matchday.html').read_text()
title = re.search(r'<title>.*?</title>', src).group(0)
cut = src.index('</style>') + len('</style>')
head = src[:cut].replace(title, '').replace('<meta name="claude:viewport-fit-sides" content="cover">', '')
doc = f'''<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
{title}
<style>:root{{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}}[hidden]{{display:none!important}}img{{max-width:100%}}</style>
{head.strip()}
</head>
<body>
{src[cut:].strip()}
</body>
</html>
'''
pathlib.Path(sys.argv[1]).write_text(doc); print('exported', sys.argv[1], len(doc))

"""Live check of a matchday forecast against what happened (votes, fantavoto, goals, bookmakers): python pipeline/evaluate_round.py"""
import sys, re, unicodedata, numpy as np, pandas as pd
R=str(__import__('pathlib').Path(__file__).resolve().parents[1])
sys.path.insert(0,R+'/pipeline'); import calibrate as C, backtest as B
RD=int(sys.argv[1]) if len(sys.argv)>1 else 10
fx=pd.read_csv(R+'/data/forecasts/matchday_xfm_latest.csv.gz'); fx=fx[fx['round']==RD]
sm=pd.read_csv(R+'/data/forecasts/matchday_simulation_latest.csv.gz'); sm=sm[sm['round']==RD]
f=fx.merge(sm[['id','exp_penScored','exp_ownGoals','exp_conceded','p_starts']],on='id')
f['xg_all']=f.exp_goals                                  # page/goals column already includes penalties? check below
v=C.votes(); v=v[v.season=='2026-27']; a=B.actual_fv(v)
act=a[a['round']==RD].drop_duplicates('player_id')[['player_id','rated','fv','goals','pen_scored','assists','vote_fantacalcio','gf','ga']]
d=f.merge(act,left_on='id',right_on='player_id',how='left')
d['rated']=d.rated.fillna(False).astype(bool); d['G']=(d.goals.fillna(0)+d.pen_scored.fillna(0)); d['pts']=d.fv.where(d.rated,0).fillna(0)
print('players',len(d),'with a vote',d.rated.sum(),'| goals scored by forecast players',int(d.G.sum()))
# benchmark: form = this season so far, share of rounds with a vote and average fantavoto
prev=a[a['round']<RD]; g=prev.groupby('player_id'); fv_mean=prev[prev.rated].groupby('player_id').fv.mean()
d['f_p']=d.id.map(g.rated.sum()/(RD-1)).fillna(0); d['f_x']=d.id.map(fv_mean)
role_fv=prev[prev.rated][['player_id','fv']].merge(f[['id','role']],left_on='player_id',right_on='id').groupby('role').fv.mean()
d['f_x']=d.f_x.fillna(d.role.map(role_fv))
sp=lambda x,y:x.rank().corr(y.rank())
print('\n=== WHO GETS A VOTE ===')
print(' Brier model %.3f | form %.3f   (lower is better)'%(((d.p_vote-d.rated)**2).mean(),((d.f_p-d.rated)**2).mean()))
print(' expected votes %.0f vs real %d'%(d.p_vote.sum(),d.rated.sum()))
b=pd.cut(d.p_vote,[-.01,.1,.5,.9,1.01]); print(' calibration:',d.groupby(b,observed=True).agg(forecast=('p_vote','mean'),real=('rated','mean'),n=('rated','size')).round(2).to_dict('index'))
v_=d[d.rated]
print('\n=== FANTAVOTO WHEN HE PLAYED (xFM) ===')
for nm,x in [('model',v_.xfm_if_voted),('form',v_.f_x)]:
    print(f' {nm:5s} error {np.abs(x-v_.fv).mean():.3f}  bias {(x-v_.fv).mean():+.3f}  rank corr {sp(x,v_.fv):.3f}')
print(' by role (model): ',{r:(round(np.abs(g.xfm_if_voted-g.fv).mean(),2),round((g.xfm_if_voted-g.fv).mean(),2),len(g)) for r,g in v_.groupby('role')})
print(' mean fantavoto: forecast %.2f real %.2f'%(v_.xfm_if_voted.mean(),v_.fv.mean()))
inr=v_[v_.fv_p25.notna()]; print(' inside range (edges half): %.0f%%'%(100*(((inr.fv>inr.fv_p25)&(inr.fv<inr.fv_p75)).mean()+0.5*((inr.fv==inr.fv_p25)|(inr.fv==inr.fv_p75)).mean())))
print('\n=== ROUND POINTS (vote % x xFM, 0 without a vote) ===')
d['e']=d.p_vote*d.xfm_if_voted.fillna(0); d['fe']=d.f_p*d.f_x.fillna(0)
for nm,x in [('model',d.e),('form',d.fe)]: print(f' {nm:5s} RMSE {np.sqrt(((x-d.pts)**2).mean()):.3f}  rank corr {sp(x,d.pts):.3f}')
print('\n=== GOALS ===')
print(' expected goals (players) %.1f vs real %d'%(d.exp_goals.sum(),d.G.sum()))
d['pG']=1-np.exp(-d.exp_goals); d['scored']=d.G>0
print(' scorers: expected %.1f, real %d | Brier model %.4f vs base rate %.4f'%(d.pG.sum(),d.scored.sum(),((d.pG-d.scored)**2).mean(),((d.scored.mean()-d.scored)**2).mean()))
bb=pd.cut(d.pG,[-.01,.05,.15,.3,.45,1]); print(' calibration P(goal):',d.groupby(bb,observed=True).agg(forecast=('pG','mean'),real=('scored','mean'),n=('scored','size')).round(3).to_dict('index'))
print(' role:',{r:(round(g.exp_goals.sum(),1),int(g.G.sum())) for r,g in d.groupby('role')})
# top predicted scorers
t=d.sort_values('pG',ascending=False).head(15)[['name','team','pG','G','rated']]; print(t.round(2).to_string(index=False))
# team goals per match
tg=d.groupby('team').agg(xg=('exp_goals','sum')).reset_index()
res=a[a['round']==RD].drop_duplicates('team')[['team','gf']]
tg=tg.merge(res,on='team'); tg['diff']=tg.gf-tg.xg; print('\n team goals forecast vs real:'); print(tg.sort_values('diff').round(2).to_string(index=False))
print(' team-goal error %.2f, corr %.2f'%(np.abs(tg['diff']).mean(),tg.xg.corr(tg.gf)))
# bookmakers
o=pd.read_csv(R+'/data/raw/odds_api/goalscorer/anytime_2026-10-30.csv'); o=o[o.outcome=='Yes']; o['p']=1/o.price
key=lambda s:re.sub(r'[^a-z ]',' ',unicodedata.normalize('NFKD',str(s)).encode('ascii','ignore').decode().lower()).split()
alias={'AS Roma':'Roma','AC Milan':'Milan','Inter Milan':'Inter','Atalanta BC':'Atalanta','Hellas Verona':'Verona'}
oo=o.groupby(['player','home','away']).p.mean().reset_index(); book={}
for x in oo.itertuples():
    for tm in (x.home,x.away): book.setdefault(alias.get(tm,tm).lower(),[]).append((key(x.player),x.p))
def bk(name,team):
    k=[w for w in key(name) if len(w)>2] or key(name); c=book.get(str(team).lower(),[])
    h=[p for t,p in c if all(w in t for w in k)]
    return h[0] if len(h)==1 else np.nan
d['book']=[bk(n,t) for n,t in zip(d.name,d.team)]; m=d[d.book.notna()].copy()
# remove bookmaker margin per match: scale so the sum of implied P matches... report raw and normalised to model total
print('\n=== GOALS vs BOOKMAKERS (%d players with odds) ==='%len(m))
m['book_n']=m.book*(m.pG.sum()/m.book.sum())
for nm,x in [('model',m.pG),('bookmakers (raw)',m.book),('bookmakers (margin removed)',m.book_n)]:
    print(f' {nm:28s} Brier {((x-m.scored)**2).mean():.4f}  log loss {-(m.scored*np.log(x.clip(1e-4,1-1e-4))+(~m.scored)*np.log(1-x.clip(1e-4,1-1e-4))).mean():.4f}  rank corr with scoring {sp(x,m.scored.astype(float)):.3f}  expected scorers {x.sum():.1f} (real {m.scored.sum()})')


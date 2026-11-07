// Head-to-head preview of a fantasy match: two set lineups (11 + ordered bench) scored on the same simulated draws of
// the next round, so players in the same real match move together. Gives each side's expected points, spread,
// modifier, fantasy goals (66 = 1 goal, then one more every 6 points) and the chance of a win, draw or loss.
//   node pipeline/match_preview.js <match.json> [bootstrap_leagues.json] [live.json]
// live.json (optional, during the round): {"finishedTeams": [club names], "votes": {"Name": [vote, fantavoto], ...}}.
// Players of finished clubs get their real result in every draw (no entry = no vote); "votes" can also fix single
// players of matches still running. The output then has both the pre-match and the live odds.
// match.json: {"rules": {defenceModifier, keeperCleanSheet, formationChange, maxSubs},
//              "home": {"name", "xi": [11 names, keeper first], "bench": [names in bench order]}, "away": {...}}
const fs=require('fs'),path=require('path');
const ROOT=path.join(__dirname,'..'),E=require(path.join(ROOT,'mobile','assets','engine.js'));
const [mf,bootFile,liveFile]=process.argv.slice(2),MATCH=JSON.parse(fs.readFileSync(mf)),RL=MATCH.rules,MAXSUB=RL.maxSubs??3;
let txt=fs.readFileSync(path.join(ROOT,'mobile','assets','league.js'),'utf8');txt=txt.slice(txt.indexOf('{'),txt.lastIndexOf('}')+1);
const L=JSON.parse(txt),r0=L.as_of_round,lg={...L,fixtures:L.fixtures.slice(0,r0+1)};
const reps=bootFile?JSON.parse(fs.readFileSync(bootFile)).map(B=>({...B,fixtures:undefined})):[];
const norm=s=>s.normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().trim();
const find=nm=>{const i=L.players.findIndex(p=>norm(p.name)===norm(nm));if(i<0)throw Error('Player not in the league list: '+nm);return i};
const sides=['home','away'].map(k=>({name:MATCH[k].name,xi:MATCH[k].xi.map(find),bench:MATCH[k].bench.map(find)}));
const all=[...new Set(sides.flatMap(s=>[...s.xi,...s.bench]))],pos=new Map(all.map((i,j)=>[i,j])),n=all.length;
const rules={defenceModifier:{...E.RULES.defenceModifier,enabled:!!RL.defenceModifier},cleanSheet:{...E.RULES.cleanSheet,P:RL.keeperCleanSheet?1:0}};
const c={competition:'x',season:L.season,teams:10,budget:500,min:1,rounds:1,P:3,D:8,C:8,A:6,rules};
const CH=255,K=60,D=CH*K,FV=new Float32Array(n*D).fill(NaN),VO=new Float32Array(n*D).fill(NaN);
for(let k=0;k<K;k++){const S=E.runSeason({rounds:1},{N:CH,detailWorlds:CH,outcomes:false,league:lg,model:{...L.model,seed:4242+k},replicates:reps});
  const {fv,nS}=E.matchdayPoints(S,c),d=S.detail;
  for(const [i,j] of pos)for(let w=0;w<nS;w++)FV[j*D+k*CH+w]=fv[i*nS+w];
  for(let o=0;o<S.detailRows*16;o+=16){const i=d[o+1]|(d[o+2]<<8);if(!pos.has(i)||!(d[o+4]&1))continue;VO[pos.get(i)*D+k*CH+d[o]]=d[o+5]/2}}
const RU=E.leagueRules(c),ok=new Set(['3-4-3','3-5-2','4-3-3','4-4-2','4-5-1','5-3-2','5-4-1']),role=i=>L.players[i].role;
function play(s,w){let subs=0,used=new Set(),pts=0,gk=null,dv=[],cnt={P:0,D:0,C:0,A:0},inn=[];s.xi.forEach(i=>cnt[role(i)]++);
  for(const i of s.xi){let p=i,x=FV[pos.get(i)*D+w];
    if(x!==x&&subs<MAXSUB)for(const b of s.bench){if(used.has(b))continue;const y=FV[pos.get(b)*D+w];if(y!==y)continue;
      if((role(i)==='P')!==(role(b)==='P'))continue;
      if(role(b)!==role(i)){if(!RL.formationChange)continue;const c2={...cnt};c2[role(i)]--;c2[role(b)]++;if(!ok.has(`${c2.D}-${c2.C}-${c2.A}`))continue;cnt[role(i)]--;cnt[role(b)]++}
      used.add(b);subs++;p=b;x=y;inn.push(b);break}
    if(x===x){pts+=x;const v=VO[pos.get(p)*D+w];if(role(p)==='P')gk=v===v?v:null;else if(role(p)==='D'&&v===v)dv.push(v)}}
  const m=RL.defenceModifier?E.defenceModifier(gk,dv,RU):0;return{pts:pts+m,m,inn}}
function summary(){
const goals=x=>x<66?0:1+Math.floor((x-66)/6);
const res=sides.map(()=>({p:new Float64Array(D),g:new Int32Array(D),m:0,subs:new Map()}));
for(let w=0;w<D;w++)sides.forEach((s,k)=>{const r=play(s,w);res[k].p[w]=r.pts;res[k].g[w]=goals(r.pts);res[k].m+=r.m;for(const b of r.inn)res[k].subs.set(b,(res[k].subs.get(b)||0)+1)});
const q=(a,x)=>{const s=Float64Array.from(a).sort();return s[Math.floor((s.length-1)*x)]};
let win=0,draw=0,loss=0,margin=0;for(let w=0;w<D;w++){const a=res[0].g[w],b=res[1].g[w];a>b?win++:a<b?loss++:draw++;margin+=res[0].p[w]-res[1].p[w]}
const ev=i=>{let s=0;for(let w=0;w<D;w++){const x=FV[pos.get(i)*D+w];if(x===x)s+=x}return s/D},pv=i=>{let s=0;for(let w=0;w<D;w++)if(FV[pos.get(i)*D+w]===FV[pos.get(i)*D+w])s++;return s/D};
return {round:r0+1,draws:D,rules:RL,sides:sides.map((s,k)=>({name:s.name,expected:+(res[k].p.reduce((a,b)=>a+b,0)/D).toFixed(2),p25:+q(res[k].p,.25).toFixed(1),p75:+q(res[k].p,.75).toFixed(1),
  modifier:+(res[k].m/D).toFixed(2),fantasyGoals:+(res[k].g.reduce((a,b)=>a+b,0)/D).toFixed(2),
  xi:s.xi.map(i=>({name:L.players[i].name,role:role(i),club:L.teams[L.players[i].team].name,pVote:+pv(i).toFixed(2),exp:+ev(i).toFixed(2)})),
  benchUsed:[...res[k].subs].sort((a,b)=>b[1]-a[1]).slice(0,5).map(([i,c])=>({name:L.players[i].name,share:+(c/D).toFixed(2)}))})),
  homeWin:+(win/D).toFixed(3),draw:+(draw/D).toFixed(3),awayWin:+(loss/D).toFixed(3),meanMargin:+(margin/D).toFixed(2)};
}
const before=summary();
if(liveFile){const LV=JSON.parse(fs.readFileSync(liveFile)),fin=new Set(LV.finishedTeams||[]),vt=new Map(Object.entries(LV.votes||{}).map(([k,v])=>[norm(k),v]));
  for(const [i,j] of pos){const p=L.players[i],t=L.teams[p.team].name,v=vt.get(norm(p.name));if(!fin.has(t)&&!v)continue;
    for(let w=0;w<D;w++){FV[j*D+w]=v?v[1]:NaN;VO[j*D+w]=v?v[0]:NaN}}}
const after=liveFile?summary():null;
console.log(JSON.stringify(liveFile?{before,live:after}:before,null,1));


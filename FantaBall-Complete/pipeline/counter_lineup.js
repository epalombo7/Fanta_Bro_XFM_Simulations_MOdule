// Counter-lineup: searches a squad's lineups against a set opponent (match.json "home") on the same simulated draws and ranks them
// by match points (3 win, 1 draw) and by expected points. Usage: node pipeline/counter_lineup.js <match.json> [bootstrap.json] "<team name>"
// Head-to-head preview of a fantasy match: two set lineups (11 + ordered bench) scored on the same simulated draws of
// the next round, so players in the same real match move together. Gives each side's expected points, spread,
// modifier, fantasy goals (66 = 1 goal, then one more every 6 points) and the chance of a win, draw or loss.
//   node pipeline/match_preview.js <match.json> [bootstrap_leagues.json]
// match.json: {"rules": {defenceModifier, keeperCleanSheet, formationChange, maxSubs},
//              "home": {"name", "xi": [11 names, keeper first], "bench": [names in bench order]}, "away": {...}}
const fs=require('fs'),path=require('path');
const ROOT=path.join(__dirname,'..'),E=require(path.join(ROOT,'mobile','assets','engine.js'));
const [mf,bootFile,squadName]=process.argv.slice(2),MATCH=JSON.parse(fs.readFileSync(mf)),RL=MATCH.rules,MAXSUB=RL.maxSubs??3;
let txt=fs.readFileSync(path.join(ROOT,'mobile','assets','league.js'),'utf8');txt=txt.slice(txt.indexOf('{'),txt.lastIndexOf('}')+1);
const L=JSON.parse(txt),r0=L.as_of_round,lg={...L,fixtures:L.fixtures.slice(0,r0+1)};
const reps=bootFile?JSON.parse(fs.readFileSync(bootFile)).map(B=>({...B,fixtures:undefined})):[];
const norm=s=>s.normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().trim();
const find=nm=>{const i=L.players.findIndex(p=>norm(p.name)===norm(nm));if(i<0)throw Error('Player not in the league list: '+nm);return i};
const sides=['home','away'].map(k=>({name:MATCH[k].name,xi:MATCH[k].xi.map(find),bench:MATCH[k].bench.map(find)}));
const SQ=JSON.parse(fs.readFileSync(path.join(ROOT,'data','teams','my_teams.json'))).teams.find(t=>t.name===squadName).players.map(find);
const all=[...new Set([...sides.flatMap(s=>[...s.xi,...s.bench]),...SQ])],pos=new Map(all.map((i,j)=>[i,j])),n=all.length;
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
const goals=x=>x<66?0:1+Math.floor((x-66)/6);
const ev=i=>{let s=0;for(let w=0;w<D;w++){const x=FV[pos.get(i)*D+w];if(x===x)s+=x}return s/D},pv=i=>{let s=0;for(let w=0;w<D;w++)if(FV[pos.get(i)*D+w]===FV[pos.get(i)*D+w])s++;return s/D};
const opp=new Float64Array(D);for(let w=0;w<D;w++)opp[w]=play(sides[0],w).pts;
const og=Int32Array.from(opp,goals);
const av=SQ.filter(i=>pv(i)>0.01),by={P:[],D:[],C:[],A:[]};av.forEach(i=>by[role(i)].push(i));for(const r in by)by[r].sort((a,b)=>ev(b)-ev(a));
const comb=(a,k)=>k===0?[[]]:a.flatMap((x,j)=>comb(a.slice(j+1),k-1).map(r=>[x,...r]));
const F=[[3,4,3],[3,5,2],[4,3,3],[4,4,2],[4,5,1],[5,3,2],[5,4,1]],cand=[];
for(const [nd,nc,na] of F)for(const g of by.P.slice(0,2))for(const dd of comb(by.D.slice(0,7),nd))for(const cc of comb(by.C.slice(0,6),nc))for(const aa of comb(by.A.slice(0,4),na)){
  if(dd.length<nd||cc.length<nc||aa.length<na)continue;const xi=[g,...dd,...cc,...aa],st=new Set(xi);
  const bench=[...by.P.filter(i=>!st.has(i)),...[...by.D,...by.C,...by.A].filter(i=>!st.has(i)).sort((a,b)=>ev(b)-ev(a))];
  cand.push({f:`${nd}-${nc}-${na}`,xi,bench,pre:xi.reduce((t,i)=>t+ev(i),0)})}
cand.sort((a,b)=>b.pre-a.pre);
const resS=cand.slice(0,600).map(cn=>{let W=0,Dr=0,P=0;for(let w=0;w<D;w++){const x=play(cn,w).pts;P+=x;const a=goals(x),b=og[w];a>b?W++:a===b?Dr++:0}
  return{f:cn.f,xi:cn.xi.map(i=>L.players[i].name),bench:cn.bench.map(i=>L.players[i].name),points:P/D,win:W/D,draw:Dr/D,mp:(3*W+Dr)/D}});
const cur=(()=>{let W=0,Dr=0,P=0;for(let w=0;w<D;w++){const x=play(sides[1],w).pts;P+=x;const a=goals(x),b=og[w];a>b?W++:a===b?Dr++:0}return{points:P/D,win:W/D,draw:Dr/D,mp:(3*W+Dr)/D}})();
const show=o=>`${o.f||'current'} pts ${o.points.toFixed(2)} win ${(o.win*100).toFixed(1)}% draw ${(o.draw*100).toFixed(1)}% match pts ${o.mp.toFixed(3)} `+(o.xi?o.xi.join(', '):'');
console.log('CURRENT LINEUP:',show(cur));
console.log('\nBEST BY MATCH POINTS (3 win, 1 draw):');[...resS].sort((a,b)=>b.mp-a.mp).slice(0,6).forEach(o=>console.log(show(o)));
console.log('\nBEST BY EXPECTED POINTS:');[...resS].sort((a,b)=>b.points-a.points).slice(0,3).forEach(o=>console.log(show(o)));
const b=[...resS].sort((a,b)=>b.mp-a.mp)[0];console.log('\nbench order for best:',b.bench.join(' > '));
console.log('draws',D);

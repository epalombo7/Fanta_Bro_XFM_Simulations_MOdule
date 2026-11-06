// Best lineup for the next matchday, by simulation: every possible lineup of a squad is scored on the same simulated
// draws of the round (real fantavoto per draw, bench substitutions, defence modifier), under the team's own league rules.
//   node pipeline/best_lineup.js <team name> [bootstrap_leagues.json] [--out "Name1,Name2"]
// Squads and rules: data/teams/my_teams.json. Rules per team:
//   defenceModifier   keeper + 3 best defenders' average vote: >=6 +1, >=6.5 +3, >=7 +6 (needs 4 defenders with a vote)
//   keeperCleanSheet  imbattibilità: keeper +1 when his team concedes none
//   formationChange   cambio modulo: a starter without a vote is replaced by the first bench player (bench order) that
//                     keeps a valid formation, whatever his role; otherwise role for role
//   maxSubs           substitutions allowed
// --out: players known to be out though the injury list does not say so yet.
const fs=require('fs'),path=require('path');
const ROOT=path.join(__dirname,'..'),E=require(path.join(ROOT,'mobile','assets','engine.js'));
const args=process.argv.slice(2),teamName=args[0],bootFile=args[1]&&!args[1].startsWith('--')?args[1]:null;
const OUT=args.includes('--out')?args[args.indexOf('--out')+1].split(',').map(s=>s.trim()).filter(Boolean):[];
const T=JSON.parse(fs.readFileSync(path.join(ROOT,'data','teams','my_teams.json'))).teams.find(t=>t.name===teamName);
if(!T)throw Error('Team not found: '+teamName);
const RL=T.rules,MAXSUB=RL.maxSubs??3;
let txt=fs.readFileSync(path.join(ROOT,'mobile','assets','league.js'),'utf8');txt=txt.slice(txt.indexOf('{'),txt.lastIndexOf('}')+1);
const L=JSON.parse(txt),r0=L.as_of_round,lg={...L,fixtures:L.fixtures.slice(0,r0+1)};
const reps=bootFile?JSON.parse(fs.readFileSync(bootFile)).map(B=>({...B,fixtures:undefined})):[];
for(const Lx of [L,...reps])for(const p of Lx.players)if(OUT.includes(p.name))p.injuredFor=Math.max(1,p.injuredFor||0);
const norm=s=>s.normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().trim();
const idx=T.players.map(n=>{const i=L.players.findIndex(p=>norm(p.name)===norm(n));if(i<0)throw Error('Player not in the league list: '+n);return i});
const role=idx.map(i=>L.players[i].role),name=idx.map(i=>L.players[i].name),n=idx.length;
// simulated draws of the round: fantavoto under the league's rules, vote, goals conceded by the team
const rules={defenceModifier:{...E.RULES.defenceModifier,enabled:!!RL.defenceModifier},cleanSheet:{...E.RULES.cleanSheet,P:RL.keeperCleanSheet?1:0}};
const c={competition:'x',season:L.season,teams:10,budget:500,min:1,rounds:1,P:3,D:8,C:8,A:6,rules};
const CH=255,K=40,D=CH*K,FV=new Float32Array(n*D).fill(NaN),VO=new Float32Array(n*D).fill(NaN);
const pos=new Map(idx.map((i,j)=>[i,j]));
for(let k=0;k<K;k++){const S=E.runSeason({rounds:1},{N:CH,detailWorlds:CH,outcomes:false,league:lg,model:{...L.model,seed:777+k},replicates:reps});
  const {fv,nS}=E.matchdayPoints(S,c),d=S.detail;
  for(let j=0;j<n;j++)for(let w=0;w<nS;w++)FV[j*D+k*CH+w]=fv[idx[j]*nS+w];
  for(let o=0;o<S.detailRows*16;o+=16){const i=d[o+1]|(d[o+2]<<8);if(!pos.has(i)||!(d[o+4]&1))continue;VO[pos.get(i)*D+k*CH+d[o]]=d[o+5]/2}}
const RU=E.leagueRules(c),FORM=[[3,4,3],[3,5,2],[4,3,3],[4,4,2],[4,5,1],[5,3,2],[5,4,1]],ok=new Set(FORM.map(f=>f.join('-')));
const ev=[...Array(n)].map((_,j)=>{let s=0;for(let w=0;w<D;w++){const x=FV[j*D+w];if(x===x)s+=x}return s/D});
const pv=[...Array(n)].map((_,j)=>{let s=0;for(let w=0;w<D;w++)if(FV[j*D+w]===FV[j*D+w])s++;return s/D});
const avail=[...Array(n)].keys().filter?[...Array(n).keys()].filter(j=>pv[j]>0.01):[];
const by={P:[],D:[],C:[],A:[]};avail.forEach(j=>by[role[j]].push(j));for(const r in by)by[r].sort((a,b)=>ev[b]-ev[a]);
function score(xi,bench,useDM){let tot=0,dmS=0;
  for(let w=0;w<D;w++){let subs=0,used=new Set(),pts=0,gk=null,dv=[],cnt={P:0,D:0,C:0,A:0};xi.forEach(j=>cnt[role[j]]++);
    const fielded=[];
    for(const j of xi){let p=j,x=FV[j*D+w];
      if(x!==x&&subs<MAXSUB){
        const cands=RL.formationChange?(role[j]==='P'?bench.P:bench.all):bench[role[j]];
        for(const b of cands){if(used.has(b))continue;const y=FV[b*D+w];if(y!==y)continue;
          if(RL.formationChange&&role[b]!==role[j]){const c2={...cnt};c2[role[j]]--;c2[role[b]]++;if(!ok.has(`${c2.D}-${c2.C}-${c2.A}`))continue;cnt[role[j]]--;cnt[role[b]]++}
          used.add(b);subs++;p=b;x=y;break}}
      if(x===x){pts+=x;const v=VO[p*D+w];if(role[p]==='P')gk=v===v?v:null;else if(role[p]==='D'&&v===v)dv.push(v)}}
    const m=useDM?E.defenceModifier(gk,dv,RU):0;tot+=pts+m;dmS+=m}
  return[tot/D,dmS/D]}
const comb=(a,k)=>k===0?[[]]:a.flatMap((x,i)=>comb(a.slice(i+1),k-1).map(r=>[x,...r]));
const out=[],cap=(a,k)=>a.slice(0,k);
for(const [nd,nc,na] of FORM)for(const g of cap(by.P,2))for(const dd of comb(cap(by.D,7),nd))for(const cc of comb(cap(by.C,7),nc))for(const aa of comb(cap(by.A,6),na)){
  if(dd.length<nd||cc.length<nc||aa.length<na)continue;
  const xi=[g,...dd,...cc,...aa],s=new Set(xi),bench={P:by.P.filter(j=>!s.has(j)),D:by.D.filter(j=>!s.has(j)),C:by.C.filter(j=>!s.has(j)),A:by.A.filter(j=>!s.has(j))};
  bench.all=[...bench.D,...bench.C,...bench.A].sort((a,b)=>ev[b]-ev[a]);
  out.push({f:`${nd}-${nc}-${na}`,xi,bench,s:[ev.length?xi.reduce((t,j)=>t+ev[j],0):0,0]})}
// pre-rank by expected points, then simulate the best few hundred in full (bench subs and modifier per draw)
out.sort((a,b)=>b.s[0]-a.s[0]);const top=out.slice(0,400);for(const o of top)o.s=score(o.xi,o.bench,!!RL.defenceModifier);
top.sort((a,b)=>b.s[0]-a.s[0]);
const res={team:T.name,round:r0+1,draws:D,rules:RL,out:OUT,
  players:avail.concat([...Array(n).keys()].filter(j=>!avail.includes(j))).map(j=>({name:name[j],team:L.teams[L.players[idx[j]].team].name,role:role[j],pVote:+pv[j].toFixed(3),exp:+ev[j].toFixed(2),xfm:pv[j]?+(ev[j]/pv[j]).toFixed(2):null})),
  best:top.slice(0,8).map(o=>({formation:o.f,points:+o.s[0].toFixed(2),modifier:+o.s[1].toFixed(2),xi:o.xi.map(j=>name[j]),
    bench:RL.formationChange?{P:o.bench.P.map(j=>name[j]),order:o.bench.all.map(j=>name[j])}:{P:o.bench.P.map(j=>name[j]),D:o.bench.D.map(j=>name[j]),C:o.bench.C.map(j=>name[j]),A:o.bench.A.map(j=>name[j])}})),
  perFormation:Object.values(top.reduce((a,o)=>(a[o.f]??=o,a),{})).map(o=>({formation:o.f,points:+o.s[0].toFixed(2),modifier:+o.s[1].toFixed(2)}))};
console.log(JSON.stringify(res,null,1));

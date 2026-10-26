// Correlations for the next matchday only: every pair of players in the same match (teammates, and players of
// the two opposing clubs), fantavoto correlated across simulation draws of that one match, counting draws where
// both get a vote. Teammates with the strongest positive correlation "move with" him (risk if fielded together);
// opponents with the strongest negative correlation are his hedge.
//   node pipeline/match_correlations.js <league.js or league.json> <out.json> [draws=15000]
const fs=require('fs'),path=require('path');
const E=require(path.join(__dirname,'..','mobile','assets','engine.js'));
const [src,out,drawsArg]=process.argv.slice(2);
let txt=fs.readFileSync(src,'utf8');txt=txt.slice(txt.indexOf('{'),txt.lastIndexOf('}')+1);
const L=JSON.parse(txt),r0=L.as_of_round,lg={...L,fixtures:L.fixtures.slice(0,r0+1)};   // the next round alone
const CHUNK=255,chunks=Math.ceil((+drawsArg||15000)/CHUNK),D=chunks*CHUNK,P=L.players.length;
const c={competition:'corr',season:L.season,teams:10,budget:500,min:1,rounds:1,P:3,D:8,C:8,A:6};
const fv=Array.from({length:P},()=>new Float32Array(D).fill(NaN));
for(let k=0;k<chunks;k++){                                   // the per-draw detail store holds 255 draws per run
  const S=E.runSeason({rounds:1},{N:CHUNK,detailWorlds:CHUNK,outcomes:false,league:lg,model:{...L.model,seed:9001+k}});
  const {fv:x,nS}=E.matchdayPoints(S,c);
  for(let i=0;i<P;i++)for(let w=0;w<nS;w++)fv[i][k*CHUNK+w]=x[i*nS+w]}
const MIN_JOINT=200;
function corr(a,b){let n=0,sa=0,sb=0,saa=0,sbb=0,sab=0;
  for(let w=0;w<D;w++){const x=a[w],y=b[w];if(x!==x||y!==y)continue;n++;sa+=x;sb+=y;saa+=x*x;sbb+=y*y;sab+=x*y}
  if(n<MIN_JOINT)return null;const cov=sab/n-sa/n*sb/n,va=saa/n-(sa/n)**2,vb=sbb/n-(sb/n)**2;
  return va>0&&vb>0?{r:cov/Math.sqrt(va*vb),n}:null}
const team=L.players.map(p=>p.team),res={};
const voted=i=>{let n=0;for(let w=0;w<D;w++)if(fv[i][w]===fv[i][w])n++;return n};
const nv=L.players.map((_,i)=>voted(i));
for(const [h,a] of lg.fixtures[r0]){
  const ids=L.players.map((_,i)=>i).filter(i=>(team[i]===h||team[i]===a)&&nv[i]>=MIN_JOINT);
  for(const i of ids){const mates=[],opps=[];
    for(const j of ids){if(j===i)continue;const x=corr(fv[i],fv[j]);if(!x)continue;
      const e=[L.players[j].name,L.teams[team[j]].name,Math.round(x.r*100)/100,x.n];(team[j]===team[i]?mates:opps).push(e)}
    mates.sort((x,y)=>y[2]-x[2]);opps.sort((x,y)=>x[2]-y[2]);
    res[L.players[i].id]={with:mates.slice(0,3),hedge:opps.slice(0,3)}}}
fs.writeFileSync(out,JSON.stringify({round:r0+1,draws:D,minJoint:MIN_JOINT,players:res}));
console.log(`match correlations: round ${r0+1}, ${D} draws, ${Object.keys(res).length} players`);

// Data for the FantaBall app page, from the latest season file (no new simulation):
//   outcomes: per player, the exact outcome counts of the next round over all recorded seasons (any rules can score them)
//   draws:    per player, his outcome in each of the season file's complete simulated rounds (same draw = same real
//             match for everyone), for lineups, fantasy goals and head-to-head
//   node pipeline/page/build_app_data.js <season.fbsim.br> <page data.json> <out.json>
const fs=require('fs'),zlib=require('zlib'),path=require('path'),E=require(path.join(__dirname,'..','..','mobile','assets','engine.js'));
const [sf,pf,of]=process.argv.slice(2);
const S=E.deserializeSeason(new Uint8Array(zlib.brotliDecompressSync(fs.readFileSync(sf))));
const page=JSON.parse(fs.readFileSync(pf)),meta=new Map(page.players.map(p=>[String(p.id),p]));
const R=S.rounds.length,D=S.detailWorlds,P=S.players.length,{offsets,keys,counts}=S.outcomes;
const draws=Array.from({length:P},()=>new Uint32Array(D)),d=S.detail;
for(let o=0;o<S.detailRows*16;o+=16){if(d[o+3]!==0)continue;const w=d[o],i=d[o+1]|(d[o+2]<<8),fl=d[o+4];
  draws[i][w]=fl&1?E.packOutcome([d[o+5]/2,d[o+6]/2,d[o+7]/2],d[o+8],d[o+9],d[o+10],d[o+11],d[o+12],d[o+13],fl&2?1:0,fl&4?1:0,d[o+14]):((fl&2?1:0)|(fl&4?2:0))}
const b64=a=>Buffer.from(a.buffer).toString('base64');
const players=S.players.map((p,i)=>{const j=i*R,oc=[];for(let x=offsets[j];x<offsets[j+1];x++)oc.push(keys[x],counts[x]);const m=meta.get(String(p.id))||{};
  return{id:+p.id,name:p.name,team:S.teams[p.team].name,role:p.role,opp:m.opp??null,home:m.home??null,out:m.out??0,inj:m.inj??null,ret:m.ret??null,fc:m.fc??null,
    bookie:m.bookie??null,sXfm:m.sXfm??null,sGames:m.sGames??null,fm:m.fm??null,games:m.games??0,goals:m.goals??0,assists:m.assists??0,with:m.with??[],hedge:m.hedge??[],
    oc,dr:b64(draws[i])}});
const out={meta:{...page.meta,round:S.first,N:S.N,D,season:page.meta.season},players};
fs.writeFileSync(of,JSON.stringify(out));
console.log('round',S.first,'N',S.N,'draws',D,'players',P,'outcome entries',players.reduce((t,p)=>t+p.oc.length/2,0),'bytes',fs.statSync(of).size);

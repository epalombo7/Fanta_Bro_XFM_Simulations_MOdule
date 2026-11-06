// Data for the FantaBall app page, from the latest season file (no new simulation):
//   outcomes: per player, the exact outcome counts of the next round over all recorded seasons (any rules can score them)
//   draws:    per player, his outcome in each of the season file's complete simulated rounds (same draw = same real
//             match for everyone), for lineups, fantasy goals and head-to-head
//   node pipeline/page/build_app_data.js <season.fbsim.br> <page data.json> <out.json> [--draws <league.js> <bootstrap.json> <chunks>]
// --draws: instead of the season file's stored rounds, simulate the next round alone again in chunks of 255 complete
// rounds (same model, bootstrap refits), e.g. 10 chunks = 2,550 draws, for less noise in lineups and fantasy goals.
// Encoding: outcome counts as base64 (uint32 key, uint32 count); draws sparse as base64 (uint16 draw, uint32 key).
const fs=require('fs'),zlib=require('zlib'),path=require('path'),E=require(path.join(__dirname,'..','..','mobile','assets','engine.js'));
const [sf,pf,of]=process.argv.slice(2);
const S=E.deserializeSeason(new Uint8Array(zlib.brotliDecompressSync(fs.readFileSync(sf))));
const page=JSON.parse(fs.readFileSync(pf)),meta=new Map(page.players.map(p=>[String(p.id),p]));
const R=S.rounds.length,D=S.detailWorlds,P=S.players.length,{offsets,keys,counts}=S.outcomes;
const key=(d,o)=>{const fl=d[o+4];return fl&1?E.packOutcome([d[o+5]/2,d[o+6]/2,d[o+7]/2],d[o+8],d[o+9],d[o+10],d[o+11],d[o+12],d[o+13],fl&2?1:0,fl&4?1:0,d[o+14]):((fl&2?1:0)|(fl&4?2:0))};
const args=process.argv.slice(2),di=args.indexOf('--draws');let draws,ND;
if(di<0){ND=D;draws=Array.from({length:P},()=>new Map());const d=S.detail;
  for(let o=0;o<S.detailRows*16;o+=16){if(d[o+3]!==0)continue;const k=key(d,o);if(k)draws[d[o+1]|(d[o+2]<<8)].set(d[o],k)}}
else{let t=fs.readFileSync(args[di+1],'utf8');t=t.slice(t.indexOf('{'),t.lastIndexOf('}')+1);const L=JSON.parse(t),r0=L.as_of_round;
  const reps=JSON.parse(fs.readFileSync(args[di+2])).map(B=>({...B,fixtures:undefined})),K=+args[di+3];ND=K*255;
  if(L.players.length!==P||L.players.some((p,i)=>String(p.id)!==String(S.players[i].id)))throw Error('League and season file players differ');
  draws=Array.from({length:P},()=>new Map());
  for(let k=0;k<K;k++){const X=E.runSeason({rounds:1},{N:255,detailWorlds:255,outcomes:false,league:{...L,fixtures:L.fixtures.slice(0,r0+1)},model:{...L.model,seed:31337+k},replicates:reps}),d=X.detail;
    for(let o=0;o<X.detailRows*16;o+=16){const kk=key(d,o);if(kk)draws[d[o+1]|(d[o+2]<<8)].set(k*255+d[o],kk)}}}
const b64=u8=>Buffer.from(u8.buffer,u8.byteOffset,u8.byteLength).toString('base64');
const sparse=m=>{const b=new DataView(new ArrayBuffer(m.size*6));let o=0;for(const [w,k] of m){b.setUint16(o,w,true);b.setUint32(o+2,k,true);o+=6}return b64(new Uint8Array(b.buffer))};
const ocEnc=a=>{const b=new DataView(new ArrayBuffer(a.length*4));a.forEach((x,i)=>b.setUint32(i*4,x,true));return b64(new Uint8Array(b.buffer))};
const players=S.players.map((p,i)=>{const j=i*R,oc=[];for(let x=offsets[j];x<offsets[j+1];x++)oc.push(keys[x],counts[x]);const m=meta.get(String(p.id))||{};
  return{id:+p.id,name:p.name,team:S.teams[p.team].name,role:p.role,opp:m.opp??null,home:m.home??null,out:m.out??0,inj:m.inj??null,ret:m.ret??null,fc:m.fc??null,
    bookie:m.bookie??null,sXfm:m.sXfm??null,sGames:m.sGames??null,fm:m.fm??null,games:m.games??0,goals:m.goals??0,assists:m.assists??0,with:m.with??[],hedge:m.hedge??[],
    oc:ocEnc(oc),dr:sparse(draws[i])}});
const out={meta:{...page.meta,round:S.first,N:S.N,D:ND,season:page.meta.season},players};
fs.writeFileSync(of,JSON.stringify(out));
console.log('round',S.first,'N',S.N,'draws',ND,'players',P,'outcome entries',players.reduce((t,p)=>t+p.oc.length*3/16,0),'bytes',fs.statSync(of).size);

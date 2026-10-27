// Module 1 — season simulation. Plays the remaining season N times and saves everything that happened
// (no league rules involved) to a compressed season file for score_season.js.
//   node run_season.js league.json rounds_left N out.fbsim.br [--burn-in B] [--detail D] [--summary matchdays.csv.gz] [--replicates boot.json]
// --replicates: bootstrap refits of the league (JSON array); simulated season w uses refit w % K.
// Plays B + N simulated seasons and records the last N (burn-in B, default 0); --detail sets how many recorded
// seasons keep per-match rows (matchday intervals, correlations; default 100). Output ending in .br is
// brotli-compressed (smallest), .gz gzip.
// --summary also writes module 1's matchday table as CSV (no league rules): per player per remaining round the
// median vote per provider, chance to be fit / available / start / play / get a vote, and expected goals,
// penalties, own goals, assists, cards, goals conceded and clean sheets.
const fs=require('fs'),zlib=require('zlib'),E=require('../mobile/assets/engine.js');
const args=process.argv.slice(2),[lf,rounds,n,of]=args,opt=k=>args.includes(k)?+args[args.indexOf(k)+1]:undefined,lg=JSON.parse(fs.readFileSync(lf)),summary=args.includes('--summary')?args[args.indexOf('--summary')+1]:null;
const reps=args.includes('--replicates')?JSON.parse(fs.readFileSync(args[args.indexOf('--replicates')+1])):[];
const t0=Date.now(),S=E.runSeason({rounds:+rounds},{N:+n||500,burnIn:opt('--burn-in')||0,detailWorlds:opt('--detail'),league:lg,model:lg.model,replicates:reps});
S.league={season:lg.season,as_of_round:lg.as_of_round};
const raw=E.serializeSeason(S);
const packed=of.endsWith('.br')?zlib.brotliCompressSync(raw,{params:{[zlib.constants.BROTLI_PARAM_QUALITY]:9,[zlib.constants.BROTLI_PARAM_LGWIN]:24,[zlib.constants.BROTLI_PARAM_SIZE_HINT]:raw.length}}):zlib.gzipSync(raw);
fs.writeFileSync(of,packed);
console.log(`season file ${of}: ${S.players.length} players, ${reps.length} bootstrap refits, ${S.burnIn} burn-in + ${S.N} recorded simulated seasons, ${S.rounds.length} rounds, ${(raw.length/1e6).toFixed(1)} MB raw -> ${(packed.length/1e6).toFixed(1)} MB, ${((Date.now()-t0)/1000).toFixed(0)} s`);
if(summary){
  const R=S.rounds.length,MF=S.mdFields.length,B=S.voteBins,q=x=>/[",]/.test(x)?'"'+x.replace(/"/g,'""')+'"':x;
  const med=(i,ri,k)=>{let h=((i*R+ri)*3+k)*B,n=0;for(let b=0;b<B;b++)n+=S.hist[h+b];if(!n)return'';let c=0;for(let b=0;b<B;b++){c+=S.hist[h+b];if(c>=n/2)return(3+b/2).toFixed(1)}};
  const cols=['fit','avail','starts','played','rated'],ev=['goals','penScored','penMissed','penSaved','ownGoals','assists','yellow','red','conceded','clean','yellowNoVote','redNoVote'];
  const lines=['id,name,team,role,round,opponent,home,'+S.providers.map(p=>'median_vote_'+p).join(',')+','+cols.map(x=>'p_'+x).join(',')+','+ev.map(x=>'exp_'+x).join(',')];
  S.players.forEach((p,i)=>S.rounds.forEach((round,ri)=>{const t=p.team,[h,a]=round.find(m=>m.includes(t))||[t,t],o=(i*R+ri)*MF,m=x=>S.md[o+S.mdFields.indexOf(x)]/S.N;
    lines.push([p.id,q(p.name),q(S.teams[t].name),p.role,S.first+ri,q(S.teams[h===t?a:h].name),h===t?1:0,...S.providers.map((_,k)=>med(i,ri,k)),...cols.map(x=>m(x).toFixed(3)),...ev.map(x=>m(x).toFixed(3))].join(','))}));
  fs.writeFileSync(summary,zlib.gzipSync(lines.join('\n')+'\n'));
  console.log('matchday summary written to',summary)}

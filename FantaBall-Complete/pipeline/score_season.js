// Module 2 — xFM under league rules. Reads a season file from run_season.js and applies the rules.
//   node score_season.js season.fbsim.gz config.json out.json [--corr prefix] [--matchdays out.csv.gz]
// --matchdays writes matchday-by-matchday scoring under the rules: per player per remaining round the chance of a
//   fantavoto, expected fantavoto if he gets one, the round's expected contribution, and the median with the middle-50%
//   interval (P25-P75).
// --corr also writes the player-by-player correlation matrices (players expected to get >= 5 votes):
//   <prefix>_matchday.csv.gz, <prefix>_head_to_head.csv.gz, <prefix>_season.csv.gz and <prefix>_pairs.csv
//   (for each player his 3 strongest same-round partners at his club = risk if started together, and his 3 strongest
//   head-to-head hedges).
// config.json is a league config ({competition, season, teams, budget, min, rounds, P, D, C, A, rules:{...}});
// any rule left out takes the standard default (RULES in engine.js).
const fs=require('fs'),zlib=require('zlib'),E=require('../mobile/assets/engine.js');
const args=process.argv.slice(2),[sf,cf,of]=args,c=JSON.parse(fs.readFileSync(cf)),corr=args.includes('--corr')?args[args.indexOf('--corr')+1]:null,mdOut=args.includes('--matchdays')?args[args.indexOf('--matchdays')+1]:null;
const buf=fs.readFileSync(sf),S=E.deserializeSeason(sf.endsWith('.br')?zlib.brotliDecompressSync(buf):zlib.gunzipSync(buf));
E.validate(c);
const o=E.scoreSeason(S,c);
fs.writeFileSync(of,JSON.stringify({league:S.league,players:o.players.map(({fixtures,...p})=>p),teams:o.teams,rules:o.rules}));
if(corr){
  const keep=o.players.filter(p=>p.rated>=5).sort((a,b)=>a.team.localeCompare(b.team)||'PDCA'.indexOf(a.role)-'PDCA'.indexOf(b.role)||b.expected-a.expected).map(p=>p.id);
  const q=x=>/[",]/.test(x)?'"'+x.replace(/"/g,'""')+'"':x;
  const mats={};
  for(const level of ['matchday','head_to_head','season']){
    const C=E.correlations(S,c,{ids:keep,level}),n=C.ids.length;mats[level]=C;
    let lines=['id,name,team,role,'+C.ids.join(',')];
    for(let a=0;a<n;a++)lines.push([C.ids[a],q(C.names[a]),q(C.teams[a]),C.roles[a],...Array.from({length:n},(_,b)=>{let r=C.matrix[a*n+b];return r===r?r.toFixed(2):''})].join(','));
    fs.writeFileSync(`${corr}_${level}.csv.gz`,zlib.gzipSync(lines.join('\n')+'\n'))}
  // Pairs summary
  const M=mats.matchday,H=mats.head_to_head,n=M.ids.length,rows=['id,name,team,role,partner,partner_team,partner_role,kind,correlation'];
  for(let a=0;a<n;a++){
    const cand=(C,filter)=>Array.from({length:n},(_,b)=>b).filter(b=>b!==a&&C.matrix[a*n+b]===C.matrix[a*n+b]&&filter(b));
    const risk=cand(M,b=>M.teams[b]===M.teams[a]).sort((x,y)=>M.matrix[a*n+y]-M.matrix[a*n+x]).slice(0,3);
    const hedge=cand(H,b=>H.teams[b]!==H.teams[a]).sort((x,y)=>H.matrix[a*n+x]-H.matrix[a*n+y]).slice(0,3);
    for(const [kind,C,list] of [['moves_with',M,risk],['hedge_head_to_head',H,hedge]])for(const b of list)
      rows.push([C.ids[a],q(C.names[a]),q(C.teams[a]),C.roles[a],q(C.names[b]),q(C.teams[b]),C.roles[b],kind,C.matrix[a*n+b].toFixed(2)].join(','))}
  fs.writeFileSync(`${corr}_pairs.csv`,rows.join('\n')+'\n');
  console.log(`correlations for ${n} players written to ${corr}_*`)}
if(mdOut){
  const q=x=>/[",]/.test(x)?'"'+x.replace(/"/g,'""')+'"':x,v=(x,d=3)=>x===null||x===undefined?'':(+x).toFixed(d);
  const lines=['id,name,team,role,round,opponent,home,p_play,p_start,p_vote,median_vote,xfm_if_voted,expected_points,fv_median,fv_p25,fv_p75,exp_goals,exp_assists,clean_sheet_if_voted'];
  for(const p of E.scoreMatchdays(S,c))for(const r of p.matchdays)
    lines.push([p.id,q(p.name),q(p.team),p.role,r.round,q(r.opponent),r.home?1:0,v(r.pPlay),v(r.pStart),v(r.pVote),v(r.medianVote,1),v(r.xfm),v(r.expected),v(r.median,1),v(r.low,1),v(r.high,1),v(r.goals),v(r.assists),v(r.cleanSheet)].join(','));
  fs.writeFileSync(mdOut,zlib.gzipSync(lines.join('\n')+'\n'));
  console.log('matchday scoring written to',mdOut)}

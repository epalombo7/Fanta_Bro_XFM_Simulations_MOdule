// FantaBall xFM engine — the single source of the simulation, used by the web app (index.html),
// the Expo WebView bundle (built by mobile/scripts/build-webview.js) and the Node tests.
//
// The simulation is team-based: every world plays the remaining calendar match by match.
// For each match it picks both lineups, draws the score from team attack/defence strengths,
// hands the goals and assists to the players on the pitch, and derives every player's vote
// from the match outcome. Teammates therefore share results, clean sheets and goal supply.
// It forecasts xFM and rated appearances only; prices are deliberately not part of it.
//
// Two kinds of settings, both overridable per run:
//  - RULES: the league's scoring rules, chosen by the user (config.rules).
//  - MODEL: statistical settings, meant to be calibrated from data (simulate(config, {model})).

const ROLES=['P','D','C','A'];

// League scoring rules. Defaults are a standard Fantacalcio Classic set; every value can be
// replaced by the user's own league rules via config.rules. Maluses are negative.
const RULES={
  roleSystem:'classic',          // 'classic' | 'mantra' (lineups use Classic roles; Mantra roles are reported)
  voteProvider:'fantacalcio',    // 'fantacalcio' | 'statistico' | 'italia': vote source used for calibration
  goal:{P:3,D:3,C:3,A:3},        // bonus per goal, by role
  assist:1,
  penaltyScored:3,               // bonus for a scored penalty (instead of the goal bonus)
  penaltyMissed:-3,
  penaltySaved:3,                // goalkeeper
  ownGoal:-2,
  yellow:-0.5,
  red:-1,
  conceded:-1,                   // goalkeeper, per goal conceded
  cleanSheet:{P:1,D:0,C:0,A:0},  // bonus when the team concedes none and the player has a vote
  noVoteRed:4,                   // fantavoto of a player sent off without a vote (null: no vote)
  noVoteYellow:null,             // fantavoto of a booked player without a vote (null: no vote; 5.5 is common)
  // Lineup-level bonus from the average vote of the keeper and the 3 best defenders, when at least
  // minDefenders defenders are fielded: [threshold, bonus] bands, highest threshold reached applies.
  defenceModifier:{enabled:true,minDefenders:4,bands:[[6,1],[6.5,3],[7,6]]}
};

// Model constants. Every value here is an assumption until fitted on real data.
const MODEL={
  seed:82,                 // simulation RNG seed (league generation uses its own seed)
  formation:{P:1,D:4,C:3,A:3},
  baseGoals:1.24,          // league-average non-penalty goals per team per match
  home:1.12,               // home multiplier on goals scored (away team divided by it)
  teamSd:.08,              // per-world uncertainty in team attack/defence (log scale)
  playerSd:.15,            // per-world uncertainty in player scoring/assist rates (log scale)
  ownGoal:.03,             // share of goals that are own goals by the opponent
  ownGoalRole:{P:.3,D:3,C:1,A:.4}, // who scores own goals, relative weight per minute by role
  penaltyRate:.14,         // penalties awarded per team per match
  penaltyConversion:.78,   // share of penalties scored
  penaltySavedShare:.7,    // share of missed penalties saved by the keeper (the rest miss the target)
  assisted:.7,             // share of credited goals that carry an assist
  subs:[3,5],              // substitutions per team per match (min, max)
  subMinutes:[10,45],      // minutes played by a substitute (min, max)
  subRatedMin:25,          // a substitute below this gets no vote unless scoring/assisting/sent off
  red:.008,                // straight red card probability per 90 minutes
  yellowBanEvery:5,        // one-match ban every N yellow cards
  injuryDispersion:0.28,    // shape of the injury-length distribution (lower = heavier tail); calibrated, data/params/injury_model.json
  // Vote = base + result + goal difference + team performance + individual noise + events
  vote:{win:.3,draw:0,loss:-.3,goalDiff:.1,teamSd:.25,indivSd:.4,goal:.5,assist:.25,red:-1,penMissed:-.5,penSaved:.5,ownGoal:-.5,
        gkConceded:-.25,gkClean:.3,defConceded:-.1,defClean:.2,min:3,max:10}
};

function rng(seed){let x=seed>>>0;return()=>{x=(1664525*x+1013904223)>>>0;return(x+.5)/4294967296}}
function normal(r){return Math.sqrt(-2*Math.log(r()))*Math.cos(2*Math.PI*r())}
function poisson(l,r){let p=1,k=0;do{k++;p*=r()}while(p>Math.exp(-Math.max(0,l))&&k<80);return k-1}
// Gamma(shape k, scale th) by Marsaglia-Tsang; used for the negative-binomial injury length.
function gamma(k,th,r){if(k<1)return gamma(k+1,th,r)*Math.pow(r(),1/k);let d=k-1/3,c=1/Math.sqrt(9*d);for(;;){let x,v;do{x=normal(r);v=1+c*x}while(v<=0);v=v*v*v;let u=r();if(u<1-.0331*x*x*x*x||Math.log(u)<.5*x*x+d*(1-v+Math.log(v)))return d*v*th}}
function quantile(a,q){let s=Float64Array.from(a).sort();return s.length?s[Math.floor((s.length-1)*q)]:0}
function clamp(x,lo,hi){return Math.min(hi,Math.max(lo,x))}

function isObj(x){return x&&typeof x==='object'&&!Array.isArray(x)}
// Deep merge: plain objects merge key by key, everything else (numbers, arrays, null) replaces.
function merge(base,over){if(!isObj(over))return over===undefined?base:over;let o={...base};for(let k in over)o[k]=isObj(base[k])&&isObj(over[k])?merge(base[k],over[k]):over[k];return o}

// League scoring rules for a config: defaults overridden by config.rules, then checked.
function leagueRules(c){let R=merge(RULES,c.rules||{}),n=(x,k)=>{if(!Number.isFinite(x))throw Error('Invalid scoring rule: '+k)};
  if(!['classic','mantra'].includes(R.roleSystem))throw Error('Role system must be classic or mantra');
  if(!['fantacalcio','statistico','italia'].includes(R.voteProvider))throw Error('Vote provider must be fantacalcio, statistico or italia');
  for(let k of ['assist','penaltyScored','penaltyMissed','penaltySaved','ownGoal','yellow','red','conceded'])n(R[k],k);
  for(let k of ['goal','cleanSheet'])ROLES.forEach(role=>n(R[k][role],k+'.'+role));
  for(let k of ['noVoteRed','noVoteYellow'])if(R[k]!==null)n(R[k],k);
  let D=R.defenceModifier;if(D.enabled){n(D.minDefenders,'defenceModifier.minDefenders');if(!Array.isArray(D.bands)||D.bands.some(b=>!Array.isArray(b)||b.length!==2||!b.every(Number.isFinite)))throw Error('Defence modifier bands must be [threshold, bonus] pairs')}
  return R}

// Defence modifier for one fielded lineup: keeper vote plus defenders' votes (all fielded with a vote).
function defenceModifier(gkVote,defVotes,R=RULES){let D=R.defenceModifier;if(!D.enabled||gkVote==null||defVotes.length<D.minDefenders)return 0;
  let best=[...defVotes].sort((x,y)=>y-x).slice(0,3),avg=(gkVote+best.reduce((s,v)=>s+v,0))/(1+best.length),bonus=0;
  for(let [t,b] of [...D.bands].sort((x,y)=>x[0]-y[0]))if(avg>=t)bonus=b;return bonus}

function validate(c){for(let k of ['teams','budget','min','rounds','P','D','C','A'])if(!Number.isInteger(c[k])||c[k]<1)throw Error('Positive whole numbers required: '+k);if(c.budget<c.min*(c.P+c.D+c.C+c.A))throw Error('Budget cannot fill squad');if(!c.competition||!c.season)throw Error('Competition and season required');leagueRules(c);return c}

// Double round robin (circle method): returns rounds of [homeTeamIndex, awayTeamIndex].
function calendar(nTeams,r=rng(11)){let order=Array.from({length:nTeams},(_,i)=>i);for(let i=order.length-1;i>0;i--){let j=Math.floor(r()*(i+1));[order[i],order[j]]=[order[j],order[i]]}let first=[];for(let k=0;k<nTeams-1;k++){let round=[];for(let m=0;m<nTeams/2;m++){let a=order[m],b=order[nTeams-1-m];round.push((k+m)%2?[a,b]:[b,a])}first.push(round);order.splice(1,0,order.pop())}return first.concat(first.map(round=>round.map(([h,a])=>[a,h])))}

// Synthetic league in the same shape real data must take:
//  teams[]:   {name, att, def, slots?}  (att/def are goal multipliers, def < 1 is a good defence;
//             slots {P,D,C,A} = starters per role, default MODEL.formation)
//  players[]: {id, name, team (index), role, start (lineup weight), base (vote when rated; or
//              baseByProvider {fantacalcio, statistico, italia}),
//              goalW, assistW (shares of team goals/assists per 90), yellow (per 90),
//              penW (penalty-taker weight), injuryRisk (per match), injuryGames (mean length),
//              injuredFor, yellows}
//  fixtures:  rounds of [home, away] team indices
function demoLeague(nTeams=20,r=rng(7)){let squadSize={P:2,D:6,C:6,A:4},goalW={P:0,D:.1,C:.35,A:1},assistW={P:.02,D:.3,C:.8,A:.6},yellow={P:.03,D:.2,C:.18,A:.1};let teams=Array.from({length:nTeams},(_,t)=>({name:'Demo club '+String(t+1).padStart(2,'0'),att:Math.exp(normal(r)*.2),def:Math.exp(normal(r)*.2)}));let players=[];teams.forEach((team,t)=>ROLES.forEach(role=>{for(let j=0;j<squadSize[role];j++){let starter=j<MODEL.formation[role];players.push({id:`T${t+1}${role}${j+1}`,name:`Demo ${role} ${String(t+1).padStart(2,'0')}-${j+1}`,team:t,role,start:starter?.8+.15*r():.15+.3*r(),base:5.9+.4*r()+(starter?.1:0),goalW:goalW[role]*(.5+r()),assistW:assistW[role]*(.5+r()),yellow:yellow[role]*(.6+.8*r()),injuryRisk:.015+.04*r(),injuryGames:1+3*r(),injuredFor:r()<.06?1+Math.floor(r()*5):0,yellows:0})}}));
  // Penalty takers: the club's best scorer takes most penalties, the next one a few
  teams.forEach((_,t)=>players.filter(p=>p.team===t).sort((x,y)=>y.goalW-x.goalW).forEach((p,k)=>p.penW=k===0?1:k===1?.2:.02));
  return{teams,players,fixtures:calendar(nTeams)}}

// Weighted draw of k distinct indices from list.
function pick(list,k,weight,r){if(k===1){let total=0;for(let i of list)total+=weight(i);let x=r()*total;for(let i of list){x-=weight(i);if(x<=0)return [i]}return list.length?[list[list.length-1]]:[]}let pool=list.slice(),out=[];while(out.length<k&&pool.length){let total=0;for(let i of pool)total+=weight(i);let x=r()*total,j=0;for(;j<pool.length-1;j++){x-=weight(pool[j]);if(x<=0)break}out.push(pool.splice(j,1)[0])}return out}

// ---------------------------------------------------------------------------------------------
// Module 1 — runSeason: plays the remaining season N times and records what happened, with no league
// rules involved. For each simulated season (world) and player it keeps the counts below; for each
// team-match the score and the defence-modifier inputs. Votes are recorded for all three vote providers
// (same match, same random draws, each provider's own calibrated coefficients).
// Module 2 — scoreSeason: turns that record into xFM under any league rules (see below).
const SEASON_FIELDS=['rated','vote_fantacalcio','vote_statistico','vote_italia', // vote sums are stored x2 (half points)
  'goals','penScored','penMissed','penSaved','ownGoals','assists',
  'yellow','red','conceded','clean',            // in matches with a vote: cards, goals conceded, clean sheets
  'yellowNoVote','redNoVote',                   // booked / sent off in a match without a vote (s.v.)
  'played','starts','fit','avail'];             // appearances, starts, matchdays fit, matchdays available
const TEAM_FIELDS=['gf','ga','dm_fantacalcio','dm_statistico','dm_italia','dRated']; // dm = 20 x avg vote of keeper + 3 best defenders (0 = n/a)
const PROVIDERS=['fantacalcio','statistico','italia'];

function runSeason(c,opts={}){
  if(!Number.isInteger(c.rounds)||c.rounds<1)throw Error('Positive whole numbers required: rounds');
  let N=opts.N||1000,league=opts.league||demoLeague(),M=merge(MODEL,opts.model||{});
  let {teams,players}=league,rounds=league.fixtures||calendar(teams.length);
  if(c.rounds>rounds.length)throw Error(`Maximum ${rounds.length} fixtures in this calendar`);
  let first=rounds.length-c.rounds+1;rounds=rounds.slice(first-1); // remaining fixtures
  let r=rng(M.seed),P=players.length,F=SEASON_FIELDS.length,TF=TEAM_FIELDS.length,nM=rounds.reduce((s,x)=>s+x.length,0);
  let VP=PROVIDERS.map(pr=>merge(M.vote,(M.voteByProvider||{})[pr]||{}));
  let stats=new Uint16Array(P*N*F),teamStats=new Uint8Array(N*nM*2*TF);
  const at=(i,w)=>(i*N+w)*F,f=k=>SEASON_FIELDS.indexOf(k);
  const [fR,fV,fG,fPS,fPM,fPSV,fOG,fA,fY,fRd,fC,fCS,fYN,fRN,fPl,fSt,fFit,fAv]=['rated','vote_fantacalcio','goals','penScored','penMissed','penSaved','ownGoals','assists','yellow','red','conceded','clean','yellowNoVote','redNoVote','played','starts','fit','avail'].map(f);
  let roster=teams.map(()=>[]);players.forEach((p,i)=>roster[p.team].push(i));
  // Per-world state
  let injured=new Int16Array(P),banned=new Int8Array(P),yellows=new Int16Array(P),q=new Float64Array(P),att=new Float64Array(teams.length),def=new Float64Array(teams.length);
  let mins=new Float64Array(P),g=new Int16Array(P),a=new Int16Array(P),yel=new Int8Array(P),red=new Int8Array(P),starter=new Int8Array(P);
  let ps=new Int8Array(P),pm=new Int8Array(P),psv=new Int8Array(P),og=new Int8Array(P); // penalties scored/missed/saved, own goals
  let w=0;

  // Availability and lineup for one team; returns indices who played (mins[] filled).
  function lineup(t){
    let ready=[];
    for(let i of roster[t]){let p=players[i];mins[i]=0;g[i]=a[i]=yel[i]=red[i]=starter[i]=ps[i]=pm[i]=psv[i]=og[i]=0;
      if(injured[i]>0){injured[i]--;continue}
      // New injury: matches missed = 1 + negative binomial with mean injuryGames-1 (heavy tail)
      if(r()<p.injuryRisk){let k=M.injuryDispersion,extra=Math.max(0,p.injuryGames-1);injured[i]=extra?Math.min(60,poisson(gamma(k,extra/k,r),r)):0;continue}
      stats[at(i,w)+fFit]++;if(banned[i]>0){banned[i]--;continue}
      stats[at(i,w)+fAv]++;ready.push(i)}
    let byRole={P:[],D:[],C:[],A:[]};for(let i of ready)byRole[players[i].role].push(i);
    let Fm=teams[t].slots||M.formation,xi=[];for(let role of ROLES)for(let i of pick(byRole[role],Fm[role],i=>players[i].start,r)){xi.push(i);starter[i]=1}
    if(xi.length<11)for(let i of pick(ready.filter(i=>!starter[i]&&players[i].role!=='P'),11-xi.length,i=>players[i].start,r)){xi.push(i);starter[i]=1}
    xi.forEach(i=>{mins[i]=90;stats[at(i,w)+fSt]++});
    let bench=ready.filter(i=>!starter[i]&&players[i].role!=='P'),out=xi.filter(i=>players[i].role!=='P'),played=xi.slice();
    let nSubs=Math.min(bench.length,M.subs[0]+Math.floor(r()*(M.subs[1]-M.subs[0]+1)));
    for(let s=0;s<nSubs;s++){
      let off=out.splice(Math.floor(r()*out.length),1)[0];
      let same=bench.filter(i=>players[i].role===players[off].role),on=pick(same.length?same:bench,1,i=>players[i].start,r)[0];
      bench.splice(bench.indexOf(on),1);
      let m=M.subMinutes[0]+Math.floor(r()*(M.subMinutes[1]-M.subMinutes[0]+1));
      mins[on]=m;mins[off]=90-m;played.push(on)}
    return played}

  // Hand a team's open-play goals to the players on the pitch (role share x form x minutes);
  // a share are own goals by the opponents on the pitch.
  function credit(played,opp,n){
    for(let k=0;k<n;k++){
      if(r()<M.ownGoal){og[pick(opp,1,i=>M.ownGoalRole[players[i].role]*mins[i]+1e-9,r)[0]]++;continue}
      let scorer=pick(played,1,i=>players[i].goalW*q[i]*mins[i]+1e-9,r)[0];g[scorer]++;
      if(r()<M.assisted){let mates=played.filter(i=>i!==scorer);if(mates.length)a[pick(mates,1,i=>players[i].assistW*q[i]*mins[i]+1e-9,r)[0]]++}}}

  // Penalties: the taker is drawn by penalty weight among players on the pitch; returns goals scored.
  function penalties(played,opp){
    let scored=0;
    for(let k=poisson(M.penaltyRate,r);k>0;k--){
      let taker=pick(played,1,i=>(players[i].penW||0)*mins[i]+1e-9,r)[0];
      if(r()<M.penaltyConversion){ps[taker]++;scored++}
      else{pm[taker]++;let gk=opp.find(i=>players[i].role==='P');if(gk!==undefined&&r()<M.penaltySavedShare)psv[gk]++}}
    return scored}

  // Cards, then votes from the match outcome for every provider; records the team-match row.
  function rate(played,gf,ga,row){
    let gd=clamp(gf-ga,-3,3),zTeam=normal(r),gk=PROVIDERS.map(()=>null),dv=PROVIDERS.map(()=>[]);
    for(let i of played){let p=players[i],o=at(i,w);
      if(r()<p.yellow*mins[i]/90){yel[i]=1;yellows[i]++;if(yellows[i]%M.yellowBanEvery===0)banned[i]=1}
      if(r()<M.red*mins[i]/90){red[i]=1;banned[i]=1}
      stats[o+fPl]++;stats[o+fG]+=g[i];stats[o+fPS]+=ps[i];stats[o+fPM]+=pm[i];stats[o+fPSV]+=psv[i];stats[o+fOG]+=og[i];stats[o+fA]+=a[i];
      if(!starter[i]&&mins[i]<M.subRatedMin&&!(g[i]||a[i]||ps[i]||pm[i]||psv[i]||og[i])){ // no vote (s.v.)
        if(red[i])stats[o+fRN]++;else if(yel[i])stats[o+fYN]++;
        continue}
      let zInd=normal(r);
      stats[o+fR]++;stats[o+fY]+=yel[i];stats[o+fRd]+=red[i];stats[o+fC]+=ga;stats[o+fCS]+=ga?0:1;
      PROVIDERS.forEach((pr,k)=>{let V=VP[k],res=gf>ga?V.win:gf<ga?V.loss:V.draw;
        let v=(p.baseByProvider?p.baseByProvider[pr]:p.base)+res+V.goalDiff*gd+zTeam*V.teamSd+zInd*V.indivSd+V.goal*(g[i]+ps[i])+V.assist*a[i]+V.penMissed*pm[i]+V.penSaved*psv[i]+V.ownGoal*og[i]+(red[i]?V.red:0);
        if(p.role==='P')v+=V.gkConceded*ga+(ga?0:V.gkClean);
        if(p.role==='D')v+=V.defConceded*ga+(ga?0:V.defClean);
        v=clamp(Math.round(v*2)/2,V.min,V.max);
        stats[o+fV+k]+=v*2;
        if(p.role==='P'&&gk[k]===null)gk[k]=v;
        if(p.role==='D')dv[k].push(v)})}
    teamStats[row]=gf;teamStats[row+1]=ga;teamStats[row+5]=dv[0].length;
    PROVIDERS.forEach((_,k)=>{if(gk[k]!==null&&dv[k].length>=3){let best=dv[k].sort((x,y)=>y-x).slice(0,3);teamStats[row+2+k]=Math.round(20*(gk[k]+best[0]+best[1]+best[2])/4)}})}

  for(w=0;w<N;w++){
    teams.forEach((t,k)=>{att[k]=t.att*Math.exp(normal(r)*M.teamSd);def[k]=t.def*Math.exp(normal(r)*M.teamSd)});
    players.forEach((p,i)=>{q[i]=Math.exp(normal(r)*M.playerSd);injured[i]=p.injuredFor||0;yellows[i]=p.yellows||0;banned[i]=0});
    let m=0;
    for(let round of rounds)for(let [h,aw] of round){
      let ph=lineup(h),pa=lineup(aw);
      let oh=poisson(M.baseGoals*att[h]*def[aw]*M.home,r),oa=poisson(M.baseGoals*att[aw]*def[h]/M.home,r);
      credit(ph,pa,oh);credit(pa,ph,oa);
      let gh=oh+penalties(ph,pa),ga=oa+penalties(pa,ph),row=((w*nM+m)*2)*TF;
      rate(ph,gh,ga,row);rate(pa,ga,gh,row+TF);m++}}

  return{format:'fantaball-season',version:1,N,first,rounds,fields:SEASON_FIELDS,teamFields:TEAM_FIELDS,providers:PROVIDERS,
    teams:teams.map(t=>({name:t.name,att:t.att,def:t.def})),
    players:players.map(p=>({id:p.id,name:p.name,team:p.team,role:p.role,qi:p.qi})),
    model:M,created:new Date().toISOString(),stats,teamStats}}

// Season file: 'FBSN' + uint32 header length + JSON header + per-player stats (Uint16, little-endian,
// layout [player][world][field]) + per team-match stats (Uint8, layout [world][match][home, away][field]).
function serializeSeason(S){
  let {stats,teamStats,...head}=S,h=new TextEncoder().encode(JSON.stringify(head)),pad=(8+h.length)%2;
  let out=new Uint8Array(8+h.length+pad+stats.byteLength+teamStats.byteLength),dv=new DataView(out.buffer);
  out.set([70,66,83,78]);dv.setUint32(4,h.length+pad,true);out.set(h,8);if(pad)out[8+h.length]=32; // pad with a space
  let o=8+h.length+pad;out.set(new Uint8Array(stats.buffer,stats.byteOffset,stats.byteLength),o);out.set(teamStats,o+stats.byteLength);
  return out}
function deserializeSeason(bytes){
  let b=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes),dv=new DataView(b.buffer,b.byteOffset,b.byteLength);
  if(String.fromCharCode(...b.subarray(0,4))!=='FBSN')throw Error('Not a FantaBall season file');
  let hl=dv.getUint32(4,true),head=JSON.parse(new TextDecoder().decode(b.subarray(8,8+hl)).trim());
  let n=head.players.length*head.N*head.fields.length,o=8+hl,st=new Uint16Array(n);
  for(let k=0;k<n;k++)st[k]=dv.getUint16(o+2*k,true);
  return{...head,stats:st,teamStats:b.slice(o+2*n)}}

// scoreSeason(season, config): fantavoto under config.rules (over RULES) for every simulated season,
// then xFM = total fantavoto / total rated games, bands across simulated seasons, and team summaries.
// Everything rules-dependent happens here, so changing the rules never needs a new season run.
function scoreSeason(S,c){
  let RU=leagueRules(c),N=S.N,F=S.fields.length,TF=S.teamFields.length,R=S.rounds.length,nM=S.teamStats.length/(N*2*TF);
  const f=k=>S.fields.indexOf(k),k=S.providers.indexOf(RU.voteProvider);
  const [fR,fG,fPS,fPM,fPSV,fOG,fA,fY,fRd,fC,fCS,fYN,fRN,fSt,fFit,fAv]=['rated','goals','penScored','penMissed','penSaved','ownGoals','assists','yellow','red','conceded','clean','yellowNoVote','redNoVote','starts','fit','avail'].map(f),fV=f('vote_'+RU.voteProvider);
  let yN=RU.noVoteYellow,rN=RU.noVoteRed,sum=(i,fi)=>{let t=0;for(let w=0;w<N;w++)t+=S.stats[(i*N+w)*F+fi];return t};
  let players=S.players.map((p,i)=>{
    let ratedW=new Float64Array(N),ptsW=new Float64Array(N),perWorld=[],votes=0,voted=0;
    for(let w=0;w<N;w++){let o=(i*N+w)*F,s=S.stats;
      let rated=s[o+fR]+(yN!==null?s[o+fYN]:0)+(rN!==null?s[o+fRN]:0);
      let pts=s[o+fV]/2+s[o+fG]*RU.goal[p.role]+s[o+fPS]*RU.penaltyScored+s[o+fPM]*RU.penaltyMissed+s[o+fPSV]*RU.penaltySaved
        +s[o+fOG]*RU.ownGoal+s[o+fA]*RU.assist+s[o+fY]*RU.yellow+s[o+fRd]*RU.red+s[o+fCS]*RU.cleanSheet[p.role]
        +(p.role==='P'?s[o+fC]*RU.conceded:0)+(yN!==null?s[o+fYN]*yN:0)+(rN!==null?s[o+fRN]*rN:0);
      ratedW[w]=rated;ptsW[w]=pts;votes+=s[o+fV]/2;voted+=s[o+fR];if(rated)perWorld.push(pts/rated)}
    let rated=ratedW.reduce((x,y)=>x+y,0)/N,pts=ptsW.reduce((x,y)=>x+y,0)/N,t=p.team;
    return{id:p.id,name:p.name,team:S.teams[t].name,role:p.role,
      fixtures:S.rounds.map((round,j)=>{let [h,aw]=round.find(m=>m.includes(t)),opp=h===t?aw:h;return{round:S.first+j,home:h===t,opponent:S.teams[opp].name,attack:S.teams[opp].att,def:S.teams[opp].def}}),
      xfm:rated?pts/rated:0,xfmLow:quantile(perWorld,.1),xfmHigh:quantile(perWorld,.9),
      rated,glo:quantile(ratedW,.1),ghi:quantile(ratedW,.9),expected:pts,
      vote:voted?votes/voted:0,goals:(sum(i,fG)+sum(i,fPS))/N,assists:sum(i,fA)/N,
      penScored:sum(i,fPS)/N,penMissed:sum(i,fPM)/N,penSaved:sum(i,fPSV)/N,ownGoals:sum(i,fOG)/N,
      integrita:sum(i,fFit)/(N*R),titolarita:sum(i,fAv)?sum(i,fSt)/sum(i,fAv):0}});
  // Team summaries: goals, conceded and the club's average defence modifier under these rules
  let tg=S.teams.map(()=>({gf:0,ga:0,mod:0,n:0})),D=RU.defenceModifier,bands=[...D.bands].sort((x,y)=>x[0]-y[0]);
  for(let w=0;w<N;w++){let m=0;for(let round of S.rounds)for(let [h,aw] of round){[h,aw].forEach((t,side)=>{let o=((w*nM+m)*2+side)*TF,T=tg[t],avg=S.teamStats[o+2+k]/20;
      T.gf+=S.teamStats[o];T.ga+=S.teamStats[o+1];T.n++;
      if(D.enabled&&avg>0&&S.teamStats[o+5]>=D.minDefenders){let bonus=0;for(let [th,bb] of bands)if(avg>=th)bonus=bb;T.mod+=bonus}});m++}}
  return{players,teams:S.teams.map((t,j)=>({...t,goals:tg[j].gf/N,conceded:tg[j].ga/N,defenceModifier:tg[j].n?tg[j].mod/tg[j].n:0})),rules:RU,model:S.model}}

// simulate(config, {N, league, model}) — or simulate(config, N, league) for short: both modules in one go.
// config.rules overrides RULES; model overrides MODEL (e.g. calibrated values).
function simulate(c,opts={},legacyLeague){
  if(typeof opts==='number')opts={N:opts,league:legacyLeague};
  validate(c);
  return scoreSeason(runSeason(c,opts),c)}

// Auction ledger bookkeeping (not part of the simulation).
function squad(c,ledger,players){let mine=ledger.filter(e=>e.owner==='me'),spent=mine.reduce((s,e)=>s+e.price,0),slots=Object.fromEntries(ROLES.map(r=>[r,c[r]]));mine.forEach(e=>{let p=players.find(p=>p.id===e.pid);if(p)slots[p.role]--});let empty=Object.values(slots).reduce((a,b)=>a+b,0);return{mine,spent,left:c.budget-spent,slots,legal:Math.max(0,c.budget-spent-c.min*Math.max(0,empty-1))}}
function purchase(c,ledger,ps,pid,price,owner){let p=ps.find(p=>p.id===pid);if(!p)throw Error('Unknown player');if(ledger.some(e=>e.pid===pid))throw Error('Already purchased');if(!Number.isInteger(price)||price<c.min)throw Error('Invalid price');if(owner==='me'){let s=squad(c,ledger,ps);if(s.slots[p.role]<1||price>s.legal)throw Error('Role full or illegal budget')}return [...ledger,{pid,price,owner,at:new Date().toISOString()}]}

if(typeof module!=="undefined")module.exports={MODEL,RULES,SEASON_FIELDS,TEAM_FIELDS,merge,leagueRules,defenceModifier,runSeason,scoreSeason,serializeSeason,deserializeSeason,simulate,demoLeague,calendar,validate,squad,purchase};

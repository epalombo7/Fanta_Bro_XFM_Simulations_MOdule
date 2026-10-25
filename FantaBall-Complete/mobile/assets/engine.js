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
  // Substitutions: each outfield starter goes off with his role's (or his own, players[].offRate) chance, up
  // to maxSubs; a bench player comes on (his role from subAffinity, then by his own subW) for minutes drawn from the role's real distribution
  // (subMinutesQ: minutes at the 0th, 10th, ..., 100th percentile).
  offRate:{P:0,D:.29,C:.55,A:.68},
  maxSubs:5,
  subsCount:[0,.001,.016,.075,.226,.682], // chance of 0..5 substitutions in a match (default; calibrated per league)
  subAffinity:{D:{D:.73,C:.16,A:.11},C:{D:.13,C:.63,A:.24},A:{D:.09,C:.29,A:.62}}, // role coming on for a role going off (real single substitutions)
  subMinutesQ:{D:[1,3,6,10,14,18,22,27,32,44,60],C:[1,5,8,12,16,20,24,27,32,44,60],A:[1,4,7,10,14,18,21,25,30,37,60],P:[1,2,7,20,32,40,49,60,79,82,90]},
  subRatedMin:25,          // a substitute below this gets no vote unless scoring/assisting/sent off
  red:.008,                // straight red card probability per 90 minutes
  yellowBanEvery:5,        // one-match ban every N yellow cards
  keeperSuccession:true,   // first-choice keeper unavailable: the next keeper in the pecking order starts
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
// Module 1 — runSeason: plays the remaining season (burnIn + N) times and records the last N simulated seasons,
// with no league rules involved. Votes are recorded for all three vote providers (same match, same random
// draws, each provider's own calibrated coefficients). It keeps:
//  - per simulated season and player (WORLD_FIELDS, one column each, smallest type that fits): what module 2
//    needs for season fantavoto under any rules — votes, rated games and every scored event;
//  - a matchday table (MD_FIELDS) per player per remaining round, summed over all N simulated seasons, plus a
//    histogram of the vote per provider (median vote);
//  - per-match detail rows for the first detailWorlds recorded seasons (matchday intervals, correlations);
//  - per team: goals for / against totals and a histogram of the defence-modifier inputs.
// Module 2 — scoreSeason / scoreMatchdays / correlations: turn that record into xFM under any league rules.
const WORLD_FIELDS={rated:'u8',vote_fantacalcio:'u16',vote_statistico:'u16',vote_italia:'u16', // vote sums are x2 (half points)
  goals:'u8',penScored:'u8',penMissed:'u8',penSaved:'u8',ownGoals:'u8',assists:'u8',
  yellow:'u8',red:'u8',conceded:'u16',clean:'u8',   // in matches with a vote: cards, goals conceded, clean sheets
  yellowNoVote:'u8',redNoVote:'u8'};               // booked / sent off in a match without a vote (s.v.)
const PROVIDERS=['fantacalcio','statistico','italia'];
// Interval reported everywhere (season xFM, rated games, matchday fantavoto): the middle 50%
const BAND=[.25,.75];
// Per-match detail: one 16-byte row per player per match played: world, player (2 bytes), round, flags
// (1 rated, 2 yellow, 4 red), vote x2 per provider (3), goals, penalties scored / missed / saved, own goals,
// assists, goals conceded, spare.
const DETAIL_BYTES=16;
// Matchday table: per player per remaining round, counts over the recorded simulated seasons of the fields
// below, plus a histogram of the vote per provider (3.0 to 10.0 in half points, 15 bins) for the median vote.
const MD_FIELDS=['played','rated','starts','fit','avail','goals','penScored','penMissed','penSaved','ownGoals','assists',
  'yellow','red','conceded','clean','yellowNoVote','redNoVote'];
const VOTE_BINS=15,DM_BINS=201,DM_RATED=12;  // defence modifier: 20 x average vote (0 = n/a), defenders with a vote (capped)
// Outcome counts: per player per remaining round, how many recorded simulated seasons produced each exact match
// outcome, packed in 32 bits — rated: bit 31 = 1; vote x2 - 6 (0-14, bits 0-3); Statistico and Italia votes as
// half-point differences + 7 (bits 4-7, 8-11); goals (12-14); penalties scored (15-16), missed (17-18), saved
// (19-20); own goals (21-22); assists (23-25); yellow (26); red (27); goals conceded, max 7 (28-30). No vote
// (s.v.) with a card: 1 = booked, 2 = sent off. Module 2 scores each outcome under the rules, so matchday
// medians and intervals use every recorded season.
function packOutcome(v,g,ps,pm,psv,og,a,yel,red,ga){const c=(x,m)=>Math.min(m,Math.max(0,x));
  return(((1<<31)|c(v[0]*2-6,14)|c(v[1]*2-v[0]*2+7,15)<<4|c(v[2]*2-v[0]*2+7,15)<<8|c(g,7)<<12|c(ps,3)<<15|c(pm,3)<<17|c(psv,3)<<19|c(og,3)<<21|c(a,7)<<23|yel<<26|red<<27|c(ga,7)<<28)>>>0)}
function unpackOutcome(k){if(!(k>>>31))return{rated:false,yellow:k&1?1:0,red:k&2?1:0};
  let v0=(k&15)+6;return{rated:true,vote2:[v0,v0+((k>>4)&15)-7,v0+((k>>8)&15)-7],goals:(k>>12)&7,penScored:(k>>15)&3,penMissed:(k>>17)&3,penSaved:(k>>19)&3,
    ownGoals:(k>>21)&3,assists:(k>>23)&7,yellow:(k>>26)&1,red:(k>>27)&1,ga:(k>>28)&7}}

const TYPED={u8:Uint8Array,u16:Uint16Array,i16:Int16Array,u32:Uint32Array,f64:Float64Array};

function runSeason(c,opts={}){
  if(!Number.isInteger(c.rounds)||c.rounds<1)throw Error('Positive whole numbers required: rounds');
  let N=opts.N||1000,burnIn=opts.burnIn||0,league=opts.league||demoLeague(),M=merge(MODEL,opts.model||{});
  let {teams,players}=league,rounds=league.fixtures||calendar(teams.length);
  if(c.rounds>rounds.length)throw Error(`Maximum ${rounds.length} fixtures in this calendar`);
  let first=rounds.length-c.rounds+1;rounds=rounds.slice(first-1); // remaining fixtures
  let r=rng(M.seed),P=players.length,T=teams.length,R=rounds.length;
  let VP=PROVIDERS.map(pr=>merge(M.vote,(M.voteByProvider||{})[pr]||{}));
  let W=Object.fromEntries(Object.entries(WORLD_FIELDS).map(([k,t])=>[k,new TYPED[t](P*N)]));
  let MF=MD_FIELDS.length,md=new Uint32Array(P*R*MF),hist=new Uint32Array(P*R*3*VOTE_BINS);
  let outc=opts.outcomes===false?null:new Array(P*R).fill(null);   // outcome counts, Map per player-round
  const bump=(i,key)=>{let j=i*R+ri,m=outc[j]||(outc[j]=new Map());m.set(key,(m.get(key)||0)+1)};
  let team={gf:new Float64Array(T),ga:new Float64Array(T),n:new Float64Array(T),dm:new Uint32Array(T*3*DM_BINS*DM_RATED)};
  const [mPl,mR,mSt,mFit,mAv,mG,mPS,mPM,mPSV,mOG,mA,mY,mRd,mC,mCS,mYN,mRN]=MD_FIELDS.map((_,k)=>k);
  let D=Math.min(N,255,opts.detailWorlds??100),detail=new Uint8Array(D?1<<20:0),nRows=0,ri=0,w=0,ws=0,rec=false;
  const mdA=i=>(i*R+ri)*MF,row16=()=>{if((nRows+1)*DETAIL_BYTES>detail.length){let d=new Uint8Array(detail.length*2);d.set(detail);detail=d}return nRows++*DETAIL_BYTES};
  let roster=teams.map(()=>[]);players.forEach((p,i)=>roster[p.team].push(i));
  let gkOrder=roster.map(ix=>ix.filter(i=>players[i].role==='P').sort((x,y)=>players[y].start-players[x].start)); // keeper pecking order
  // Per-world state
  let injured=new Int16Array(P),banned=new Int8Array(P),yellows=new Int16Array(P),q=new Float64Array(P),att=new Float64Array(T),def=new Float64Array(T);
  let mins=new Float64Array(P),g=new Int16Array(P),a=new Int16Array(P),yel=new Int8Array(P),red=new Int8Array(P),starter=new Int8Array(P);
  let ps=new Int8Array(P),pm=new Int8Array(P),psv=new Int8Array(P),og=new Int8Array(P); // penalties scored/missed/saved, own goals

  // Availability and lineup for one team; returns indices who played (mins[] filled).
  function lineup(t){
    let ready=[];
    for(let i of roster[t]){let p=players[i];mins[i]=0;g[i]=a[i]=yel[i]=red[i]=starter[i]=ps[i]=pm[i]=psv[i]=og[i]=0;
      if(injured[i]>0){injured[i]--;continue}
      // New injury: matches missed = 1 + negative binomial with mean injuryGames-1 (heavy tail)
      if(r()<p.injuryRisk){let k=M.injuryDispersion,extra=Math.max(0,p.injuryGames-1);injured[i]=extra?Math.min(60,poisson(gamma(k,extra/k,r),r)):0;continue}
      if(rec)md[mdA(i)+mFit]++;if(banned[i]>0){banned[i]--;continue}
      if(rec)md[mdA(i)+mAv]++;ready.push(i)}
    let byRole={P:[],D:[],C:[],A:[]};for(let i of ready)byRole[players[i].role].push(i);
    let Fm=teams[t].slots||M.formation,xi=[];
    for(let role of ROLES){let pool=byRole[role];
      // Keeper succession: if the club's first-choice keeper is out, the best available keeper is the de facto first choice
      if(role==='P'&&M.keeperSuccession&&pool.length&&!pool.includes(gkOrder[t][0]))pool=[pool.reduce((x,y)=>players[y].start>players[x].start?y:x)];
      for(let i of pick(pool,Fm[role],i=>players[i].start,r)){xi.push(i);starter[i]=1}}
    if(xi.length<11)for(let i of pick(ready.filter(i=>!starter[i]&&players[i].role!=='P'),11-xi.length,i=>players[i].start,r)){xi.push(i);starter[i]=1}
    xi.forEach(i=>{mins[i]=90;if(rec)md[mdA(i)+mSt]++});
    let bench=ready.filter(i=>!starter[i]&&players[i].role!=='P'),played=xi.slice();
    // how many go off: the real distribution of substitutions per match (subsCount), else each by his own chance;
    // who goes off: by the odds of his chance of being subbed off
    let offR=i=>players[i].offRate??M.offRate[players[i].role],out=xi.filter(i=>players[i].role!=='P'),offs;
    if(M.subsCount){let x=r(),n=0;while(n<M.subsCount.length-1&&(x-=M.subsCount[n])>0)n++;
      offs=pick(out,Math.min(n,M.maxSubs),i=>offR(i)/(1.02-offR(i)),r)}
    else{offs=out.filter(i=>r()<offR(i));while(offs.length>M.maxSubs)offs.splice(Math.floor(r()*offs.length),1)}
    for(let off of offs){if(!bench.length)break;
      // role of the substitute from the affinity (among roles on the bench), then the player by his chance of coming on
      let aff=M.subAffinity[players[off].role]||{},sw=i=>players[i].subW??players[i].start,tot={D:0,C:0,A:0};for(let i of bench)tot[players[i].role]+=sw(i);
      let on=pick(bench,1,i=>(aff[players[i].role]??.01)*sw(i)/(tot[players[i].role]||1),r)[0];
      bench.splice(bench.indexOf(on),1);
      let m=subMinute(players[on].role);mins[on]=m;mins[off]=90-m;played.push(on)}
    return played}
  // Substitute minutes from the role's distribution (linear between percentiles)
  function subMinute(role){let Q=M.subMinutesQ[role]||M.subMinutesQ.C,x=r()*10,k=Math.min(9,Math.floor(x));return Math.max(1,Math.round(Q[k]+(Q[k+1]-Q[k])*(x-k)))}

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

  // Cards, then votes from the match outcome for every provider; records everything for this team-match.
  function rate(played,gf,ga,t){
    let gd=clamp(gf-ga,-3,3),zTeam=normal(r),gk=PROVIDERS.map(()=>null),dv=PROVIDERS.map(()=>[]);
    for(let i of played){let p=players[i],o=i*N+ws,q2=mdA(i);
      if(r()<p.yellow*mins[i]/90){yel[i]=1;yellows[i]++;if(yellows[i]%M.yellowBanEvery===0)banned[i]=1}
      if(r()<M.red*mins[i]/90){red[i]=1;banned[i]=1}
      let sv=!starter[i]&&mins[i]<M.subRatedMin&&!(g[i]||a[i]||ps[i]||pm[i]||psv[i]||og[i]); // no vote (s.v.)
      let zInd=sv?0:normal(r);
      if(!rec)continue;          // burn-in: the draws happen, nothing is recorded
      W.goals[o]+=g[i];W.penScored[o]+=ps[i];W.penMissed[o]+=pm[i];W.penSaved[o]+=psv[i];W.ownGoals[o]+=og[i];W.assists[o]+=a[i];
      md[q2+mPl]++;md[q2+mG]+=g[i];md[q2+mPS]+=ps[i];md[q2+mPM]+=pm[i];md[q2+mPSV]+=psv[i];md[q2+mOG]+=og[i];md[q2+mA]+=a[i];
      let d=ws<D?row16():-1;
      if(d>=0){detail[d]=ws;detail[d+1]=i&255;detail[d+2]=i>>8;detail[d+3]=ri;detail[d+4]=(yel[i]?2:0)|(red[i]?4:0);
        detail[d+8]=g[i];detail[d+9]=ps[i];detail[d+10]=pm[i];detail[d+11]=psv[i];detail[d+12]=og[i];detail[d+13]=a[i];detail[d+14]=ga}
      if(sv){if(red[i]){W.redNoVote[o]++;md[q2+mRN]++;if(outc)bump(i,2)}else if(yel[i]){W.yellowNoVote[o]++;md[q2+mYN]++;if(outc)bump(i,1)}continue}
      if(d>=0)detail[d+4]|=1;
      W.rated[o]++;W.yellow[o]+=yel[i];W.red[o]+=red[i];W.conceded[o]+=ga;W.clean[o]+=ga?0:1;
      md[q2+mR]++;md[q2+mY]+=yel[i];md[q2+mRd]+=red[i];md[q2+mC]+=ga;md[q2+mCS]+=ga?0:1;
      let vv=[0,0,0];
      PROVIDERS.forEach((pr,k)=>{let V=VP[k],res=gf>ga?V.win:gf<ga?V.loss:V.draw;
        let v=(p.baseByProvider?p.baseByProvider[pr]:p.base)+res+V.goalDiff*gd+zTeam*V.teamSd+zInd*V.indivSd+V.goal*(g[i]+ps[i])+V.assist*a[i]+V.penMissed*pm[i]+V.penSaved*psv[i]+V.ownGoal*og[i]+(red[i]?V.red:0);
        if(p.role==='P')v+=V.gkConceded*ga+(ga?0:V.gkClean);
        if(p.role==='D')v+=V.defConceded*ga+(ga?0:V.defClean);
        v=clamp(Math.round(v*2)/2,V.min,V.max);
        W['vote_'+pr][o]+=v*2;if(d>=0)detail[d+5+k]=v*2;hist[((i*R+ri)*3+k)*VOTE_BINS+Math.round((v-3)*2)]++;vv[k]=v;
        if(p.role==='P'&&gk[k]===null)gk[k]=v;
        if(p.role==='D')dv[k].push(v)});
      if(outc)bump(i,packOutcome(vv,g[i],ps[i],pm[i],psv[i],og[i],a[i],yel[i],red[i],ga))}
    if(!rec)return;
    team.gf[t]+=gf;team.ga[t]+=ga;team.n[t]++;
    PROVIDERS.forEach((_,k)=>{let val=0;if(gk[k]!==null&&dv[k].length>=3){let best=dv[k].sort((x,y)=>y-x).slice(0,3);val=Math.round(20*(gk[k]+best[0]+best[1]+best[2])/4)}
      team.dm[((t*3+k)*DM_BINS+val)*DM_RATED+Math.min(DM_RATED-1,dv[k].length)]++})}

  for(w=0;w<burnIn+N;w++){
    rec=w>=burnIn;ws=w-burnIn;
    teams.forEach((t,k)=>{att[k]=t.att*Math.exp(normal(r)*M.teamSd);def[k]=t.def*Math.exp(normal(r)*M.teamSd)});
    players.forEach((p,i)=>{q[i]=Math.exp(normal(r)*M.playerSd);injured[i]=p.injuredFor||0;yellows[i]=p.yellows||0;banned[i]=0});
    ri=0;
    for(let round of rounds){for(let [h,aw] of round){
      let ph=lineup(h),pa=lineup(aw);
      let oh=poisson(M.baseGoals*att[h]*def[aw]*M.home,r),oa=poisson(M.baseGoals*att[aw]*def[h]/M.home,r);
      credit(ph,pa,oh);credit(pa,ph,oa);
      let gh=oh+penalties(ph,pa),ga=oa+penalties(pa,ph);
      rate(ph,gh,ga,h);rate(pa,ga,gh,aw)}ri++}}

  return{format:'fantaball-season',version:4,N,burnIn,first,rounds,providers:PROVIDERS,band:BAND,worldFields:WORLD_FIELDS,
    detailWorlds:D,detailRows:nRows,detail:detail.slice(0,nRows*DETAIL_BYTES),
    mdFields:MD_FIELDS,voteBins:VOTE_BINS,md,hist,W,team,outcomes:outc&&packOutcomes(outc),
    teams:teams.map(t=>({name:t.name,att:t.att,def:t.def})),
    players:players.map(p=>({id:p.id,name:p.name,team:p.team,role:p.role,qi:p.qi})),
    model:M,created:new Date().toISOString()}}

// Outcome counts to flat arrays: offsets [P*R+1], keys (sorted within each player-round), counts.
function packOutcomes(outc){let n=0;for(let m of outc)if(m)n+=m.size;
  let offsets=new Uint32Array(outc.length+1),keys=new Uint32Array(n),counts=new Uint32Array(n),o=0;
  outc.forEach((m,j)=>{offsets[j]=o;if(m){for(let k of [...m.keys()].sort((x,y)=>x-y)){keys[o]=k;counts[o]=m.get(k);o++}}});offsets[outc.length]=o;
  return{offsets,keys,counts}}

// Season file (version 4): 'FBSN' + uint32 header length + JSON header + sections listed in header.sections
// ({name, type, length}), each 4-byte aligned, little-endian. To compress well (brotli in the CLI) every
// per-season field is its own column, votes are stored as differences (provider 1 minus 12 per rated game,
// providers 2 and 3 minus provider 1) and the per-match detail rows are stored byte-column by byte-column.
function seasonSections(S){
  let out=[],P=S.players.length,N=S.N,F=S.W;
  for(let [k,t] of Object.entries(S.worldFields)){
    let a=F[k];
    if(k==='vote_fantacalcio'){let d=new Int16Array(P*N);for(let j=0;j<d.length;j++)d[j]=a[j]-12*F.rated[j];out.push(['W.'+k,'i16',d])}
    else if(k.startsWith('vote_')){let d=new Int16Array(P*N),b=F.vote_fantacalcio;for(let j=0;j<d.length;j++)d[j]=a[j]-b[j];out.push(['W.'+k,'i16',d])}
    else out.push(['W.'+k,t,a])}
  out.push(['md','u32',S.md],['hist','u32',S.hist],['team.gf','f64',S.team.gf],['team.ga','f64',S.team.ga],['team.n','f64',S.team.n],['team.dm','u32',S.team.dm]);
  let nr=S.detailRows,cols=new Uint8Array(nr*DETAIL_BYTES);
  for(let j=0;j<nr;j++)for(let b=0;b<DETAIL_BYTES;b++)cols[b*nr+j]=S.detail[j*DETAIL_BYTES+b];
  out.push(['detail','u8',cols]);
  if(S.outcomes){let {offsets,keys,counts}=S.outcomes,dk=new Uint32Array(keys.length);  // keys delta-coded within each player-round
    for(let j=0;j<offsets.length-1;j++)for(let x=offsets[j];x<offsets[j+1];x++)dk[x]=x===offsets[j]?keys[x]:keys[x]-keys[x-1];
    out.push(['out.offsets','u32',offsets],['out.keys','u32',dk],['out.counts',S.N<65536?'u16':'u32',S.N<65536?Uint16Array.from(counts):counts])}
  return out}
function serializeSeason(S){
  let secs=seasonSections(S),{W,team,md,hist,detail,outcomes,_fv,...head}=S;
  head.sections=secs.map(([name,type,arr])=>({name,type,length:arr.length}));
  let h=new TextEncoder().encode(JSON.stringify(head)),hp=(4-(8+h.length)%4)%4,size=8+h.length+hp;
  for(let [,,arr] of secs)size+=arr.byteLength+(4-arr.byteLength%4)%4;
  let out=new Uint8Array(size),dv=new DataView(out.buffer);
  out.set([70,66,83,78]);dv.setUint32(4,h.length+hp,true);out.set(h,8);out.fill(32,8+h.length,8+h.length+hp);
  let o=8+h.length+hp;
  for(let [,,arr] of secs){out.set(new Uint8Array(arr.buffer,arr.byteOffset,arr.byteLength),o);o+=arr.byteLength+(4-arr.byteLength%4)%4}
  return out}
function deserializeSeason(bytes){
  let b=bytes instanceof Uint8Array?new Uint8Array(bytes.buffer,bytes.byteOffset,bytes.byteLength):new Uint8Array(bytes),dv=new DataView(b.buffer,b.byteOffset,b.byteLength);
  if(String.fromCharCode(...b.subarray(0,4))!=='FBSN')throw Error('Not a FantaBall season file');
  let hl=dv.getUint32(4,true),head=JSON.parse(new TextDecoder().decode(b.subarray(8,8+hl)).trim());
  if(head.version!==4)throw Error('Season file version '+head.version+' is not supported: re-run module 1');
  let o=8+hl,raw={};
  for(let s of head.sections){let T_=TYPED[s.type],n=s.length*T_.BYTES_PER_ELEMENT,copy=b.slice(o,o+n);raw[s.name]=new T_(copy.buffer);o+=n+(4-n%4)%4}
  let S={...head,W:{},team:{gf:raw['team.gf'],ga:raw['team.ga'],n:raw['team.n'],dm:raw['team.dm']},md:raw.md,hist:raw.hist},P=head.players.length,N=head.N;
  for(let [k,t] of Object.entries(head.worldFields)){let a=new TYPED[t](P*N),d=raw['W.'+k];
    if(k==='vote_fantacalcio')for(let j=0;j<a.length;j++)a[j]=d[j]+12*raw['W.rated'][j];
    else if(k.startsWith('vote_'))for(let j=0;j<a.length;j++)a[j]=d[j]+S.W.vote_fantacalcio[j];
    else a.set(d);
    S.W[k]=a}
  if(raw['out.offsets']){let off=raw['out.offsets'],dk=raw['out.keys'],keys=new Uint32Array(dk.length);
    for(let j=0;j<off.length-1;j++)for(let x=off[j];x<off[j+1];x++)keys[x]=x===off[j]?dk[x]:keys[x-1]+dk[x];
    S.outcomes={offsets:off,keys,counts:Uint32Array.from(raw['out.counts'])}}
  let nr=head.detailRows,cols=raw.detail;S.detail=new Uint8Array(nr*DETAIL_BYTES);
  for(let j=0;j<nr;j++)for(let k=0;k<DETAIL_BYTES;k++)S.detail[j*DETAIL_BYTES+k]=cols[k*nr+j];
  return S}

// scoreSeason(season, config): fantavoto under config.rules (over RULES) for every recorded simulated season,
// then xFM = total fantavoto / total rated games, the middle-50% band across simulated seasons, and team
// summaries. Everything rules-dependent happens here, so changing the rules never needs a new season run.
function scoreSeason(S,c){
  let RU=leagueRules(c),N=S.N,R=S.rounds.length,MF=S.mdFields.length,W=S.W,V=W['vote_'+RU.voteProvider];
  let yN=RU.noVoteYellow,rN=RU.noVoteRed,[lo,hi]=S.band||BAND;
  const mdSum=(i,f)=>{let k=S.mdFields.indexOf(f),t=0;for(let ri=0;ri<R;ri++)t+=S.md[(i*R+ri)*MF+k];return t};
  let players=S.players.map((p,i)=>{
    let ratedW=new Float64Array(N),perWorld=[],pts=0,ratedT=0,votes=0,voted=0;
    for(let w=0;w<N;w++){let o=i*N+w;
      let rated=W.rated[o]+(yN!==null?W.yellowNoVote[o]:0)+(rN!==null?W.redNoVote[o]:0);
      let x=V[o]/2+W.goals[o]*RU.goal[p.role]+W.penScored[o]*RU.penaltyScored+W.penMissed[o]*RU.penaltyMissed+W.penSaved[o]*RU.penaltySaved
        +W.ownGoals[o]*RU.ownGoal+W.assists[o]*RU.assist+W.yellow[o]*RU.yellow+W.red[o]*RU.red+W.clean[o]*RU.cleanSheet[p.role]
        +(p.role==='P'?W.conceded[o]*RU.conceded:0)+(yN!==null?W.yellowNoVote[o]*yN:0)+(rN!==null?W.redNoVote[o]*rN:0);
      ratedW[w]=rated;pts+=x;ratedT+=rated;votes+=V[o]/2;voted+=W.rated[o];if(rated)perWorld.push(x/rated)}
    let t=p.team,avail=mdSum(i,'avail');
    return{id:p.id,name:p.name,team:S.teams[t].name,role:p.role,
      fixtures:S.rounds.map((round,j)=>{let [h,aw]=round.find(m=>m.includes(t)),opp=h===t?aw:h;return{round:S.first+j,home:h===t,opponent:S.teams[opp].name,attack:S.teams[opp].att,def:S.teams[opp].def}}),
      xfm:ratedT?pts/ratedT:0,xfmLow:quantile(perWorld,lo),xfmHigh:quantile(perWorld,hi),
      rated:ratedT/N,glo:quantile(ratedW,lo),ghi:quantile(ratedW,hi),expected:pts/N,
      vote:voted?votes/voted:0,goals:(mdSum(i,'goals')+mdSum(i,'penScored'))/N,assists:mdSum(i,'assists')/N,
      penScored:mdSum(i,'penScored')/N,penMissed:mdSum(i,'penMissed')/N,penSaved:mdSum(i,'penSaved')/N,ownGoals:mdSum(i,'ownGoals')/N,
      integrita:mdSum(i,'fit')/(N*R),titolarita:avail?mdSum(i,'starts')/avail:0}});
  // Team summaries: goals, conceded and the club's average defence modifier under these rules
  let D=RU.defenceModifier,bands=[...D.bands].sort((x,y)=>x[0]-y[0]),k=S.providers.indexOf(RU.voteProvider);
  let teams=S.teams.map((t,j)=>{let mod=0;
    if(D.enabled)for(let v=1;v<DM_BINS;v++)for(let dr=Math.min(DM_RATED-1,D.minDefenders);dr<DM_RATED;dr++){let cnt=S.team.dm[((j*3+k)*DM_BINS+v)*DM_RATED+dr];
      if(cnt){let bonus=0;for(let [th,bb] of bands)if(v/20>=th)bonus=bb;mod+=bonus*cnt}}
    return{...t,goals:S.team.gf[j]/N,conceded:S.team.ga[j]/N,defenceModifier:S.team.n[j]?mod/S.team.n[j]:0}});
  return{players,teams,rules:RU,model:S.model}}

// Matchday fantavoto under the rules for every (detail world, round) slot: Float32Array [player][slot],
// NaN when the player had no fantavoto that round (didn't play, or no vote and no s.v. rule applies).
function matchdayPoints(S,c){
  if(!S.detailRows)throw Error('This season file has no per-match detail (run module 1 with detailWorlds > 0)');
  let RU=leagueRules(c),k=S.providers.indexOf(RU.voteProvider),R=S.rounds.length,nS=S.detailWorlds*R,P=S.players.length;
  let fv=new Float32Array(P*nS).fill(NaN),d=S.detail;
  for(let o=0;o<S.detailRows*DETAIL_BYTES;o+=DETAIL_BYTES){
    let i=d[o+1]|(d[o+2]<<8),role=S.players[i].role,slot=d[o]*R+d[o+3],fl=d[o+4],x;
    if(fl&1){let ga=d[o+14];x=d[o+5+k]/2+d[o+8]*RU.goal[role]+d[o+9]*RU.penaltyScored+d[o+10]*RU.penaltyMissed+d[o+11]*RU.penaltySaved+d[o+12]*RU.ownGoal
        +d[o+13]*RU.assist+(fl&2?RU.yellow:0)+(fl&4?RU.red:0)+(ga?0:RU.cleanSheet[role])+(role==='P'?ga*RU.conceded:0)}
    else if(fl&4&&RU.noVoteRed!==null)x=RU.noVoteRed;
    else if(fl&2&&RU.noVoteYellow!==null)x=RU.noVoteYellow;
    else continue;
    fv[i*nS+slot]=x}
  return{fv,nS}}

// Fantavoto of one packed outcome under rules RU for provider index k (null: no fantavoto).
function outcomeFantavoto(o,role,RU,k){
  if(!o.rated)return o.red&&RU.noVoteRed!==null?RU.noVoteRed:o.yellow&&RU.noVoteYellow!==null?RU.noVoteYellow:null;
  return o.vote2[k]/2+o.goals*RU.goal[role]+o.penScored*RU.penaltyScored+o.penMissed*RU.penaltyMissed+o.penSaved*RU.penaltySaved+o.ownGoals*RU.ownGoal
    +o.assists*RU.assist+o.yellow*RU.yellow+o.red*RU.red+(o.ga?0:RU.cleanSheet[role])+(role==='P'?o.ga*RU.conceded:0)}
// Weighted quantile (values with counts).
function wquantile(vals,wts,q){let idx=vals.map((_,j)=>j).sort((a,b)=>vals[a]-vals[b]),tot=wts.reduce((a,b)=>a+b,0),t=Math.floor((tot-1)*q),c=0;
  for(let j of idx){c+=wts[j];if(c>t)return vals[j]}return vals[idx[idx.length-1]]}

// Matchday-by-matchday scoring (module 2): for each player and remaining round, under the league rules:
//  pPlay, pVote (chance of a fantavoto, incl. the league's s.v. rules), medianVote (provider's vote, from
//  the matchday table), xfm (expected fantavoto if he gets one: exact, from expected counts), expected
//  (pVote x xfm, the round's expected contribution), and median / low / high of his fantavoto in that round
//  (middle-50% interval P25-P75 over every recorded simulated season, from the outcome counts).
function scoreMatchdays(S,c,ids){
  if(!S.md)throw Error('This season file has no matchday table (made by an older version: re-run module 1)');
  let RU=leagueRules(c),k=S.providers.indexOf(RU.voteProvider),N=S.N,R=S.rounds.length,MF=S.mdFields.length,B=S.voteBins,f=x=>S.mdFields.indexOf(x);
  let key=JSON.stringify(RU);if(!S.outcomes&&S.detailRows&&(!S._fv||S._fv.key!==key))S._fv={key,...matchdayPoints(S,c)};
  let idx=ids?ids.map(id=>S.players.findIndex(p=>p.id===String(id))).filter(i=>i>=0):S.players.map((_,i)=>i),yN=RU.noVoteYellow,rN=RU.noVoteRed;
  return idx.map(i=>{let p=S.players[i],t=p.team,rows=S.rounds.map((round,ri)=>{
      let o=(i*R+ri)*MF,m=x=>S.md[o+f(x)],h=((i*R+ri)*3+k)*B;
      // fantavoto total over the N simulated seasons for this round, and how many of them gave one
      let rated=m('rated')+(yN!==null?m('yellowNoVote'):0)+(rN!==null?m('redNoVote'):0),vsum=0;
      for(let b=0;b<B;b++)vsum+=S.hist[h+b]*(3+b/2);
      let tot=vsum+m('goals')*RU.goal[p.role]+m('penScored')*RU.penaltyScored+m('penMissed')*RU.penaltyMissed+m('penSaved')*RU.penaltySaved
        +m('ownGoals')*RU.ownGoal+m('assists')*RU.assist+m('yellow')*RU.yellow+m('red')*RU.red+m('clean')*RU.cleanSheet[p.role]
        +(p.role==='P'?m('conceded')*RU.conceded:0)+(yN!==null?m('yellowNoVote')*yN:0)+(rN!==null?m('redNoVote')*rN:0);
      let med=null,cum=0,nv=m('rated');for(let b=0;b<B&&nv;b++){cum+=S.hist[h+b];if(cum>=nv/2){med=3+b/2;break}}
      let fvs=[],wts=null;
      if(S.outcomes){let {offsets,keys,counts}=S.outcomes,j=i*R+ri;wts=[];   // every recorded season, exact under the rules
        for(let x=offsets[j];x<offsets[j+1];x++){let fvx=outcomeFantavoto(unpackOutcome(keys[x]),p.role,RU,k);if(fvx!==null){fvs.push(fvx);wts.push(counts[x])}}}
      else if(S._fv){let {fv,nS}=S._fv;for(let w=0;w<S.detailWorlds;w++){let x=fv[i*nS+w*R+ri];if(x===x)fvs.push(x)}}
      const qq=q=>wts?wquantile(fvs,wts,q):quantile(fvs,q),enough=wts?wts.reduce((a,b)=>a+b,0)>=10:fvs.length>=10;
      let [h0,a0]=round.find(mm=>mm.includes(t))||[t,t];
      return{round:S.first+ri,opponent:S.teams[h0===t?a0:h0].name,home:h0===t,pPlay:m('played')/N,pVote:rated/N,pStart:m('starts')/N,pFit:m('fit')/N,
        medianVote:med,xfm:rated?tot/rated:null,expected:tot/N,
        median:enough?qq(.5):null,low:enough?qq((S.band||BAND)[0]):null,high:enough?qq((S.band||BAND)[1]):null,
        goals:(m('goals')+m('penScored'))/N,assists:m('assists')/N,cleanSheet:m('rated')?m('clean')/m('rated'):null}});
    return{id:p.id,name:p.name,team:S.teams[t].name,role:p.role,matchdays:rows}})}

// Fewest shared observations for a correlation to be reported (fewer is mostly noise)
const MIN_JOINT={matchday:100,head_to_head:60,season:50};

// Pearson correlation of two players' series over the slots where both have a value (NaN if too few).
function corrPair(a,b,minJoint){let n=0,sa=0,sb=0,saa=0,sbb=0,sab=0;
  for(let t=0;t<a.length;t++){let x=a[t],y=b[t];if(x===x&&y===y){n++;sa+=x;sb+=y;saa+=x*x;sbb+=y*y;sab+=x*y}}
  if(n<minJoint)return{r:NaN,n};let va=saa-sa*sa/n,vb=sbb-sb*sb/n;return{r:va>0&&vb>0?(sab-sa*sb/n)/Math.sqrt(va*vb):NaN,n}}

// correlations(season, config, {ids, level, minJoint}): player-by-player correlation matrix under the rules.
//  level 'matchday' (default): fantavoto in the same round, when both have one; tells you whether starting
//    two players together adds risk (positive, e.g. keeper and defenders of one club) or hedges (negative,
//    e.g. a keeper and the striker he faces).
//  level 'head_to_head': as matchday, but for players of different clubs only the rounds where the two
//    clubs play each other: the keeper-vs-opposing-striker hedge for that match.
//  level 'season': each simulated season's xFM; tells you whether their whole seasons rise and fall together.
function correlations(S,c,o={}){
  let level=o.level||'matchday',idx=o.ids?o.ids.map(id=>S.players.findIndex(p=>p.id===String(id))).filter(i=>i>=0):S.players.map((_,i)=>i);
  let series;
  let meet=null;
  if(level==='matchday'||level==='head_to_head'){let {fv,nS}=matchdayPoints(S,c);series=i=>fv.subarray(i*nS,(i+1)*nS);
    if(level==='head_to_head'){let R=S.rounds.length,cache={};
      // Slots (detail world x round) where clubs ta and tb play each other
      meet=(ta,tb)=>{let key=ta<tb?ta+'-'+tb:tb+'-'+ta;if(cache[key])return cache[key];let rs=[];S.rounds.forEach((round,ri)=>{if(round.some(([h,a])=>(h===ta&&a===tb)||(h===tb&&a===ta)))rs.push(ri)});
        let sl=[];for(let w=0;w<S.detailWorlds;w++)for(let ri of rs)sl.push(w*R+ri);return cache[key]=sl}}}
  else{let RU=leagueRules(c),N=S.N,cache={};
    series=i=>cache[i]||(cache[i]=Float64Array.from({length:N},(_,w)=>{let r=S.W.rated[i*N+w];
      return r?perWorldPoints(S,RU,i,w)/r:NaN}))}
  let n=idx.length,m=new Float32Array(n*n),joint=new Uint32Array(n*n),min=o.minJoint??MIN_JOINT[level];
  const pick=(arr,sl)=>Float64Array.from(sl,t=>arr[t]);
  for(let a=0;a<n;a++){m[a*n+a]=1;let sa=series(idx[a]),ta=S.players[idx[a]].team;for(let b=a+1;b<n;b++){let sb=series(idx[b]),tb=S.players[idx[b]].team,res;
    if(meet&&ta!==tb){let sl=meet(ta,tb);res=corrPair(pick(sa,sl),pick(sb,sl),min)}else res=corrPair(sa,sb,min);
    m[a*n+b]=m[b*n+a]=res.r;joint[a*n+b]=joint[b*n+a]=res.n}}
  return{level,ids:idx.map(i=>S.players[i].id),names:idx.map(i=>S.players[i].name),teams:idx.map(i=>S.teams[S.players[i].team].name),roles:idx.map(i=>S.players[i].role),matrix:m,joint}}

// One player against everyone: [{id, name, team, role, r, n}], sorted by r (matchday or head_to_head level).
function correlationRow(S,c,id,o={}){
  let key=JSON.stringify(leagueRules(c));if(!S._fv||S._fv.key!==key)S._fv={key,...matchdayPoints(S,c)};
  let {fv,nS}=S._fv,i=S.players.findIndex(p=>p.id===String(id)),R=S.rounds.length,min=o.minJoint??MIN_JOINT[o.level||'matchday'],ti=S.players[i].team,a=fv.subarray(i*nS,(i+1)*nS),out=[];
  let rounds=t=>S.rounds.map((rd,ri)=>rd.some(([h,x])=>(h===ti&&x===t)||(h===t&&x===ti))?ri:-1).filter(x=>x>=0),slots={};
  S.players.forEach((p,j)=>{if(j===i)return;let b=fv.subarray(j*nS,(j+1)*nS),res;
    if(o.level==='head_to_head'&&p.team!==ti){let sl=slots[p.team]||(slots[p.team]=(()=>{let r=rounds(p.team),x=[];for(let w=0;w<S.detailWorlds;w++)for(let ri of r)x.push(w*R+ri);return x})());
      res=corrPair(Float64Array.from(sl,t=>a[t]),Float64Array.from(sl,t=>b[t]),min)}
    else res=corrPair(a,b,min);
    if(res.r===res.r)out.push({id:p.id,name:p.name,team:S.teams[p.team].name,role:p.role,r:res.r,n:res.n})});
  return out.sort((x,y)=>y.r-x.r)}

// One simulated season's fantavoto total for player i under rules RU (matches with a vote only).
function perWorldPoints(S,RU,i,w){let o=i*S.N+w,W=S.W,role=S.players[i].role;
  return W['vote_'+RU.voteProvider][o]/2+W.goals[o]*RU.goal[role]+W.penScored[o]*RU.penaltyScored+W.penMissed[o]*RU.penaltyMissed+W.penSaved[o]*RU.penaltySaved
    +W.ownGoals[o]*RU.ownGoal+W.assists[o]*RU.assist+W.yellow[o]*RU.yellow+W.red[o]*RU.red+W.clean[o]*RU.cleanSheet[role]+(role==='P'?W.conceded[o]*RU.conceded:0)}

// simulate(config, {N, league, model}) — or simulate(config, N, league) for short: both modules in one go.
// config.rules overrides RULES; model overrides MODEL (e.g. calibrated values).
function simulate(c,opts={},legacyLeague){
  if(typeof opts==='number')opts={N:opts,league:legacyLeague};
  validate(c);
  return scoreSeason(runSeason(c,opts),c)}

// Auction ledger bookkeeping (not part of the simulation).
function squad(c,ledger,players){let mine=ledger.filter(e=>e.owner==='me'),spent=mine.reduce((s,e)=>s+e.price,0),slots=Object.fromEntries(ROLES.map(r=>[r,c[r]]));mine.forEach(e=>{let p=players.find(p=>p.id===e.pid);if(p)slots[p.role]--});let empty=Object.values(slots).reduce((a,b)=>a+b,0);return{mine,spent,left:c.budget-spent,slots,legal:Math.max(0,c.budget-spent-c.min*Math.max(0,empty-1))}}
function purchase(c,ledger,ps,pid,price,owner){let p=ps.find(p=>p.id===pid);if(!p)throw Error('Unknown player');if(ledger.some(e=>e.pid===pid))throw Error('Already purchased');if(!Number.isInteger(price)||price<c.min)throw Error('Invalid price');if(owner==='me'){let s=squad(c,ledger,ps);if(s.slots[p.role]<1||price>s.legal)throw Error('Role full or illegal budget')}return [...ledger,{pid,price,owner,at:new Date().toISOString()}]}

if(typeof module!=="undefined")module.exports={MODEL,RULES,WORLD_FIELDS,BAND,packOutcome,unpackOutcome,merge,leagueRules,defenceModifier,runSeason,scoreSeason,matchdayPoints,scoreMatchdays,correlations,correlationRow,MD_FIELDS,serializeSeason,deserializeSeason,simulate,demoLeague,calendar,validate,squad,purchase};

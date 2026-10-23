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
  injuryDispersion:.8,     // shape of the injury-length distribution (lower = heavier tail of long injuries)
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
//  teams[]:   {name, att, def}  (att/def are goal multipliers; def < 1 is a good defence)
//  players[]: {id, name, team (index), role, start (lineup weight), base (vote when rated),
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

// simulate(config, {N, league, model}) — or simulate(config, N, league) for short.
// config.rules overrides RULES; model overrides MODEL (e.g. calibrated values).
function simulate(c,opts={},legacyLeague){
  if(typeof opts==='number')opts={N:opts,league:legacyLeague};
  validate(c);
  let N=opts.N||1000,league=opts.league||demoLeague(),M=merge(MODEL,opts.model||{}),RU=leagueRules(c);
  let {teams,players}=league,rounds=league.fixtures||calendar(teams.length);
  if(c.rounds>rounds.length)throw Error(`Maximum ${rounds.length} fixtures in this calendar`);
  let first=rounds.length-c.rounds+1;rounds=rounds.slice(first-1); // remaining fixtures
  let r=rng(M.seed),V=M.vote,P=players.length,R=rounds.length;
  let roster=teams.map(()=>[]);players.forEach((p,i)=>roster[p.team].push(i));
  // Accumulators: per player per world, and per player totals
  let ratedW=players.map(()=>new Float64Array(N)),pointsW=players.map(()=>new Float64Array(N));
  let fit=new Float64Array(P),avail=new Float64Array(P),starts=new Float64Array(P),votes=new Float64Array(P),goals=new Float64Array(P),assists=new Float64Array(P);
  let teamGoals=new Float64Array(teams.length),teamConceded=new Float64Array(teams.length);
  // Per-world state
  let injured=new Int16Array(P),banned=new Int8Array(P),yellows=new Int16Array(P),q=new Float64Array(P),att=new Float64Array(teams.length),def=new Float64Array(teams.length);
  let mins=new Float64Array(P),g=new Int16Array(P),a=new Int16Array(P),yel=new Int8Array(P),red=new Int8Array(P),starter=new Int8Array(P);
  let ps=new Int8Array(P),pm=new Int8Array(P),psv=new Int8Array(P),og=new Int8Array(P); // penalties scored/missed/saved, own goals
  let penScored=new Float64Array(P),penMissed=new Float64Array(P),penSaved=new Float64Array(P),ownGoals=new Float64Array(P);
  let teamMod=new Float64Array(teams.length);

  // Availability and lineup for one team; returns indices who played (mins[] filled).
  function lineup(t){
    let ready=[];
    for(let i of roster[t]){let p=players[i];mins[i]=0;g[i]=a[i]=yel[i]=red[i]=starter[i]=ps[i]=pm[i]=psv[i]=og[i]=0;
      if(injured[i]>0){injured[i]--;continue}
      // New injury: matches missed = 1 + negative binomial with mean injuryGames-1 (heavy tail)
      if(r()<p.injuryRisk){let k=M.injuryDispersion,extra=Math.max(0,p.injuryGames-1);injured[i]=extra?Math.min(60,poisson(gamma(k,extra/k,r),r)):0;continue}
      fit[i]++;if(banned[i]>0){banned[i]--;continue}
      avail[i]++;ready.push(i)}
    let byRole={P:[],D:[],C:[],A:[]};for(let i of ready)byRole[players[i].role].push(i);
    let xi=[];for(let role of ROLES)for(let i of pick(byRole[role],M.formation[role],i=>players[i].start,r)){xi.push(i);starter[i]=1}
    if(xi.length<11)for(let i of pick(ready.filter(i=>!starter[i]&&players[i].role!=='P'),11-xi.length,i=>players[i].start,r)){xi.push(i);starter[i]=1}
    xi.forEach(i=>{mins[i]=90;starts[i]++});
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

  // Votes from the match outcome, then fantavoto from the league rules. Returns the team's defence modifier.
  function rate(played,gf,ga,w,t){
    let res=gf>ga?V.win:gf<ga?V.loss:V.draw,gd=clamp(gf-ga,-3,3),perf=normal(r)*V.teamSd,gkVote=null,defVotes=[];
    for(let i of played){let p=players[i];
      if(r()<p.yellow*mins[i]/90){yel[i]=1;yellows[i]++;if(yellows[i]%M.yellowBanEvery===0)banned[i]=1}
      if(r()<M.red*mins[i]/90){red[i]=1;banned[i]=1}
      goals[i]+=g[i]+ps[i];assists[i]+=a[i];penScored[i]+=ps[i];penMissed[i]+=pm[i];penSaved[i]+=psv[i];ownGoals[i]+=og[i];
      let decisive=g[i]||a[i]||ps[i]||pm[i]||psv[i]||og[i]||red[i];
      if(!starter[i]&&mins[i]<M.subRatedMin&&!decisive){ // no vote (s.v.): only the league's s.v. rules can still score it
        let fv=yel[i]&&RU.noVoteYellow!==null?RU.noVoteYellow:null;
        if(fv!==null){ratedW[i][w]++;pointsW[i][w]+=fv}
        continue}
      let v=p.base+res+V.goalDiff*gd+perf+normal(r)*V.indivSd+V.goal*(g[i]+ps[i])+V.assist*a[i]+V.penMissed*pm[i]+V.penSaved*psv[i]+V.ownGoal*og[i]+(red[i]?V.red:0);
      if(p.role==='P')v+=V.gkConceded*ga+(ga?0:V.gkClean);
      if(p.role==='D')v+=V.defConceded*ga+(ga?0:V.defClean);
      v=clamp(Math.round(v*2)/2,V.min,V.max);
      if(red[i]&&!starter[i]&&mins[i]<M.subRatedMin&&!(g[i]||a[i]||ps[i]||pm[i]||psv[i]||og[i])&&RU.noVoteRed!==null){ratedW[i][w]++;pointsW[i][w]+=RU.noVoteRed;continue}
      let fm=v+g[i]*RU.goal[p.role]+ps[i]*RU.penaltyScored+pm[i]*RU.penaltyMissed+psv[i]*RU.penaltySaved+og[i]*RU.ownGoal
        +a[i]*RU.assist+yel[i]*RU.yellow+red[i]*RU.red+(ga?0:RU.cleanSheet[p.role]);
      if(p.role==='P'){fm+=ga*RU.conceded;if(gkVote===null)gkVote=v}
      if(p.role==='D')defVotes.push(v);
      votes[i]+=v;ratedW[i][w]++;pointsW[i][w]+=fm}
    return defenceModifier(gkVote,defVotes,RU)}

  for(let w=0;w<N;w++){
    teams.forEach((t,k)=>{att[k]=t.att*Math.exp(normal(r)*M.teamSd);def[k]=t.def*Math.exp(normal(r)*M.teamSd)});
    players.forEach((p,i)=>{q[i]=Math.exp(normal(r)*M.playerSd);injured[i]=p.injuredFor||0;yellows[i]=p.yellows||0;banned[i]=0});
    for(let round of rounds)for(let [h,aw] of round){
      let ph=lineup(h),pa=lineup(aw);
      let oh=poisson(M.baseGoals*att[h]*def[aw]*M.home,r),oa=poisson(M.baseGoals*att[aw]*def[h]/M.home,r);
      credit(ph,pa,oh);credit(pa,ph,oa);
      let gh=oh+penalties(ph,pa),ga=oa+penalties(pa,ph);
      teamGoals[h]+=gh;teamGoals[aw]+=ga;teamConceded[h]+=ga;teamConceded[aw]+=gh;
      teamMod[h]+=rate(ph,gh,ga,w,h);teamMod[aw]+=rate(pa,ga,gh,w,aw)}}

  let mean=x=>x.reduce((s,v)=>s+v,0)/x.length;
  let out=players.map((p,i)=>{
    let rated=mean(ratedW[i]),pts=mean(pointsW[i]),perWorld=[];
    for(let w=0;w<N;w++)if(ratedW[i][w])perWorld.push(pointsW[i][w]/ratedW[i][w]);
    return{id:p.id,name:p.name,team:teams[p.team].name,role:p.role,
      fixtures:rounds.map((round,k)=>{let [h,aw]=round.find(m=>m.includes(p.team)),opp=h===p.team?aw:h;return{round:first+k,home:h===p.team,opponent:teams[opp].name,attack:teams[opp].att,def:teams[opp].def}}),
      xfm:rated?pts/rated:0,xfmLow:quantile(perWorld,.1),xfmHigh:quantile(perWorld,.9),
      rated,glo:quantile(ratedW[i],.1),ghi:quantile(ratedW[i],.9),expected:pts,
      vote:votes[i]/(rated*N||1),goals:goals[i]/N,assists:assists[i]/N,
      penScored:penScored[i]/N,penMissed:penMissed[i]/N,penSaved:penSaved[i]/N,ownGoals:ownGoals[i]/N,
      integrita:fit[i]/(N*R),titolarita:avail[i]?starts[i]/avail[i]:0}});
  return{players:out,teams:teams.map((t,k)=>({name:t.name,att:t.att,def:t.def,goals:teamGoals[k]/N,conceded:teamConceded[k]/N,
    defenceModifier:teamMod[k]/(N*R)})),rules:RU,model:M};
}

// Auction ledger bookkeeping (not part of the simulation).
function squad(c,ledger,players){let mine=ledger.filter(e=>e.owner==='me'),spent=mine.reduce((s,e)=>s+e.price,0),slots=Object.fromEntries(ROLES.map(r=>[r,c[r]]));mine.forEach(e=>{let p=players.find(p=>p.id===e.pid);if(p)slots[p.role]--});let empty=Object.values(slots).reduce((a,b)=>a+b,0);return{mine,spent,left:c.budget-spent,slots,legal:Math.max(0,c.budget-spent-c.min*Math.max(0,empty-1))}}
function purchase(c,ledger,ps,pid,price,owner){let p=ps.find(p=>p.id===pid);if(!p)throw Error('Unknown player');if(ledger.some(e=>e.pid===pid))throw Error('Already purchased');if(!Number.isInteger(price)||price<c.min)throw Error('Invalid price');if(owner==='me'){let s=squad(c,ledger,ps);if(s.slots[p.role]<1||price>s.legal)throw Error('Role full or illegal budget')}return [...ledger,{pid,price,owner,at:new Date().toISOString()}]}

if(typeof module!=="undefined")module.exports={MODEL,RULES,merge,leagueRules,defenceModifier,simulate,demoLeague,calendar,validate,squad,purchase};

// FantaBall xFM engine — the single source of the simulation, used by the web app (index.html),
// the Expo WebView bundle (built by mobile/scripts/build-webview.js) and the Node tests.
//
// The simulation is team-based: every world plays the remaining calendar match by match.
// For each match it picks both lineups, draws the score from team attack/defence strengths,
// hands the goals and assists to the players on the pitch, and derives every player's vote
// from the match outcome. Teammates therefore share results, clean sheets and goal supply.
// It forecasts xFM and rated appearances only; prices are deliberately not part of it.

const ROLES=['P','D','C','A'];

// Model constants. Every value here is an assumption until fitted on real data.
const MODEL={
  seed:82,                 // simulation RNG seed (league generation uses its own seed)
  formation:{P:1,D:4,C:3,A:3},
  baseGoals:1.35,          // league-average goals per team per match
  home:1.12,               // home multiplier on goals scored (away team divided by it)
  teamSd:.08,              // per-world uncertainty in team attack/defence (log scale)
  playerSd:.15,            // per-world uncertainty in player scoring/assist rates (log scale)
  ownGoal:.03,             // share of goals not credited to any player
  assisted:.7,             // share of credited goals that carry an assist
  subs:[3,5],              // substitutions per team per match (min, max)
  subMinutes:[10,45],      // minutes played by a substitute (min, max)
  subRatedMin:25,          // a substitute below this gets no vote unless scoring/assisting/sent off
  red:.008,                // straight red card probability per 90 minutes
  yellowBanEvery:5,        // one-match ban every N yellow cards
  // Vote = base + result + goal difference + team performance + individual noise + events
  vote:{win:.3,draw:0,loss:-.3,goalDiff:.1,teamSd:.25,indivSd:.4,goal:.5,assist:.25,red:-1,
        gkConceded:-.25,gkClean:.3,defConceded:-.1,defClean:.2,min:3,max:10}
};

function rng(seed){let x=seed>>>0;return()=>{x=(1664525*x+1013904223)>>>0;return(x+.5)/4294967296}}
function normal(r){return Math.sqrt(-2*Math.log(r()))*Math.cos(2*Math.PI*r())}
function poisson(l,r){let p=1,k=0;do{k++;p*=r()}while(p>Math.exp(-Math.max(0,l))&&k<80);return k-1}
function quantile(a,q){let s=Float64Array.from(a).sort();return s.length?s[Math.floor((s.length-1)*q)]:0}
function clamp(x,lo,hi){return Math.min(hi,Math.max(lo,x))}

function validate(c){for(let k of ['teams','budget','min','rounds','P','D','C','A'])if(!Number.isInteger(c[k])||c[k]<1)throw Error('Positive whole numbers required: '+k);if(c.budget<c.min*(c.P+c.D+c.C+c.A))throw Error('Budget cannot fill squad');for(let k of ['goal','assist','yellow','red','conceded','clean'])if(!Number.isFinite(c[k])||c[k]<0)throw Error('Invalid scoring value: '+k);if(!c.competition||!c.season)throw Error('Competition and season required');return c}

// Double round robin (circle method): returns rounds of [homeTeamIndex, awayTeamIndex].
function calendar(nTeams,r=rng(11)){let order=Array.from({length:nTeams},(_,i)=>i);for(let i=order.length-1;i>0;i--){let j=Math.floor(r()*(i+1));[order[i],order[j]]=[order[j],order[i]]}let first=[];for(let k=0;k<nTeams-1;k++){let round=[];for(let m=0;m<nTeams/2;m++){let a=order[m],b=order[nTeams-1-m];round.push((k+m)%2?[a,b]:[b,a])}first.push(round);order.splice(1,0,order.pop())}return first.concat(first.map(round=>round.map(([h,a])=>[a,h])))}

// Synthetic league in the same shape real data must take:
//  teams[]:   {name, att, def}  (att/def are goal multipliers; def < 1 is a good defence)
//  players[]: {id, name, team (index), role, start (lineup weight), base (vote when rated),
//              goalW, assistW (shares of team goals/assists per 90), yellow (per 90),
//              injuryRisk (per match), injuryGames (mean length), injuredFor, yellows}
//  fixtures:  rounds of [home, away] team indices
function demoLeague(nTeams=20,r=rng(7)){let squadSize={P:2,D:6,C:6,A:4},goalW={P:0,D:.1,C:.35,A:1},assistW={P:.02,D:.3,C:.8,A:.6},yellow={P:.03,D:.2,C:.18,A:.1};let teams=Array.from({length:nTeams},(_,t)=>({name:'Demo club '+String(t+1).padStart(2,'0'),att:Math.exp(normal(r)*.2),def:Math.exp(normal(r)*.2)}));let players=[];teams.forEach((team,t)=>ROLES.forEach(role=>{for(let j=0;j<squadSize[role];j++){let starter=j<MODEL.formation[role];players.push({id:`T${t+1}${role}${j+1}`,name:`Demo ${role} ${String(t+1).padStart(2,'0')}-${j+1}`,team:t,role,start:starter?.8+.15*r():.15+.3*r(),base:5.9+.4*r()+(starter?.1:0),goalW:goalW[role]*(.5+r()),assistW:assistW[role]*(.5+r()),yellow:yellow[role]*(.6+.8*r()),injuryRisk:.015+.04*r(),injuryGames:1+3*r(),injuredFor:r()<.06?1+Math.floor(r()*5):0,yellows:0})}}));return{teams,players,fixtures:calendar(nTeams)}}

// Weighted draw of k distinct indices from list.
function pick(list,k,weight,r){if(k===1){let total=0;for(let i of list)total+=weight(i);let x=r()*total;for(let i of list){x-=weight(i);if(x<=0)return [i]}return list.length?[list[list.length-1]]:[]}let pool=list.slice(),out=[];while(out.length<k&&pool.length){let total=0;for(let i of pool)total+=weight(i);let x=r()*total,j=0;for(;j<pool.length-1;j++){x-=weight(pool[j]);if(x<=0)break}out.push(pool.splice(j,1)[0])}return out}

function simulate(c,N=1000,league=demoLeague()){
  validate(c);
  let {teams,players}=league,rounds=league.fixtures||calendar(teams.length);
  if(c.rounds>rounds.length)throw Error(`Maximum ${rounds.length} fixtures in this calendar`);
  let first=rounds.length-c.rounds+1;rounds=rounds.slice(first-1); // remaining fixtures
  let r=rng(MODEL.seed),V=MODEL.vote,P=players.length,R=rounds.length;
  let roster=teams.map(()=>[]);players.forEach((p,i)=>roster[p.team].push(i));
  // Accumulators: per player per world, and per player totals
  let ratedW=players.map(()=>new Float64Array(N)),pointsW=players.map(()=>new Float64Array(N));
  let fit=new Float64Array(P),avail=new Float64Array(P),starts=new Float64Array(P),votes=new Float64Array(P),goals=new Float64Array(P),assists=new Float64Array(P);
  let teamGoals=new Float64Array(teams.length),teamConceded=new Float64Array(teams.length);
  // Per-world state
  let injured=new Int16Array(P),banned=new Int8Array(P),yellows=new Int16Array(P),q=new Float64Array(P),att=new Float64Array(teams.length),def=new Float64Array(teams.length);
  let mins=new Float64Array(P),g=new Int16Array(P),a=new Int16Array(P),yel=new Int8Array(P),red=new Int8Array(P),starter=new Int8Array(P);

  // Availability and lineup for one team; returns indices who played (mins[] filled).
  function lineup(t){
    let ready=[];
    for(let i of roster[t]){let p=players[i];mins[i]=0;g[i]=a[i]=yel[i]=red[i]=starter[i]=0;
      if(injured[i]>0){injured[i]--;continue}
      if(r()<p.injuryRisk){injured[i]=poisson(p.injuryGames-1,r);continue}
      fit[i]++;if(banned[i]>0){banned[i]--;continue}
      avail[i]++;ready.push(i)}
    let byRole={P:[],D:[],C:[],A:[]};for(let i of ready)byRole[players[i].role].push(i);
    let xi=[];for(let role of ROLES)for(let i of pick(byRole[role],MODEL.formation[role],i=>players[i].start,r)){xi.push(i);starter[i]=1}
    if(xi.length<11)for(let i of pick(ready.filter(i=>!starter[i]&&players[i].role!=='P'),11-xi.length,i=>players[i].start,r)){xi.push(i);starter[i]=1}
    xi.forEach(i=>{mins[i]=90;starts[i]++});
    let bench=ready.filter(i=>!starter[i]&&players[i].role!=='P'),out=xi.filter(i=>players[i].role!=='P'),played=xi.slice();
    let nSubs=Math.min(bench.length,MODEL.subs[0]+Math.floor(r()*(MODEL.subs[1]-MODEL.subs[0]+1)));
    for(let s=0;s<nSubs;s++){
      let off=out.splice(Math.floor(r()*out.length),1)[0];
      let same=bench.filter(i=>players[i].role===players[off].role),on=pick(same.length?same:bench,1,i=>players[i].start,r)[0];
      bench.splice(bench.indexOf(on),1);
      let m=MODEL.subMinutes[0]+Math.floor(r()*(MODEL.subMinutes[1]-MODEL.subMinutes[0]+1));
      mins[on]=m;mins[off]=90-m;played.push(on)}
    return played}

  // Hand a team's goals to the players on the pitch, weighted by role share, form and minutes.
  function credit(played,n){
    for(let k=0;k<n;k++){
      if(r()<MODEL.ownGoal)continue;
      let scorer=pick(played,1,i=>players[i].goalW*q[i]*mins[i]+1e-9,r)[0];g[scorer]++;
      if(r()<MODEL.assisted){let mates=played.filter(i=>i!==scorer);if(mates.length)a[pick(mates,1,i=>players[i].assistW*q[i]*mins[i]+1e-9,r)[0]]++}}}

  function rate(played,gf,ga,w){
    let res=gf>ga?V.win:gf<ga?V.loss:V.draw,gd=clamp(gf-ga,-3,3),perf=normal(r)*V.teamSd;
    for(let i of played){let p=players[i];
      if(r()<p.yellow*mins[i]/90){yel[i]=1;yellows[i]++;if(yellows[i]%MODEL.yellowBanEvery===0)banned[i]=1}
      if(r()<MODEL.red*mins[i]/90){red[i]=1;banned[i]=1}
      goals[i]+=g[i];assists[i]+=a[i];
      if(!starter[i]&&mins[i]<MODEL.subRatedMin&&!g[i]&&!a[i]&&!red[i])continue; // senza voto
      let v=p.base+res+V.goalDiff*gd+perf+normal(r)*V.indivSd+V.goal*g[i]+V.assist*a[i]+(red[i]?V.red:0);
      if(p.role==='P')v+=V.gkConceded*ga+(ga?0:V.gkClean);
      if(p.role==='D')v+=V.defConceded*ga+(ga?0:V.defClean);
      v=clamp(Math.round(v*2)/2,V.min,V.max);
      let fm=v+g[i]*c.goal+a[i]*c.assist-yel[i]*c.yellow-red[i]*c.red;
      if(p.role==='P')fm+=-ga*c.conceded+(ga?0:c.clean);
      votes[i]+=v;ratedW[i][w]++;pointsW[i][w]+=fm}}

  for(let w=0;w<N;w++){
    teams.forEach((t,k)=>{att[k]=t.att*Math.exp(normal(r)*MODEL.teamSd);def[k]=t.def*Math.exp(normal(r)*MODEL.teamSd)});
    players.forEach((p,i)=>{q[i]=Math.exp(normal(r)*MODEL.playerSd);injured[i]=p.injuredFor||0;yellows[i]=p.yellows||0;banned[i]=0});
    for(let round of rounds)for(let [h,aw] of round){
      let ph=lineup(h),pa=lineup(aw);
      let gh=poisson(MODEL.baseGoals*att[h]*def[aw]*MODEL.home,r),ga=poisson(MODEL.baseGoals*att[aw]*def[h]/MODEL.home,r);
      teamGoals[h]+=gh;teamGoals[aw]+=ga;teamConceded[h]+=ga;teamConceded[aw]+=gh;
      credit(ph,gh);credit(pa,ga);rate(ph,gh,ga,w);rate(pa,ga,gh,w)}}

  let mean=x=>x.reduce((s,v)=>s+v,0)/x.length;
  let out=players.map((p,i)=>{
    let rated=mean(ratedW[i]),pts=mean(pointsW[i]),perWorld=[];
    for(let w=0;w<N;w++)if(ratedW[i][w])perWorld.push(pointsW[i][w]/ratedW[i][w]);
    return{id:p.id,name:p.name,team:teams[p.team].name,role:p.role,
      fixtures:rounds.map((round,k)=>{let [h,aw]=round.find(m=>m.includes(p.team)),opp=h===p.team?aw:h;return{round:first+k,home:h===p.team,opponent:teams[opp].name,attack:teams[opp].att,def:teams[opp].def}}),
      xfm:rated?pts/rated:0,xfmLow:quantile(perWorld,.1),xfmHigh:quantile(perWorld,.9),
      rated,glo:quantile(ratedW[i],.1),ghi:quantile(ratedW[i],.9),expected:pts,
      vote:votes[i]/(rated*N||1),goals:goals[i]/N,assists:assists[i]/N,
      integrita:fit[i]/(N*R),titolarita:avail[i]?starts[i]/avail[i]:0}});
  return{players:out,teams:teams.map((t,k)=>({name:t.name,att:t.att,def:t.def,goals:teamGoals[k]/N,conceded:teamConceded[k]/N}))};
}

// Auction ledger bookkeeping (not part of the simulation).
function squad(c,ledger,players){let mine=ledger.filter(e=>e.owner==='me'),spent=mine.reduce((s,e)=>s+e.price,0),slots=Object.fromEntries(ROLES.map(r=>[r,c[r]]));mine.forEach(e=>{let p=players.find(p=>p.id===e.pid);if(p)slots[p.role]--});let empty=Object.values(slots).reduce((a,b)=>a+b,0);return{mine,spent,left:c.budget-spent,slots,legal:Math.max(0,c.budget-spent-c.min*Math.max(0,empty-1))}}
function purchase(c,ledger,ps,pid,price,owner){let p=ps.find(p=>p.id===pid);if(!p)throw Error('Unknown player');if(ledger.some(e=>e.pid===pid))throw Error('Already purchased');if(!Number.isInteger(price)||price<c.min)throw Error('Invalid price');if(owner==='me'){let s=squad(c,ledger,ps);if(s.slots[p.role]<1||price>s.legal)throw Error('Role full or illegal budget')}return [...ledger,{pid,price,owner,at:new Date().toISOString()}]}

if(typeof module!=="undefined")module.exports={MODEL,simulate,demoLeague,calendar,validate,squad,purchase};

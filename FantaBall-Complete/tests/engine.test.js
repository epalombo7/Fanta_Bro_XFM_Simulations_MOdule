const assert=require('assert'),E=require('../mobile/assets/engine');
const c={competition:'Demo',season:'Demo',teams:12,budget:500,min:1,rounds:38,P:3,D:8,C:8,A:6};
const {players:ps,teams}=E.simulate(c,200);
assert.equal(ps.length,360);
ps.forEach(p=>{assert(p.rated>=0&&p.rated<=c.rounds);assert(p.glo<=p.ghi);assert(Number.isFinite(p.xfm));assert(p.integrita>=0&&p.integrita<=1);['prices','target','low','median','high'].forEach(k=>assert(!(k in p),'simulation must not price players: '+k))});
// Deterministic for a fixed seed
assert.equal(ps[3].xfm,E.simulate(c,200).players[3].xfm);
// Team-based: a team's goals are its players' goals (incl. penalties) plus the opponents' own goals
const sum=(xs,k)=>xs.reduce((s,p)=>s+p[k],0),scored=t=>sum(ps.filter(p=>p.team===t.name),'goals');
assert(Math.abs(sum(ps,'goals')+sum(ps,'ownGoals')-sum(teams,'goals'))<1e-6);
teams.forEach(t=>assert(Math.abs(scored(t)-t.goals*(1-E.MODEL.ownGoal))<t.goals*.1,t.name));
// Penalties: about MODEL.penaltyRate per team per match, saves never exceed misses
const matches=teams.length*c.rounds/2,pens=sum(ps,'penScored')+sum(ps,'penMissed');
assert(Math.abs(pens/(2*matches)-E.MODEL.penaltyRate)<.03);assert(sum(ps,'penSaved')<=sum(ps,'penMissed'));
// League rules drive the fantavoto: a bigger attacker goal bonus raises attackers' xFM only
const alt=E.simulate({...c,rules:{goal:{A:4.5}}},200).players;
ps.forEach((p,i)=>{if(p.role==='A'&&p.goals>1)assert(alt[i].xfm>p.xfm);if(p.role==='P')assert.equal(alt[i].xfm,p.xfm)});
assert.throws(()=>E.simulate({...c,rules:{yellow:'x'}},10),/yellow/);
assert.throws(()=>E.simulate({...c,rules:{voteProvider:'other'}},10));
// Defence modifier bands
assert.equal(E.defenceModifier(7,[7,7,7,6]),6);assert.equal(E.defenceModifier(6,[6,6,6,6]),1);assert.equal(E.defenceModifier(5.5,[6,6,6,6]),0);
assert.equal(E.defenceModifier(7,[7,7,7]),0);assert.equal(E.defenceModifier(7,[7,7,7,7],E.merge(E.RULES,{defenceModifier:{enabled:false}})),0);
// Model settings can be overridden per run (e.g. calibrated values)
const strong=E.simulate(c,{N:100,model:{baseGoals:1.6}});assert(sum(strong.teams,'goals')>sum(teams,'goals')*1.15);
// Ratings follow match outcomes: first-choice keepers of the best defences outscore those of the worst
const gk=teams.map(t=>[t.conceded,ps.filter(p=>p.team===t.name&&p.role==='P').sort((a,b)=>b.rated-a.rated)[0].xfm]).sort((a,b)=>a[0]-b[0]);
const avg=a=>a.reduce((s,x)=>s+x[1],0)/a.length;assert(avg(gk.slice(0,5))>avg(gk.slice(-5)));
// Each team plays every remaining round once
assert(ps.every(p=>p.fixtures.length===c.rounds));
assert.throws(()=>E.simulate({...c,rounds:39},10));
// Two modules: the season record is rules-independent; scoring it equals simulate(); the file round-trips
const S=E.runSeason(c,{N:200});
assert.equal(JSON.stringify(E.scoreSeason(S,c).players),JSON.stringify(ps));
const S2=E.deserializeSeason(E.serializeSeason(S));
assert.equal(JSON.stringify(E.scoreSeason(S2,c).players),JSON.stringify(ps));
assert.deepEqual(E.scoreSeason(S,{...c,rules:{goal:{A:4.5}}}).players.map(p=>p.rated),ps.map(p=>p.rated)); // rules move xFM, not games
const booked=E.scoreSeason(S,{...c,rules:{noVoteYellow:5.5}}).players;
assert(sum(booked,'rated')>=sum(ps,'rated'));
assert.throws(()=>E.deserializeSeason(new Uint8Array([1,2,3,4,0,0,0,0])),/season file/);
// Correlations: keeper and defenders of one club move together; a keeper hedges the striker he faces
const tm=S.players.findIndex(p=>p.role==='P'),club=S.players[tm].team;
const keeper=S.players[tm].id,defs=S.players.filter(p=>p.team===club&&p.role==='D').slice(0,2).map(p=>p.id);
const opp=S.rounds.flat().find(([h,a])=>h===club||a===club),oppClub=opp[0]===club?opp[1]:opp[0];
const st=S.players.filter(p=>p.team===oppClub&&p.role==='A')[0].id;
const Cm=E.correlations(S,c,{ids:[keeper,...defs,st]}),Ch=E.correlations(S,c,{ids:[keeper,...defs,st],level:'head_to_head'});
assert(Cm.matrix[1]>0.2&&Cm.matrix[2]>0.2,'keeper and own defenders correlate');
assert(Ch.matrix[3]<-0.2,'keeper hedges the opposing striker head-to-head');
assert(E.correlationRow(S,c,keeper).length>0);
assert.equal(E.deserializeSeason(E.serializeSeason(S)).detail.length,S.detail.length);
// Matchday scoring: expected contributions add up to the season expectation under any rules; intervals are ordered
for(const rules of [{},{goal:{A:4.5},voteProvider:'italia',noVoteYellow:5.5}]){
  const cc={...c,rules},season=E.scoreSeason(S,cc).players,md=E.scoreMatchdays(S,cc);
  md.forEach((p,i)=>{assert(Math.abs(p.matchdays.reduce((t,r)=>t+r.expected,0)-season[i].expected)<1e-6,'matchday sum = season');
    p.matchdays.forEach(r=>{if(r.median!==null)assert(r.low<=r.median&&r.median<=r.high);if(r.medianVote!==null)assert(r.medianVote>=3&&r.medianVote<=10)})})}
assert.equal(E.scoreMatchdays(E.deserializeSeason(E.serializeSeason(S)),c)[5].matchdays[3].xfm,E.scoreMatchdays(S,c)[5].matchdays[3].xfm);
// Outcome counts give exactly the same matchday quantiles as scoring every simulated season match by match
{const Sx=E.runSeason(c,{N:120,detailWorlds:120});
 for(const rules of [{},{goal:{A:4.5},voteProvider:'italia',noVoteYellow:5.5}]){const cc={...c,rules},a=E.scoreMatchdays(Sx,cc),b=E.scoreMatchdays({...Sx,outcomes:null},cc);
   a.forEach((p,i)=>p.matchdays.forEach((r,j)=>{const q=b[i].matchdays[j];assert.deepEqual([r.median,r.low,r.high],[q.median,q.low,q.high])}))}
 const o=E.unpackOutcome(E.packOutcome([7,7.5,6.5],2,1,0,0,0,1,1,0,3));assert.deepEqual([o.vote2,o.goals,o.penScored,o.assists,o.yellow,o.ga],[[14,15,13],2,1,1,1,3]);
 assert.equal(JSON.stringify(E.scoreMatchdays(E.deserializeSeason(E.serializeSeason(Sx)),c)),JSON.stringify(E.scoreMatchdays(Sx,c)))}
// Burn-in: those seasons are simulated but not recorded
assert.equal(E.runSeason(c,{N:30,burnIn:10}).N,30);
// Keeper succession: with the first-choice keeper out, the second keeper starts every match; without the rule
// the starting place would be shared among the backups
{const lg=E.demoLeague(),gks=lg.players.filter(p=>p.team===0&&p.role==='P').sort((x,y)=>y.start-x.start);
 lg.players.push({...gks[1],id:'T1P3',name:'Third keeper',start:gks[1].start*.9,injuredFor:0});   // a close third choice
 gks[0].injuredFor=99;gks[0].injuryRisk=0;gks[1].injuryRisk=0;
 const run=succ=>E.runSeason({rounds:10},{N:200,league:lg,model:{keeperSuccession:succ},outcomes:false}),pct=(S,id)=>{let i=S.players.findIndex(p=>p.id===id),k=S.mdFields.indexOf('starts');let t=0;for(let r=0;r<S.rounds.length;r++)t+=S.md[(i*S.rounds.length+r)*S.mdFields.length+k];return t/(S.N*S.rounds.length)};
 const on=run(true),off=run(false);
 assert(pct(on,gks[1].id)>0.99,'second keeper starts every match');assert(pct(off,gks[1].id)<0.8,'without the rule the backups share')}
// Ledger
let l=E.purchase(c,[],ps,ps[0].id,10,'me');assert.equal(E.squad(c,l,ps).left,490);assert.throws(()=>E.purchase(c,l,ps,ps[0].id,10,'me'));assert.throws(()=>E.purchase(c,l,ps,ps[1].id,999,'me'));assert.throws(()=>E.validate({...c,budget:1}));
console.log('Team-based simulation and ledger tests passed');

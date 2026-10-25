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
// Ledger
let l=E.purchase(c,[],ps,ps[0].id,10,'me');assert.equal(E.squad(c,l,ps).left,490);assert.throws(()=>E.purchase(c,l,ps,ps[0].id,10,'me'));assert.throws(()=>E.purchase(c,l,ps,ps[1].id,999,'me'));assert.throws(()=>E.validate({...c,budget:1}));
console.log('Team-based simulation and ledger tests passed');

const assert=require('assert'),E=require('../mobile/assets/engine');
const c={competition:'Demo',season:'Demo',teams:12,budget:500,min:1,rounds:38,P:3,D:8,C:8,A:6,goal:3,assist:1,yellow:.5,red:1,conceded:1,clean:1};
const {players:ps,teams}=E.simulate(c,200);
assert.equal(ps.length,360);
ps.forEach(p=>{assert(p.rated>=0&&p.rated<=c.rounds);assert(p.glo<=p.ghi);assert(Number.isFinite(p.xfm));assert(p.integrita>=0&&p.integrita<=1);['prices','target','low','median','high'].forEach(k=>assert(!(k in p),'simulation must not price players: '+k))});
// Deterministic for a fixed seed
assert.equal(ps[3].xfm,E.simulate(c,200).players[3].xfm);
// Team-based: credited player goals equal team goals less own goals
const scored=t=>ps.filter(p=>p.team===t.name).reduce((s,p)=>s+p.goals,0);
teams.forEach(t=>assert(Math.abs(scored(t)-t.goals*(1-E.MODEL.ownGoal))<t.goals*.1,t.name));
// Ratings follow match outcomes: first-choice keepers of the best defences outscore those of the worst
const gk=teams.map(t=>[t.conceded,ps.filter(p=>p.team===t.name&&p.role==='P').sort((a,b)=>b.rated-a.rated)[0].xfm]).sort((a,b)=>a[0]-b[0]);
const avg=a=>a.reduce((s,x)=>s+x[1],0)/a.length;assert(avg(gk.slice(0,5))>avg(gk.slice(-5)));
// Each team plays every remaining round once
assert(ps.every(p=>p.fixtures.length===c.rounds));
assert.throws(()=>E.simulate({...c,rounds:39},10));
// Ledger
let l=E.purchase(c,[],ps,ps[0].id,10,'me');assert.equal(E.squad(c,l,ps).left,490);assert.throws(()=>E.purchase(c,l,ps,ps[0].id,10,'me'));assert.throws(()=>E.purchase(c,l,ps,ps[1].id,999,'me'));assert.throws(()=>E.validate({...c,budget:1}));
console.log('Team-based simulation and ledger tests passed');

// Runs the engine on a league JSON from calibrate.py: node simulate.js league.json config.json N out.json
const fs=require('fs'),E=require('../mobile/assets/engine.js');
const [lf,cf,n,of]=process.argv.slice(2),lg=JSON.parse(fs.readFileSync(lf)),c=JSON.parse(fs.readFileSync(cf));
const o=E.simulate(c,{N:+n||500,league:lg,model:lg.model});
fs.writeFileSync(of,JSON.stringify({players:o.players.map(({fixtures,...p})=>p),teams:o.teams,rules:o.rules}));

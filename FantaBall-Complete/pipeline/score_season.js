// Module 2 — xFM under league rules. Reads a season file from run_season.js and applies the rules.
//   node score_season.js season.fbsim.gz config.json out.json
// config.json is a league config ({competition, season, teams, budget, min, rounds, P, D, C, A, rules:{...}});
// any rule left out takes the standard default (RULES in engine.js).
const fs=require('fs'),zlib=require('zlib'),E=require('../mobile/assets/engine.js');
const [sf,cf,of]=process.argv.slice(2),c=JSON.parse(fs.readFileSync(cf));
const S=E.deserializeSeason(zlib.gunzipSync(fs.readFileSync(sf)));
E.validate(c);
const o=E.scoreSeason(S,c);
fs.writeFileSync(of,JSON.stringify({league:S.league,players:o.players.map(({fixtures,...p})=>p),teams:o.teams,rules:o.rules}));

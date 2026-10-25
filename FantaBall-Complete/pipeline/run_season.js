// Module 1 — season simulation. Plays the remaining season N times and saves everything that happened
// (no league rules involved) to a compressed season file for score_season.js.
//   node run_season.js league.json rounds_left N out.fbsim.gz
const fs=require('fs'),zlib=require('zlib'),E=require('../mobile/assets/engine.js');
const [lf,rounds,n,of]=process.argv.slice(2),lg=JSON.parse(fs.readFileSync(lf));
const S=E.runSeason({rounds:+rounds},{N:+n||500,league:lg,model:lg.model});
S.league={season:lg.season,as_of_round:lg.as_of_round};
fs.writeFileSync(of,zlib.gzipSync(E.serializeSeason(S)));
console.log(`season file ${of}: ${S.players.length} players x ${S.N} simulated seasons, ${S.rounds.length} rounds`);

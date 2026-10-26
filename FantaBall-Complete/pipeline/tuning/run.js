// node run.js engine.js files.json N out.json overrides.json
const fs=require('fs'),E=require(process.argv[2]),files=JSON.parse(fs.readFileSync(process.argv[3])),ov=JSON.parse(fs.readFileSync(process.argv[6]||'/dev/null','utf8')||'{}'),out=[];
for(const f of files){const L=JSON.parse(fs.readFileSync(f)),r=L.as_of_round;
  const lg={...L,fixtures:L.fixtures.slice(0,r+1)};
  const S=E.runSeason({rounds:1},{N:+process.argv[4],league:lg,model:E.merge(L.model,ov),detailWorlds:0});
  const c={competition:'bt',season:L.season,teams:10,budget:500,min:1,rounds:1,P:3,D:8,C:8,A:6};
  for(const p of E.scoreMatchdays(S,c)){const m=p.matchdays[0];out.push([L.season,r+1,+p.id,p.role,m.pVote,m.xfm])}}
fs.writeFileSync(process.argv[5],JSON.stringify(out));

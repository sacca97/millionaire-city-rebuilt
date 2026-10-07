const Database=require("/home/sacca/Projects/millionaire-city-rebuilt/node_modules/better-sqlite3");
const d=new Database(process.argv[2]);const r=d.prepare("select json from save_documents where user_id=1 and tag='universe'").get();
if(!r){console.log("no doc");process.exit(1)}
const j=JSON.parse(r.json);const p=j.universe.find(e=>Array.isArray(e.Profile));p.tutorialEnd="1";p.bossGenre="1";
d.prepare("update save_documents set json=? where user_id=1 and tag='universe'").run(JSON.stringify(j));console.log("seeded");

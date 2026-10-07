// node seed-collectibles.cjs <db>: post-tutorial seed + level ~10 + identical collectible state (group 1 complete, 3 and 8 partial)
const Database=require("/home/sacca/Projects/millionaire-city-rebuilt/node_modules/better-sqlite3");
const d=new Database(process.argv[2]);
const get=t=>JSON.parse(d.prepare("select json from save_documents where user_id=1 and tag=?").get(t).json);
const put=(t,j)=>d.prepare("update save_documents set json=? where user_id=1 and tag=?").run(JSON.stringify(j),t);
const u=get("universe");const p=u.universe.find(e=>Array.isArray(e.Profile));p.tutorialEnd="1";p.bossGenre="1";p.exp="6000";put("universe",u);
const c=get("collectiblesList");
c.collectiblesList=[{Objects:[],skus:"gift_001:1,gift_002:2,gift_003:1,gift_004:3,gift_005:2,gift_006:1,gift_029:1,gift_030:4"},{Rewards:[],skus:""},{Pending:[],tupla:""}];
put("collectiblesList",c);console.log("seeded");

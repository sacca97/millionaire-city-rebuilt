// Collectibles at level 9: first album open (New! star + info arrow), help click, claim reward of the completed group.
export const seed = (u, prof) => { prof.exp = "6000"; };
export const seedDocs = (mutateDoc) => mutateDoc("collectiblesList", (c) => { c.collectiblesList = [{ Objects: [], skus: "gift_001:1,gift_002:2,gift_003:1,gift_004:3,gift_005:2,gift_006:1,gift_029:1,gift_030:4" }, { Rewards: [], skus: "" }, { Pending: [], tupla: "" }]; });
export default async function (o) {
  const { sleep, click: c, mv: m, shot, stat, dump, reload } = o;
  await o.boot(); await sleep(3000); stat("start"); await shot("00-start");
  await c(153, 457); await sleep(2000); await shot("01-vault-bar");
  const ax = Number(process.env.AX ?? 0), ay = Number(process.env.AY ?? 0);
  if (!ax) return;
  await c(ax, ay); await sleep(3500); await shot("02-album-first");
  await c(Number(process.env.HX ?? 680), Number(process.env.HY ?? 132)); await sleep(2000); await shot("03-help");
  await c(Number(process.env.HCX ?? 570), Number(process.env.HCY ?? 188)); await sleep(1500); await shot("03b-help-closed");
  await c(Number(process.env.CX ?? 585), Number(process.env.CY ?? 520)); await sleep(3500); await shot("04-claim");
  await sleep(2000); await shot("05-claim2"); stat("claimed"); dump("before-reload");
  await reload(); await shot("06-reloaded"); stat("reloaded"); dump("final");
}

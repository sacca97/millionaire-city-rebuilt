// sign the Family contract on the seeded house, open the vault storage, use a stored 30% rent accelerator on the renting house.
export const seedDocs = (mutateDoc) => mutateDoc("storageList", (d) => { d.storageList.push({ item: [], sku: "rentAcc30", amount: "2" }); });
export default async function (o) {
  const { sleep, click: c, mv: m, shot, stat, dump, reload } = o;
  await o.boot(); await sleep(3000); stat("start");
  await c(506, 364); await sleep(2500); await c(290, 215); await sleep(3500); await shot("00-contract"); stat("contract");
  await c(153, 457); await sleep(2000); await shot("01-vault-bar");
  await c(229, 400); await sleep(2500); await shot("02-storage");
  await c(376, 369); await sleep(2000); await m(506, 360); await sleep(1000); await shot("03-accelerator-cursor");
  await c(506, 360); await sleep(3000); await shot("04-accelerated"); stat("accelerated");
  await sleep(3000); dump("before-reload");
  await reload(); await shot("05-reloaded"); stat("reloaded"); dump("final");
}

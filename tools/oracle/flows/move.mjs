// Move tool via the multifunction bar (briefcase): buy a 2x2 plot, move the seeded house onto it (ItemObject.move, ToolMove).
export default async function (o) {
  const { sleep, click: c, mv: m, shot, stat, dump, reload } = o;
  await o.boot(); await sleep(3000); stat("start"); await shot("00-start");
  await c(563, 459); await sleep(1000);
  for (const [tx, ty] of [[556, 225], [588, 225], [556, 257], [588, 257]]) { await m(tx, ty); await sleep(300); await c(tx, ty); await sleep(1200); }
  stat("terrain");
  await c(55, 452); await sleep(1500); await shot("01-multibar");
  await c(65, 398); await sleep(1500); await shot("02-move-tool");
  await m(506, 364); await sleep(1200); await shot("03-hover-house");
  await c(506, 364); await sleep(1500); await shot("04-picked");
  await m(572, 241); await sleep(1200); await shot("05-ghost");
  await c(572, 241); await sleep(3000); await shot("06-dropped");
  await c(340, 373); await sleep(3000); await shot("06b-confirmed"); stat("moved");
  await sleep(3000); dump("before-reload");
  await reload(); await shot("07-reloaded"); stat("reloaded"); dump("final");
}

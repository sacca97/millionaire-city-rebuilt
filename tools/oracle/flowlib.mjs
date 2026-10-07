// Shared by oracle (scenarios/flow.mjs) and ours (ours-flow.mjs): common seed + state summary.
export const seedFlow = (mutateDoc, { daily = false, extra, docs } = {}) => {
  docs?.(mutateDoc);
  mutateDoc("universe", (u) => {
    const prof = u.universe.find((e) => Array.isArray(e.Profile));
    prof.tutorialEnd = "1"; prof.bossGenre = "1";
    // no daily reward due (the reward roll is random server-side); flows that test it pass daily:true
    extra?.(u, prof);
  });
  if (!daily) mutateDoc("dailyBonusInfo", (d) => { d.dailyRewardsLastGivenDate = String(Date.now()); });
};
export const statOf = (getDoc, label) => {
  const u = getDoc("universe").universe; const P = u.find((e) => e.Profile); const W = u.find((e) => e.World).World; const mine = W.find((c) => c.whose === "0");
  console.log(label, JSON.stringify({ coins: P.DCCoins, cv: P.companyValue, exp: P.exp, cash: P.DCCash, n: mine.Company.length, items: mine.Company.filter((i) => !i.sku.startsWith("decorations_tree")).map((i) => [i.sku, i.x, i.y, JSON.stringify(i.Item)]).slice(-3) }));
};

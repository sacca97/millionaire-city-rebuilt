import run, { seed as seedExpansionFlow } from "./missions-instant-expansion.mjs";

// Also seed mission 4 (buyExpansion) as available so the real expansion purchase drives it.
export const seed = (universe, prof) => {
  seedExpansionFlow(universe, prof);
  const missions = prof.Profile.find((entry) => Array.isArray(entry.Missions));
  missions.Missions = [{ Up: [], chunk: "4" }, { Reached: [], chunk: "" }, { Given: [], chunk: "" }];
};

export default run;

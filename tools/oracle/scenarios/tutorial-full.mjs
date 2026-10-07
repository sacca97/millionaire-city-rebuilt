// Original client: full first-session tutorial on a fresh save. Stage origin (252,203). Outputs or_<step>.png + <step>.saves.json.
import { sleep } from "../lib.mjs";
import fs from "node:fs";
import path from "node:path";
const X = 252, Y = 203;
export default { async run(o) {
  const c = async (x, y) => { await o.move(x + X, y + Y); await sleep(300); await o.click(x + X, y + Y); };
  const m = (x, y) => o.move(x + X, y + Y);
  const shot = async (k) => { const f = await o.shot(k); try { (await import("node:child_process")).execFileSync("python3", ["-c", `from PIL import Image;Image.open(${JSON.stringify(f)}).crop((${X},${Y},${X + 760},${Y + 600})).save(${JSON.stringify(path.join(o.outDir, "or_" + k + ".png"))})`]); } catch {} };
  const dump = async (k) => { await sleep(3500); o.dump(k); };
  await o.waitLog(/load_success/, 150000); await sleep(15000);
  await shot("a_advisor"); await c(285, 307); await sleep(1500); await shot("b_boss_anim"); await sleep(8000); await shot("c_step0");
  await dump("0_welcome"); await c(209, 376); await sleep(4000); await shot("d_step1"); await m(440, 200); await sleep(500); await m(445, 195); await sleep(800); await shot("e_hq_ghost");
  await c(445, 195); await sleep(4000); await shot("f_hq_placed"); await dump("1_hq");
  await c(209, 376); await sleep(4000); await shot("g_step2"); await c(562, 458); await sleep(1500); await m(588, 318); await sleep(800); await shot("h_terrain_tool");
  await c(588, 318); await sleep(2000); await c(588, 350); await sleep(2500); await shot("i_plots"); await dump("2_plots");
  await c(209, 376); await sleep(4000); await shot("j_step3"); await c(618, 458); await sleep(3000); await shot("k_shop");
  await c(255, 355); await sleep(3000); await m(560, 330); await sleep(800); await m(570, 335); await sleep(800); await shot("l_house_ghost");
  await c(570, 335); await sleep(4000); await shot("m_house_placed"); await dump("3_house");
  await c(209, 376); await sleep(4000); await shot("n_step4"); await c(675, 458); await sleep(1500); await m(520, 380); await sleep(800); await shot("o_road_tool");
  await c(525, 380); await sleep(2500); await shot("p_road1"); await c(557, 380); await sleep(3000); await shot("q_roads"); await dump("4_road");
  await c(209, 376); await sleep(4000); await shot("r_step5"); await c(572, 335); await sleep(3000); await shot("s_instant_popup");
  await c(377, 360); await sleep(4000); await shot("t_built"); await dump("5_instant");
  await c(209, 376); await sleep(4000); await shot("u_step6"); await c(572, 335); await sleep(3000); await shot("v_contract_box");
  await c(257, 230); await sleep(3500); await shot("w_contract_signed"); await dump("6_contract");
  await c(209, 376); await sleep(4000); await shot("x_step7"); await c(618, 458); await sleep(3000); await shot("y_shop7");
  await c(528, 163); await sleep(2500); await shot("z_shop_deco"); await c(255, 355); await sleep(3000); await m(520, 300); await sleep(800); await m(525, 305); await sleep(800); await shot("aa_deco_ghost");
  await m(555, 285); await sleep(800); await shot("ab_deco_ghost2"); await c(556, 286); await sleep(4000); await shot("ac_deco_placed"); await dump("7_deco");
  await c(209, 376); await sleep(4000); await shot("ad_step8"); await c(572, 335); await sleep(3000); await shot("ae_collected"); await sleep(2000); await shot("af_collected2"); await dump("8_collect");
  await c(209, 376); await sleep(4000); await shot("ag_final"); await dump("9_final");
  await c(209, 378); await sleep(3000); await shot("ai_after_final"); await sleep(5000); await shot("aj_invite");
  await c(568, 166); await sleep(4000); await shot("ak_end"); await dump("10_end");
  // reload: second session sees the completed save
  try { await o.eval("setTimeout(()=>location.reload(),50);1"); } catch {} await sleep(60000); await shot("al_reloaded"); await dump("11_reloaded");
}};

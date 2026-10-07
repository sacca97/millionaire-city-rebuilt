// Reward drawing (RewardCoins/RewardExp/RewardItem.draw + RewardComposite.draw) and fit-into-container helper
// (PopupMission.showPopupParams / PopupReward.showPopup: scale = min(cw/w, ch/h, 1), centred in the `container` placeholder).
import { localBounds, Widget, type Part } from "../../gui/widget";
import type { MissionReward } from "../../game/missions";
import { setItemIcon } from "../shop/icons";
import { REWARD_ART_URL, SKU, rewardLabel } from "./logic";

export interface Drawn {
  el: HTMLElement;
  w: number;
  h: number;
}

/** RewardSingle.draw: container_reward with the coin/xp bitmap (or blue stars + item icon) and the text. */
export async function drawReward(r: MissionReward): Promise<Drawn> {
  const w = await Widget.create(SKU, "container_reward");
  const art = w.part("mission_reward");
  if (r.kind === "item") {
    // RewardItem.draw: blue_stars bitmap behind the item icon; "x N" only when amount > 1 (text_reward), text_reward_2 removed.
    w.hide("text_reward_2");
    putArt(art, `${REWARD_ART_URL}blue_stars.png`);
    await setItemIcon(art, r.sku).catch(() => false);
    if (r.amount > 1) w.setText("text_reward", `x ${r.amount}`);
    else w.hide("text_reward");
  } else {
    // RewardCoins/RewardExp.draw: text_reward removed, text_reward_2 = label, bitmap popup_reward_<coins|exp>.
    w.hide("text_reward");
    w.setText("text_reward_2", rewardLabel(r));
    putArt(art, `${REWARD_ART_URL}popup_reward_${r.kind}.png`);
  }
  const b = localBounds(w.node, false) ?? [0, 0, 125, 105];
  return { el: w.root, w: b[2] - b[0], h: b[3] - b[1] };
}

/** Adds a bitmap at the origin of `part` (Sprite.addChild(Bitmap) without transform). */
function putArt(part: Part, url: string): HTMLImageElement {
  const img = document.createElement("img");
  img.className = "g-tex";
  img.draggable = false;
  img.src = url;
  img.style.cssText = "left:0;top:0;";
  part.el.appendChild(img);
  return img;
}

/** RewardManager.getReward: one reward, or a RewardComposite laid out 4 per row (RewardComposite.draw). */
export async function drawRewards(rewards: MissionReward[]): Promise<Drawn> {
  if (rewards.length <= 1) return drawReward(rewards[0] ?? { kind: "coins", amount: 0 });
  const holder = document.createElement("div");
  holder.className = "g-n";
  let x = 0;
  let y = 0;
  let maxW = 0;
  let maxH = 0;
  let n = 0;
  for (const r of rewards) {
    const d = await drawReward(r);
    d.el.style.transform = `translate(${x}px,${y}px)`;
    holder.appendChild(d.el);
    n += 1;
    maxW = Math.max(maxW, x + d.w);
    maxH = Math.max(maxH, y + d.h);
    x += d.w;
    if (n % 4 === 0) {
      x = 0;
      y += d.h;
    }
  }
  return { el: holder, w: maxW, h: maxH };
}

/**
 * Draws the rewards into the `container` placeholder of `host` (hidden), scaled down to fit and centred
 * (PopupMission.showPopupParams :~60-80).
 */
export async function fillRewardContainer(host: Widget, rewards: MissionReward[], containerName = "container"): Promise<void> {
  const ph = host.part(containerName);
  const pb = localBounds(ph.node, true) ?? [0, 0, 268, 99];
  const cw = pb[2] - pb[0];
  const ch = pb[3] - pb[1];
  const d = await drawRewards(rewards);
  const scale = Math.min(1, cw / d.w, ch / d.h);
  const x = ph.x + pb[0] + (cw - d.w * scale) / 2;
  const y = ph.y + pb[1] + (ch - d.h * scale) / 2;
  ph.hide();
  d.el.style.transformOrigin = "0 0";
  d.el.style.transform = `translate(${x}px,${y}px) scale(${scale})`;
  host.root.appendChild(d.el);
}

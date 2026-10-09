/**
 * Friends bar skeleton, port of friends/FriendsBar.as on hud.swf `friends_bar` + `hud_friend_box*`.
 * Shows "yourself" + neighbors ranked by company value (position_1..3 badges, level, company value, name) and the
 * "Add neighbors" slot. Offline: neighbors = get_neighbor_list entries + the NPCs of NPCDefinitions.xml
 * (FriendsManager.npcsLoad: advisors only for the player's boss genre). Clicking a box emits uiBus 'visit'.
 */
import { convertNumberRanking } from "../../gui/format";
import { getText } from "../../gui/i18n";
import { Button } from "../../gui/button";
import { Widget, type Part } from "../../gui/widget";
import { levelOf, RULES_ROOT } from "../../game/rules";
import { uiBus } from "../bus";
import type { UiContext } from "../context";
import { hitArea } from "./util";
import { probe } from "../shop/measure";

export interface Neighbor {
  userId: string;
  name: string;
  exp: number;
  companyValue: number;
  photo?: string;
  self?: boolean;
  npc?: boolean;
}

/** NPCDefinitions.xml names that are advisors (Ronald = boss genre 0, Cindy = genre 1; RulesFacade.npcsIsMyAdvisor). */
const ADVISORS = ["Ronald", "Cindy"];
const NPC_USER_ID: Record<string, string> = { Ronald: "100", Cindy: "100", Sheik: "101" };
const NPC_PHOTO = "/mcity/0.501/Datas/Assets/npcs/";
const BOX_W = 74;
const FRIENDS_PER_PAGE = 8; // FriendsBar.as:25
const VISIBLE_W = 619;

/** Pure: rank by company value (desc); the position badge of each neighbor. */
export function rankNeighbors(list: Neighbor[]): Neighbor[] {
  return [...list].sort((a, b) => b.companyValue - a.companyValue);
}

export function parseNpcs(xml: string, bossGenre: number): Neighbor[] {
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  const out: Neighbor[] = [];
  for (const d of Array.from(doc.getElementsByTagName("Definition"))) {
    const name = d.getAttribute("name") ?? "";
    const advisorIdx = ADVISORS.indexOf(name);
    if (advisorIdx >= 0 && advisorIdx !== bossGenre) continue;
    out.push({
      userId: NPC_USER_ID[name] ?? name,
      name,
      exp: Number(d.getAttribute("xp") ?? 0),
      companyValue: Number(d.getAttribute("companyValue") ?? 0),
      photo: NPC_PHOTO + (d.getAttribute("url") ?? `${name}.png`),
      npc: true,
    });
  }
  return out;
}

export function parseNeighborList(dat: Record<string, unknown> | undefined): Neighbor[] {
  const raw = (dat?.neighborList ?? dat?.neighbor ?? []) as unknown;
  const arr = Array.isArray(raw) ? raw : [];
  return arr.map((n) => {
    const o = n as Record<string, unknown>;
    return {
      userId: String(o.id ?? o.userId ?? ""),
      name: String(o.name ?? o.nameFriend ?? "Neighbor"),
      exp: Number(o.xp ?? o.exp ?? 0),
      companyValue: Number(o.companyValue ?? 0),
      photo: o.url ? String(o.url) : undefined,
    };
  }).filter((n) => n.userId !== "");
}

export class FriendsBar {
  readonly el: HTMLElement;
  private bar!: Widget;
  private strip!: HTMLElement;
  private offset = 0;
  private slots = 0;
  private neighbors: Neighbor[] = [];
  private arrows: { l?: Button; r?: Button } = {};

  private constructor(private readonly ctx: UiContext) {
    this.el = document.createElement("div");
    this.el.className = "mc-friends";
    this.el.style.cssText = "position:absolute;left:0;top:0;pointer-events:none";
  }

  static async create(ctx: UiContext): Promise<FriendsBar> {
    const f = new FriendsBar(ctx);
    await f.build();
    return f;
  }

  private async build(): Promise<void> {
    this.bar = await Widget.create("hud", "friends_bar");
    const w = this.bar;
    this.el.appendChild(w.root);
    w.find("loading")?.hide();
    for (const n of ["mArrowRight03", "mArrowLeft03"]) w.find(n)?.hide(); // 03 = "jump to end" variants, unused in the skeleton
    const cont = w.part("friends_container");
    // The strip clips the boxes to the container area (the original masks them).
    this.strip = document.createElement("div");
    this.strip.style.cssText = `position:absolute;left:${cont.x}px;top:${cont.y}px;width:${VISIBLE_W}px;height:120px;overflow:hidden;pointer-events:none`;
    w.root.appendChild(this.strip);
    const invite = w.part("InviteRandom");
    invite.find("Invite")?.setText(getText("TID_BUTTON_TEXT_ADDNEIGHBORS"), { rich: false });
    const ih = hitArea(invite);
    ih.style.cursor = "pointer";
    ih.addEventListener("click", () => uiBus.emit("openInvite"));
    this.arrows.l = this.wire("mArrowLeft01", -1);
    this.arrows.r = this.wire("mArrowRight01", 1);
    await this.reload();
    this.ctx.game.on("profile", () => this.refreshSelf());
  }

  private wire(name: string, dir: number): Button {
    const b = new Button(this.bar.part(name));
    b.onClick(() => this.scroll(dir));
    return b;
  }

  private scroll(dir: number): void {
    const max = Math.max(0, this.slotCount() - Math.floor(VISIBLE_W / BOX_W));
    this.offset = Math.max(0, Math.min(max, this.offset + dir));
    this.strip.firstElementChild && ((this.strip.firstElementChild as HTMLElement).style.transform = `translateX(${-this.offset * BOX_W}px)`);
    this.arrows.l?.setEnabled(this.offset > 0);
    this.arrows.r?.setEnabled(this.offset < max);
  }
  private slotCount(): number {
    return this.slots;
  }

  /** Neighbor list from the server (+ NPCs + myself), skeleton rendering. */
  async reload(): Promise<void> {
    const { game, conn } = this.ctx;
    let listed: Neighbor[] = [];
    try {
      listed = parseNeighborList((await conn.query("get_neighbor_list"))?._dat as Record<string, unknown> | undefined);
    } catch {
      /* offline: only NPCs */
    }
    let npcs: Neighbor[] = [];
    try {
      const res = await fetch(`${RULES_ROOT}NPCDefinitions.xml`);
      if (res.ok) npcs = parseNpcs(await res.text(), Number(game.state.profile.raw.bossGenre ?? 0));
    } catch {
      /* ignore */
    }
    this.neighbors = [...listed, ...npcs];
    await this.render();
  }

  private selfEntry(): Neighbor {
    const p = this.ctx.game.profile;
    return { userId: String(this.ctx.game.state.profile.raw.userId ?? "1"), name: this.ctx.game.state.profile.userName, exp: p.exp, companyValue: p.companyValue, self: true };
  }
  private selfTimer = 0;
  private selfSig = "";
  /** Re-rank when the player's own value/xp changed (debounced: boxes are rebuilt). */
  private refreshSelf(): void {
    const me = this.selfEntry();
    const sig = `${me.exp}|${me.companyValue}`;
    if (sig === this.selfSig) return;
    this.selfSig = sig;
    window.clearTimeout(this.selfTimer);
    this.selfTimer = window.setTimeout(() => void this.render(), 1000);
  }
  private rendering = false;

  private async render(): Promise<void> {
    if (this.rendering) return;
    this.rendering = true;
    try {
      // FriendsBar.buildNeighborsContent :136-170: FRIENDS_PER_PAGE (8) minus the neighbor count of "Add neighbors" slots first, then the
      // neighbors sorted ascending by company value (rank = count - index), so the best company sits at the right end.
      const ranked = rankNeighbors([this.selfEntry(), ...this.neighbors]); // descending: rank = index + 1
      const asc = [...ranked].reverse();
      const empties = Math.max(0, FRIENDS_PER_PAGE - asc.length);
      const row = document.createElement("div");
      row.style.cssText = "position:absolute;left:0;top:0;transition:transform .2s";
      const widgets = await Promise.all(asc.map((n, i) => this.box(n, asc.length - i)));
      const adds = await Promise.all(Array.from({ length: empties }, async () => {
        const add = await Widget.create("hud", "hud_friend_box_add_friend");
        probe().appendChild(add.root); // text fitting measures real layout
        add.setText("Name", getText("TID_BUTTON_TEXT_ADDNEIGHBORS"));
        const ah = hitArea(add.self);
        ah.style.cursor = "pointer";
        ah.addEventListener("click", () => uiBus.emit("openInvite"));
        return add;
      }));
      [...adds, ...widgets].forEach((bw, i) => {
        bw.root.style.transform = `translate(${i * BOX_W}px,0)`;
        row.appendChild(bw.root);
      });
      this.slots = empties + asc.length;
      this.strip.replaceChildren(row);
      this.scroll(0);
    } finally {
      this.rendering = false;
    }
  }

  /** hud_friend_box / hud_friend_box_yourself: position badge, name, level, company value. */
  private async box(n: Neighbor, position: number): Promise<Widget> {
    const w = await Widget.create("hud", n.self ? "hud_friend_box_yourself" : "hud_friend_box");
    probe().appendChild(w.root);
    for (const i of [1, 2, 3]) w.find(`position_${i}`)?.setVisible(position === i);
    w.part("position").setText(String(position), { rich: false });
    w.part("Name").setText(n.name, { rich: false });
    // FriendsBarContentFriend.as:116/141: TextManager.convertNumberRanking
    w.part("Dollars").setText(getText("TID_COIN_SYMBOL") + convertNumberRanking(n.companyValue), { rich: false });
    w.part("ExLevel").setText(String(levelOf(this.ctx.game.rules, n.exp)), { rich: false });
    if (n.photo) w.part("photo").setImage(n.photo, { x: 0, y: 0, w: 50, h: 50 });
    const hit = hitArea(w.self);
    hit.style.cursor = "pointer";
    hit.addEventListener("click", () => {
      if (!n.self) uiBus.emit("visit", { userId: n.userId, name: n.name, companyValue: n.companyValue, photo: n.photo });
    });
    return w;
  }

  /** FriendsBar placement: centred, bottom edge on the window bottom (DollarsGame.as:681). */
  layout(): void {
    this.el.style.transform = `translate(${Math.round((window.innerWidth - 785) / 2)}px,${window.innerHeight}px)`;
  }
  get toolbarOrigin(): { x: number; y: number } {
    return { x: Math.round((window.innerWidth - 785) / 2) + 10, y: window.innerHeight };
  }
  part(name: string): Part {
    return this.bar.part(name);
  }
}

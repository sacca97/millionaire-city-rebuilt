// Developer debug panel (plain DOM), toggled with the backtick key. Drives the core loop without the real HUD.
import type { Game } from "../game/game";

export function installDebugPanel(game: Game): { toggle(): void; element: HTMLElement } {
  const el = document.createElement("div");
  el.id = "mcity-debug";
  el.style.cssText =
    "position:fixed;top:8px;right:8px;z-index:99999;background:rgba(0,0,0,.82);color:#eee;font:12px/1.4 monospace;padding:8px;border-radius:6px;max-width:260px;display:none";
  document.body.appendChild(el);

  const info = document.createElement("div");
  info.dataset.role = "info";
  el.appendChild(info);

  const row = (): HTMLDivElement => {
    const r = document.createElement("div");
    r.style.cssText = "margin-top:4px;display:flex;flex-wrap:wrap;gap:4px";
    el.appendChild(r);
    return r;
  };
  const button = (parent: HTMLElement, label: string, fn: () => void): HTMLButtonElement => {
    const b = document.createElement("button");
    b.textContent = label;
    b.style.cssText = "font:11px monospace;padding:2px 5px;cursor:pointer";
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      fn();
      render();
    });
    parent.appendChild(b);
    return b;
  };

  const select = document.createElement("select");
  select.style.cssText = "font:11px monospace;max-width:240px";
  const skus = [...game.defs.values()]
    .filter((d) => ["houses", "decoration", "commerce"].includes(d.rules.kind))
    .sort((a, b) => a.rules.kind.localeCompare(b.rules.kind) || a.rules.level - b.rules.level || a.sku.localeCompare(b.sku));
  for (const d of skus) {
    const o = document.createElement("option");
    o.value = d.sku;
    o.textContent = `${d.sku} L${d.rules.level} ${d.rules.constructionCoins}c`;
    select.appendChild(o);
  }
  select.value = skus.find((d) => d.sku === "houses_001_001")?.sku ?? select.value;
  el.appendChild(select);

  const r1 = row();
  button(r1, "build (ghost)", () => game.setTool({ kind: "build", sku: select.value }));
  button(r1, "auto-place", () => void game.autoBuild(select.value));
  const r2 = row();
  for (const kind of ["select", "road", "terrain", "destroy"] as const) button(r2, kind, () => game.setTool({ kind }));
  button(r2, "move sel", () => game.selection && game.startMove(game.selection.sid));
  const r3 = row();
  button(r3, "sign 1st contract (sel)", () => {
    const sel = game.selection;
    const opt = sel && game.contractOptions(sel.sid).find((o) => o.unlocked && o.affordable);
    if (sel && opt) game.signContract(sel.sid, opt.sku);
  });
  button(r3, "collect all", () => game.collectAll());
  button(r3, "sell sel", () => game.selection && game.sellItem(game.selection.sid));
  const r4 = row();
  for (const k of [1, 10, 100, 1000]) button(r4, `x${k}`, () => (game.timeScale = k));
  button(r4, "flush", () => void game.flush());

  const render = (): void => {
    const p = game.profile;
    const sel = game.selection;
    info.innerHTML =
      `coins ${p.coins} | cash ${p.cash}<br>level ${p.level} exp ${p.exp}/${p.xpMax}<br>value ${p.companyValue}<br>` +
      `tool ${game.tool.kind}${game.tool.sku ? ":" + game.tool.sku : ""} | x${game.timeScale} | queue ${game.queue.pendingCount}${game.isIdle() ? " idle" : ""}<br>` +
      (sel ? `sel #${sel.sid} ${sel.sku} st${sel.stateId}/m${sel.mode} t=${Math.round(sel.time / 1000)}s` : "sel -");
  };
  game.on("profile", render);
  game.on("selection", render);
  game.on("tool", render);
  game.on("item-changed", render);
  setInterval(() => el.style.display !== "none" && render(), 500);

  const toggle = (): void => {
    el.style.display = el.style.display === "none" ? "block" : "none";
    render();
  };
  window.addEventListener("keydown", (e) => {
    if (e.key === "`") {
      toggle();
    }
  });
  return { toggle, element: el };
}

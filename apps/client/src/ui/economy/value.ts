// PopupValue (GUI/PopupValue.as): opened by clicking the Headquarters (StateOnHeadQuarter.doClick :60-68). houses_info.swf
// popup_value: coins, gold, buildings, terrain and the company value total (Company.getCompanyValuePer* / getCompanyValue).
import { Button } from "../../gui/button";
import { convertNumberToString } from "../../gui/format";
import { getText } from "../../gui/i18n";
import { Popup } from "../../gui/popup";
import { Widget } from "../../gui/widget";
import type { UiContext } from "../context";

let open = false;

export async function openCompanyValue(ctx: UiContext): Promise<void> {
  if (open) return;
  open = true;
  const v = ctx.game.companyValueBreakdown();
  const w = await Widget.create("houses_info", "popup_value");
  const p = new Popup(w);
  p.on("close", () => (open = false));
  const sym = getText("TID_COIN_SYMBOL");
  const money = (n: number): string => sym + convertNumberToString(n, 0, 0);
  const colon = getText("TID_ESPACIO2PUNTOS");
  w.setText("Caption", getText("TID_HINT_VALUE"));
  w.setText("TextInfo_01", getText("TID_GEN_DCCOINS") + colon);
  w.setText("TextInfo_02", getText("TID_GEN_DCCASH") + colon);
  w.setText("TextInfo_03", getText("TID_CV_1") + colon);
  w.setText("TextInfo_04", getText("TID_CV_2") + colon);
  w.setText("TextInfo_05", getText("TID_CV_TOTAL") + colon);
  w.setText("cash", money(v.coins));
  w.setText("gold", money(v.gold));
  w.setText("buildings", money(v.buildings));
  w.setText("terrain", money(v.terrain));
  w.setText("total", money(v.total));
  p.wireClose(new Button(w.part("OkButton")));
  p.show();
}

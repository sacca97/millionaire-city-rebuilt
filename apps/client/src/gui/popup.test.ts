import { describe, expect, it } from "vitest";
import { PopupManager, type Popup } from "./popup";

const fake = (clearsShowFlag = false): Popup => ({ clearsShowFlag, dim: { style: {} }, boxEl: { style: {} } }) as unknown as Popup;

describe("PopupManager.showPopupFlag (DollarsGame.mShowPopup)", () => {
  it("is set while a popup is open and follows the stack when a popup closes (Popup.as:90, 228)", () => {
    const m = new PopupManager();
    const a = fake();
    const b = fake();
    m._push(a);
    m._push(b);
    expect(m.showPopupFlag).toBe(true);
    m._remove(b);
    expect(m.showPopupFlag).toBe(true);
    m._remove(a);
    expect(m.showPopupFlag).toBe(false);
  });

  it("a closing PopupMessage clears it even though the reward popup below is still open (PopupMessage.as:88; oracle R02-3-g1)", () => {
    const m = new PopupManager();
    const reward = fake();
    const info = fake(true);
    m._push(reward);
    m._push(info);
    m._remove(info);
    expect(m.isAnyOpen).toBe(true);
    expect(m.showPopupFlag).toBe(false);
  });
});

/**
 * Text fitting (TextManager.setTextScaled) measures real layout, so widgets must be attached to the document while their
 * texts are set. Widgets are built off-screen; this keeps a hidden probe element they can live in until they are placed.
 */
let probeEl: HTMLElement | undefined;
export function probe(): HTMLElement {
  if (!probeEl || !probeEl.isConnected) {
    probeEl = document.createElement('div');
    probeEl.setAttribute('aria-hidden', 'true');
    probeEl.style.cssText = 'position:fixed;left:-10000px;top:0;visibility:hidden;pointer-events:none';
    document.body.appendChild(probeEl);
  }
  return probeEl;
}

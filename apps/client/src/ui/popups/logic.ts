// Pure helpers for the gameplay popups (no DOM): gold exchange maths and expansion price table.

/** PopupConfirm.convertToGold (PopupConfirm.as:60-69): gold bars needed to cover `missingCoins` (rounded up). */
export function goldForCoins(missingCoins: number, cashToCoins: number): number {
  if (missingCoins <= 0 || cashToCoins <= 0) return 0;
  return Math.ceil(missingCoins / cashToCoins);
}

export interface ExpansionPrice {
  coins: number;
  cash: number;
  fbc: number;
  /** InversorsSuccessful: friends/investments needed for the free-with-investors path. */
  investors: number;
}

/** rules/expansionsPrices.xml (RulesFacade.expansionsGetDCCoins/DCCash/FBCredits/FriendsNeeded). Row = bought-expansion count. */
export function parseExpansionPrices(xml: string): ExpansionPrice[] {
  const out: ExpansionPrice[] = [];
  for (const m of xml.matchAll(/<Definition\s+([^>]*?)\/?>/g)) {
    const a = (k: string) => Number(new RegExp(`(?:^|\\s)${k}="([^"]*)"`).exec(m[1])?.[1] ?? 0);
    out.push({ coins: a('DCCoins'), cash: a('DCCash'), fbc: a('FBC'), investors: a('InversorsSuccessful') });
  }
  return out;
}

/** Price row for the next purchase (Profile.expansionsGetDCCoins uses mExpansionsMineCount); clamps to the last row. */
export function priceFor(prices: ExpansionPrice[], expansionCount: number): ExpansionPrice {
  return prices[Math.min(Math.max(0, expansionCount), prices.length - 1)] ?? { coins: 0, cash: 0, fbc: 0, investors: 0 };
}

/** Map.as:1716 showBuyPlot: only a for-sale plot (state 1) opens the buy popup; a locked plot (0) shows TID_EXPANSION_LOCKED. */
export function plotAction(state: number): 'buy' | 'locked' | 'none' {
  return state === 1 ? 'buy' : state === 0 ? 'locked' : 'none';
}

/** Contract grid slot (ContractBox.addItem + scrollRect offsets): 3 columns x 2 rows per page, centred on the popup. */
export function contractSlot(index: number): { page: number; x: number; y: number } {
  const col = index % 3;
  const row = Math.floor(index / 3) % 2;
  return { page: Math.floor(index / 6), x: 114 * col - 114, y: -80 + 147 * row };
}

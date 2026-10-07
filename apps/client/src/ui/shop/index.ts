/**
 * Shop area: BuyBox shop, storage (vault) popup, early unlock, limited editions. Entry points are the uiBus events
 * `openShop({tab?})` and `openStorage()`; the public API (`shop`, `storage`) is returned from `mount`.
 */
import { uiBus } from '../bus';
import type { UiContext } from '../context';
import { ShopData } from './data';
import { handleNeedMoney } from './money';
import { Shop } from './shop';
import { StoragePopup } from './storage';

export interface ShopApi {
  data: ShopData;
  shop: Shop;
  storage: StoragePopup;
}

let api: ShopApi | undefined;
/** The mounted shop (the tutorial points arrows at its tabs / buy buttons). */
export const getShop = (): ShopApi | undefined => api;

export async function mount(ctx: UiContext): Promise<ShopApi> {
  const data = await ShopData.load(ctx);
  const shop = new Shop(ctx, data);
  const storage = new StoragePopup(ctx, data);
  uiBus.on('openShop', (e) => void shop.open(e?.tab));
  uiBus.on('openStorage', () => void storage.open());
  // ToolBuild.itemAttachedCheckPrice: refused build for lack of money -> exchange / not-enough-gold popups
  ctx.game.on('need-money', (need) => void handleNeedMoney(ctx, need));
  api = { data, shop, storage };
  (window as unknown as { __shop?: ShopApi }).__shop = api;
  return api;
}

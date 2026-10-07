// Gameplay popups area: contract picker, instant build, level-up, sell/move confirms, not-enough-coins/gold, exchange,
// expansion purchase (+ for-sale signs on the map), toasts and floating rent numbers.
import { getText, t } from '../../gui/i18n';
import { RENT_MODE, STATE_ID } from '../../net/commands';
import { uiBus } from '../bus';
import type { UiContext } from '../context';
import { confirmCancelContract, openContractPopup } from './contract';
import { openExpansion, loadExpansionPrices, mountPlotOverlays } from './expansion';
import { confirmDestroy, confirmMove, confirmPayMove, openExchange, ensureCoins, showMessage } from './flows';
import { openInstantBuild } from './instantBuild';
import { openLevelUp } from './levelUp';
import { mountOverlays } from './overlays';

export { ensureCoins, openExchange, showNoGold } from './flows';

export async function mount(ctx: UiContext): Promise<void> {
  const { game } = ctx;
  await loadExpansionPrices();

  uiBus.on('openContract', ({ sid }) => void openContractPopup(ctx, sid));
  uiBus.on('openInstantBuild', ({ sid }) => void openInstantBuild(ctx, sid));
  uiBus.on('openExpansion', ({ plot }) => void openExpansion(ctx, plot));
  uiBus.on('openExchange', () => void openExchange(ctx));
  uiBus.on('levelUp', ({ level }) => void openLevelUp(ctx, level));
  game.on('levelUp', ({ level }) => void openLevelUp(ctx, level)); // de-duplicated per level inside openLevelUp

  // Click on an item with the select tool (ItemObject click -> StateOnRent.doDoClick / StateOnConstructionOwner.doDoClick).
  game.on('selection', (item) => {
    if (!item) return;
    if (item.stateId === STATE_ID.CONSTRUCTION) void openInstantBuild(ctx, item.sid);
    else if (item.stateId === STATE_ID.RENT && item.mode === RENT_MODE.WAITING_FOR_CONTRACT) void openContractPopup(ctx, item.sid);
    else if (item.stateId === STATE_ID.RENT && item.mode === RENT_MODE.RENTING && !item.isCommerce) void confirmCancelContract(ctx, item.sid);
  });

  // Confirmations requested by the tools (ToolDestroy -> PopupConfirmDestroy, ToolMove -> PopupConfirmMove, not enough coins).
  game.hooks.confirmSell = (sid) => {
    const item = game.item(sid);
    if (!item) return;
    const profit = game.sellPrice(item);
    void confirmDestroy(getText(profit > 0 ? 'TID_DESTROY_MSG' : 'TID_DESTROY_BUILDING_NOREWARD'), profit, () => game.sellItem(sid)).then((p) => p.show());
  };
  game.hooks.confirmMove = (sid, tx, ty) => {
    const item = game.item(sid);
    if (!item) return;
    const price = game.movePrice(item);
    // ToolMove.itemAttachedCheckPrize: the multifunction/free-move entry (vault "move") confirms, the toolbar tool offers PopupPayMove.
    if (game.moveFree) void confirmMove(price, () => game.moveItem(sid, tx, ty, true)).then((p) => p.show());
    else {
      void confirmPayMove(price, game.moveRentPrice, () => {
        if (game.profile.coins < price) game.hooks.notEnoughCoins?.(price);
        else game.moveItem(sid, tx, ty, true);
      }, () => {
        if (game.rentMove()) game.moveItem(sid, tx, ty, true);
        else uiBus.emit('openAddGold');
      }).then((p) => p.show());
    }
  };
  game.hooks.placeRefused = (sku) => {
    const def = game.defs.get(sku);
    // ItemDefinition.requiresTerrainMine: everything except decorations and the like (noPlot items); "%U" = baseCols x baseRows.
    const terrain = def !== undefined && !game.noPlotSku(sku);
    void showMessage(terrain ? t('TID_PLACE_IN_TERRAIN', [`${def.cols}x${def.rows}`]) : getText('TID_CANT_BUILD_DECORATION'), terrain ? 'terrain' : null);
  };
  game.hooks.notEnoughCoins = (needed) => void ensureCoins(ctx, needed, () => undefined);

  mountOverlays(ctx);
  mountPlotOverlays(ctx);
}

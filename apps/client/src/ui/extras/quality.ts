import { renderOptions } from '../../view/itemView';
import { getQuality, onQualityChange } from '../hud/settings';

/** Quality LOW -> no item animations (OptionsPanel.onQualityClick / ItemObject.as:2240-2345). */
export function mountQuality(): void {
  const apply = () => { renderOptions.animations = getQuality() === 'high'; };
  apply();
  onQualityChange(apply);
}

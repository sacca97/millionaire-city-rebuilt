// Pure viewport-culling maths (no Pixi): used by CityView to hide ground chunks and item views that lie outside the camera.
// Culling only toggles `visible`; it never changes game state, events or commands.

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** World-pixel rectangle covered by a screen of w x h pixels for a camera (world.x/y, uniform scale k), grown by `margin` world px. */
export function worldViewRect(camX: number, camY: number, k: number, w: number, h: number, margin = 0): Rect {
  return { left: -camX / k - margin, top: -camY / k - margin, right: (w - camX) / k + margin, bottom: (h - camY) / k + margin };
}

export function intersects(r: Rect, left: number, top: number, right: number, bottom: number): boolean {
  return right >= r.left && left <= r.right && bottom >= r.top && top <= r.bottom;
}

/** Union of boxes [x0,y0,x1,y1]; undefined when empty. */
export function unionBoxes(boxes: Array<[number, number, number, number]>): [number, number, number, number] | undefined {
  if (boxes.length === 0) return undefined;
  let [a, b, c, d] = boxes[0];
  for (const [x0, y0, x1, y1] of boxes) {
    a = Math.min(a, x0);
    b = Math.min(b, y0);
    c = Math.max(c, x1);
    d = Math.max(d, y1);
  }
  return [a, b, c, d];
}

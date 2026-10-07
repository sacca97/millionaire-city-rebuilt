import { describe, expect, it } from 'vitest';
import { classPreview, findByName, frameAt, instantiate, instantiateRoot, walk, type GuiLayout } from './layout';

const layout: GuiLayout = {
  swf: 't.swf',
  frameRate: 30,
  stage: [0, 0, 100, 100],
  fonts: [],
  classes: { Panel: 3, Btn: 5 },
  symbols: {
    '1': { t: 'shape', bounds: [-5, -5, 5, 5], png: 'shapes/1.png' },
    '2': {
      t: 'text', bounds: [0, 0, 40, 10], size: 12, color: '#ffffff', align: 'center', text: 'Hi',
      multiline: false, wordWrap: false, input: false, autoSize: false,
    },
    '3': {
      t: 'sprite', png: 'sprites/Panel/', pngFrames: 1, bounds: [-5, -5, 55, 25],
      frames: [[
        { d: 1, ref: 1 },
        { d: 2, ref: 2, n: 'label', m: [2, 0, 0, 2, 10, 20] },
      ], 0],
    },
    '4': { t: 'shape', bounds: [0, 0, 4, 4], png: 'shapes/4.png' },
    '5': {
      t: 'sprite', button: true, labels: { UpState: 0, OverState: 1, DownState: 2 },
      frames: [[{ d: 1, ref: 1 }], [{ d: 1, ref: 4 }], [{ d: 1, ref: 4, m: [1, 0, 0, 1, 1, 1] }]],
    },
  },
  root: { t: 'sprite', frames: [[{ d: 1, ref: 3, n: 'panel', m: [1, 0, 0, 1, 7, 8] }]] },
};

describe('gui layout', () => {
  it('instantiates a class tree with names, matrices and textures', () => {
    const n = instantiate(layout, 'Panel', { baseUrl: '/gui/t' });
    expect(n.kind).toBe('sprite');
    expect(n.children).toHaveLength(2);
    expect(n.children[0].texture).toEqual({ path: '/gui/t/shapes/1.png', x: -5, y: -5, w: 10, h: 10 });
    const label = findByName(n, 'label')!;
    expect(label).toMatchObject({ x: 10, y: 20, scaleX: 2, scaleY: 2, kind: 'text' });
    expect(label.text?.text).toBe('Hi');
  });

  it('resolves deduped frames and nested root placements', () => {
    expect(frameAt(layout.symbols['3'] as never, 1)).toHaveLength(2);
    const root = instantiateRoot(layout);
    const panel = findByName(root, 'panel')!;
    expect([panel.x, panel.y]).toEqual([7, 8]);
    expect([...walk(root)].length).toBe(4);
  });

  it('builds button states', () => {
    const b = instantiate(layout, 'Btn');
    expect(b.kind).toBe('button');
    expect(Object.keys(b.states!).sort()).toEqual(['down', 'over', 'up']);
    expect(b.states!.over[0].texture?.path).toBe('/shapes/4.png');
  });

  it('gives class preview paths and rejects unknown symbols', () => {
    expect(classPreview(layout, 'Panel', '/g')).toEqual({ path: '/g/sprites/Panel/1.png', x: -5, y: -5 });
    expect(() => instantiate(layout, 'Nope')).toThrow();
  });
});

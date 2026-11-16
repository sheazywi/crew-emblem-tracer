import { PRESETS } from './presets';
import { makeLayer, type Layer } from './types';

const AMBER = '#f5a524';
const NAVY = '#14212e';
const CREAM = '#f4ead2';
const STEEL = '#3b5068';

/** The crest the app opens on, so the first view shows what the editor does. */
export function exampleCrest(): Layer[] {
  const shield = PRESETS.shield.pts;
  const chevron = PRESETS.chevron.pts;
  return [
    makeLayer('path', { name: 'Shield rim', pts: shield, x: 256, y: 262, w: 372, h: 432, color: AMBER }),
    makeLayer('path', { name: 'Shield', pts: shield, x: 256, y: 260, w: 340, h: 398, color: NAVY }),
    makeLayer('poly', { name: 'Hex plate', n: 6, x: 256, y: 206, w: 236, h: 236, color: STEEL }),
    makeLayer('ring', { name: 'Ring', x: 256, y: 206, w: 190, h: 190, inner: 0.86, color: AMBER }),
    makeLayer('star', { name: 'Star', n: 5, inner: 0.45, x: 256, y: 204, w: 148, h: 148, color: CREAM }),
    makeLayer('path', { name: 'Chevron', pts: chevron, x: 256, y: 338, w: 150, h: 64, color: AMBER }),
    makeLayer('round', { name: 'Banner', x: 256, y: 408, w: 236, h: 58, r: 50, color: CREAM }),
    makeLayer('text', {
      name: 'Motto',
      text: 'FORGE',
      font: 'Chakra Petch',
      weight: 700,
      x: 256,
      y: 408,
      w: 150,
      h: 28,
      color: NAVY,
    }),
  ];
}

/** A fixture with every shape type, rotations and flips, used by the golden pixel tests. */
export function allTypesFixture(): Layer[] {
  return [
    makeLayer('rect', { x: 256, y: 256, w: 500, h: 500, color: '#1d2a38' }),
    makeLayer('rect', { x: 110, y: 90, w: 150, h: 70, rot: 17, color: '#d9534f' }),
    makeLayer('round', { x: 300, y: 80, w: 180, h: 80, r: 30, rot: -8, color: '#5bc0de' }),
    makeLayer('ellipse', { x: 440, y: 110, w: 90, h: 140, rot: 33, color: '#f0ad4e' }),
    makeLayer('triangle', { x: 90, y: 230, w: 120, h: 130, rot: 200, color: '#5cb85c' }),
    makeLayer('rtri', { x: 230, y: 220, w: 110, h: 90, rot: 40, fx: true, color: '#9b59b6' }),
    makeLayer('star', { x: 380, y: 250, w: 150, h: 150, n: 7, inner: 0.5, rot: 12, color: '#f4ead2' }),
    makeLayer('poly', { x: 100, y: 390, w: 130, h: 130, n: 6, rot: 20, color: '#e67e22' }),
    makeLayer('poly', { x: 230, y: 400, w: 120, h: 120, n: 5, rot: -10, color: '#1abc9c' }),
    makeLayer('ring', { x: 370, y: 410, w: 140, h: 140, inner: 0.6, color: '#ecf0f1' }),
    makeLayer('path', {
      pts: PRESETS.bolt.pts,
      x: 460,
      y: 380,
      w: 70,
      h: 150,
      rot: 15,
      fy: true,
      color: '#f5a524',
    }),
    makeLayer('path', { pts: PRESETS.heart.pts, x: 256, y: 300, w: 90, h: 82, color: '#e74c3c' }),
    makeLayer('ellipse', { x: 256, y: 150, w: 60, h: 60, opacity: 0.5, color: '#ffffff' }),
  ];
}

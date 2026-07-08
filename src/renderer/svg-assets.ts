/**
 * Inline-SVG asset plumbing for the graphics upgrade
 * (docs/graphics-requirements.md).
 *
 * Assets are single-root SVGs under ./assets/, imported as raw text so they
 * inject inline and CSS custom properties (--steel, --glass, …) apply. Each
 * animatable/positionable part is a named <g id="…"> carrying a
 * `data-viewbox` (its own crop box) so code can slice one authored file into
 * independently scaled layers — the jar stretches to a 2–7 col × 1–15 row
 * range at runtime, so art is sliced, never fixed.
 */

// eslint-disable-next-line import/no-unresolved
import jarRaw from './assets/jar.svg?raw';
// eslint-disable-next-line import/no-unresolved
import clawRaw from './assets/claw.svg?raw';
// eslint-disable-next-line import/no-unresolved
import pebbleRaw from './assets/pebble.svg?raw';
// eslint-disable-next-line import/no-unresolved
import pitRaw from './assets/pit.svg?raw';
// eslint-disable-next-line import/no-unresolved
import miniJarRaw from './assets/jar-mini.svg?raw';

const SVG_NS = 'http://www.w3.org/2000/svg';

const parsed = new Map<string, Document>();

function doc(raw: string): Document {
  let d = parsed.get(raw);
  if (!d) {
    d = new DOMParser().parseFromString(raw, 'image/svg+xml');
    parsed.set(raw, d);
  }
  return d;
}

export interface LayerOpts {
  /** preserveAspectRatio="none" — the layer stretches to its container. */
  stretch?: boolean;
  className?: string;
}

/**
 * Build a standalone <svg> containing clones of the named groups (plus the
 * asset's <defs>, so gradients travel along). The first group's data-viewbox
 * becomes the layer's viewBox.
 */
export function svgLayer(raw: string, ids: string[], opts: LayerOpts = {}): SVGSVGElement {
  const source = doc(raw);
  const out = document.createElementNS(SVG_NS, 'svg');
  const first = source.getElementById(ids[0]);
  const viewBox =
    first?.getAttribute('data-viewbox') ??
    source.documentElement.getAttribute('viewBox') ??
    '0 0 100 100';
  out.setAttribute('viewBox', viewBox);
  out.setAttribute('preserveAspectRatio', opts.stretch ? 'none' : 'xMidYMid meet');
  out.setAttribute('aria-hidden', 'true');
  if (opts.className) out.setAttribute('class', opts.className);
  const defs = source.querySelector('defs');
  if (defs) out.appendChild(document.importNode(defs, true));
  for (const id of ids) {
    const g = source.getElementById(id);
    if (g) out.appendChild(document.importNode(g, true));
  }
  return out;
}

export const ASSETS = {
  jar: jarRaw,
  claw: clawRaw,
  pebble: pebbleRaw,
  pit: pitRaw,
  miniJar: miniJarRaw,
} as const;

/** A fresh pebble node sized for a jar slot / floater. */
export function pebbleNode(className = 'pebble-svg'): SVGSVGElement {
  return svgLayer(pebbleRaw, ['pebble'], { className });
}

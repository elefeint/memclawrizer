/**
 * Deck detail (F4, re-homed by F10b): per-deck box histogram, due forecast,
 * response-time trend, per-card table, and a filterable attempt log. Plain
 * DOM/SVG — no chart library. Each chart plots a single series (no legend;
 * the title names it); the series hue is the app accent, validated ≥3:1 on
 * both surfaces. Tables carry the exact values, so charts stay sparsely
 * labeled.
 *
 * F10b: this is no longer a screen of its own. The global Hall of Fame owns
 * the header/back button and mounts this section under its deck picker, so
 * the whole thing renders on the CRT panel (which re-points --accent, --fg
 * and friends at phosphor tones — every rule below inherits them).
 */
import { api } from '../api';
import type { AttemptFilter, CardStats, Outcome } from '../../shared/api';
import { parseDateIso } from '../hall-of-fame-data';

const SVG_NS = 'http://www.w3.org/2000/svg';

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  testid?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (testid) e.dataset.testid = testid;
  return e;
}

function svg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number> = {},
): SVGElementTagNameMap[K] {
  const e = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
}

/** Round a maximum up to a clean 1/2/5×10^k value for axis scales. */
function niceMax(v: number): number {
  if (v <= 0) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 5, 10]) if (v <= m * mag) return m * mag;
  return 10 * mag;
}

/** Short axis/table date. Bare 'YYYY-MM-DD' day keys read as LOCAL midnight. */
export function fmtDate(iso: string): string {
  return parseDateIso(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function fmtDateTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function fmtMs(ms: number | null): string {
  if (ms === null) return '—';
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

// ------------------------------------------------------------- tooltip ----

function makeTooltip(): {
  show(text: string, x: number, y: number): void;
  hide(): void;
  element: HTMLElement;
} {
  const tip = el('div', 'viz-tooltip');
  tip.hidden = true;
  return {
    element: tip,
    show(text, x, y) {
      tip.textContent = text;
      tip.hidden = false;
      tip.style.left = `${x + 12}px`;
      tip.style.top = `${y - 10}px`;
    },
    hide() {
      tip.hidden = true;
    },
  };
}

// -------------------------------------------------------------- charts ----

interface Point {
  label: string;
  value: number;
  /** Full text for the hover tooltip. */
  detail: string;
}

interface ChartOpts {
  /** Formats the sparse direct labels (column caps / line endpoint). */
  fmt(v: number): string;
  tooltip: ReturnType<typeof makeTooltip>;
}

const W = 340;
const H = 170;
const PAD = { top: 22, right: 14, bottom: 24, left: 14 };

/** Single-series column chart: ≤24px bars, 4px rounded caps, value on cap. */
function columnChart(points: Point[], opts: ChartOpts): SVGSVGElement {
  const s = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img' });
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const base = PAD.top + innerH;
  const max = niceMax(Math.max(...points.map((p) => p.value), 1));

  // Baseline (hairline, recessive).
  s.appendChild(
    svg('line', { x1: PAD.left, y1: base, x2: W - PAD.right, y2: base, class: 'chart-baseline' }),
  );

  const band = innerW / points.length;
  const barW = Math.min(24, band * 0.55);
  points.forEach((p, i) => {
    const x = PAD.left + band * i + (band - barW) / 2;
    const h = (p.value / max) * innerH;
    const top = base - h;
    const r = Math.min(4, barW / 2, h);
    if (h > 0) {
      // Rounded data-end (top), square at the baseline.
      const d =
        `M ${x} ${base} L ${x} ${top + r} Q ${x} ${top} ${x + r} ${top} ` +
        `L ${x + barW - r} ${top} Q ${x + barW} ${top} ${x + barW} ${top + r} ` +
        `L ${x + barW} ${base} Z`;
      const bar = svg('path', { d, class: 'chart-bar' });
      attachHover(bar, p, opts);
      s.appendChild(bar);
    } else {
      // Zero still deserves a hover target on the band.
      const hit = svg('rect', { x, y: base - 12, width: barW, height: 12, class: 'chart-hit' });
      attachHover(hit, p, opts);
      s.appendChild(hit);
    }
    // Value on the cap; every column labeled, so no y-ticks needed.
    const cap = svg('text', { x: x + barW / 2, y: top - 5, class: 'chart-value' });
    cap.textContent = opts.fmt(p.value);
    s.appendChild(cap);
    const lbl = svg('text', { x: x + barW / 2, y: base + 15, class: 'chart-label' });
    lbl.textContent = p.label;
    s.appendChild(lbl);
  });
  return s;
}

/** Single-series line: 2px round joins, ringed end-dot, endpoint label. */
function lineChart(points: Point[], opts: ChartOpts): SVGSVGElement {
  const s = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img' });
  const innerW = W - PAD.left - PAD.right - 34; // room for y ticks on the right
  const innerH = H - PAD.top - PAD.bottom;
  const base = PAD.top + innerH;
  const max = niceMax(Math.max(...points.map((p) => p.value), 1));

  // Two hairline gridlines with clean ticks (values not directly labeled).
  for (const frac of [0.5, 1]) {
    const y = base - innerH * frac;
    s.appendChild(
      svg('line', { x1: PAD.left, y1: y, x2: PAD.left + innerW, y2: y, class: 'chart-grid' }),
    );
    const t = svg('text', { x: PAD.left + innerW + 5, y: y + 3, class: 'chart-tick' });
    t.textContent = opts.fmt(max * frac);
    s.appendChild(t);
  }
  s.appendChild(
    svg('line', {
      x1: PAD.left,
      y1: base,
      x2: PAD.left + innerW,
      y2: base,
      class: 'chart-baseline',
    }),
  );

  const xAt = (i: number) =>
    points.length === 1 ? PAD.left + innerW / 2 : PAD.left + (innerW * i) / (points.length - 1);
  const yAt = (v: number) => base - (v / max) * innerH;

  if (points.length > 1) {
    const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xAt(i)} ${yAt(p.value)}`).join(' ');
    s.appendChild(svg('path', { d, class: 'chart-line' }));
  }

  points.forEach((p, i) => {
    const hit = svg('circle', { cx: xAt(i), cy: yAt(p.value), r: 10, class: 'chart-hit' });
    attachHover(hit, p, opts);
    s.appendChild(hit);
    if (i === points.length - 1) {
      // End-dot with a 2px surface ring; the endpoint gets the direct label.
      s.appendChild(svg('circle', { cx: xAt(i), cy: yAt(p.value), r: 4.5, class: 'chart-dot' }));
      const lbl = svg('text', {
        x: xAt(i),
        y: yAt(p.value) - 10,
        class: 'chart-value chart-value-end',
      });
      lbl.textContent = opts.fmt(p.value);
      s.appendChild(lbl);
    }
    if (i === 0 || i === points.length - 1) {
      const t = svg('text', { x: xAt(i), y: base + 15, class: 'chart-label' });
      t.textContent = p.label;
      s.appendChild(t);
    }
  });
  return s;
}

function attachHover(mark: SVGElement, p: Point, opts: ChartOpts): void {
  mark.addEventListener('mousemove', (e) => opts.tooltip.show(p.detail, e.clientX, e.clientY));
  mark.addEventListener('mouseleave', () => opts.tooltip.hide());
}

function chartCard(title: string, chart: SVGElement | HTMLElement): HTMLElement {
  const card = el('section', 'chart-card');
  const h = el('h2');
  h.textContent = title;
  card.append(h, chart);
  return card;
}

function emptyNote(text: string): HTMLElement {
  const p = el('p', 'chart-empty');
  p.textContent = text;
  return p;
}

// -------------------------------------------------------------- tables ----

function table(headers: string[], rows: (string | HTMLElement)[][]): HTMLElement {
  const wrap = el('div', 'table-wrap');
  const t = el('table', 'stats-table');
  const thead = el('thead');
  const hr = el('tr');
  for (const htext of headers) {
    const th = el('th');
    th.textContent = htext;
    hr.appendChild(th);
  }
  thead.appendChild(hr);
  const tbody = el('tbody');
  for (const row of rows) {
    const tr = el('tr');
    for (const cell of row) {
      const td = el('td');
      if (typeof cell === 'string') td.textContent = cell;
      else td.appendChild(cell);
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  t.append(thead, tbody);
  wrap.appendChild(t);
  return wrap;
}

function outcomeCell(outcome: Outcome): HTMLElement {
  const s = el('span', `outcome outcome-${outcome}`);
  s.textContent =
    outcome === 'correct' ? '✓ correct' : outcome === 'wrong' ? '✗ wrong' : '⏰ timeout';
  return s;
}

// --------------------------------------------------------------- mount ----

/**
 * Render one deck's charts + tables into `host` (which the caller owns and
 * empties). Returns a teardown for the floating tooltip and the section.
 */
export async function mountDeckDetail(host: HTMLElement, deckId: string): Promise<() => void> {
  const screen = el('div', 'deck-detail');

  const tooltip = makeTooltip();
  document.body.appendChild(tooltip.element);

  const chartsRow = el('div', 'charts-row');
  screen.appendChild(chartsRow);

  const cardsSection = el('section', 'stats-section');
  const attemptsSection = el('section', 'stats-section');
  screen.append(cardsSection, attemptsSection);

  host.appendChild(screen);

  const [deckStats, cards] = await Promise.all([api.stats.deck(deckId), api.stats.cards(deckId)]);

  // --- charts ---
  const count = (v: number) => String(v);
  chartsRow.appendChild(
    chartCard(
      'Leitner boxes',
      columnChart(
        deckStats.boxCounts.map((v, i) => ({
          label: `box ${i + 1}`,
          value: v,
          detail: `box ${i + 1}: ${v} card${v === 1 ? '' : 's'}`,
        })),
        { fmt: count, tooltip },
      ),
    ),
  );

  chartsRow.appendChild(
    chartCard(
      'Due forecast',
      deckStats.dueForecast.length === 0
        ? emptyNote('nothing scheduled yet')
        : columnChart(
            deckStats.dueForecast.map((f) => ({
              label: fmtDate(f.dateIso),
              value: f.count,
              detail: `${fmtDate(f.dateIso)}: ${f.count} due`,
            })),
            { fmt: count, tooltip },
          ),
    ),
  );

  chartsRow.appendChild(
    chartCard(
      'Median response time',
      deckStats.dailyMedianElapsed.length === 0
        ? emptyNote('no attempts yet')
        : lineChart(
            deckStats.dailyMedianElapsed.map((d) => ({
              label: fmtDate(d.dateIso),
              value: d.medianMs,
              detail: `${fmtDate(d.dateIso)}: median ${fmtMs(d.medianMs)}`,
            })),
            { fmt: (v) => fmtMs(Math.round(v)), tooltip },
          ),
    ),
  );

  // --- per-card table ---
  {
    const title = el('h2');
    title.textContent = 'cards';
    cardsSection.appendChild(title);
    if (cards.length === 0) {
      cardsSection.appendChild(emptyNote('no cards'));
    } else {
      cardsSection.appendChild(
        table(
          ['card', 'box', 'due', 'last success', '✓', '✗', 'median'],
          cards.map((c: CardStats) => [
            c.promptPreview,
            String(c.box),
            fmtDateTime(c.dueAtIso),
            fmtDateTime(c.lastSuccessAtIso),
            String(c.lifetimeCorrect),
            String(c.lifetimeWrong),
            fmtMs(c.medianElapsedMs),
          ]),
        ),
      );
    }
  }

  // --- attempt log with filters ---
  const attemptsTitle = el('h2');
  attemptsTitle.textContent = 'attempt log';
  attemptsSection.appendChild(attemptsTitle);

  const filters = el('div', 'filter-row');
  const outcomeSel = el('select');
  for (const [value, label] of [
    ['', 'all outcomes'],
    ['correct', 'correct'],
    ['wrong', 'wrong'],
    ['timeout', 'timeout'],
  ] as const) {
    const o = el('option');
    o.value = value;
    o.textContent = label;
    outcomeSel.appendChild(o);
  }
  const cardSel = el('select');
  {
    const all = el('option');
    all.value = '';
    all.textContent = 'all cards';
    cardSel.appendChild(all);
    for (const c of cards) {
      const o = el('option');
      o.value = c.cardId;
      o.textContent = c.promptPreview;
      cardSel.appendChild(o);
    }
  }
  filters.append(outcomeSel, cardSel);
  attemptsSection.appendChild(filters);

  const logHost = el('div');
  attemptsSection.appendChild(logHost);

  async function refreshLog(): Promise<void> {
    const filter: AttemptFilter = { deckId, limit: 200 };
    if (outcomeSel.value) filter.outcome = outcomeSel.value as Outcome;
    if (cardSel.value) filter.cardId = cardSel.value;
    const attempts = await api.stats.attempts(filter);
    logHost.innerHTML = '';
    if (attempts.length === 0) {
      logHost.appendChild(emptyNote('no attempts match'));
      return;
    }
    logHost.appendChild(
      table(
        ['when', 'card', 'response', 'outcome', 'time', 'first', 'box'],
        attempts.map((a) => [
          fmtDateTime(a.shownAtIso),
          a.cardId,
          a.response === '' ? '∅' : a.response,
          outcomeCell(a.outcome),
          `${fmtMs(a.elapsedMs)} / ${fmtMs(a.timerMs)}`,
          a.isFirstOfSession ? '●' : '',
          a.boxBefore === a.boxAfter ? String(a.boxBefore) : `${a.boxBefore} → ${a.boxAfter}`,
        ]),
      ),
    );
  }

  outcomeSel.addEventListener('change', () => void refreshLog());
  cardSel.addEventListener('change', () => void refreshLog());
  await refreshLog();

  return () => {
    tooltip.element.remove();
    screen.remove();
  };
}

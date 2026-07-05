/**
 * The claw machine's prize pool. Weighting is by repetition: common trinkets
 * appear several times, oddities once — so the flattened array IS the
 * distribution and pickPrize() can stay a dumb uniform pick. Extend by adding
 * entries; no other code changes needed.
 */

const COMMON: readonly string[] = [
  '🧸', '🦆', '🎲', '🪀', '🧩', '🎈', '🎀', '🎁', '🔔', '⭐',
  '🍬', '🍭', '🍪', '🧁', '🍩', '🍒', '🍓', '🍊', '🍋', '🍉',
  '🍇', '🍑', '🥨', '🍡', '🍙', '⚽', '🏀', '🎾', '🥎', '🪁',
  '🎯', '🃏', '🎨', '🖍️', '📐', '🚂', '🚗', '🚕', '🚲', '🛴',
  '⛵', '🛶', '🎠', '🐟', '🐠', '🐡', '🦀', '🦐', '🐙', '🐚',
  '🐌', '🦋', '🐞', '🐝', '🐢', '🐸', '🐤', '🐧', '🦉', '🐰',
  '🐹', '🐭', '🐿️', '🍀', '🌻', '🌷', '🌈', '☂️', '🎵', '🎶',
];

const UNCOMMON: readonly string[] = [
  '🎺', '🎷', '🥁', '🎻', '🪕', '🎹', '🪗', '🎪', '🎭', '🩰',
  '🛼', '⛸️', '🥌', '🪃', '🪆', '🧿', '🔮', '🧭', '⏰', '⌛',
  '🧲', '🔦', '🕯️', '🏮', '🪔', '📻', '📟', '🎥', '📷', '🔭',
  '🔬', '🗝️', '🧬', '🦎', '🦜', '🦔', '🐳', '🦭', '🧊', '🫧',
];

const RARE: readonly string[] = [
  '💎', '👑', '🏆', '🥇', '🦄', '🐉', '🦖', '🦕', '🧞', '🪐',
  '🌋', '🗿', '🛰️', '🚀', '⚓', '💍', '🎖️', '🏺', '🦚', '🦩',
  '🦥', '🦦', '🪩', '🦣', '🔱',
];

function repeat(pool: readonly string[], times: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < times; i++) out.push(...pool);
  return out;
}

/**
 * ~345 entries: commons ×4, uncommons ×2, rares ×1 → an oddity roughly every
 * 14th grab. A plain array on purpose (see module doc).
 */
export const PRIZE_POOL: readonly string[] = [
  ...repeat(COMMON, 4),
  ...repeat(UNCOMMON, 2),
  ...RARE,
];

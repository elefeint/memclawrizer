/**
 * Every game-feel duration in one place so docs/verify.md tuning sessions can
 * adjust the feel without spelunking. Machine-side tick cadence constants live
 * in drill-machine.ts (they are part of the pure logic under test).
 *
 * Rule: the DOM animations for a phase must finish comfortably within the
 * phase duration below — the state machine advances on these clocks, not on
 * animation `finished` promises.
 */

/** Claw grab-and-carry to the jar slot; doubles as the success acknowledgment. */
export const GRAB_MS = 1100;
/** Claw grabs but the prize slips back into the pit (retry success). */
export const SLIP_MS = 1100;
/** Failure feedback: expected answers + mnemonic stay up this long. */
export const FEEDBACK_MS = 2800;
/** Pebble drop into the jar slot (runs inside the feedback window). */
export const PEBBLE_MS = 420;
/** Lid screws onto a perfect jar (+ label fade-in). */
export const SEAL_MS = 2000;
/** Imperfect end: prizes tumble quietly back into the pit. */
export const EMPTY_MS = 1500;
/** Pause on the terminal screen before returning home. */
export const EXIT_DELAY_MS = 700;

/** Claw-drop / rise segments inside grab & slip (must sum under GRAB/SLIP_MS). */
export const CLAW_DROP_MS = 240;
export const CLAW_RISE_MS = 240;
export const PRIZE_FLY_MS = 480;
export const PRIZE_FALL_MS = 420;

/** Stagger between prizes when the jar empties into the pit. */
export const EMPTY_STAGGER_MS = 70;

/**
 * TICK cadence fallback alongside requestAnimationFrame. rAF freezes when the
 * window is occluded/minimized; a plain interval keeps the machine's clock —
 * and therefore the hard deadline — honest even then.
 */
export const TICK_FALLBACK_MS = 100;

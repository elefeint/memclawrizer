/**
 * Unit tests for the pure drill state machine (F1). Everything deterministic:
 * time is TICK payloads, randomness is a fixed-sequence rng.
 */
import { describe, it, expect } from 'vitest';
import type { AnswerResult, CardView, SessionStart } from '../shared/api';
import {
  DrillEvent,
  DrillState,
  Effect,
  MachineDeps,
  ReduceResult,
  TICK_INTERVAL_BASE_MS,
  TICK_INTERVAL_MIN_MS,
  initialState,
  pickPrize,
  reduce,
  tickIntervalAt,
} from './drill-machine';

const POOL = ['🦆', '🎲', '🌵', '🧸'] as const;

/** rng that walks a fixed sequence of values (repeats the last one). */
function seqRng(values: number[]): () => number {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)];
}

function deps(rngValues: number[] = [0]): MachineDeps {
  return { rng: seqRng(rngValues), prizePool: POOL };
}

function card(over: Partial<CardView> = {}): CardView {
  return {
    cardId: 'shi',
    promptType: 'text',
    promptText: 'し',
    mediaUrl: null,
    timerMs: 5000,
    slotIndex: 0,
    isRetry: false,
    ...over,
  };
}

function sessionStart(first: CardView | null, queueLength = 2): SessionStart {
  return { sessionId: 'sess-1', queueLength, first };
}

function result(over: Partial<AnswerResult> = {}): AnswerResult {
  return {
    outcome: 'correct',
    isFirstOfSession: true,
    expected: null,
    hint: null,
    slotIndex: 0,
    next: null,
    remaining: 0,
    sessionEnd: null,
    ...over,
  };
}

/** Drive a sequence of events, collecting all effects. */
function run(
  events: DrillEvent[],
  d: MachineDeps = deps(),
  from: DrillState = initialState,
): { state: DrillState; effects: Effect[]; steps: ReduceResult[] } {
  let state = from;
  const effects: Effect[] = [];
  const steps: ReduceResult[] = [];
  for (const e of events) {
    const r = reduce(state, e, d);
    steps.push(r);
    state = r.state;
    effects.push(...r.effects);
  }
  return { state, effects, steps };
}

function effectTypes(effects: Effect[]): string[] {
  return effects.map((e) => e.type);
}

describe('START', () => {
  it('presents the first card, sizes the jar, starts the timer', () => {
    const first = card();
    const { state, effects } = run([{ type: 'START', session: sessionStart(first, 3) }]);
    expect(state.phase).toBe('presenting');
    expect(state.sessionId).toBe('sess-1');
    expect(state.card).toEqual(first);
    expect(state.remaining).toBe(3);
    expect(state.slots).toEqual([{ kind: 'empty' }, { kind: 'empty' }, { kind: 'empty' }]);
    expect(effects).toEqual([{ type: 'startTimer', ms: 5000 }]);
  });

  it('goes straight to done when nothing is due (first = null)', () => {
    const { state, effects } = run([{ type: 'START', session: sessionStart(null, 0) }]);
    expect(state.phase).toBe('done');
    expect(effects).toEqual([]);
  });
});

describe('correct first attempt', () => {
  it('submits with an rng-picked prize and measured elapsed, then grabs into the slot', () => {
    // rng 0.5 over a 4-item pool → index 2 → '🌵'
    const d = deps([0.5]);
    const { state, effects } = run(
      [
        { type: 'START', session: sessionStart(card(), 2) },
        { type: 'TICK', nowMs: 1000 }, // arms deadline at 6000
        { type: 'TICK', nowMs: 2200 },
        { type: 'SUBMIT', text: 'shi' },
      ],
      d,
    );
    expect(state.phase).toBe('awaitingResult');
    const submit = effects.find((e) => e.type === 'submitAnswer');
    expect(submit).toEqual({
      type: 'submitAnswer',
      req: { cardId: 'shi', response: 'shi', elapsedMs: 1200, timedOut: false, prize: '🌵' },
    });

    const r2 = reduce(
      state,
      {
        type: 'RESULT',
        result: result({
          outcome: 'correct',
          isFirstOfSession: true,
          slotIndex: 0,
          next: card({ cardId: 'ka', slotIndex: 1 }),
          remaining: 1,
        }),
      },
      d,
    );
    expect(r2.state.phase).toBe('grab');
    expect(r2.state.slots[0]).toEqual({ kind: 'prize', prize: '🌵' });
    expect(r2.state.remaining).toBe(1);
    expect(effectTypes(r2.effects)).toEqual(['playSuccessChirp', 'animateGrab']);
    expect(r2.effects[1]).toEqual({ type: 'animateGrab', slotIndex: 0, prize: '🌵' });

    // Grab animation finishes → next card presents, timer restarts.
    const r3 = reduce(r2.state, { type: 'ANIMATION_DONE' }, d);
    expect(r3.state.phase).toBe('presenting');
    expect(r3.state.card?.cardId).toBe('ka');
    expect(r3.state.presentedAtMs).toBeNull(); // re-arms on next TICK
    expect(r3.state.draftText).toBe('');
    expect(r3.effects).toEqual([{ type: 'startTimer', ms: 5000 }]);
  });

  it('clamps elapsedMs to timerMs and never below zero', () => {
    const d = deps();
    const { steps } = run(
      [
        { type: 'START', session: sessionStart(card({ timerMs: 1000 }), 1) },
        { type: 'TICK', nowMs: 0 },
        { type: 'TICK', nowMs: 999 },
        { type: 'SUBMIT', text: 'shi' },
      ],
      d,
    );
    const submit = steps[3].effects[0];
    if (submit.type !== 'submitAnswer') throw new Error('expected submitAnswer');
    expect(submit.req.elapsedMs).toBe(999);
  });

  it('ignores empty and whitespace-only submits', () => {
    const { state, effects } = run([
      { type: 'START', session: sessionStart(card(), 1) },
      { type: 'TICK', nowMs: 0 },
      { type: 'SUBMIT', text: '' },
      { type: 'SUBMIT', text: '   ' },
    ]);
    expect(state.phase).toBe('presenting');
    expect(effectTypes(effects)).toEqual(['startTimer', 'playTick']);
  });

  it('ignores SUBMIT while awaiting a result (no double submit)', () => {
    const d = deps();
    const { state, effects } = run(
      [
        { type: 'START', session: sessionStart(card(), 1) },
        { type: 'TICK', nowMs: 0 },
        { type: 'SUBMIT', text: 'shi' },
        { type: 'SUBMIT', text: 'shi again' },
      ],
      d,
    );
    expect(state.phase).toBe('awaitingResult');
    expect(effects.filter((e) => e.type === 'submitAnswer')).toHaveLength(1);
  });
});

describe('wrong then retry-clear (the slip)', () => {
  it('drops a pebble and shows feedback on a first-attempt wrong', () => {
    const d = deps();
    const { state, effects } = run(
      [
        { type: 'START', session: sessionStart(card({ cardId: 'mock-hard' }), 2) },
        { type: 'TICK', nowMs: 0 },
        { type: 'SUBMIT', text: 'nope' },
        {
          type: 'RESULT',
          result: result({
            outcome: 'wrong',
            isFirstOfSession: true,
            expected: ['xyzzy'],
            hint: 'the magic word is xyzzy',
            slotIndex: 0,
            next: card({ cardId: 'ka', slotIndex: 1 }),
            remaining: 2,
          }),
        },
      ],
      d,
    );
    expect(state.phase).toBe('feedback');
    expect(state.slots[0]).toEqual({ kind: 'pebble' });
    expect(effects.filter((e) => e.type === 'playDing')).toHaveLength(0); // ding is timeout-only
    expect(effects).toContainEqual({ type: 'animatePebble', slotIndex: 0 });
    expect(effects).toContainEqual({
      type: 'showFeedback',
      expected: ['xyzzy'],
      hint: 'the magic word is xyzzy',
    });
  });

  it('a retry success slips (no prize in submit, no jar change, isFirstOfSession=false)', () => {
    const d = deps([0.9]);
    // Session mid-flight: pebble already in slot 0, retry card presenting.
    const pre = run(
      [
        { type: 'START', session: sessionStart(card({ cardId: 'mock-hard' }), 2) },
        { type: 'TICK', nowMs: 0 },
        { type: 'SUBMIT', text: 'nope' },
        {
          type: 'RESULT',
          result: result({
            outcome: 'wrong',
            isFirstOfSession: true,
            expected: ['xyzzy'],
            hint: null,
            slotIndex: 0,
            next: card({ cardId: 'mock-hard', slotIndex: 0, isRetry: true }),
            remaining: 2,
          }),
        },
        { type: 'ANIMATION_DONE' }, // feedback over → retry card presents
        { type: 'TICK', nowMs: 10_000 },
        { type: 'SUBMIT', text: 'xyzzy' },
      ],
      d,
    );
    const submit = pre.effects.filter((e) => e.type === 'submitAnswer').at(-1);
    if (submit?.type !== 'submitAnswer') throw new Error('expected submitAnswer');
    expect(submit.req.prize).toBeNull(); // retries never pick a prize

    const r = reduce(
      pre.state,
      {
        type: 'RESULT',
        result: result({
          outcome: 'correct',
          isFirstOfSession: false,
          slotIndex: 0,
          next: card({ cardId: 'ka', slotIndex: 1 }),
          remaining: 1,
        }),
      },
      d,
    );
    expect(r.state.phase).toBe('slip');
    expect(r.state.slots[0]).toEqual({ kind: 'pebble' }); // slot keeps the pebble
    expect(effectTypes(r.effects)).toEqual(['playSuccessChirp', 'animateSlip']);
  });

  it('a repeat failure on a retry card shows feedback but drops no second pebble', () => {
    const d = deps();
    const mid = run(
      [
        { type: 'START', session: sessionStart(card({ cardId: 'h', slotIndex: 0 }), 1) },
        { type: 'TICK', nowMs: 0 },
        { type: 'SUBMIT', text: 'nope' },
        {
          type: 'RESULT',
          result: result({
            outcome: 'wrong',
            isFirstOfSession: true,
            expected: ['xyzzy'],
            hint: null,
            slotIndex: 0,
            next: card({ cardId: 'h', slotIndex: 0, isRetry: true }),
            remaining: 1,
          }),
        },
        { type: 'ANIMATION_DONE' },
        { type: 'TICK', nowMs: 100 },
        { type: 'SUBMIT', text: 'still nope' },
      ],
      d,
    );
    const r = reduce(
      mid.state,
      {
        type: 'RESULT',
        result: result({
          outcome: 'wrong',
          isFirstOfSession: false,
          expected: ['xyzzy'],
          hint: null,
          slotIndex: 0,
          next: card({ cardId: 'h', slotIndex: 0, isRetry: true }),
          remaining: 1,
        }),
      },
      d,
    );
    expect(r.state.phase).toBe('feedback');
    expect(effectTypes(r.effects)).toEqual(['showFeedback']); // no animatePebble
  });
});

describe('timeout', () => {
  it('dings and machine-submits with timedOut, elapsedMs=timerMs, and the typed draft', () => {
    const { state, effects } = run([
      { type: 'START', session: sessionStart(card({ timerMs: 5000 }), 1) },
      { type: 'TICK', nowMs: 1000 }, // deadline armed at 6000
      { type: 'TICK', nowMs: 4000, inputText: 'sh' },
      { type: 'TICK', nowMs: 6000, inputText: 'sh' },
    ]);
    expect(state.phase).toBe('awaitingResult');
    const tail = effects.slice(-2);
    expect(tail[0]).toEqual({ type: 'playDing' });
    expect(tail[1]).toEqual({
      type: 'submitAnswer',
      req: { cardId: 'shi', response: 'sh', elapsedMs: 5000, timedOut: true, prize: null },
    });
  });

  it('does not time out before the deadline', () => {
    const { state, effects } = run([
      { type: 'START', session: sessionStart(card({ timerMs: 5000 }), 1) },
      { type: 'TICK', nowMs: 1000 },
      { type: 'TICK', nowMs: 5999 },
    ]);
    expect(state.phase).toBe('presenting');
    expect(effects.filter((e) => e.type === 'playDing')).toHaveLength(0);
    expect(effects.filter((e) => e.type === 'submitAnswer')).toHaveLength(0);
  });
});

describe('abort', () => {
  it('mid-card: aborts the session, empties earned prizes into the pit, ends quietly', () => {
    const d = deps([0.0]); // prize index 0 → '🦆'
    const seq = run(
      [
        { type: 'START', session: sessionStart(card(), 2) },
        { type: 'TICK', nowMs: 0 },
        { type: 'SUBMIT', text: 'shi' },
        {
          type: 'RESULT',
          result: result({
            outcome: 'correct',
            isFirstOfSession: true,
            slotIndex: 0,
            next: card({ cardId: 'ka', slotIndex: 1 }),
            remaining: 1,
          }),
        },
        { type: 'ANIMATION_DONE' },
        { type: 'TICK', nowMs: 1000 },
        { type: 'ABORT' },
      ],
      d,
    );
    expect(seq.state.phase).toBe('aborting');
    const last = seq.steps.at(-1)!;
    expect(last.effects).toEqual([
      { type: 'abortSession' },
      { type: 'animateEmpty', jar: ['🦆', null] },
    ]);
    // No seal chime, no sessionComplete on the way out.
    const done = reduce(seq.state, { type: 'ANIMATION_DONE' }, d);
    expect(done.state.phase).toBe('aborted');
    expect(done.effects).toEqual([]);
    // Terminal: further events are inert.
    expect(reduce(done.state, { type: 'ABORT' }, d).effects).toEqual([]);
    expect(reduce(done.state, { type: 'SUBMIT', text: 'x' }, d).effects).toEqual([]);
  });

  it('a RESULT arriving after ABORT is ignored', () => {
    const d = deps();
    const mid = run(
      [
        { type: 'START', session: sessionStart(card(), 1) },
        { type: 'TICK', nowMs: 0 },
        { type: 'SUBMIT', text: 'shi' },
        { type: 'ABORT' }, // abort while awaiting the result
      ],
      d,
    );
    expect(mid.state.phase).toBe('aborting');
    const r = reduce(mid.state, { type: 'RESULT', result: result() }, d);
    expect(r.state.phase).toBe('aborting');
    expect(r.effects).toEqual([]);
  });
});

describe('session end', () => {
  it('perfect: grab finishes → seal chime + seal animation → done + sessionComplete', () => {
    const d = deps([0.25]); // index 1 → '🎲'
    const end = { perfect: true, jar: ['🎲'] };
    const seq = run(
      [
        { type: 'START', session: sessionStart(card(), 1) },
        { type: 'TICK', nowMs: 0 },
        { type: 'SUBMIT', text: 'shi' },
        {
          type: 'RESULT',
          result: result({
            outcome: 'correct',
            isFirstOfSession: true,
            slotIndex: 0,
            next: null,
            remaining: 0,
            sessionEnd: end,
          }),
        },
        { type: 'ANIMATION_DONE' }, // grab done → sealing
      ],
      d,
    );
    expect(seq.state.phase).toBe('sealing');
    expect(seq.steps.at(-1)!.effects).toEqual([
      { type: 'playSealChime' },
      { type: 'animateSeal', jar: ['🎲'] },
    ]);
    const done = reduce(seq.state, { type: 'ANIMATION_DONE' }, d);
    expect(done.state.phase).toBe('done');
    expect(done.effects).toEqual([{ type: 'sessionComplete', end }]);
  });

  it('imperfect: quiet empty — no chime, prizes tumble back, then sessionComplete', () => {
    const d = deps();
    const end = { perfect: false, jar: [null, '🦆'] };
    // Final card was a retry clear (slip), session imperfect.
    const seq = run(
      [
        { type: 'START', session: sessionStart(card({ cardId: 'h' }), 2) },
        { type: 'TICK', nowMs: 0 },
        { type: 'SUBMIT', text: 'x' },
        {
          type: 'RESULT',
          result: result({
            outcome: 'correct',
            isFirstOfSession: false, // pretend retry clear ends the session
            slotIndex: 0,
            next: null,
            remaining: 0,
            sessionEnd: end,
          }),
        },
        { type: 'ANIMATION_DONE' }, // slip done → emptying
      ],
      d,
    );
    expect(seq.state.phase).toBe('emptying');
    expect(seq.steps.at(-1)!.effects).toEqual([{ type: 'animateEmpty', jar: [null, '🦆'] }]);
    const done = reduce(seq.state, { type: 'ANIMATION_DONE' }, d);
    expect(done.state.phase).toBe('done');
    expect(done.effects).toEqual([{ type: 'sessionComplete', end }]);
    // The seal chime plays at no other moment.
    expect(effectTypes(seq.effects).concat(effectTypes(done.effects))).not.toContain(
      'playSealChime',
    );
  });
});

describe('tick acceleration', () => {
  it('interval is flat until 75% then shrinks to the panic rate', () => {
    expect(tickIntervalAt(0)).toBe(TICK_INTERVAL_BASE_MS);
    expect(tickIntervalAt(0.74)).toBe(TICK_INTERVAL_BASE_MS);
    expect(tickIntervalAt(0.75)).toBe(TICK_INTERVAL_BASE_MS);
    expect(tickIntervalAt(0.875)).toBeCloseTo((TICK_INTERVAL_BASE_MS + TICK_INTERVAL_MIN_MS) / 2);
    expect(tickIntervalAt(1)).toBe(TICK_INTERVAL_MIN_MS);
  });

  it('emits ticks more often (rate > 1) in the final 25% of the countdown', () => {
    // 10s timer, TICK every 50ms like a rAF loop.
    const events: DrillEvent[] = [{ type: 'START', session: sessionStart(card({ timerMs: 10_000 }), 1) }];
    for (let t = 0; t <= 9950; t += 50) events.push({ type: 'TICK', nowMs: t });
    const { effects, steps } = run(events);

    // Reconstruct (nowMs, rate) for each playTick.
    const ticks: { at: number; rate: number }[] = [];
    steps.forEach((step, i) => {
      const e = events[i];
      for (const eff of step.effects) {
        if (eff.type === 'playTick' && e.type === 'TICK') ticks.push({ at: e.nowMs, rate: eff.rate });
      }
    });
    expect(ticks.length).toBeGreaterThan(10);

    const early = ticks.filter((t) => t.at < 7500);
    const late = ticks.filter((t) => t.at >= 7500);
    expect(early.every((t) => t.rate === 1)).toBe(true);
    expect(late.some((t) => t.rate > 1)).toBe(true);
    // Cadence tightens: average gap in the last quarter < base interval.
    const gaps = late.slice(1).map((t, i) => t.at - late[i].at);
    const avgGap = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    expect(avgGap).toBeLessThan(TICK_INTERVAL_BASE_MS);
    // Rates increase monotonically (within tick granularity) toward the deadline.
    const lateRates = late.map((t) => t.rate);
    expect(lateRates.at(-1)!).toBeGreaterThan(lateRates[0]);
    // And no submit happened — the card was never answered nor timed out.
    expect(effects.filter((e) => e.type === 'submitAnswer')).toHaveLength(0);
  });
});

describe('pickPrize', () => {
  it('maps rng uniformly over the pool and clamps the edges', () => {
    expect(pickPrize(() => 0, POOL)).toBe('🦆');
    expect(pickPrize(() => 0.999999, POOL)).toBe('🧸');
    expect(pickPrize(() => 1, POOL)).toBe('🧸'); // defensive clamp
    expect(pickPrize(() => 0.5, POOL)).toBe('🌵');
  });
});

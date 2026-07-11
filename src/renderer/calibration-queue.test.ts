import { describe, it, expect } from 'vitest';
import { currentTrial, initQueue, isDone, submitTrial } from './calibration-queue';

const TRIALS = [
  { cardId: 'shi', text: 'shi' },
  { cardId: 'ka', text: 'ka' },
  { cardId: 'n', text: 'n' },
];

describe('calibration trial queue (F8)', () => {
  it('clears a clean run in order, logging every attempt', () => {
    let q = initQueue(TRIALS);
    expect(q.total).toBe(3);
    expect(currentTrial(q)?.cardId).toBe('shi');

    q = submitTrial(q, 'shi', 900);
    q = submitTrial(q, ' KA ', 700.6); // isCorrect normalizes; elapsed rounds
    q = submitTrial(q, 'n', 500);

    expect(isDone(q)).toBe(true);
    expect(q.cleared).toBe(3);
    expect(q.attempts).toEqual([
      { cardId: 'shi', text: 'shi', response: 'shi', elapsedMs: 900 },
      { cardId: 'ka', text: 'ka', response: ' KA ', elapsedMs: 701 },
      { cardId: 'n', text: 'n', response: 'n', elapsedMs: 500 },
    ]);
  });

  it('re-queues a mistyped trial to the end and logs both attempts', () => {
    let q = initQueue(TRIALS);
    q = submitTrial(q, 'sji', 1400); // typo — goes to the back
    expect(q.cleared).toBe(0);
    expect(currentTrial(q)?.cardId).toBe('ka');
    expect(q.pending.map((t) => t.cardId)).toEqual(['ka', 'n', 'shi']);

    q = submitTrial(q, 'ka', 800);
    q = submitTrial(q, 'n', 600);
    expect(isDone(q)).toBe(false); // shi comes round again
    expect(currentTrial(q)?.cardId).toBe('shi');

    q = submitTrial(q, 'shi', 950);
    expect(isDone(q)).toBe(true);
    expect(q.cleared).toBe(3);
    // The submit batch keeps the mistype AND the repeat, in order.
    expect(q.attempts.map((a) => [a.cardId, a.response])).toEqual([
      ['shi', 'sji'],
      ['ka', 'ka'],
      ['n', 'n'],
      ['shi', 'shi'],
    ]);
  });

  it('an empty response is a mistype (isCorrect rejects empty), never a clear', () => {
    let q = initQueue([TRIALS[0]]);
    q = submitTrial(q, '', 300);
    expect(q.cleared).toBe(0);
    expect(isDone(q)).toBe(false);
    expect(q.pending[0].cardId).toBe('shi');
    expect(q.attempts).toHaveLength(1);
  });

  it('empty trial list is done immediately and ignores stray submits', () => {
    const q = initQueue([]);
    expect(isDone(q)).toBe(true);
    expect(submitTrial(q, 'x', 100)).toBe(q);
  });
});

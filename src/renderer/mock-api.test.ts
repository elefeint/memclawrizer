/**
 * Tests the mock — which doubles as an executable spec of the contract
 * semantics both agents build against (first-attempt-only, re-queue, jar,
 * perfect seal).
 */
import { describe, it, expect } from 'vitest';
import { createMockApi } from './mock-api';

describe('mock api session semantics', () => {
  it('runs an imperfect session: wrong first attempt → pebble slot, retry clears the card', async () => {
    const api = createMockApi();
    const start = await api.session.start('mock-kana');
    expect(start.queueLength).toBe(4);
    expect(start.first?.cardId).toBe('shi');

    // Card 1 correct (variant romanization).
    let r = await api.session.answer(start.sessionId, {
      cardId: 'shi', response: ' SI ', elapsedMs: 1200, timedOut: false, prize: '🦆',
    });
    expect(r.outcome).toBe('correct');
    expect(r.isFirstOfSession).toBe(true);

    // Card 2 correct.
    r = await api.session.answer(start.sessionId, {
      cardId: 'ka', response: 'ka', elapsedMs: 900, timedOut: false, prize: '🎲',
    });

    // Card 3 timeout → re-queued, hint surfaced.
    r = await api.session.answer(start.sessionId, {
      cardId: 'n', response: '', elapsedMs: 5000, timedOut: true, prize: null,
    });
    expect(r.outcome).toBe('timeout');
    expect(r.expected).toEqual(['n']);
    expect(r.hint).toMatch(/consonant/);

    // Card 4 correct.
    r = await api.session.answer(start.sessionId, {
      cardId: 'mock-hard', response: 'xyzzy', elapsedMs: 2000, timedOut: false, prize: '🌵',
    });
    expect(r.outcome).toBe('correct');

    // Re-queued card 3 comes back as a retry; clearing it does NOT fill the slot.
    expect(r.next?.cardId).toBe('n');
    expect(r.next?.isRetry).toBe(true);
    r = await api.session.answer(start.sessionId, {
      cardId: 'n', response: 'n', elapsedMs: 800, timedOut: false, prize: null,
    });
    expect(r.outcome).toBe('correct');
    expect(r.isFirstOfSession).toBe(false);
    expect(r.next).toBeNull();
    expect(r.sessionEnd).not.toBeNull();
    expect(r.sessionEnd?.perfect).toBe(false);
    expect(r.sessionEnd?.jar).toEqual(['🦆', '🎲', null, '🌵']);

    // No trophy for imperfect sessions.
    expect(await api.stats.trophies()).toHaveLength(0);
  });

  it('seals a perfect session onto the trophy shelf', async () => {
    const api = createMockApi();
    const start = await api.session.start('mock-piano');
    const r = await api.session.answer(start.sessionId, {
      cardId: 'treble-c4', response: 'C4', elapsedMs: 3000, timedOut: false, prize: '🏆',
    });
    expect(r.sessionEnd?.perfect).toBe(true);
    expect(r.sessionEnd?.jar).toEqual(['🏆']);

    const trophies = await api.stats.trophies();
    expect(trophies).toHaveLength(1);
    expect(trophies[0].deckId).toBe('mock-piano');
    expect(trophies[0].jar).toEqual(['🏆']);
  });
});

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
    // F6: answer-side audio rides along as a data:-URI wav.
    expect(r.answerMediaUrl).toMatch(/^data:audio\/wav;base64,/);

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
    expect(r.answerMediaUrl).toBeNull(); // ん has no answer audio in the mock

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

    // No trophy for imperfect sessions (seeds aside — see seedTrophies()).
    const earned = (await api.stats.trophies()).filter((t) => !t.sessionId.startsWith('seed-'));
    expect(earned).toHaveLength(0);
  });

  it('seals a perfect session onto the trophy shelf', async () => {
    const api = createMockApi();
    const start = await api.session.start('mock-piano');
    const r = await api.session.answer(start.sessionId, {
      cardId: 'treble-c4', response: 'C4', elapsedMs: 3000, timedOut: false, prize: '🏆',
    });
    expect(r.sessionEnd?.perfect).toBe(true);
    expect(r.sessionEnd?.jar).toEqual(['🏆']);

    // Newest first: the fresh trophy leads; deterministic seeds sit behind.
    const trophies = await api.stats.trophies();
    expect(trophies[0].deckId).toBe('mock-piano');
    expect(trophies[0].jar).toEqual(['🏆']);
    const earned = trophies.filter((t) => !t.sessionId.startsWith('seed-'));
    expect(earned).toHaveLength(1);
    // The seeds make one perfect piano run the TENTH — the consolidation demo.
    expect(trophies.filter((t) => t.deckId === 'mock-piano')).toHaveLength(10);
  });
});

describe('mock api deck archiving (contract change #3, F7)', () => {
  it('archive stamps archivedAtIso, splitting the list; unarchive returns the deck', async () => {
    const api = createMockApi();

    // Everything starts active, with packId mirroring the deck id.
    let decks = await api.decks.list();
    expect(decks.every((d) => d.archivedAtIso === null)).toBe(true);
    expect(decks.every((d) => d.packId === d.id)).toBe(true);

    await api.decks.archive('mock-kana');
    decks = await api.decks.list();
    const kana = decks.find((d) => d.id === 'mock-kana');
    expect(kana?.archivedAtIso).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    // Other decks stay active — the home screen splits on archivedAtIso.
    expect(decks.find((d) => d.id === 'mock-piano')?.archivedAtIso).toBeNull();

    // Archived decks are not drillable (mirrors backend B7)…
    await expect(api.session.start('mock-kana')).rejects.toThrow(/archived/);
    // …but their history stays reachable (the archived row keeps a Stats link).
    const cards = await api.stats.cards('mock-kana');
    expect(cards.length).toBeGreaterThan(0);

    await api.decks.unarchive('mock-kana');
    decks = await api.decks.list();
    expect(decks.find((d) => d.id === 'mock-kana')?.archivedAtIso).toBeNull();
    const start = await api.session.start('mock-kana');
    expect(start.queueLength).toBe(4);
  });

  it('keeps an archived deck’s trophies on the shelf', async () => {
    const api = createMockApi();
    const before = (await api.stats.trophies()).filter((t) => t.deckId === 'mock-piano');
    expect(before).toHaveLength(9); // the seeds

    await api.decks.archive('mock-piano');
    const after = (await api.stats.trophies()).filter((t) => t.deckId === 'mock-piano');
    expect(after).toEqual(before); // perfection is forever
  });
});

describe('mock api timer calibration (contract change #4, F8)', () => {
  const trial = (cardId: string, text: string, response: string, elapsedMs: number) => ({
    cardId,
    text,
    response,
    elapsedMs,
  });

  it('start hands out canonical answers to copy-type', async () => {
    const api = createMockApi();
    const { sessionId, trials } = await api.calibration.start('mock-kana');
    expect(sessionId).toMatch(/^mock-calibration-/);
    expect(trials.map((t) => t.text)).toEqual(['shi', 'ka', 'n', 'xyzzy']);
  });

  it('submit: floor = median of CLEAN trials only; suggestion applied and drill picks it up', async () => {
    const api = createMockApi();
    const { sessionId, trials } = await api.calibration.start('mock-kana');

    // One mistype (huge elapsed) + its clean repeat: the 5000ms outlier must
    // not move the floor. Clean elapsed: 1200, 1400, 1600, 1400 → median 1400.
    const r = await api.calibration.submit(sessionId, [
      trial(trials[0].cardId, trials[0].text, 'sji', 5000), // mistype — excluded
      trial(trials[1].cardId, trials[1].text, trials[1].text, 1200),
      trial(trials[2].cardId, trials[2].text, trials[2].text, 1600),
      trial(trials[3].cardId, trials[3].text, trials[3].text, 1400),
      trial(trials[0].cardId, trials[0].text, trials[0].text, 1400), // the repeat
    ]);
    expect(r.floorMs).toBe(1400);
    // (1400 + 3500 allowance) / 1.5 = 3266.7 → rounded to 3300 (contract #5:
    // mock-kana authors a 3500ms allowance — nothing to calculate in kana).
    expect(r.suggestedBaseTimerMs).toBe(3300);
    expect(r.appliedToSettings).toBe(true);

    // The deck is stamped and the NEXT drill reads the new timer.
    const deck = (await api.decks.list()).find((d) => d.id === 'mock-kana');
    expect(deck?.calibratedAtIso).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(deck?.settings.baseTimerMs).toBe(3300);
    const start = await api.session.start('mock-kana');
    expect(start.first?.timerMs).toBe(3300);
  });

  it('too few clean trials: suggestion NOT applied, deck stays uncalibrated', async () => {
    const api = createMockApi();
    const { sessionId } = await api.calibration.start('mock-kana');
    const r = await api.calibration.submit(sessionId, [
      trial('shi', 'shi', 'shi', 1000),
      trial('ka', 'ka', 'oops', 1000),
      trial('n', 'n', 'oops', 1000),
      trial('mock-hard', 'xyzzy', 'oops', 1000),
    ]);
    expect(r.appliedToSettings).toBe(false);
    const deck = (await api.decks.list()).find((d) => d.id === 'mock-kana');
    expect(deck?.calibratedAtIso).toBeNull();
    expect(deck?.settings.baseTimerMs).toBe(5000); // untouched
  });

  it('abort discards the run: settings and calibratedAtIso unchanged', async () => {
    const api = createMockApi();
    const { sessionId } = await api.calibration.start('mock-piano');
    await api.calibration.abort(sessionId);
    const deck = (await api.decks.list()).find((d) => d.id === 'mock-piano');
    expect(deck?.calibratedAtIso).toBeNull();
    expect(deck?.settings.baseTimerMs).toBe(7000);
    // The session is gone — a late submit is rejected.
    await expect(api.calibration.submit(sessionId, [])).rejects.toThrow(/unknown calibration/);
  });
});

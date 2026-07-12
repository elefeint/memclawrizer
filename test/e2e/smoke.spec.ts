/**
 * The one Playwright-Electron smoke test (DESIGN.md testing layer 4): drives
 * the PACKAGED app end-to-end to catch wiring rot — preload bridge, mem://
 * protocol, native addon packaging, attempt persistence. Game logic itself is
 * covered by the unit/DB layers; this test only proves the seams.
 *
 * Prereq: `npm run package` (out/memclawrizer-linux-x64/memclawrizer).
 * Run: `npm run test:e2e`.
 *
 * The session queue is shuffled in main with real Math.random, so the test
 * reads each prompt and answers adaptively: first presentation deliberately
 * wrong, everything else correct, then clears the re-queued retry.
 */
import { test, expect, _electron as electron } from '@playwright/test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../..');
const EXECUTABLE = path.join(ROOT, 'out/memclawrizer-linux-x64/memclawrizer');
const FIXTURE = path.join(ROOT, 'test/fixtures/mini.deckpack');

/** Prompt → accepted answer for the mini fixture (image card = 'dot'). */
const ANSWER_BY_TEXT: Record<string, string> = { か: 'ka', し: 'shi', ん: 'n' };

test('packaged app: drill with a wrong answer, re-queue, jar, and persisted attempts', async () => {
  test.skip(!existsSync(EXECUTABLE), `packaged app missing — run \`npm run package\` first`);

  const userData = mkdtempSync(path.join(tmpdir(), 'memclawrizer-smoke-'));
  const dbPath = path.join(userData, 'memclawrizer.duckdb');

  // Seed the temp DB through the normal import path, then release it —
  // DuckDB is single-writer and the app opens it next.
  {
    const { openDatabase } = await import('../../src/main/db');
    const { importPack } = await import('../../src/main/packs');
    const db = await openDatabase(dbPath);
    const result = await importPack(db.conn, FIXTURE, new Date());
    expect(result.cardsAdded).toBe(4);
    db.conn.closeSync();
    db.instance.closeSync();
  }

  const electronApp = await electron.launch({
    executablePath: EXECUTABLE,
    args: ['--no-sandbox'],
    env: { ...process.env, MEMCLAW_USERDATA: userData },
  });

  try {
    const page = await electronApp.firstWindow();

    // ---- home screen over the REAL api ----
    await expect(page.getByTestId('home-screen')).toBeVisible();
    const deckRow = page.getByTestId('deck-row');
    await expect(deckRow).toHaveCount(1);
    await expect(deckRow).toContainText('Mini fixture deck');
    await expect(deckRow).toContainText('0 due · 4 new · 4 cards');
    await expect(page.getByTestId('trophy-shelf')).toContainText('perfect sessions live here');

    // ---- calibration warm-up (F8: first drill of an uncalibrated deck) ----
    // Complete it for real: copy-type every shown answer until the result
    // beat, so calibration → applied timer → drill hand-off is smoke-covered.
    await page.getByRole('button', { name: 'Drill', exact: true }).click();
    await expect(page.locator('.calibrate')).toBeVisible();
    const calInput = page.locator('.calibrate-input');
    // The input is disabled between trials and after the last one, so poll:
    // type when ready, wait when not, stop at the result beat.
    for (let i = 0; i < 100; i++) {
      if (await page.locator('.calibrate-result').isVisible()) break;
      if (await calInput.isEnabled()) {
        const shown = (await page.locator('.calibrate-text').textContent()) ?? '';
        await calInput.fill(shown.trim());
        await calInput.press('Enter');
      } else {
        await page.waitForTimeout(100);
      }
    }
    await expect(page.locator('.calibrate-result')).toContainText('your floor');

    // ---- drill (auto-continues after the result beat) ----
    await expect(page.getByTestId('drill-screen')).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('jar').getByTestId('jar-slot')).toHaveCount(4);

    const input = page.getByTestId('answer-input');
    const prompt = page.getByTestId('prompt');
    const retryChip = page.locator('.retry-chip');

    /** Waits for a presentation and returns the correct answer for its card. */
    const readCard = async (): Promise<{ answer: string; isImage: boolean }> => {
      await expect(input).toBeEnabled();
      const img = prompt.locator('img.prompt-image');
      if (await img.count()) {
        // The mem:// seam: the BLOB-backed SVG must actually have rendered.
        await expect
          .poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth))
          .toBeGreaterThan(0);
        return { answer: 'dot', isImage: true };
      }
      const text = (await prompt.locator('.prompt-text').textContent()) ?? '';
      const answer = ANSWER_BY_TEXT[text.trim()];
      expect(answer, `unexpected prompt ${JSON.stringify(text)}`).toBeTruthy();
      return { answer, isImage: false };
    };

    const submit = async (text: string): Promise<void> => {
      await input.fill(text);
      await input.press('Enter');
    };

    let sawImageCard = false;
    let wrongAnswer = ''; // the correct answer of the card we failed on purpose

    // Four first attempts: fail the first card, clear the other three.
    for (let i = 0; i < 4; i++) {
      const card = await readCard();
      sawImageCard ||= card.isImage;
      if (i === 0) {
        wrongAnswer = card.answer;
        await submit('zzz');
        // Failure feedback shows the expected answer (the mnemonic channel).
        await expect(page.getByTestId('feedback')).toBeVisible();
        await expect(page.getByTestId('feedback')).toContainText(card.answer);
      } else {
        await submit(card.answer);
      }
    }

    // The failed card comes back as a retry (re-queued within the session).
    const retry = await readCard();
    sawImageCard ||= retry.isImage;
    expect(retry.answer).toBe(wrongAnswer);
    await expect(retryChip).toBeVisible();
    expect(sawImageCard).toBe(true); // the mem:// card was rendered somewhere above

    // All four first attempts are decided: the jar holds 3 prizes + 1 pebble.
    await expect(page.locator('[data-testid="jar-slot"].prize')).toHaveCount(3);
    await expect(page.locator('[data-testid="jar-slot"].pebble')).toHaveCount(1);

    // Clear the retry → imperfect session end: nothing kept, no trophy.
    await submit(retry.answer);
    await expect(page.locator('.drill-status')).toContainText('nothing kept');
    await expect(page.getByTestId('home-screen')).toBeVisible();
    await expect(page.getByTestId('trophy-shelf')).toContainText('perfect sessions live here');
  } finally {
    await electronApp.close();
  }

  // ---- the audit trail landed in the DB (open only after the app exited) ----
  await new Promise((r) => setTimeout(r, 500));
  const { DuckDBInstance } = await import('@duckdb/node-api');
  const instance = await DuckDBInstance.create(dbPath);
  const conn = await instance.connect();
  try {
    const attempts = (
      await conn.runAndReadAll(
        `SELECT outcome, is_first_of_session, box_before, box_after
         FROM attempts ORDER BY id`,
      )
    ).getRows();
    // 4 calibration copy-trials (min(10, deck size)) + 5 drill attempts.
    const calRows = attempts.filter((r) => r[0] === 'calibration');
    expect(calRows).toHaveLength(4);
    for (const r of calRows) {
      expect(r[1]).toBe(false); // never a first attempt
      expect(r[2]).toBe(r[3]); // never moves a box
    }
    const drill = attempts.filter((r) => r[0] !== 'calibration');
    expect(drill).toHaveLength(5);
    expect(drill.filter((r) => r[0] === 'correct')).toHaveLength(4);
    expect(drill.filter((r) => r[0] === 'wrong')).toHaveLength(1);
    expect(drill.filter((r) => r[1] === true)).toHaveLength(4); // first attempts
    const retryRow = drill.find((r) => r[1] === false);
    expect(retryRow?.[0]).toBe('correct'); // the cleared retry
    expect(retryRow?.[2]).toBe(retryRow?.[3]); // ...moved no box

    const sessions = (
      await conn.runAndReadAll(
        `SELECT coalesce(kind, 'drill'), perfect, ended_at IS NOT NULL, jar
         FROM sessions ORDER BY started_at`,
      )
    ).getRows();
    expect(sessions).toHaveLength(2);
    const calSession = sessions.find((r) => r[0] === 'calibration');
    expect(calSession?.[2]).toBe(true); // applied calibration → ended_at set
    const drillSession = sessions.find((r) => r[0] === 'drill');
    expect(drillSession?.[1]).toBe(false); // imperfect
    expect(drillSession?.[2]).toBe(true); // ended_at set
    expect(drillSession?.[3]).toBeNull(); // jar kept only for perfect sessions

    // The calibration actually tightened the deck's timer (playwright types
    // fast → floor is tiny → suggestion clamps to the 1500ms minimum).
    const settings = (
      await conn.runAndReadAll(`SELECT settings FROM decks`)
    ).getRows();
    expect(JSON.parse(String(settings[0][0])).baseTimerMs).toBe(1500);
  } finally {
    conn.closeSync();
    instance.closeSync();
    rmSync(userData, { recursive: true, force: true });
  }
});

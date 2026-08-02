/**
 * The drill screen — the arcade claw machine (F2).
 *
 * All game logic lives in the pure drill-machine; this module only renders
 * states, executes effects (audio, animations, api calls), and feeds events
 * back in. The claw's position along the rail IS the timer. Animations are
 * fire-and-forget; the machine advances on the duration constants in
 * timings.ts, never on animation `finished` promises.
 */
import { api } from '../api';
import { TESTIDS } from '../../shared/testids';
import type { CardView } from '../../shared/api';
import {
  DrillEvent,
  DrillState,
  Effect,
  initialState,
  reduce,
} from '../drill-machine';
import { PRIZE_POOL } from '../prize-pool';
import { ASSETS, pebbleNode, svgLayer } from '../svg-assets';
import * as audio from '../audio';
import * as T from '../timings';

export interface Nav {
  /** F8: `announce` shows one message in the home status line after mount. */
  home(announce?: string): void;
  drill(deckId: string, tags?: string[]): void;
  /** F8 copy-typing warm-up: 'pre-drill' flows into the drill (carrying the
   *  tag selection), 'recalibrate' returns home with an announcement. */
  calibrate(deckId: string, tags: string[] | undefined, mode: 'pre-drill' | 'recalibrate'): void;
  /** F9: the deck settings screen behind the deck row's gear icon. */
  deckSettings(deckId: string): void;
  /** F10b: the GLOBAL hall of fame; deckId only preselects the deck-detail
   *  picker (the Archived section's Stats link deep-links that way). */
  hallOfFame(deckId?: string): void;
}

const CLAW_W = 64; // claw.svg head width; travel = rail width − CLAW_W
const CABLE_LEN = 28; // claw.svg #cable base length; stretched by scaleY on drop
const PIT_ITEMS = 26;

const sleep = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms));

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

export async function mountDrill(
  root: HTMLElement,
  deckId: string,
  tags: string[] | undefined,
  nav: Nav,
): Promise<() => void> {
  // ---------------------------------------------------------------- DOM ----
  const screen = el('div', 'drill', TESTIDS.drillScreen);

  const railWrap = el('div', 'rail-wrap');
  const rail = el('div', 'rail');
  const claw = el('div', 'claw');
  // Asset B slices: trolley rides the rail (never drops), the cable stretches
  // (scaleY about its top), the head drops with the arm. The carried prize is
  // sandwiched between #finger-back and the hub + front-finger layer — that
  // overlap is what sells "grabbed".
  const clawTrolley = svgLayer(ASSETS.claw, ['trolley'], { className: 'claw-trolley' });
  const clawCable = svgLayer(ASSETS.claw, ['cable'], { className: 'claw-cable-svg', stretch: true });
  const clawArm = el('div', 'claw-arm');
  const clawHeadBack = svgLayer(ASSETS.claw, ['finger-back'], { className: 'claw-head-back' });
  const clawCarry = el('span', 'claw-carry');
  const clawHead = svgLayer(ASSETS.claw, ['hub', 'finger-left', 'finger-right', 'lamp'], {
    className: 'claw-head-front',
  });
  clawArm.append(clawHeadBack, clawCarry, clawHead);
  claw.append(clawTrolley, clawCable, clawArm);
  rail.appendChild(claw);
  railWrap.appendChild(rail);

  const body = el('div', 'drill-body');
  const center = el('div', 'drill-center');
  const hud = el('div', 'drill-hud');
  const remainingEl = el('span', 'remaining', TESTIDS.remaining);
  const retryChip = el('span', 'retry-chip');
  retryChip.textContent = 'retry — no prize';
  retryChip.hidden = true;
  hud.append(remainingEl, retryChip);

  const promptEl = el('div', 'prompt', TESTIDS.prompt);
  const input = el('input', 'answer-input', TESTIDS.answerInput);
  input.type = 'text';
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.setAttribute('aria-label', 'your answer');

  const feedbackEl = el('div', 'feedback', TESTIDS.feedback);
  feedbackEl.hidden = true;
  const statusEl = el('div', 'drill-status');
  statusEl.hidden = true;

  center.append(hud, promptEl, input, feedbackEl, statusEl);

  const jarSide = el('aside', 'jar-side');
  const jarEl = el('div', 'jar', TESTIDS.jar);
  const jarLid = el('div', 'jar-lid');
  jarLid.appendChild(svgLayer(ASSETS.jar, ['jar-lid'], { className: 'jar-lid-svg', stretch: true }));
  jarLid.hidden = true;
  const jarLabel = el('div', 'jar-label');
  jarLabel.appendChild(
    svgLayer(ASSETS.jar, ['jar-label-plate'], { className: 'jar-label-plate', stretch: true }),
  );
  const jarLabelText = el('span', 'jar-label-text');
  jarLabel.appendChild(jarLabelText);
  jarLabel.hidden = true;
  jarSide.append(jarLid, jarEl, jarLabel);

  body.append(center, jarSide);

  // Asset D slices: back wall, floor strip, glass reflection; emoji trinkets
  // are code-scattered between the floor and the glass.
  const pit = el('div', 'pit');
  const pitBack = svgLayer(ASSETS.pit, ['pit-back'], { className: 'pit-layer', stretch: true });
  const pitFloor = svgLayer(ASSETS.pit, ['pit-floor'], { className: 'pit-floor-svg', stretch: true });
  const pitGlass = svgLayer(ASSETS.pit, ['pit-glass'], { className: 'pit-layer pit-glass-svg', stretch: true });
  pit.append(pitBack, pitFloor, pitGlass);

  screen.append(railWrap, body, pit);
  root.appendChild(screen);

  // Scatter the pit with trinkets from the pool.
  for (let i = 0; i < PIT_ITEMS; i++) {
    addPitItem(PRIZE_POOL[Math.floor(Math.random() * PRIZE_POOL.length)], (i + 0.5) / PIT_ITEMS);
  }

  function addPitItem(text: string, xFrac = Math.random()): HTMLElement {
    const s = el('span', 'pit-item');
    s.textContent = text;
    s.style.left = `${4 + xFrac * 90}%`;
    s.style.bottom = `${6 + Math.random() * 34}px`;
    s.style.transform = `rotate(${Math.round(Math.random() * 50 - 25)}deg)`;
    pit.insertBefore(s, pitGlass);
    return s;
  }

  // ---------------------------------------------------------------- jar ----
  let slotEls: HTMLElement[] = [];

  function buildJar(n: number): void {
    jarEl.innerHTML = '';
    slotEls = [];
    // Asset A slices, sized by code: back wall behind the slots, glass +
    // rim in front of them (paint order = DOM order; all positioned).
    jarEl.appendChild(svgLayer(ASSETS.jar, ['jar-back'], { className: 'jar-layer', stretch: true }));
    const cell = 30;
    const rowH = 26;
    const pad = 12;
    const cols = Math.max(2, Math.min(7, Math.ceil(Math.sqrt(n))));
    // Honeycomb packing, filled bottom-up so the jar fills like a real jar.
    let placed = 0;
    let row = 0;
    const positions: { x: number; y: number }[] = [];
    while (placed < n) {
      const inRow = row % 2 === 0 ? cols : Math.max(1, cols - 1);
      for (let c = 0; c < inRow && placed < n; c++, placed++) {
        positions.push({ x: pad + c * cell + (row % 2 === 1 ? cell / 2 : 0), y: row });
      }
      row++;
    }
    const width = pad * 2 + cols * cell + cell / 2;
    const height = pad * 2 + row * rowH + 6;
    jarEl.style.width = `${width}px`;
    jarEl.style.height = `${Math.max(height, 70)}px`;
    jarLid.style.width = `${width * 0.7}px`;
    for (let i = 0; i < n; i++) {
      const s = el('div', 'jar-slot empty', TESTIDS.jarSlot);
      s.style.left = `${positions[i].x}px`;
      s.style.bottom = `${pad + positions[i].y * rowH}px`;
      jarEl.appendChild(s);
      slotEls.push(s);
    }
    jarEl.appendChild(svgLayer(ASSETS.jar, ['jar-front'], { className: 'jar-layer', stretch: true }));
    jarEl.appendChild(svgLayer(ASSETS.jar, ['jar-rim'], { className: 'jar-rim-svg', stretch: true }));
  }

  function setSlot(i: number, kind: 'prize' | 'pebble', prize?: string): void {
    const s = slotEls[i];
    if (!s) return;
    s.className = `jar-slot ${kind}`;
    s.textContent = '';
    if (kind === 'prize') s.textContent = prize ?? '';
    else s.appendChild(pebbleNode());
  }

  /**
   * Make the jar DOM match the machine's slots. Animations fill slots for
   * visual promptness, but their promises can stall (occluded window), so the
   * jar is re-synced from state whenever an animation phase ends.
   */
  function syncSlots(slots: DrillState['slots']): void {
    slots.forEach((slot, i) => {
      if (slot.kind === 'prize') setSlot(i, 'prize', slot.prize);
      else if (slot.kind === 'pebble') setSlot(i, 'pebble');
    });
  }

  // ----------------------------------------------------------- floaters ----
  const floaters = new Set<HTMLElement>();

  function spawnFloater(content: string | Node, from: { x: number; y: number }): HTMLElement {
    const f = el('span', 'floater');
    if (typeof content === 'string') f.textContent = content;
    else f.appendChild(content);
    f.style.left = `${from.x}px`;
    f.style.top = `${from.y}px`;
    document.body.appendChild(f);
    floaters.add(f);
    return f;
  }

  function removeFloater(f: HTMLElement): void {
    floaters.delete(f);
    f.remove();
  }

  function centerOf(r: DOMRect): { x: number; y: number } {
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  function flyText(
    content: string | Node,
    from: { x: number; y: number },
    to: { x: number; y: number },
    ms: number,
    fade = false,
  ): Promise<void> {
    const f = spawnFloater(content, from);
    const anim = f.animate(
      [
        { transform: 'translate(-50%, -50%)', opacity: 1 },
        {
          transform: `translate(calc(-50% + ${to.x - from.x}px), calc(-50% + ${to.y - from.y}px))`,
          opacity: fade ? 0 : 1,
        },
      ],
      { duration: ms, easing: 'cubic-bezier(.45,.05,.55,.95)' },
    );
    return anim.finished.then(
      () => removeFloater(f),
      () => removeFloater(f),
    );
  }

  // --------------------------------------------------------------- claw ----
  function clawTravelPx(): number {
    return Math.max(0, rail.clientWidth - CLAW_W);
  }

  /** Bumped on every claw reset so stalled animation chains bail out. */
  let clawGen = 0;

  function startClaw(ms: number): void {
    // Reset everything a stalled animation might have left behind.
    clawGen++;
    for (const a of clawArm.getAnimations()) a.cancel();
    for (const a of clawCable.getAnimations()) a.cancel();
    clawArm.style.transform = 'translateY(0px)';
    clawCable.style.transform = 'scaleY(1)';
    clawCarry.textContent = '';
    claw.classList.remove('fingers-closed', 'lamp-on');
    claw.classList.add('travelling'); // trolley wheels spin during travel
    claw.style.transition = 'none';
    claw.style.transform = 'translateX(0px)';
    void claw.offsetWidth; // reflow so the next transition starts from 0
    claw.style.transition = `transform ${ms}ms linear`;
    claw.style.transform = `translateX(${clawTravelPx()}px)`;
  }

  function freezeClaw(): void {
    const m = getComputedStyle(claw).transform;
    claw.style.transition = 'none';
    claw.style.transform = m === 'none' ? 'translateX(0px)' : m;
    claw.classList.remove('travelling', 'lamp-on');
  }

  const closeFingers = () => claw.classList.add('fingers-closed');
  const openFingers = () => claw.classList.remove('fingers-closed');

  function armDropPx(): number {
    const head = clawHead.getBoundingClientRect();
    const pitR = pit.getBoundingClientRect();
    return Math.max(40, pitR.top + pitR.height * 0.45 - head.bottom);
  }

  async function moveArm(toPx: number, ms: number, easing: string): Promise<void> {
    // Head translates; the braided cable stretches to match (scaleY about its
    // top edge — the method claw.svg declares it survives).
    const fromArm = clawArm.style.transform || 'translateY(0px)';
    const fromCable = clawCable.style.transform || 'scaleY(1)';
    const scale = (CABLE_LEN + toPx) / CABLE_LEN;
    const cableAnim = clawCable.animate(
      [{ transform: fromCable }, { transform: `scaleY(${scale})` }],
      { duration: ms, easing, fill: 'forwards' },
    );
    const anim = clawArm.animate([{ transform: fromArm }, { transform: `translateY(${toPx}px)` }], {
      duration: ms,
      easing,
      fill: 'forwards',
    });
    await anim.finished.catch(() => undefined);
    clawArm.style.transform = `translateY(${toPx}px)`;
    clawCable.style.transform = `scaleY(${scale})`;
    anim.cancel();
    cableAnim.cancel();
  }

  async function animateGrab(slotIndex: number, prize: string): Promise<void> {
    const gen = clawGen;
    const drop = armDropPx();
    await moveArm(drop, T.CLAW_DROP_MS, 'cubic-bezier(.5,0,1,1)');
    if (gen !== clawGen) return; // claw was reset for the next card meanwhile
    // Fingers close around the prize (front pair in front, back finger behind).
    clawCarry.textContent = prize;
    closeFingers();
    await sleep(T.CLAW_CLOSE_MS);
    if (gen !== clawGen) return;
    await moveArm(0, T.CLAW_RISE_MS, 'cubic-bezier(0,0,.5,1)');
    if (gen !== clawGen) return;
    const from = centerOf(clawCarry.getBoundingClientRect());
    clawCarry.textContent = '';
    openFingers(); // release over the jar
    const slot = slotEls[slotIndex];
    const to = slot ? centerOf(slot.getBoundingClientRect()) : from;
    await flyText(prize, from, to, T.PRIZE_FLY_MS);
    setSlot(slotIndex, 'prize', prize);
  }

  async function animateSlip(): Promise<void> {
    const gen = clawGen;
    const drop = armDropPx();
    const teased = PRIZE_POOL[Math.floor(Math.random() * PRIZE_POOL.length)];
    await moveArm(drop, T.CLAW_DROP_MS, 'cubic-bezier(.5,0,1,1)');
    if (gen !== clawGen) return;
    clawCarry.textContent = teased;
    closeFingers();
    await sleep(T.CLAW_CLOSE_MS);
    if (gen !== clawGen) return;
    await moveArm(drop * 0.45, T.CLAW_RISE_MS, 'cubic-bezier(0,0,.5,1)');
    if (gen !== clawGen) return;
    // Classic heartbreak: fingers re-open mid-hoist and it tumbles back.
    const from = centerOf(clawCarry.getBoundingClientRect());
    clawCarry.textContent = '';
    openFingers();
    const pitR = pit.getBoundingClientRect();
    const to = { x: from.x + (Math.random() * 60 - 30), y: pitR.top + pitR.height * 0.55 };
    void flyText(teased, from, to, T.PRIZE_FALL_MS, true);
    await moveArm(0, T.CLAW_RISE_MS, 'cubic-bezier(0,0,.5,1)');
  }

  async function animatePebble(slotIndex: number): Promise<void> {
    const slot = slotEls[slotIndex];
    if (!slot) return;
    const to = centerOf(slot.getBoundingClientRect());
    const jarR = jarEl.getBoundingClientRect();
    await flyText(pebbleNode('floater-pebble'), { x: to.x, y: jarR.top - 24 }, to, T.PEBBLE_MS);
    setSlot(slotIndex, 'pebble');
  }

  function animateSeal(): void {
    // Slots are already filled by the grabs; screw the lid on and label it.
    jarLid.hidden = false;
    jarLid.animate(
      [
        { transform: 'translateY(-26px) rotate(-150deg)', opacity: 0 },
        { transform: 'translateY(0) rotate(0deg)', opacity: 1 },
      ],
      { duration: 700, easing: 'cubic-bezier(0,.6,.4,1)', fill: 'forwards' },
    );
    jarEl.classList.add('sealed');
    jarLabelText.textContent = `${deckName} — ${new Date().toLocaleDateString()} — ${slotEls.length}`;
    jarLabel.hidden = false;
    jarLabel.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 600, delay: 500, fill: 'forwards' });
  }

  function animateEmpty(jar: (string | null)[]): void {
    // Quiet: prizes tumble back into the pit; pebbles sink out of sight.
    const pitR = pit.getBoundingClientRect();
    jar.forEach((prize, i) => {
      const slot = slotEls[i];
      if (!slot) return;
      const from = centerOf(slot.getBoundingClientRect());
      if (prize !== null) {
        const xFrac = Math.random();
        const to = { x: pitR.left + pitR.width * (0.05 + xFrac * 0.9), y: pitR.top + pitR.height * 0.6 };
        window.setTimeout(() => {
          void flyText(prize, from, to, T.PRIZE_FALL_MS).then(() => {
            addPitItem(prize, xFrac);
          });
        }, i * T.EMPTY_STAGGER_MS);
      }
      window.setTimeout(() => {
        slot.className = 'jar-slot empty';
        slot.textContent = '';
      }, i * T.EMPTY_STAGGER_MS + 60);
    });
  }

  // -------------------------------------------------------- answer audio ----
  // One reused element (F6): assigning a new src implicitly stops whatever
  // was still playing from the previous card's resolution. <audio> element
  // loading is the supported path for mem:// — fetch()/WebAudio-decode fails
  // by Chromium scheme restriction. Deliberately no ducking: the ding and
  // the spoken syllable coexisting is honest.
  const answerAudio = new Audio();

  function playAnswerAudio(url: string): void {
    answerAudio.pause();
    answerAudio.src = url;
    answerAudio.currentTime = 0;
    void answerAudio.play().catch(() => undefined);
  }

  // ------------------------------------------------------------- prompt ----
  let audioPlayer: HTMLAudioElement | null = null;

  function renderPrompt(card: CardView): void {
    promptEl.innerHTML = '';
    audioPlayer = null;
    if (card.promptType === 'text') {
      const t = el('div', 'prompt-text');
      t.textContent = card.promptText ?? '';
      promptEl.appendChild(t);
    } else if (card.promptType === 'image') {
      const img = el('img', 'prompt-image');
      if (card.mediaUrl) img.src = card.mediaUrl;
      img.alt = '';
      promptEl.appendChild(img);
    } else {
      // Audio prompt: replay button; auto-plays once on presentation.
      const btn = el('button', 'prompt-audio');
      btn.type = 'button';
      btn.textContent = '🔊 replay';
      if (card.mediaUrl) {
        audioPlayer = new Audio(card.mediaUrl);
        void audioPlayer.play().catch(() => undefined);
      }
      btn.addEventListener('click', () => {
        if (audioPlayer) {
          audioPlayer.currentTime = 0;
          void audioPlayer.play().catch(() => undefined);
        }
        input.focus();
      });
      promptEl.appendChild(btn);
    }
    retryChip.hidden = !card.isRetry;
  }

  function showFeedback(expected: string[], hint: string | null): void {
    feedbackEl.innerHTML = '';
    const ans = el('div', 'feedback-expected');
    ans.textContent = expected.join('  /  ');
    feedbackEl.appendChild(ans);
    if (hint) {
      const h = el('div', 'feedback-hint');
      h.textContent = hint;
      feedbackEl.appendChild(h);
    }
    feedbackEl.hidden = false;
  }

  // ------------------------------------------------------------ machine ----
  const deps = { rng: Math.random, prizePool: PRIZE_POOL };
  let state: DrillState = initialState;
  let disposed = false;
  let rafId = 0;
  let animTimer: number | undefined;
  let exitTimer: number | undefined;

  function scheduleAnimationDone(ms: number): void {
    if (animTimer !== undefined) window.clearTimeout(animTimer);
    animTimer = window.setTimeout(() => {
      animTimer = undefined;
      dispatch({ type: 'ANIMATION_DONE' });
    }, ms);
  }

  function dispatch(event: DrillEvent): void {
    if (disposed) return;
    const r = reduce(state, event, deps);
    const prev = state;
    state = r.state;
    render(prev);
    execute(r.effects);
  }

  function render(prev: DrillState): void {
    if (prev.remaining !== state.remaining || prev.phase === 'idle') {
      remainingEl.textContent = state.remaining === 1 ? '1 card left' : `${state.remaining} cards left`;
    }
    if (state.phase === 'presenting' && state.card && state.card !== prev.card) {
      renderPrompt(state.card);
      input.value = '';
    }
    const typing = state.phase === 'presenting';
    if (input.disabled === typing) {
      input.disabled = !typing;
      if (typing) input.focus();
    }
    if (prev.phase === 'feedback' && state.phase !== 'feedback') {
      feedbackEl.hidden = true;
    }
    if (prev.phase === 'presenting' && state.phase !== 'presenting') {
      freezeClaw();
    }
    const animPhases = ['grab', 'slip', 'feedback'];
    if (animPhases.includes(prev.phase) && state.phase !== prev.phase && state.phase !== 'aborting') {
      syncSlots(state.slots);
    }
    if (state.phase !== prev.phase && (state.phase === 'done' || state.phase === 'aborted')) {
      if (state.phase === 'aborted' || (state.sessionEnd && !state.sessionEnd.perfect)) {
        statusEl.textContent = 'nothing kept — the pit waits for tomorrow';
        statusEl.hidden = false;
      } else if (state.sessionEnd?.perfect) {
        statusEl.textContent = 'sealed.';
        statusEl.hidden = false;
      }
      exitTimer = window.setTimeout(
        () => nav.home(),
        state.sessionEnd?.perfect ? T.EXIT_DELAY_MS * 2 : T.EXIT_DELAY_MS,
      );
    }
  }

  function execute(effects: Effect[]): void {
    for (const eff of effects) {
      switch (eff.type) {
        case 'startTimer':
          startClaw(eff.ms);
          break;
        case 'playTick':
          audio.playTick(eff.rate);
          // Final-25% acceleration lights the claw's accent lamp.
          if (eff.rate > 1) claw.classList.add('lamp-on');
          break;
        case 'playDing':
          audio.playDing();
          break;
        case 'playSuccessChirp':
          audio.playSuccessChirp();
          break;
        case 'playSealChime':
          audio.playSealChime();
          break;
        case 'animateGrab':
          void animateGrab(eff.slotIndex, eff.prize);
          scheduleAnimationDone(T.GRAB_MS);
          break;
        case 'animateSlip':
          void animateSlip();
          scheduleAnimationDone(T.SLIP_MS);
          break;
        case 'animatePebble':
          void animatePebble(eff.slotIndex);
          break; // runs inside the feedback window; showFeedback owns the clock
        case 'showFeedback':
          showFeedback(eff.expected, eff.hint);
          scheduleAnimationDone(T.FEEDBACK_MS);
          break;
        case 'playAnswerAudio':
          playAnswerAudio(eff.url);
          break;
        case 'animateSeal':
          animateSeal();
          scheduleAnimationDone(T.SEAL_MS);
          break;
        case 'animateEmpty':
          animateEmpty(eff.jar);
          scheduleAnimationDone(T.EMPTY_MS);
          break;
        case 'submitAnswer': {
          const sid = state.sessionId;
          if (sid) {
            void api.session
              .answer(sid, eff.req)
              .then((result) => dispatch({ type: 'RESULT', result }));
          }
          break;
        }
        case 'abortSession':
          if (state.sessionId) void api.session.abort(state.sessionId);
          break;
        case 'sessionComplete':
          break; // terminal render handles the exit
      }
    }
  }

  // -------------------------------------------------------------- input ----
  function onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      dispatch({ type: 'ABORT' });
    } else if (e.key === 'Enter' && !input.disabled) {
      e.preventDefault();
      dispatch({ type: 'SUBMIT', text: input.value });
    }
  }
  window.addEventListener('keydown', onKeyDown);

  function tick(): void {
    dispatch({ type: 'TICK', nowMs: performance.now(), inputText: input.value });
  }

  function loop(): void {
    tick();
    rafId = requestAnimationFrame(loop);
  }

  // rAF freezes when the window is occluded; this keeps the deadline honest.
  let fallbackTimer: number | undefined;

  // -------------------------------------------------------------- start ----
  const deckName = (await api.decks.list()).find((d) => d.id === deckId)?.name ?? deckId;
  const start = await api.session.start(deckId, tags && tags.length > 0 ? { tags } : undefined);

  if (!start.first) {
    promptEl.innerHTML = '';
    const msg = el('div', 'prompt-text nothing-due');
    msg.textContent = 'nothing due — come back tomorrow';
    promptEl.appendChild(msg);
    input.disabled = true;
    remainingEl.textContent = '';
    exitTimer = window.setTimeout(() => nav.home(), 1600);
  } else {
    buildJar(start.queueLength);
    dispatch({ type: 'START', session: start });
    rafId = requestAnimationFrame(loop);
    fallbackTimer = window.setInterval(tick, T.TICK_FALLBACK_MS);
    input.focus();
  }

  return () => {
    disposed = true;
    cancelAnimationFrame(rafId);
    if (fallbackTimer !== undefined) window.clearInterval(fallbackTimer);
    if (animTimer !== undefined) window.clearTimeout(animTimer);
    if (exitTimer !== undefined) window.clearTimeout(exitTimer);
    window.removeEventListener('keydown', onKeyDown);
    answerAudio.pause();
    answerAudio.removeAttribute('src');
    for (const f of [...floaters]) f.remove();
    floaters.clear();
    screen.remove();
  };
}

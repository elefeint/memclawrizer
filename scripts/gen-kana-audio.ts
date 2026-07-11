/**
 * ONE-TIME AUTHORING SCRIPT — never a build dependency, never in `gen:decks`.
 *
 * Synthesizes one .ogg per unique kana entry (104 morae; hiragana and
 * katakana share the same files) into scripts/audio/kana/<id>.ogg, where
 * <id> is the TABLE entry id from gen-kana.ts ('shi', 'kya', 'di', ...).
 * The TTS is fed the KANA text (しゃ), never romaji. gen-kana.ts embeds
 * whatever this directory contains; the outputs are committed so goldens
 * and CI stay deterministic without any TTS installed.
 *
 *   npx tsx scripts/gen-kana-audio.ts
 *
 * Engine priority:
 *   1. open_jtalk (best open Japanese TTS; voice from /usr/share/hts-voice,
 *      dictionary from /var/lib/mecab/dic/open-jtalk)
 *   2. espeak-ng -v ja
 *   3. neither → prints the install command and exits 1 WITHOUT writing.
 *
 * Every wav is post-processed through ~/.local/bin/ffmpeg: mono, 22050 Hz,
 * silence-trimmed both ends, loudness-normalized, encoded to ogg with
 * bitexact flags — re-runs are byte-identical given the same engine+ffmpeg.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { TABLE } from './gen-kana';

const OUT_DIR = path.resolve(__dirname, 'audio', 'kana');
const FFMPEG = path.join(os.homedir(), '.local', 'bin', 'ffmpeg');

const JTALK_DIC = '/var/lib/mecab/dic/open-jtalk/naist-jdic';
const JTALK_VOICE_DIR = '/usr/share/hts-voice';

/**
 * Speech speed (open_jtalk -r, 1.0 = normal). Isolated morae at 1.0 come out
 * 0.14–0.26 s — too quick to catch during play (Elena, 2026-07-10). 0.5
 * roughly doubles them.
 */
const JTALK_RATE = '0.5';

function onPath(bin: string): boolean {
  try {
    execFileSync('which', [bin], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/** First .htsvoice under /usr/share/hts-voice (nitech-jp-atr503-m001 etc.). */
function findHtsVoice(): string | null {
  if (!existsSync(JTALK_VOICE_DIR)) return null;
  const stack = [JTALK_VOICE_DIR];
  while (stack.length > 0) {
    const dir = stack.pop() as string;
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) stack.push(p);
      else if (entry.name.endsWith('.htsvoice')) return p;
    }
  }
  return null;
}

type Engine = { name: string; toWav: (kana: string, wavPath: string, tmpDir: string) => void };

function pickEngine(): Engine | null {
  const jtalkBin = ['open_jtalk', 'open-jtalk'].find(onPath);
  const voice = findHtsVoice();
  if (jtalkBin && voice && existsSync(JTALK_DIC)) {
    return {
      name: `${jtalkBin} (${path.basename(voice)})`,
      toWav: (kana, wavPath, tmpDir) => {
        const txt = path.join(tmpDir, 'in.txt');
        writeFileSync(txt, kana + '\n');
        execFileSync(
          jtalkBin,
          ['-x', JTALK_DIC, '-m', voice, '-r', JTALK_RATE, '-ow', wavPath, txt],
          { stdio: 'pipe' },
        );
      },
    };
  }
  if (onPath('espeak-ng')) {
    return {
      name: 'espeak-ng -v ja',
      toWav: (kana, wavPath) => {
        execFileSync('espeak-ng', ['-v', 'ja', '-w', wavPath, kana], { stdio: 'pipe' });
      },
    };
  }
  return null;
}

/**
 * Trim silence both ends, normalize loudness, then re-pad: 60 ms lead-in
 * (playback start latency must not swallow the consonant onset) and a 150 ms
 * tail so the clip breathes instead of cutting dead. Bitexact ogg.
 */
function wavToOgg(wavPath: string, oggPath: string): void {
  execFileSync(
    FFMPEG,
    [
      '-y',
      '-i', wavPath,
      '-af',
      // Lead trim stays tight (-45dB: crisp onset). Tail trim is looser
      // (-50dB) so the vowel decay survives, but capped at 0.8s of speech —
      // at -60dB some clips kept >1s of HTS noise-floor breath.
      'silenceremove=start_periods=1:start_threshold=-45dB,' +
        'areverse,silenceremove=start_periods=1:start_threshold=-50dB,areverse,' +
        'atrim=0:0.8,loudnorm=I=-18:TP=-2,adelay=60:all=1,apad=pad_dur=0.15',
      '-ac', '1',
      '-ar', '22050',
      '-c:a', 'libvorbis',
      '-fflags', '+bitexact',
      '-flags:a', '+bitexact',
      '-map_metadata', '-1',
      oggPath,
    ],
    { stdio: 'pipe' },
  );
}

function main(): void {
  if (!existsSync(FFMPEG)) {
    console.error(`[gen-kana-audio] ffmpeg not found at ${FFMPEG} — nothing written.`);
    process.exit(1);
  }
  const engine = pickEngine();
  if (engine === null) {
    console.error(
      '[gen-kana-audio] no Japanese TTS engine found — nothing written.\n' +
        'Install one (open-jtalk strongly preferred for kana):\n' +
        '  sudo apt install open-jtalk open-jtalk-mecab-naist-jdic hts-voice-nitech-jp-atr503-m001\n' +
        'or, as a fallback:\n' +
        '  sudo apt install espeak-ng',
    );
    process.exit(1);
  }
  console.log(`[gen-kana-audio] engine: ${engine.name}`);

  mkdirSync(OUT_DIR, { recursive: true });
  const tmpDir = path.join(os.tmpdir(), `gen-kana-audio-${process.pid}`);
  mkdirSync(tmpDir, { recursive: true });
  try {
    let done = 0;
    for (const entry of TABLE) {
      const wavPath = path.join(tmpDir, `${entry.id}.wav`);
      const oggPath = path.join(OUT_DIR, `${entry.id}.ogg`);
      engine.toWav(entry.hira, wavPath, tmpDir);
      wavToOgg(wavPath, oggPath);
      done++;
    }
    console.log(`[gen-kana-audio] wrote ${done} ogg files to ${OUT_DIR}`);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

if (require.main === module) main();

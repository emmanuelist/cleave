/**
 * Generates the narration audio, one file per segment, then a single track
 * padded so each block starts exactly where its segment does.
 *
 * ElevenLabs when ELEVENLABS_API_KEY is set (their free tier covers this
 * script comfortably). macOS `say` otherwise, which is dated but proves the
 * pipeline without a key.
 *
 *   ELEVENLABS_API_KEY=... npm run voice
 *   npm run voice                       # local fallback
 *
 * Pick a voice:  curl -H "xi-api-key: $KEY" https://api.elevenlabs.io/v1/voices
 * then set ELEVENLABS_VOICE_ID.
 */
import { NARRATION } from "./narration.js";
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { config as dotenv } from "dotenv";

dotenv({ path: new URL("../.env", import.meta.url).pathname, quiet: true });

const KEY = process.env.ELEVENLABS_API_KEY;
// "Brian" — a calm, mid-range narration voice. Override with ELEVENLABS_VOICE_ID.
const VOICE = process.env.ELEVENLABS_VOICE_ID ?? "nPczCjzI2devNBz1zQrb";
const MODEL = process.env.ELEVENLABS_MODEL ?? "eleven_multilingual_v2";
const OUT = "film/voice";

async function eleven(text: string, file: string) {
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE}`, {
    method: "POST",
    headers: { "xi-api-key": KEY!, "content-type": "application/json" },
    body: JSON.stringify({
      text,
      model_id: MODEL,
      // Higher stability keeps a technical read even; a little style keeps it
      // from sounding flat across three minutes.
      voice_settings: { stability: 0.45, similarity_boost: 0.75, style: 0.12, use_speaker_boost: true },
    }),
  });
  if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${(await res.text()).slice(0, 180)}`);
  writeFileSync(file, Buffer.from(await res.arrayBuffer()));
}

function local(text: string, file: string) {
  const aiff = file.replace(/\.mp3$/, ".aiff");
  execFileSync("say", ["-v", process.env.SAY_VOICE ?? "Daniel", "-r", "168", "-o", aiff, text]);
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", aiff, "-c:a", "libmp3lame", "-b:a", "192k", file]);
}

const dur = (f: string) =>
  Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f]).toString().trim());

async function main() {
  mkdirSync(OUT, { recursive: true });

  // Segments always run longer than their planned window: navigation and the
  // wait-for-paint happen BEFORE the hold starts, and the explorer alone adds
  // ~12s. Padding to the plan would drift the voice out of the picture, so we
  // pad to what was actually filmed.
  let measured: Record<string, number> = {};
  const manifest = "film/segments.json";
  if (existsSync(manifest)) {
    measured = JSON.parse(readFileSync(manifest, "utf8"));
    console.log("Locking to measured segment lengths from film/segments.json");
  } else {
    console.log("No film/segments.json yet: using planned windows. Run film:cut first for exact sync.");
  }
  console.log(KEY ? "Voice: ElevenLabs" : "Voice: macOS say (no ELEVENLABS_API_KEY set)");

  let cursor = 0;
  const parts: string[] = [];
  for (const b of NARRATION) {
    const f = `${OUT}/${b.segment}.mp3`;
    if (KEY) await eleven(b.text, f); else local(b.text, f);
    const window = measured[b.segment] ?? b.secs;
    const d = dur(f);
    const over = d > window;
    console.log(`  ${b.segment.padEnd(16)} ${d.toFixed(1)}s spoken / ${window.toFixed(1)}s segment ${over ? "  OVERRUNS" : ""}`);

    // Pad each block out to its segment length so the voice stays locked to
    // the picture. Drift compounds; a per-block pad cannot.
    const padded = `${OUT}/${b.segment}-padded.mp3`;
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", f,
      "-af", `apad=whole_dur=${window.toFixed(3)}`, "-c:a", "libmp3lame", "-b:a", "192k", padded]);
    parts.push(padded);
    cursor += window;
  }

  const list = `${OUT}/list.txt`;
  writeFileSync(list, parts.map((p) => `file '${p.split("/").pop()}'`).join("\n"));
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", list,
    "-c:a", "libmp3lame", "-b:a", "192k", "film/narration.mp3"]);
  console.log(`\n  film/narration.mp3  (${dur("film/narration.mp3").toFixed(1)}s, target ${cursor}s)`);
  if (!existsSync("film/cleave-silent.mp4")) console.log("  (run npm run film && npm run film:cut, then npm run film:mix)");
}

main().catch((e) => { console.error("\nvoice failed:", e.message ?? e); process.exit(1); });

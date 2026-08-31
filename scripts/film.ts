/**
 * Films the demo.
 *
 * This automates the CAMERA, not the content. Every frame is the real app,
 * driven by the real engine, against real Somnia markets. Nothing is stubbed
 * and no footage is synthesised. What it buys is determinism: exact beats,
 * no mouse fumbling, and a re-run if anything changes.
 *
 * Segments map to docs/run-of-show.md. Record voice separately, then:
 *   npm run film:cut          # assemble segments
 *   npm run film:voice a.m4a  # mux narration over the cut
 *
 *   npm run film              # needs `npm run serve -- --live --short` warm
 */
import { chromium, type Page } from "playwright";
import { mkdirSync, rmSync } from "node:fs";
import { CUES, CAPTION_RUNTIME } from "./captions.js";

const APP = process.env.APP_URL ?? "http://localhost:5173";
const SITE = process.env.SITE_URL ?? "https://cleave-ecru.vercel.app";
const TX = "https://shannon-explorer.somnia.network/tx/0xb785b4f03a6f0fcc68be476ad4dd617dd667ef21d6d3fac1531d91cb1116afd3";
const OUT = "film";
const W = 1440, H = 900;

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Wait until the page actually has content. Fixed sleeps guess; this checks.
 *  The Somnia explorer takes ~14s to paint and ~22s to settle, so a 4s sleep
 *  filmed a blank white page. */
async function untilPainted(page: Page, minChars = 400, timeoutMs = 40_000) {
  const t0 = Date.now();
  for (;;) {
    const n = await page.evaluate(() => (document.body?.innerText ?? "").trim().length).catch(() => 0);
    if (n >= minChars) { process.stdout.write(`  painted (${n} chars, ${((Date.now() - t0) / 1000).toFixed(1)}s)\n`); return; }
    if (Date.now() - t0 > timeoutMs) { process.stdout.write(`  ! never painted after ${timeoutMs / 1000}s\n`); return; }
    await wait(500);
  }
}

/** Hold on a page for `secs`, doing nothing. The app is live; it moves on its own. */
async function hold(page: Page, secs: number, label: string) {
  process.stdout.write(`  ${label} … ${secs}s\n`);
  await wait(secs * 1000);
}

/** Captions are injected AFTER the page settles, so their clock starts when
 *  the shot actually begins rather than when navigation did. */
async function captions(page: Page, name: string) {
  const cues = CUES[name];
  if (!cues?.length) return;
  await page.evaluate(CAPTION_RUNTIME.replace("__CUES__", JSON.stringify(cues)));
}

async function segment(name: string, secs: number, go: (p: Page) => Promise<void>) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: W, height: H },
    recordVideo: { dir: `${OUT}/${name}`, size: { width: W, height: H } },
    deviceScaleFactor: 1,
  });
  const page = await ctx.newPage();
  console.log(`\n▸ ${name}`);
  await go(page);
  await captions(page, name);
  await hold(page, secs, "rolling");
  await ctx.close();     // flushes the video
  await browser.close();
}

async function main() {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });

  // 1. The claim, live, on the public site.
  await segment("01-landing", 21, async (p) => {
    await p.goto(SITE, { waitUntil: "domcontentloaded" });
    await untilPainted(p, 800);
    await wait(5000);                       // let the live chain read populate
  });

  // 2. The instrument working. Long enough to catch leg events and a rollover,
  //    which arrive every ~30s at --short. This is the body of the demo.
  await segment("02-instrument", 70, async (p) => {
    await p.goto(APP, { waitUntil: "domcontentloaded" });
    await untilPainted(p, 600);
    await wait(2000);
  });

  // 3. The activity log alone, where the refusal is legible.
  await segment("03-activity", 23, async (p) => {
    await p.goto(APP, { waitUntil: "domcontentloaded" });
    await wait(2500);
    await p.evaluate(() => document.querySelector(".events")?.scrollIntoView({ block: "center" }));
  });

  // 4. Settlement, on the explorer.
  // The explorer is slow. Wait for it to actually paint, then hold, so the
  // settlement beat is legible rather than a white rectangle.
  await segment("04-settlement", 31, async (p) => {
    await p.goto(TX, { waitUntil: "domcontentloaded", timeout: 45_000 }).catch(() => {});
    await untilPainted(p, 700, 45_000);
    await wait(2500);
  });

  console.log(`\nSegments in ${OUT}/. Next: npm run film:cut`);
}

main().catch((e) => { console.error(e); process.exit(1); });

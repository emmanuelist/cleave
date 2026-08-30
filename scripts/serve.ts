/**
 * Serves the interface and streams engine state over SSE.
 *
 * The page is a VIEW onto the loop that trades, not a second implementation.
 * With --live it quotes for real; without, it reads live books and shows what it
 * would quote. Either way every number on screen comes off the chain.
 *
 *   npm run serve                 # read-only, real books
 *   npm run serve -- --live       # quoting for real
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { runMaker, emptyState, type EngineState } from "../src/engine.js";

const PORT = Number(process.env.PORT ?? 5173);
const live = process.argv.includes("--live");
const short = process.argv.includes("--short");
const minutes = Number(process.argv[process.argv.indexOf("--minutes") + 1]) || 120;
const WEB = new URL("../web/", import.meta.url).pathname;

let state: EngineState = emptyState();
const clients = new Set<import("node:http").ServerResponse>();

const broadcast = (s: EngineState) => {
  state = s;
  const frame = `data: ${JSON.stringify(s)}\n\n`;
  for (const c of clients) { try { c.write(frame); } catch { clients.delete(c); } }
};

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml",
};

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);

  if (url.pathname === "/api/stream") {
    res.writeHead(200, {
      "content-type": "text/event-stream", "cache-control": "no-cache",
      connection: "keep-alive", "x-accel-buffering": "no",
    });
    res.write(`data: ${JSON.stringify(state)}\n\n`);
    clients.add(res);
    req.on("close", () => clients.delete(res));
    return;
  }

  const file = url.pathname === "/" ? "index.html" : url.pathname.replace(/^\//, "");
  try {
    const body = await readFile(join(WEB, file));
    res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404, { "content-type": "text/plain" }); res.end("not found");
  }
}).listen(PORT, () => {
  console.log(`\n  Cleave — http://localhost:${PORT}`);
  console.log(`  mode: ${live ? "LIVE (quoting for real)" : "read-only (real books, no orders)"}\n`);
});

runMaker({ live, minutes, size: Number(process.env.QUOTE_SIZE ?? 5), short }, broadcast)
  .catch((e) => { console.error("engine stopped:", e?.message ?? e); });

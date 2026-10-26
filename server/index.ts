// One small server: POST /api/turn (the model call) plus the web app.
// Dev:  Vite runs inside this process in middleware mode, so one command does both.
// Prod: serves the built files from dist/.

import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { runTurn, validateTurnInput } from "./model.ts";

try {
  process.loadEnvFile(".env");
} catch {
  // No .env file. Real environment variables still work.
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const prod = process.argv.includes("--prod");
const port = Number(process.env.PORT ?? 8080);

const app = express();
app.use(express.json({ limit: "64kb" }));

// Each call spends money on the API key, so cap it per IP. In memory only; a real
// deployment would use a shared store.
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 30;
const hits = new Map<string, number[]>();
function allowed(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length <= MAX_PER_WINDOW;
}

app.post("/api/turn", async (req, res) => {
  if (!allowed(req.ip ?? "unknown")) {
    res.status(429).json({ ok: false, error: "Too many model calls. Wait a minute." });
    return;
  }
  let input;
  try {
    input = validateTurnInput(req.body);
  } catch (error) {
    res
      .status(400)
      .json({ ok: false, error: error instanceof Error ? error.message : "Bad request" });
    return;
  }
  res.json(await runTurn(input));
});

if (prod) {
  const dist = path.join(root, "dist");
  app.use(express.static(dist));
  app.use((_req, res) => res.sendFile(path.join(dist, "index.html")));
} else {
  const { createServer } = await import("vite");
  const vite = await createServer({ root, server: { middlewareMode: true }, appType: "spa" });
  app.use(vite.middlewares);
}

app.listen(port, () => {
  console.log(`Meridian Operator on http://localhost:${port} (${prod ? "production" : "dev"})`);
});

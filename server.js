#!/usr/bin/env node
import express from "express";
import { createServer } from "node:http";
import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { loadConfig } from "./src/config.js";
import { runCouncil } from "./src/council.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const HISTORY_DIR = join(__dirname, "history");
const UI_DIST = join(__dirname, "ui-dist");
const PORT = process.env.PORT || 3001;

await mkdir(HISTORY_DIR, { recursive: true });

const app = express();
app.use(express.json());

// Serve built UI in production
app.use(express.static(UI_DIST));

// In-memory store: runId -> { clients: Set<res>, events: [], result, error, done }
const runs = new Map();

// --- Config ---
app.get("/api/config", async (_req, res) => {
  try {
    const { config } = await loadConfig();
    const providers = Object.entries(config.providers).map(([name, p]) => ({
      name,
      enabled: p.enabled !== false,
      displayName: p.displayName || name,
      command: p.command
    }));
    res.json({
      providers,
      conference: config.conference,
      judge: config.judge,
      reviewer: config.reviewer
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Start a run ---
app.post("/api/run", async (req, res) => {
  const { question, providers: selectedProviders, rounds, proposals } = req.body;
  if (!question?.trim()) {
    return res.status(400).json({ error: "question is required" });
  }

  const id = `${Date.now()}-${randomBytes(4).toString("hex")}`;
  runs.set(id, { clients: new Set(), events: [], result: null, error: null, done: false });

  res.json({ id });

  // Load config and apply overrides
  const { config: baseConfig } = await loadConfig();
  const config = structuredClone(baseConfig);

  if (Array.isArray(selectedProviders) && selectedProviders.length > 0) {
    for (const [name, p] of Object.entries(config.providers)) {
      p.enabled = selectedProviders.includes(name);
    }
  }
  if (Number.isInteger(rounds) && rounds > 0) config.conference.discussionRounds = rounds;
  if (Number.isInteger(proposals) && proposals > 1) config.conference.proposalCount = proposals;

  const push = (event) => {
    const run = runs.get(id);
    if (!run) return;
    run.events.push(event); // buffer so late-connecting clients get the full history
    const data = `data: ${JSON.stringify(event)}\n\n`;
    for (const client of run.clients) {
      client.write(data);
    }
  };

  const hooks = {
    onFanoutStart: (names) => push({ type: "fanout_start", names }),
    onProviderComplete: (result) => push({ type: "provider_done", result }),
    onEvaluationStart: (name) => push({ type: "eval_start", name }),
    onEvaluationComplete: (result) => push({ type: "eval_done", result }),
    onSynthesisStart: (name) => push({ type: "synth_start", name }),
    onSynthesisComplete: (result) => push({ type: "synth_done", result }),
    onConferenceStage: (stage, message) => push({ type: "stage", stage, message }),
    onConferenceParticipant: (result) => push({ type: "participant", result })
  };

  const saveHistory = async (record) => {
    await writeFile(join(HISTORY_DIR, `${id}.json`), JSON.stringify(record, null, 2));
  };

  const closeClients = () => {
    const runEntry = runs.get(id);
    if (runEntry) for (const client of runEntry.clients) client.end();
  };

  try {
    const result = await runCouncil(question, config, hooks);
    const run = runs.get(id);
    if (run) { run.result = result; run.done = true; }
    push({ type: "done", run: result });
    await saveHistory({ id, ts: new Date().toISOString(), question, status: "done", result });
    closeClients();
  } catch (err) {
    const run = runs.get(id);
    if (run) { run.error = err.message; run.done = true; }
    push({ type: "error", message: err.message });
    await saveHistory({ id, ts: new Date().toISOString(), question, status: "error", error: err.message, result: null });
    closeClients();
  }
});

// --- SSE stream ---
app.get("/api/run/:id/events", (req, res) => {
  const run = runs.get(req.params.id);

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  if (!run) {
    res.write(`data: ${JSON.stringify({ type: "error", message: "Run not found" })}\n\n`);
    res.end();
    return;
  }

  // Replay all buffered events so late-connecting clients catch up
  for (const event of run.events) {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  }

  if (run.done) {
    res.end();
    return;
  }

  run.clients.add(res);
  req.on("close", () => run.clients.delete(res));
});

// --- History ---
app.get("/api/history", async (_req, res) => {
  try {
    const files = await readdir(HISTORY_DIR).catch(() => []);
    const items = await Promise.all(
      files
        .filter((f) => f.endsWith(".json"))
        .map(async (f) => {
          const raw = await readFile(join(HISTORY_DIR, f), "utf8");
          const { id, ts, question, status, error, result } = JSON.parse(raw);
          const winnerProposal = result?.proposals?.find(
            (p) => p.ok && p.proposalId === result?.election?.winner
          );
          // Build a short snippet from the winning answer or synthesis
          const snippetSource =
            winnerProposal?.data?.answer ??
            result?.synthesis?.text ??
            result?.participants?.[0]?.text ??
            error ??
            "";
          const snippet = snippetSource.replace(/[#*`>\-_]/g, "").replace(/\s+/g, " ").trim().slice(0, 120);
          return {
            id,
            ts,
            question,
            status: status ?? "done",
            mode: result?.mode ?? "synthesis",
            snippet,
            winnerTitle: winnerProposal?.data?.title ?? null
          };
        })
    );
    items.sort((a, b) => (b.ts > a.ts ? 1 : -1));
    res.json(items);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/history/:id", async (req, res) => {
  try {
    const raw = await readFile(join(HISTORY_DIR, `${req.params.id}.json`), "utf8");
    res.json(JSON.parse(raw));
  } catch {
    res.status(404).json({ error: "Not found" });
  }
});

// SPA fallback (serve index.html for any non-API route)
app.get("*", (_req, res) => {
  res.sendFile(join(UI_DIST, "index.html"), (err) => {
    if (err) res.status(404).send("UI not built. Run: npm run build");
  });
});

createServer(app).listen(PORT, () => {
  console.log(`Consultant server running at http://localhost:${PORT}`);
  console.log(`For dev UI: npm run dev:ui  (proxies to this server)`);
});

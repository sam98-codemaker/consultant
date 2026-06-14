import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

const MAX_BUFFER_BYTES = 10 * 1024 * 1024;

function parseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function textFromClaude(stdout) {
  const payload = parseJson(stdout);
  if (payload?.is_error || payload?.error) {
    throw new Error(payload.result || payload.error?.message || payload.error);
  }
  return payload?.result ?? payload?.response ?? stdout.trim();
}

function textFromGemini(stdout) {
  const payload = parseJson(stdout);
  if (payload?.error) {
    throw new Error(payload.error?.message || payload.error);
  }
  return payload?.response ?? payload?.result ?? payload?.text ?? stdout.trim();
}

function textFromGrok(stdout) {
  const payload = parseJson(stdout);
  if (payload?.error) {
    throw new Error(payload.error?.message || payload.error);
  }
  return payload?.result ?? payload?.response ?? payload?.text ?? stdout.trim();
}

export const providerDefinitions = {
  claude: {
    command: "claude",
    args: ({ prompt, model }) => [
      "-p",
      "--output-format",
      "json",
      "--permission-mode",
      "dontAsk",
      "--tools",
      "",
      "--no-session-persistence",
      ...(model ? ["--model", model] : []),
      prompt
    ],
    parse: textFromClaude
  },
  gemini: {
    command: "gemini",
    args: ({ prompt, model }) => [
      "-p",
      prompt,
      "-o",
      "json",
      "--approval-mode",
      "plan",
      "--skip-trust",
      ...(model ? ["--model", model] : [])
    ],
    parse: textFromGemini
  },
  grok: {
    command: "grok",
    args: ({ prompt, model }) => [
      "-p",
      prompt,
      "--output-format",
      "json",
      "--permission-mode",
      "plan",
      "--no-memory",
      "--no-subagents",
      "--disable-web-search",
      ...(model ? ["--model", model] : [])
    ],
    parse: textFromGrok
  },
  codex: {
    command: "codex",
    usesOutputFile: true,
    args: ({ prompt, model, outputFile, cwd }) => [
      "exec",
      "--sandbox",
      "read-only",
      "--ephemeral",
      "--skip-git-repo-check",
      "--color",
      "never",
      "-C",
      cwd,
      "-o",
      outputFile,
      ...(model ? ["--model", model] : []),
      prompt
    ],
    parse: (stdout, output) => output?.trim() || stdout.trim()
  }
};

export function createProvider(name, options = {}) {
  const definition = providerDefinitions[name];
  if (!definition) {
    throw new Error(`Unknown provider: ${name}`);
  }

  return {
    name,
    displayName: options.displayName || formatDisplayName(name, options.model),
    command: options.command || definition.command,
    model: options.model,
    definition
  };
}

export async function runProvider(provider, prompt, options = {}) {
  const startedAt = Date.now();
  const timeoutMs = options.timeoutMs ?? 180_000;
  const cwd = await mkdtemp(join(tmpdir(), `model-council-${provider.name}-`));
  const outputFile = join(cwd, "final-response.txt");
  const args = provider.definition.args({
    prompt,
    model: provider.model,
    outputFile,
    cwd
  });

  try {
    const execution = await spawnAndCollect(provider.command, args, {
      cwd,
      timeoutMs,
      env: process.env
    });

    let output = "";
    if (provider.definition.usesOutputFile) {
      output = await readFile(outputFile, "utf8").catch(() => "");
    }

    if (execution.code !== 0) {
      throw new Error(
        execution.stderr.trim() ||
          execution.stdout.trim() ||
          `${provider.command} exited with code ${execution.code}`
      );
    }

    const text = provider.definition.parse(execution.stdout, output);
    if (!text) {
      throw new Error(`${provider.name} returned an empty response`);
    }

    return {
      provider: provider.name,
      displayName: provider.displayName,
      model: provider.model,
      ok: true,
      text,
      durationMs: Date.now() - startedAt
    };
  } catch (error) {
    return {
      provider: provider.name,
      displayName: provider.displayName,
      model: provider.model,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - startedAt
    };
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

function formatDisplayName(name, model) {
  const providerName = {
    claude: "Claude",
    gemini: "Gemini",
    grok: "Grok",
    codex: "OpenAI Codex"
  }[name] ?? name;

  return model ? `${providerName} (${model})` : `${providerName} (configured default)`;
}

function spawnAndCollect(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 2_000).unref();
      finishReject(new Error(`${command} timed out after ${options.timeoutMs}ms`));
    }, options.timeoutMs);

    function append(current, chunk) {
      const next = current + chunk.toString();
      if (Buffer.byteLength(next) > MAX_BUFFER_BYTES) {
        child.kill("SIGTERM");
        finishReject(new Error(`${command} produced more than 10 MB of output`));
      }
      return next;
    }

    function finishReject(error) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    }

    child.on("error", finishReject);
    child.stdout.on("data", (chunk) => {
      stdout = append(stdout, chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr = append(stderr, chunk);
    });
    child.on("close", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, signal, stdout, stderr });
    });
  });
}

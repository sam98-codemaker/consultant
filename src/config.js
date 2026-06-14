import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { providerDefinitions } from "./providers.js";

export const defaultConfig = {
  providers: Object.fromEntries(
    Object.entries(providerDefinitions).map(([name, definition]) => [
      name,
      { enabled: true, command: definition.command }
    ])
  ),
  judge: "codex",
  reviewer: null,
  timeoutMs: 180_000,
  synthesis: true,
  refinement: true,
  conference: {
    enabled: true,
    discussionRounds: 2,
    proposalCount: 3,
    jsonRepairRetries: 1
  }
};

export async function loadConfig(explicitPath) {
  const candidates = [
    explicitPath,
    process.env.MODEL_COUNCIL_CONFIG,
    resolve("council.config.json"),
    join(homedir(), ".config", "model-council", "config.json")
  ].filter(Boolean);

  let userConfig = {};
  let source = null;
  for (const candidate of candidates) {
    if (await exists(candidate)) {
      source = candidate;
      userConfig = JSON.parse(await readFile(candidate, "utf8"));
      break;
    }
  }

  return {
    config: mergeConfig(defaultConfig, userConfig),
    source
  };
}

export function mergeConfig(base, override) {
  const providers = { ...base.providers };
  for (const [name, provider] of Object.entries(override.providers ?? {})) {
    providers[name] = { ...(providers[name] ?? {}), ...provider };
  }

  return {
    ...base,
    ...override,
    providers,
    conference: {
      ...base.conference,
      ...override.conference
    }
  };
}

async function exists(path) {
  try {
    await access(path, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

#!/usr/bin/env node

import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { loadConfig } from "./config.js";
import { runCouncil } from "./council.js";

const args = parseArgs(process.argv.slice(2));
const loaded = await loadConfig(args.config);
const config = applyCliOverrides(loaded.config, args);

if (args.help) {
  printHelp();
  process.exit(0);
}

if (args.list) {
  printProviders(config, loaded.source);
  process.exit(0);
}

if (args.question) {
  await askCouncil(args.question, config);
} else {
  await runShell(config, loaded.source);
}

async function runShell(activeConfig, configSource) {
  const rl = createInterface({ input, output });
  output.write("Model Council Shell\n");
  output.write(`Config: ${configSource ?? "defaults"}\n`);
  output.write("Commands: /providers, /help, /exit\n\n");

  try {
    while (true) {
      const question = (await rl.question("council> ")).trim();
      if (!question) continue;
      if (question === "/exit" || question === "/quit") break;
      if (question === "/help") {
        printHelp();
        continue;
      }
      if (question === "/providers") {
        printProviders(activeConfig, configSource);
        continue;
      }
      await askCouncil(question, activeConfig);
    }
  } finally {
    rl.close();
  }
}

async function askCouncil(question, activeConfig) {
  output.write("\n");
  const response = await runCouncil(question, activeConfig, {
    onFanoutStart(names) {
      output.write(`Consulting ${names.join(", ")} in parallel...\n`);
    },
    onProviderComplete(result) {
      const status = result.ok ? "done" : `failed: ${oneLine(result.error)}`;
      output.write(`  ${result.provider}: ${status} (${formatDuration(result.durationMs)})\n`);
    },
    onEvaluationStart(name) {
      output.write(`Reviewing candidate quality with ${name}...\n`);
    },
    onEvaluationComplete(result) {
      if (!result.ok) {
        output.write(`  review failed, using fast synthesis: ${oneLine(result.error)}\n`);
      }
    },
    onSynthesisStart(name) {
      output.write(`Writing final answer with ${name}...\n`);
    },
    onSynthesisComplete(result) {
      if (!result.ok) {
        output.write(`  synthesis failed: ${oneLine(result.error)}\n`);
      }
    },
    onConferenceStage(stage, message) {
      output.write(`[${stage}] ${message}\n`);
    },
    onConferenceParticipant(result) {
      if (!result.ok) {
        output.write(`  ${result.displayName ?? result.provider}: failed: ${oneLine(result.error)}\n`);
      }
    }
  });

  output.write("\n");
  if (response.mode === "conference") {
    output.write(`${response.report}\n\n`);
    return;
  }

  if (response.synthesis?.ok) {
    output.write(`${response.synthesis.text}\n\n`);
    return;
  }

  const successes = response.results.filter((result) => result.ok);
  if (successes.length === 0) {
    output.write("All providers failed.\n");
    for (const result of response.results) {
      output.write(`- ${result.provider}: ${oneLine(result.error)}\n`);
    }
    output.write("\n");
    return;
  }

  for (const result of successes) {
    output.write(`## ${result.provider}\n${result.text}\n\n`);
  }
}

function parseArgs(argv) {
  const parsed = { providers: null, questionParts: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--help" || value === "-h") parsed.help = true;
    else if (value === "--list") parsed.list = true;
    else if (value === "--no-synthesis") parsed.noSynthesis = true;
    else if (value === "--fast") parsed.fast = true;
    else if (value === "--config") parsed.config = argv[++index];
    else if (value === "--judge") parsed.judge = argv[++index];
    else if (value === "--reviewer") parsed.reviewer = argv[++index];
    else if (value === "--rounds") parsed.rounds = Number(argv[++index]);
    else if (value === "--proposals") parsed.proposals = Number(argv[++index]);
    else if (value === "--providers") parsed.providers = argv[++index]?.split(",");
    else if (value === "--timeout") parsed.timeoutMs = Number(argv[++index]);
    else parsed.questionParts.push(value);
  }
  parsed.question = parsed.questionParts.join(" ").trim();
  return parsed;
}

function applyCliOverrides(base, parsed) {
  const config = structuredClone(base);
  if (parsed.providers) {
    for (const [name, provider] of Object.entries(config.providers)) {
      provider.enabled = parsed.providers.includes(name);
    }
  }
  if (parsed.judge) config.judge = parsed.judge;
  if (parsed.reviewer) config.reviewer = parsed.reviewer;
  if (parsed.noSynthesis) config.synthesis = false;
  if (parsed.fast) {
    config.refinement = false;
    config.conference.enabled = false;
  }
  if (Number.isInteger(parsed.rounds) && parsed.rounds > 0) {
    config.conference.discussionRounds = parsed.rounds;
  }
  if (Number.isInteger(parsed.proposals) && parsed.proposals > 1) {
    config.conference.proposalCount = parsed.proposals;
  }
  if (Number.isFinite(parsed.timeoutMs) && parsed.timeoutMs > 0) {
    config.timeoutMs = parsed.timeoutMs;
  }
  return config;
}

function printProviders(config, source) {
  output.write(`Config: ${source ?? "defaults"}\n`);
  for (const [name, provider] of Object.entries(config.providers)) {
    const marker = provider.enabled === false ? "off" : "on";
    const judge = config.judge === name ? ", judge" : "";
    const reviewer = config.reviewer === name ? ", reviewer" : "";
    output.write(`- ${name}: ${marker}${judge}${reviewer} (${provider.command})\n`);
  }
  output.write(
    `Mode: ${config.conference?.enabled === false ? "fast synthesis" : `conference (${config.conference.discussionRounds} rounds)`}\n`
  );
}

function printHelp() {
  output.write(`Usage:
  npm start
  node src/cli.js "What caused the 2008 financial crisis?"
  node src/cli.js --providers claude,gemini,codex --judge claude "Question"

Options:
  --providers <names>   Comma-separated provider names
  --judge <name>        Provider used for synthesis
  --reviewer <name>     Provider used to evaluate candidate quality
  --rounds <count>      Number of model discussion rounds
  --proposals <count>   Number of competing final proposals
  --fast                Skip conference rounds and synthesize immediately
  --no-synthesis        Print individual answers only
  --timeout <ms>        Timeout per provider call
  --config <path>       JSON configuration file
  --list                Show configured providers
  -h, --help            Show this help
`);
}

function formatDuration(durationMs) {
  return `${(durationMs / 1000).toFixed(1)}s`;
}

function oneLine(value = "") {
  return value.replace(/\s+/g, " ").trim().slice(0, 240);
}

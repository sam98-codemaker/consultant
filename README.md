# Model Council Shell

A local terminal conference hall where multiple installed AI models answer,
challenge one another, elect temporary roles, prepare competing proposals, and
rank the final options.

The initial adapters support:

- Claude Code
- Gemini CLI
- Grok
- OpenAI Codex CLI

## Important boundary

This project uses each CLI's existing authenticated session. It does not read,
copy, store, or exchange browser cookies, passwords, OAuth tokens, or API keys.

A consumer subscription is not automatically an API subscription. For a hosted
multi-user product, use each provider's official OAuth or API integration and
follow its terms. Do not ask users to paste session cookies.

## Run

Requires Node.js 20 or newer and at least one authenticated provider CLI.

```bash
cd /Users/sampath/Projects/model-council-shell
npm start
```

Ask one question without entering the interactive shell:

```bash
node src/cli.js "Compare PostgreSQL and MySQL for a new SaaS product."
```

Choose members and the synthesizer:

```bash
node src/cli.js \
  --providers claude,gemini,grok,codex \
  --judge codex \
  "What are the strongest arguments for and against this architecture?"
```

Control the conference length and number of proposals:

```bash
node src/cli.js \
  --providers gemini,grok,codex \
  --rounds 2 \
  --proposals 3 \
  "Review this technical architecture."
```

Use the lower-latency legacy synthesizer:

```bash
node src/cli.js --fast "Your question"
```

List configuration:

```bash
node src/cli.js --list
```

## Configure

Copy `council.config.example.json` to `council.config.json`, then change enabled
providers, exact display names, model IDs, discussion rounds, proposal count,
or the timeout.

Configuration is loaded in this order:

1. `--config <path>`
2. `MODEL_COUNCIL_CONFIG`
3. `./council.config.json`
4. `~/.config/model-council/config.json`
5. Built-in defaults

Example provider override:

```json
{
  "providers": {
    "claude": {
      "enabled": true,
      "command": "/Users/me/.local/bin/claude",
      "displayName": "Claude Sonnet",
      "model": "sonnet"
    }
  },
  "reviewer": "gemini",
  "refinement": true,
  "conference": {
    "enabled": true,
    "discussionRounds": 2,
    "proposalCount": 3
  },
  "timeoutMs": 240000
}
```

Set `displayName` to the exact model/version you selected when the CLI does not
report it programmatically. Without that configuration, the report explicitly
labels the participant as a configured default rather than guessing a version.

## Conference protocol

1. **Independent opening positions:** Every model answers before seeing the
   others.
2. **Named model identity:** The transcript uses configured model names such as
   Claude Sonnet, Gemini Pro, Grok, and OpenAI Codex.
3. **Claim ledger:** A facilitator extracts distinct claims and records support,
   opposition, and verification status.
4. **Structured discussion:** Models address claims, challenge named models,
   answer prior challenges, and may revise their positions.
5. **Dynamic role election:** Models vote for temporary researcher, critic,
   reasoner, fact-checker, and synthesizer roles. Self-votes are discarded.
6. **Confidence tracking:** Each model records its revised position, whether it
   changed, why it changed, and confidence from 0 to 100.
7. **Evidence handling:** Claims can be marked as requiring external
   verification. Cross-model agreement is never labelled as verified evidence.
8. **Competing proposals:** Elected and selected models produce complete final
   proposals.
9. **Ranked voting:** Models rank proposals using Borda-style points. A model's
   own proposal is removed from its ballot.
10. **Transparent report:** The output includes openings, claims, roles,
    confidence, position changes, vote reasons, the winner, minority proposals,
    unresolved evidence requests, and the discussion transcript.

Agreement between models is useful evidence, but it is not proof. Models may
share training data, retrieval sources, or the same incorrect assumption.

## Cost and latency

Conference mode makes substantially more model calls than fast mode. With `N`
models, `R` discussion rounds, and `P` proposals, a typical conference uses
approximately:

```text
N openings + 1 claim pass + (N × R) discussion calls + P proposals + N votes
```

Start with two or three models and one discussion round while developing:

```bash
node src/cli.js \
  --providers gemini,grok,codex \
  --rounds 1 \
  --proposals 2 \
  "Your question"
```

## Product direction

The CLI-based MVP validates orchestration and user experience. A production
service should replace subprocess adapters with provider API adapters and add:

- Provider OAuth/API-key connections using OS keychain or encrypted secrets
- Streaming responses and cancellation
- Cost and token budgets
- Per-provider model selection
- Search and citation normalization
- Provider-backed external evidence retrieval and source-quality scoring
- Persistent conversations
- Evaluation datasets and answer-quality scoring
- Rate-limit handling, retries, audit logs, and privacy controls
- A deterministic evidence layer for factual verification

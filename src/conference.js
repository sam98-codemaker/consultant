import { createProvider, runProvider } from "./providers.js";

const ROLES = ["researcher", "critic", "reasoner", "fact_checker", "synthesizer"];

export async function runConference(question, config, hooks = {}) {
  const providers = enabledProviders(config);
  if (providers.length === 0) throw new Error("No providers are enabled");

  hooks.onConferenceStage?.("opening", `Opening positions from ${providers.length} models`);
  const openings = await parallelRound(providers, (provider) =>
    buildOpeningPrompt(question, provider.displayName), config, hooks
  );
  const participants = openings.filter((result) => result.ok);
  if (participants.length === 0) {
    return emptyConference(question, openings);
  }
  if (participants.length === 1) {
    return singleParticipantConference(question, openings, participants[0]);
  }

  const facilitator = selectFacilitator(config, providers, participants);
  hooks.onConferenceStage?.("claims", `Building claim ledger with ${facilitator.displayName}`);
  const claimResult = await runJsonRound(
    facilitator,
    buildClaimLedgerPrompt(question, participants),
    config
  );
  let claims = normalizeClaims(claimResult.data, participants);

  let discussion = [];
  const rounds = Math.max(1, Number(config.conference?.discussionRounds) || 1);
  for (let round = 1; round <= rounds; round += 1) {
    hooks.onConferenceStage?.("discussion", `Discussion round ${round} of ${rounds}`);
    const roundResults = await parallelRound(
      providersForParticipants(providers, participants),
      (provider) =>
        buildDiscussionPrompt(question, provider, participants, claims, discussion, round),
      config,
      hooks,
      true
    );
    discussion.push(
      ...roundResults.map((result) => ({ ...result, discussionRound: round }))
    );
  }

  claims = applyDiscussionStances(claims, discussion, participants);
  const roleElection = tallyRoleVotes(discussion, participants);
  hooks.onConferenceStage?.("roles", "Dynamic roles elected from model votes");

  hooks.onConferenceStage?.("proposals", "Preparing competing final proposals");
  const proposalAuthors = selectProposalAuthors(
    providersForParticipants(providers, participants),
    roleElection,
    config
  );
  const proposalResults = await parallelRound(
    proposalAuthors,
    (provider) =>
      buildProposalPrompt(question, provider, participants, claims, discussion, roleElection),
    config,
    hooks,
    true
  );
  const proposals = proposalResults.map((proposal, index) => ({
    ...proposal,
    proposalId: `P${index + 1}`
  }));

  hooks.onConferenceStage?.("voting", "Models ranking competing proposals");
  const votes = await parallelRound(
    providersForParticipants(providers, participants),
    (provider) => buildVotePrompt(question, provider, proposals),
    config,
    hooks,
    true
  );
  const election = tallyRankedVotes(proposals, votes);

  return {
    mode: "conference",
    question,
    participants,
    failures: openings.filter((result) => !result.ok),
    claims,
    discussion,
    roleElection,
    proposals,
    votes,
    election,
    report: buildConferenceReport({
      question,
      participants,
      failures: openings.filter((result) => !result.ok),
      claims,
      discussion,
      roleElection,
      proposals,
      votes,
      election
    })
  };
}

export function parseStructuredJson(text) {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  for (const candidate of [trimmed, fenced, extractJsonObject(trimmed)].filter(Boolean)) {
    try {
      return JSON.parse(candidate);
    } catch {
      // Try the next representation.
    }
  }
  return null;
}

export function tallyRoleVotes(discussion, participants) {
  const eligible = new Set(participants.map((participant) => participant.displayName));
  const counts = Object.fromEntries(ROLES.map((role) => [role, new Map()]));

  for (const response of latestDiscussionByModel(discussion)) {
    for (const role of ROLES) {
      const nominee = resolveEligibleName(response.data.roleVotes?.[role], eligible);
      if (!nominee || nominee === response.displayName) continue;
      counts[role].set(nominee, (counts[role].get(nominee) ?? 0) + 1);
    }
  }

  return Object.fromEntries(
    ROLES.map((role) => {
      const ranking = [...counts[role].entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([model, votes]) => ({ model, votes }));
      const tied = ranking.filter((item) => item.votes === ranking[0]?.votes);
      return [
        role,
        {
          winner: tied.length === 1 ? tied[0].model : null,
          tied: tied.map((item) => item.model),
          ranking
        }
      ];
    })
  );
}

export function applyDiscussionStances(claims, discussion, participants) {
  const participantNames = new Set(
    participants.map((participant) => participant.displayName)
  );
  const latest = latestDiscussionByModel(discussion);

  return claims.map((claim) => {
    const supporters = new Set(claim.supporters);
    const opponents = new Set(claim.opponents);
    let needsExternalVerification =
      claim.verificationStatus === "external verification required";

    for (const response of latest) {
      if (!participantNames.has(response.displayName)) continue;
      const stance = (response.data.stances ?? []).find(
        (item) => item.claimId === claim.id
      )?.position;
      if (stance === "support") {
        supporters.add(response.displayName);
        opponents.delete(response.displayName);
      } else if (stance === "oppose") {
        opponents.add(response.displayName);
        supporters.delete(response.displayName);
      } else if (stance === "needs_evidence") {
        needsExternalVerification = true;
      }
    }

    return {
      ...claim,
      supporters: [...supporters],
      opponents: [...opponents],
      verificationStatus: needsExternalVerification
        ? "external verification required"
        : claim.verificationStatus
    };
  });
}

export function tallyRankedVotes(proposals, votes) {
  const validProposals = proposals.filter((proposal) => proposal.ok);
  const proposalIds = new Set(validProposals.map((proposal) => proposal.proposalId));
  const scores = new Map(validProposals.map((proposal) => [proposal.proposalId, 0]));
  const firstChoices = new Map(validProposals.map((proposal) => [proposal.proposalId, 0]));
  const acceptedVotes = [];

  for (const vote of votes.filter((item) => item.ok && item.data)) {
    const ranking = [...new Set(vote.data.ranking ?? [])].filter((id) => proposalIds.has(id));
    const ownProposal = validProposals.find(
      (proposal) => proposal.displayName === vote.displayName
    )?.proposalId;
    const eligibleRanking = ranking.filter((id) => id !== ownProposal);
    if (eligibleRanking.length === 0) continue;

    eligibleRanking.forEach((id, index) => {
      scores.set(id, scores.get(id) + eligibleRanking.length - index);
    });
    firstChoices.set(
      eligibleRanking[0],
      firstChoices.get(eligibleRanking[0]) + 1
    );
    acceptedVotes.push({
      voter: vote.displayName,
      ranking: eligibleRanking,
      reason: vote.data.reason ?? "",
      confidence: clampConfidence(vote.data.confidence)
    });
  }

  const ranking = validProposals
    .map((proposal) => ({
      proposalId: proposal.proposalId,
      author: proposal.displayName,
      score: scores.get(proposal.proposalId),
      firstChoices: firstChoices.get(proposal.proposalId)
    }))
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.firstChoices - a.firstChoices ||
        a.proposalId.localeCompare(b.proposalId)
    );

  const tied = ranking.filter(
    (item) =>
      item.score === ranking[0]?.score &&
      item.firstChoices === ranking[0]?.firstChoices
  );
  return {
    winner: tied.length === 1 ? tied[0].proposalId : null,
    tied: tied.map((item) => item.proposalId),
    ranking,
    acceptedVotes
  };
}

async function parallelRound(providers, promptBuilder, config, hooks, structured = false) {
  return Promise.all(
    providers.map(async (provider) => {
      const result = structured
        ? await runJsonRound(provider, promptBuilder(provider), config)
        : await runProvider(provider, promptBuilder(provider), {
            timeoutMs: config.timeoutMs
          });
      hooks.onConferenceParticipant?.(result);
      return result;
    })
  );
}

async function runJsonRound(provider, prompt, config) {
  const result = await runProvider(provider, prompt, { timeoutMs: config.timeoutMs });
  if (!result.ok) return result;
  const data = parseStructuredJson(result.text);
  if (data) return { ...result, data };

  if ((config.conference?.jsonRepairRetries ?? 1) < 1) {
    return { ...result, ok: false, error: "Model did not return valid JSON" };
  }

  const repaired = await runProvider(
    provider,
    `Convert the following malformed response into valid JSON only.
Preserve its meaning. Do not add markdown fences, commentary, or new claims.

MALFORMED RESPONSE:
${result.text}`,
    { timeoutMs: config.timeoutMs }
  );
  if (!repaired.ok) return repaired;
  const repairedData = parseStructuredJson(repaired.text);
  return repairedData
    ? { ...repaired, data: repairedData, repaired: true }
    : { ...repaired, ok: false, error: "Model did not return valid JSON after repair" };
}

function enabledProviders(config) {
  return Object.entries(config.providers)
    .filter(([, providerConfig]) => providerConfig.enabled !== false)
    .map(([name, providerConfig]) => createProvider(name, providerConfig));
}

function providersForParticipants(providers, participants) {
  const successful = new Set(participants.map((participant) => participant.provider));
  return providers.filter((provider) => successful.has(provider.name));
}

function selectFacilitator(config, providers, participants) {
  const preferred = config.reviewer || config.judge;
  return (
    providers.find(
      (provider) =>
        provider.name === preferred &&
        participants.some((participant) => participant.provider === provider.name)
    ) ?? providersForParticipants(providers, participants)[0]
  );
}

function buildOpeningPrompt(question, displayName) {
  return `You are ${displayName}, participating in a model conference.
Answer independently before seeing other models. Do not call tools or execute commands.
Give your recommendation, reasoning, assumptions, important uncertainties, and confidence from 0 to 100.

QUESTION:
${question}`;
}

function buildClaimLedgerPrompt(question, participants) {
  return `Act only as the facilitator of a model conference.
Extract the smallest useful set of distinct, decision-relevant claims from the opening positions.
Do not decide which model is correct. Return JSON only:
{"claims":[{"id":"C1","text":"...","supporters":["exact model name"],"opponents":["exact model name"],"needsExternalVerification":true,"verificationReason":"..."}]}

QUESTION:
${question}

OPENING POSITIONS:
${formatNamedResponses(participants)}`;
}

function buildDiscussionPrompt(question, provider, participants, claims, priorRound, round) {
  return `You are ${provider.displayName} in discussion round ${round}.
Review the named opening positions and claim ledger. Engage with specific claims and models.
Changing your position is good when justified. Do not vote for yourself for any role.
External verification means checking reliable sources outside this model conference; model agreement is not verification.

Return JSON only:
{
  "stances":[{"claimId":"C1","position":"support|oppose|uncertain|needs_evidence","reason":"..."}],
  "challenges":[{"to":"exact model name","claimId":"C1","question":"..."}],
  "answers":[{"from":"exact model name","claimId":"C1","answer":"..."}],
  "revisedPosition":"...",
  "positionChanged":false,
  "changeReason":"...",
  "confidence":75,
  "roleVotes":{
    "researcher":"exact other model name",
    "critic":"exact other model name",
    "reasoner":"exact other model name",
    "fact_checker":"exact other model name",
    "synthesizer":"exact other model name"
  },
  "roleVoteReason":"..."
}

QUESTION:
${question}

OPENING POSITIONS:
${formatNamedResponses(participants)}

CLAIM LEDGER:
${JSON.stringify(claims)}

PRIOR DISCUSSION:
${JSON.stringify(priorRound.filter((item) => item.ok).map(publicRoundData))}`;
}

function buildProposalPrompt(question, provider, participants, claims, discussion, roles) {
  const electedRoles = Object.entries(roles)
    .filter(([, election]) => election.winner === provider.displayName)
    .map(([role]) => role);
  return `You are ${provider.displayName}. Prepare a complete competing final proposal.
The conference elected you for these temporary roles: ${electedRoles.join(", ") || "none"}.
Use the discussion, preserve meaningful caveats, and do not claim disputed facts are verified.

Return JSON only:
{"title":"...","answer":"...","minorityConditions":["..."],"unverifiedClaims":["C1"],"confidence":80}

QUESTION:
${question}

OPENINGS:
${formatNamedResponses(participants)}

CLAIMS:
${JSON.stringify(claims)}

DISCUSSION:
${JSON.stringify(discussion.filter((item) => item.ok).map(publicRoundData))}`;
}

function buildVotePrompt(question, provider, proposals) {
  const available = proposals
    .filter((proposal) => proposal.ok)
    .map((proposal) => ({
      proposalId: proposal.proposalId,
      author: proposal.displayName,
      proposal: proposal.data
    }));
  return `You are ${provider.displayName}. Rank the competing proposals for the user's question.
Judge correctness, relevance, completeness, reasoning, practical usefulness, and treatment of uncertainty.
Do not include your own proposal in the ranking. Return JSON only:
{"ranking":["P2","P1"],"reason":"...","mainWeakness":"...","confidence":80,"evidenceThatWouldChangeVote":"..."}

QUESTION:
${question}

PROPOSALS:
${JSON.stringify(available)}`;
}

function normalizeClaims(data, participants) {
  const names = new Set(participants.map((participant) => participant.displayName));
  const claims = Array.isArray(data?.claims) ? data.claims : [];
  return claims.slice(0, 20).map((claim, index) => ({
    id: `C${index + 1}`,
    text: String(claim.text ?? "").trim(),
    supporters: (claim.supporters ?? []).filter((name) => names.has(name)),
    opponents: (claim.opponents ?? []).filter((name) => names.has(name)),
    verificationStatus: claim.needsExternalVerification
      ? "external verification required"
      : "cross-model assessment only",
    verificationReason: String(claim.verificationReason ?? "").trim()
  })).filter((claim) => claim.text);
}

function selectProposalAuthors(providers, roleElection, config) {
  const desired = Math.min(
    providers.length,
    Math.max(2, Number(config.conference?.proposalCount) || 3)
  );
  const electedNames = [
    roleElection.synthesizer?.winner,
    roleElection.reasoner?.winner,
    roleElection.critic?.winner
  ].filter(Boolean);
  const selected = [];
  for (const name of electedNames) {
    const provider = providers.find((item) => item.displayName === name);
    if (provider && !selected.includes(provider)) selected.push(provider);
  }
  for (const provider of providers) {
    if (selected.length >= desired) break;
    if (!selected.includes(provider)) selected.push(provider);
  }
  return selected.slice(0, desired);
}

function buildConferenceReport(data) {
  const winner = data.proposals.find(
    (proposal) => proposal.proposalId === data.election.winner
  );
  const minority = data.proposals.filter(
    (proposal) => proposal.ok && proposal.proposalId !== data.election.winner
  );
  const changed = data.discussion.filter(
    (item) => item.ok && item.data?.positionChanged
  );
  const unverified = data.claims.filter(
    (claim) => claim.verificationStatus === "external verification required"
  );

  return `# Model Conference Report

## Question
${data.question}

## Participants
${data.participants.map((item) => `- ${item.displayName}`).join("\n")}

## Opening Positions
${data.participants.map((item) => `### ${item.displayName}\n${item.text}`).join("\n\n")}

## Winning Conclusion
${winner?.data?.answer ?? formatTieConclusion(data)}

## Vote Result
${data.election.ranking.map((item, index) => `${index + 1}. ${item.proposalId} by ${item.author}: ${item.score} points, ${item.firstChoices} first-choice votes`).join("\n") || "No valid ranked votes."}

## Vote Reasons
${data.election.acceptedVotes.map((vote) => `- ${vote.voter} (${vote.confidence}%): ${vote.reason}`).join("\n") || "- No valid vote reasons."}

## Dynamic Role Election
${Object.entries(data.roleElection).map(([role, result]) => `- ${role}: ${result.winner ?? (result.tied?.length ? `tie between ${result.tied.join(", ")}` : "not elected")}`).join("\n")}

## Claim Ledger
${data.claims.map((claim) => `- ${claim.id}: ${claim.text} [${claim.verificationStatus}]\n  Support: ${claim.supporters.join(", ") || "none recorded"}; Oppose: ${claim.opponents.join(", ") || "none recorded"}`).join("\n") || "- No valid claim ledger was produced."}

## Confidence After Discussion
${latestDiscussionByModel(data.discussion).map((item) => `- ${item.displayName}: ${clampConfidence(item.data.confidence)}%`).join("\n") || "- No structured confidence values."}

## Position Changes
${changed.map((item) => `- ${item.displayName}: ${item.data.changeReason || item.data.revisedPosition}`).join("\n") || "- No model reported a material position change."}

## Competing and Minority Proposals
${minority.map((proposal) => `### ${proposal.proposalId}: ${proposal.data.title || proposal.displayName}\n${proposal.data.answer}`).join("\n\n") || "No minority proposal."}

## External Verification Required
${unverified.map((claim) => `- ${claim.id}: ${claim.text}${claim.verificationReason ? ` (${claim.verificationReason})` : ""}`).join("\n") || "- None identified by the conference."}

## Discussion Transcript
${data.discussion.filter((item) => item.ok).map((item) => `### ${item.displayName}\n${formatDiscussion(item.data)}`).join("\n\n")}
`;
}

function formatNamedResponses(results) {
  return results
    .map((result) => `<model name="${result.displayName}">\n${result.text}\n</model>`)
    .join("\n\n");
}

function formatDiscussion(data) {
  const stances = (data.stances ?? [])
    .map((stance) => `- ${stance.claimId}: ${stance.position} - ${stance.reason}`)
    .join("\n");
  const challenges = (data.challenges ?? [])
    .map((challenge) => `- Challenges ${challenge.to} on ${challenge.claimId}: ${challenge.question}`)
    .join("\n");
  const answers = (data.answers ?? [])
    .map((answer) => `- Answers ${answer.from} on ${answer.claimId}: ${answer.answer}`)
    .join("\n");
  return `Position: ${data.revisedPosition ?? "Not provided"}
Confidence: ${clampConfidence(data.confidence)}%
Position changed: ${data.positionChanged ? `yes - ${data.changeReason || "reason not provided"}` : "no"}

Claim stances:
${stances || "- No structured stances recorded."}

Challenges:
${challenges || "- No direct challenge recorded."}

Answers:
${answers || "- No answer to a prior challenge recorded."}

Role ballot reason: ${data.roleVoteReason || "Not provided."}`;
}

function publicRoundData(item) {
  return { model: item.displayName, ...item.data };
}

function extractJsonObject(text) {
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  return first >= 0 && last > first ? text.slice(first, last + 1) : null;
}

function clampConfidence(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(100, Math.round(number)));
}

function resolveEligibleName(value, eligible) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLocaleLowerCase();
  return [...eligible].find((name) => name.toLocaleLowerCase() === normalized) ?? null;
}

function latestDiscussionByModel(discussion) {
  const latest = new Map();
  for (const item of discussion.filter((entry) => entry.ok && entry.data)) {
    latest.set(item.displayName, item);
  }
  return [...latest.values()];
}

function formatTieConclusion(data) {
  if (data.election.tied?.length) {
    const tied = data.proposals.filter(
      (proposal) => data.election.tied.includes(proposal.proposalId)
    );
    return `The ranked vote ended in a tie between ${tied.map((proposal) => `${proposal.proposalId} by ${proposal.displayName}`).join(" and ")}. No arbitrary winner was selected.`;
  }
  return "No proposal received a valid vote.";
}

function emptyConference(question, openings) {
  return {
    mode: "conference",
    question,
    participants: [],
    failures: openings,
    report: `# Model Conference Report\n\nAll models failed to provide an opening position.`
  };
}

function singleParticipantConference(question, openings, participant) {
  return {
    mode: "conference",
    question,
    participants: [participant],
    failures: openings.filter((result) => !result.ok),
    report: `# Model Conference Report

## Question
${question}

## Participant
${participant.displayName}

## Result
${participant.text}

A conference requires at least two successful models, so discussion and voting were skipped.`
  };
}

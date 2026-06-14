import { useState } from "react";
import Markdown from "react-markdown";

export default function ReportView({ question, result }) {
  const isConference = result?.mode === "conference";

  return (
    <div className="report-view">
      {isConference ? (
        <ConferenceReport result={result} />
      ) : (
        <SynthesisReport result={result} />
      )}
    </div>
  );
}

function ConferenceReport({ result }) {
  const { proposals = [], election, claims = [], discussion = [], report } = result;
  const winner = proposals.find((p) => p.ok && p.proposalId === election?.winner);
  const minority = proposals.filter((p) => p.ok && p.proposalId !== election?.winner);
  const [showFull, setShowFull] = useState(false);

  return (
    <>
      {winner && (
        <div className="winner-card">
          <div className="winner-label">Winning Proposal · {election?.winner}</div>
          <div className="winner-title">{winner.data?.title ?? "Untitled"}</div>
          <div className="winner-author">by {winner.displayName}</div>
          <div className="winner-answer markdown-body">
            <Markdown>{winner.data?.answer ?? ""}</Markdown>
          </div>
          {winner.data?.minorityConditions?.length > 0 && (
            <Collapsible label="Minority conditions">
              <ul className="markdown-body" style={{ paddingLeft: 18 }}>
                {winner.data.minorityConditions.map((c, i) => <li key={i}>{c}</li>)}
              </ul>
            </Collapsible>
          )}
          {winner.data?.unverifiedClaims?.length > 0 && (
            <Collapsible label={`${winner.data.unverifiedClaims.length} unverified claims`}>
              <ul style={{ paddingLeft: 18, fontSize: 13, color: "var(--muted)", lineHeight: 1.7 }}>
                {winner.data.unverifiedClaims.map((c, i) => <li key={i}>{c}</li>)}
              </ul>
            </Collapsible>
          )}
        </div>
      )}

      {!winner && election?.tied?.length > 0 && (
        <div className="winner-card" style={{ borderLeftColor: "var(--muted)" }}>
          <div className="winner-label">Result</div>
          <p style={{ color: "var(--text2)" }}>Tie between proposals: {election.tied.join(", ")}. No winner selected.</p>
        </div>
      )}

      {election?.ranking?.length > 1 && (
        <div className="vote-section">
          <h3>Vote Tally</h3>
          <table className="vote-table">
            <thead>
              <tr><th>#</th><th>Proposal</th><th>Author</th><th>Score</th><th>1st</th></tr>
            </thead>
            <tbody>
              {election.ranking.map((item, i) => (
                <tr key={item.proposalId} className={i === 0 ? "winner-row" : ""}>
                  <td>{i + 1}</td>
                  <td>{item.proposalId}</td>
                  <td>{item.author}</td>
                  <td>{item.score}</td>
                  <td>{item.firstChoices}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {minority.length > 0 && (
        <Collapsible label={`${minority.length} minority proposal${minority.length > 1 ? "s" : ""}`}>
          {minority.map((p) => (
            <div key={p.proposalId} style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 12, color: "var(--muted)", fontWeight: 700, marginBottom: 4 }}>
                {p.proposalId} · {p.displayName} (confidence {p.data?.confidence ?? "?"}%)
              </div>
              <div className="markdown-body"><Markdown>{p.data?.answer ?? ""}</Markdown></div>
            </div>
          ))}
        </Collapsible>
      )}

      {claims.filter((c) => c.verificationStatus === "external verification required").length > 0 && (
        <Collapsible label="Claims requiring external verification">
          <ul style={{ paddingLeft: 18, fontSize: 13, color: "var(--muted)", lineHeight: 1.7 }}>
            {claims
              .filter((c) => c.verificationStatus === "external verification required")
              .map((c) => <li key={c.id}><strong style={{ color: "var(--text2)" }}>{c.id}</strong>: {c.text}</li>)}
          </ul>
        </Collapsible>
      )}

      {report && (
        <Collapsible label="Full conference transcript">
          <div className="markdown-body"><Markdown>{report}</Markdown></div>
        </Collapsible>
      )}
    </>
  );
}

function SynthesisReport({ result }) {
  const { results = [], synthesis } = result ?? {};
  const successful = results.filter((r) => r.ok);
  const failed = results.filter((r) => !r.ok);

  return (
    <>
      {synthesis?.ok ? (
        <div className="markdown-body">
          <Markdown>{synthesis.text}</Markdown>
        </div>
      ) : successful.length > 0 ? (
        successful.map((r) => (
          <div key={r.provider} className="provider-answer">
            <h3>{r.displayName ?? r.provider}</h3>
            <div className="markdown-body"><Markdown>{r.text}</Markdown></div>
          </div>
        ))
      ) : (
        <div className="error-card">All providers failed to respond.</div>
      )}

      {failed.length > 0 && (
        <Collapsible label={`${failed.length} failed provider${failed.length > 1 ? "s" : ""}`}>
          <ul style={{ paddingLeft: 18, fontSize: 13, color: "var(--muted)", lineHeight: 1.8 }}>
            {failed.map((r) => (
              <li key={r.provider}><strong style={{ color: "var(--text2)" }}>{r.provider}</strong>: {r.error}</li>
            ))}
          </ul>
        </Collapsible>
      )}
    </>
  );
}

function Collapsible({ label, children }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="collapsible">
      <button className="section-toggle" onClick={() => setOpen((v) => !v)}>
        <span className="section-toggle-arrow">{open ? "▼" : "▶"}</span>
        {label}
      </button>
      {open && <div className="collapsible-body">{children}</div>}
    </div>
  );
}

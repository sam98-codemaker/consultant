function dateGroup(ts) {
  const now = new Date();
  const d = new Date(ts);
  const diffDays = Math.floor((now - d) / 86_400_000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays <= 7) return "Last 7 days";
  if (diffDays <= 30) return "Last 30 days";
  return d.toLocaleString("default", { month: "long", year: "numeric" });
}

function timeLabel(ts) {
  const d = new Date(ts);
  const diffDays = Math.floor((Date.now() - d) / 86_400_000);
  if (diffDays === 0) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (diffDays === 1) return "Yesterday";
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

export default function HistoryPanel({ history, activeId, onSelect }) {
  if (!history.length) {
    return (
      <div className="history-empty">
        No past councils yet.<br />
        Ask a question to get started.
      </div>
    );
  }

  // Group by date bucket
  const groups = [];
  const seen = new Map();
  for (const item of history) {
    const g = dateGroup(item.ts);
    if (!seen.has(g)) { seen.set(g, []); groups.push({ label: g, items: seen.get(g) }); }
    seen.get(g).push(item);
  }

  return (
    <ul className="history-list">
      {groups.map(({ label, items }) => (
        <li key={label}>
          <div className="history-group-label">{label}</div>
          {items.map((item) => (
            <div
              key={item.id}
              className={`history-item ${activeId === item.id ? "active" : ""}`}
              onClick={() => onSelect(item.id)}
            >
              <div className="history-question">{item.question}</div>
              {item.snippet && (
                <div className="history-snippet">{item.snippet}</div>
              )}
              <div className="history-meta">
                {item.status === "error" ? (
                  <span className="badge badge-error">error</span>
                ) : item.mode === "conference" ? (
                  <span className="badge badge-conference">conference</span>
                ) : (
                  <span className="badge badge-synth">synthesis</span>
                )}
                <span className="history-time">{timeLabel(item.ts)}</span>
              </div>
            </div>
          ))}
        </li>
      ))}
    </ul>
  );
}

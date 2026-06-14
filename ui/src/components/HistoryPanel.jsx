function timeAgo(ts) {
  const diff = Date.now() - new Date(ts).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function HistoryPanel({ history, onSelect }) {
  if (!history.length) {
    return (
      <div className="history-empty">
        No past councils yet.<br />
        Ask the council a question to get started.
      </div>
    );
  }

  return (
    <ul className="history-list">
      {history.map((item) => (
        <li key={item.id} className="history-item" onClick={() => onSelect(item.id)}>
          <div className="history-question">{item.question}</div>
          <div className="history-meta">
            <span className={`badge ${item.mode === "conference" ? "badge-conference" : "badge-synth"}`}>
              {item.mode === "conference" ? "conference" : "synthesis"}
            </span>
            <span className="history-time">{timeAgo(item.ts)}</span>
          </div>
        </li>
      ))}
    </ul>
  );
}

export async function fetchConfig() {
  const res = await fetch("/api/config");
  if (!res.ok) throw new Error("Failed to load config");
  return res.json();
}

export async function startRun({ question, providers, rounds, proposals }) {
  const res = await fetch("/api/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question, providers, rounds, proposals })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to start run");
  }
  return res.json(); // { id }
}

export async function fetchHistory() {
  const res = await fetch("/api/history");
  if (!res.ok) throw new Error("Failed to load history");
  return res.json();
}

export async function fetchHistoryItem(id) {
  const res = await fetch(`/api/history/${id}`);
  if (!res.ok) throw new Error("Not found");
  return res.json();
}

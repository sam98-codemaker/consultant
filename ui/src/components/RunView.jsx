import { useState, useEffect, useRef } from "react";
import ReportView from "./ReportView.jsx";

const STAGE_LABELS = {
  opening:    "Opening Positions",
  claims:     "Claim Ledger",
  discussion: "Discussion",
  roles:      "Role Election",
  proposals:  "Proposals",
  voting:     "Vote",
};

export default function RunView({ runId, question, onDone, onEvent }) {
  const [stages, setStages] = useState([]); // [{stage, desc, events[], done}]
  const [loose, setLoose] = useState([]);   // events before first stage
  const [done, setDone] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const esRef = useRef(null);
  const currentStageRef = useRef(null);

  const addToCurrentStage = (ev) => {
    setStages((prev) => {
      if (prev.length === 0) return prev;
      const next = [...prev];
      next[next.length - 1] = {
        ...next[next.length - 1],
        events: [...next[next.length - 1].events, ev],
      };
      return next;
    });
  };

  const openNewStage = (stage, desc) => {
    currentStageRef.current = stage;
    setStages((prev) => {
      // Mark previous stage done
      if (prev.length > 0) {
        const closed = [...prev];
        closed[closed.length - 1] = { ...closed[closed.length - 1], done: true };
        return [...closed, { stage, desc, events: [], done: false }];
      }
      return [{ stage, desc, events: [], done: false }];
    });
  };

  useEffect(() => {
    if (!runId) return;

    const connect = () => {
      const es = new EventSource(`/api/run/${runId}/events`);
      esRef.current = es;

      es.onmessage = (e) => {
        const event = JSON.parse(e.data);
        onEvent?.();

        if (event.type === "done") {
          setStages((prev) => {
            if (prev.length === 0) return prev;
            const next = [...prev];
            next[next.length - 1] = { ...next[next.length - 1], done: true };
            return next;
          });
          setResult(event.run);
          setDone(true);
          onDone?.(question, event.run);
          es.close();
          return;
        }

        if (event.type === "error") {
          setError(event.message);
          setDone(true);
          es.close();
          return;
        }

        if (event.type === "stage") {
          openNewStage(event.stage, event.message);
          return;
        }

        // Everything else goes into current stage or loose
        addToCurrentStage(event);
      };

      es.onerror = () => {
        if (!done) {
          setError("Connection lost.");
          setDone(true);
        }
        es.close();
      };
    };

    // Small delay so server has registered the run
    const t = setTimeout(connect, 80);
    return () => {
      clearTimeout(t);
      esRef.current?.close();
    };
  }, [runId]);

  return (
    <div className="run-view">
      {loose.map((ev, i) => <LooseEvent key={i} event={ev} />)}

      {stages.map((s, i) => (
        <StageCard
          key={i}
          stage={s.stage}
          desc={s.desc}
          events={s.events}
          done={s.done}
          isLast={i === stages.length - 1}
          running={!done && i === stages.length - 1}
        />
      ))}

      {!done && stages.length === 0 && (
        <div className="stage-group">
          <div className="stage-body">
            <div className="running-row">
              <span className="spinner" />
              <span>Connecting to council…</span>
            </div>
          </div>
        </div>
      )}

      {error && <div className="error-card">✗ {error}</div>}
    </div>
  );
}

function StageCard({ stage, desc, events, done, running }) {
  return (
    <div className="stage-group">
      <div className="stage-header">
        <span className={`stage-dot ${done ? "done" : running ? "running" : ""}`} />
        <span className="stage-name">{STAGE_LABELS[stage] ?? stage}</span>
        <span className="stage-desc">{desc}</span>
      </div>
      <div className="stage-body">
        {events.map((ev, i) => <EventRow key={i} event={ev} />)}
        {running && events.length === 0 && (
          <div className="running-row">
            <span className="spinner" />
            <span>Waiting for models…</span>
          </div>
        )}
      </div>
    </div>
  );
}

function EventRow({ event }) {
  switch (event.type) {
    case "fanout_start":
      return (
        <div className="event-row">
          <span className="event-icon">→</span>
          <span className="event-label">Querying <strong>{event.names.join(", ")}</strong> in parallel</span>
        </div>
      );

    case "provider_done":
      return (
        <div className="event-row">
          <span className={`event-icon ${event.result.ok ? "ok" : "fail"}`}>
            {event.result.ok ? "✓" : "✗"}
          </span>
          <span className="event-label">
            <strong>{event.result.displayName ?? event.result.provider}</strong>
            {!event.result.ok && <span className="event-fail"> — {event.result.error}</span>}
          </span>
          {event.result.ok && (
            <span className="event-time">{(event.result.durationMs / 1000).toFixed(1)}s</span>
          )}
        </div>
      );

    case "participant":
      if (!event.result.ok) {
        return (
          <div className="event-row">
            <span className="event-icon fail">✗</span>
            <span className="event-label">
              <strong>{event.result.displayName ?? event.result.provider}</strong>
              <span className="event-fail"> — {event.result.error}</span>
            </span>
          </div>
        );
      }
      return (
        <div className="event-row">
          <span className="event-icon ok">✓</span>
          <span className="event-label">
            <strong>{event.result.displayName ?? event.result.provider}</strong> responded
          </span>
          {event.result.durationMs != null && (
            <span className="event-time">{(event.result.durationMs / 1000).toFixed(1)}s</span>
          )}
        </div>
      );

    case "eval_start":
      return (
        <div className="event-row">
          <span className="event-icon">⟳</span>
          <span className="event-label">Evaluating with <strong>{event.name}</strong>…</span>
        </div>
      );

    case "eval_done":
      return (
        <div className="event-row">
          <span className={`event-icon ${event.result.ok ? "ok" : "fail"}`}>
            {event.result.ok ? "✓" : "✗"}
          </span>
          <span className="event-label">
            {event.result.ok ? "Evaluation complete" : `Evaluation failed — ${event.result.error}`}
          </span>
        </div>
      );

    case "synth_start":
      return (
        <div className="event-row">
          <span className="event-icon">✎</span>
          <span className="event-label">Writing final answer with <strong>{event.name}</strong>…</span>
        </div>
      );

    case "synth_done":
      return (
        <div className="event-row">
          <span className={`event-icon ${event.result.ok ? "ok" : "fail"}`}>
            {event.result.ok ? "✓" : "✗"}
          </span>
          <span className="event-label">
            {event.result.ok ? "Synthesis complete" : `Failed — ${event.result.error}`}
          </span>
        </div>
      );

    default:
      return null;
  }
}

function LooseEvent({ event }) {
  return (
    <div className="stage-group">
      <div className="stage-body">
        <EventRow event={event} />
      </div>
    </div>
  );
}

import { useState, useEffect, useCallback, useRef } from "react";
import InputBar from "./components/InputBar.jsx";
import RunView from "./components/RunView.jsx";
import ReportView from "./components/ReportView.jsx";
import HistoryPanel from "./components/HistoryPanel.jsx";
import { fetchConfig, fetchHistory, fetchHistoryItem, startRun } from "./api.js";

const EXAMPLE_QUESTIONS = [
  "Compare PostgreSQL vs MySQL for a new SaaS product.",
  "What are the strongest arguments for microservices vs monolith?",
  "Evaluate React vs Vue for a large enterprise frontend."
];

export default function App() {
  const [config, setConfig] = useState(null);
  const [view, setView] = useState("welcome"); // "welcome" | "run" | "report"
  const [activeRunId, setActiveRunId] = useState(null);
  const [activeQuestion, setActiveQuestion] = useState(null);
  const [reportData, setReportData] = useState(null);
  const [history, setHistory] = useState([]);
  const [running, setRunning] = useState(false);
  const conversationRef = useRef(null);

  useEffect(() => {
    fetchConfig().then(setConfig).catch(console.error);
    reloadHistory();
  }, []);

  const reloadHistory = useCallback(() => {
    fetchHistory().then(setHistory).catch(console.error);
  }, []);

  const scrollToBottom = useCallback(() => {
    if (conversationRef.current) {
      conversationRef.current.scrollTop = conversationRef.current.scrollHeight;
    }
  }, []);

  const handleSubmit = useCallback(async ({ question, providers, rounds, proposals }) => {
    setRunning(true);
    setActiveQuestion(question);
    setReportData(null);
    setView("run");
    try {
      const { id } = await startRun({ question, providers, rounds, proposals });
      setActiveRunId(id);
    } catch (err) {
      setRunning(false);
      setActiveRunId(null);
    }
  }, []);

  const handleRunDone = useCallback((question, result) => {
    setRunning(false);
    setReportData({ question, result });
    setTimeout(reloadHistory, 400); // slight delay so server finishes writing
  }, [reloadHistory]);

  const handleRunError = useCallback(() => {
    setRunning(false);
    setTimeout(reloadHistory, 400);
  }, [reloadHistory]);

  const handleHistorySelect = useCallback(async (id) => {
    const item = await fetchHistoryItem(id);
    setActiveRunId(null);
    setActiveQuestion(item.question);
    setReportData({ question: item.question, result: item.result });
    setView("report");
    setRunning(false);
  }, []);

  const handleNew = useCallback(() => {
    setView("welcome");
    setActiveRunId(null);
    setActiveQuestion(null);
    setReportData(null);
    setRunning(false);
  }, []);

  const handleExampleClick = useCallback((q) => {
    // Just pre-fill — InputBar reads this via prop
    setActiveQuestion(q);
  }, []);

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sidebar-header">
          <div className="sidebar-logo">
            <div className="sidebar-logo-icon">⚖</div>
            <span className="sidebar-title">Consultant</span>
          </div>
          <button className="btn-new" onClick={handleNew}>+ New</button>
        </div>
        <HistoryPanel history={history} activeId={activeRunId} onSelect={handleHistorySelect} />
      </aside>

      <div className="workspace">
        <div className="conversation" ref={conversationRef}>
          {view === "welcome" && (
            <div className="welcome">
              <div className="welcome-icon">⚖</div>
              <h2>Consultant</h2>
              <p>Put your question to a structured conference of AI models. They deliberate, challenge each other, vote, and deliver a ranked verdict.</p>
              <div className="welcome-tips">
                {EXAMPLE_QUESTIONS.map((q) => (
                  <button key={q} className="welcome-tip" onClick={() => setActiveQuestion(q)}>
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}

          {(view === "run" || view === "report") && activeQuestion && (
            <div className="user-question">{activeQuestion}</div>
          )}

          {view === "run" && activeRunId && (
            <RunView
              key={activeRunId}
              runId={activeRunId}
              question={activeQuestion}
              onDone={handleRunDone}
              onError={handleRunError}
              onEvent={scrollToBottom}
            />
          )}

          {view === "report" && reportData && !activeRunId && (
            <>
              <div className="report-divider"><span className="report-divider-label">Final Report</span></div>
              <ReportView question={reportData.question} result={reportData.result} />
            </>
          )}

          {/* Show report below live run when it finishes */}
          {view === "run" && reportData && (
            <>
              <div className="report-divider"><span className="report-divider-label">Final Report</span></div>
              <ReportView question={reportData.question} result={reportData.result} />
            </>
          )}
        </div>

        {config && (
          <InputBar
            config={config}
            onSubmit={handleSubmit}
            disabled={running}
            prefill={activeQuestion}
            onPrefillConsumed={() => setActiveQuestion(null)}
          />
        )}
      </div>
    </div>
  );
}

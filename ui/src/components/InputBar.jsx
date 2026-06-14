import { useState, useEffect, useRef } from "react";

export default function InputBar({ config, onSubmit, disabled, prefill, onPrefillConsumed }) {
  const [question, setQuestion] = useState("");
  const [selectedProviders, setSelectedProviders] = useState(
    config.providers.filter((p) => p.enabled).map((p) => p.name)
  );
  const [rounds, setRounds] = useState(config.conference?.discussionRounds ?? 2);
  const [proposals, setProposals] = useState(config.conference?.proposalCount ?? 3);
  const [error, setError] = useState(null);
  const textareaRef = useRef(null);

  useEffect(() => {
    if (prefill && prefill !== question) {
      setQuestion(prefill);
      onPrefillConsumed?.();
      textareaRef.current?.focus();
    }
  }, [prefill]);

  const toggleProvider = (name) => {
    setSelectedProviders((prev) =>
      prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]
    );
  };

  const handleSubmit = async () => {
    const q = question.trim();
    if (!q || selectedProviders.length === 0 || disabled) return;
    setError(null);
    try {
      await onSubmit({ question: q, providers: selectedProviders, rounds, proposals });
      setQuestion("");
    } catch (err) {
      setError(err.message);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  // Auto-resize textarea
  const handleChange = (e) => {
    setQuestion(e.target.value);
    const el = e.target;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 180) + "px";
  };

  const canSend = question.trim().length > 0 && selectedProviders.length > 0 && !disabled;

  return (
    <div className="input-bar">
      <div className="input-providers">
        {config.providers.map((p) => (
          <label
            key={p.name}
            className={`provider-chip ${selectedProviders.includes(p.name) ? "selected" : ""}`}
          >
            <input
              type="checkbox"
              checked={selectedProviders.includes(p.name)}
              onChange={() => toggleProvider(p.name)}
              disabled={disabled}
            />
            <span className="provider-chip-dot" />
            {p.displayName || p.name}
          </label>
        ))}
      </div>

      <div className="input-row">
        <div className="input-textarea-wrap">
          <textarea
            ref={textareaRef}
            className="input-textarea"
            placeholder="Ask the council… (Enter to send, Shift+Enter for newline)"
            value={question}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            disabled={disabled}
            rows={1}
          />
        </div>
        <button
          className="input-send"
          onClick={handleSubmit}
          disabled={!canSend}
          title="Convene Council"
        >
          <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
          </svg>
        </button>
      </div>

      <div className="input-options">
        <div className="input-option">
          <label htmlFor="rounds">Rounds</label>
          <input
            id="rounds"
            type="number"
            min={1}
            max={5}
            value={rounds}
            onChange={(e) => setRounds(Number(e.target.value))}
            disabled={disabled}
          />
        </div>
        <div className="input-option">
          <label htmlFor="proposals">Proposals</label>
          <input
            id="proposals"
            type="number"
            min={2}
            max={6}
            value={proposals}
            onChange={(e) => setProposals(Number(e.target.value))}
            disabled={disabled}
          />
        </div>
        {error && <span className="input-error">{error}</span>}
        {disabled && <span style={{ fontSize: "11px", color: "var(--muted)", marginLeft: "auto" }}>Conference in progress…</span>}
      </div>
    </div>
  );
}

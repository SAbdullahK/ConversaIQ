import { useState, useRef, useCallback } from "react";

// ─── CONFIG ──────────────────────────────────────────────
const API_BASE = "http://localhost:8000"; // ← change port if needed
// ─────────────────────────────────────────────────────────

function sentimentToScore(sentiment = "") {
  const s = sentiment.toLowerCase();
  if (s.includes("positive")) return 78;
  if (s.includes("negative")) return 22;
  return 50;
}

function parseTranscript(raw = "") {
  if (!raw || !raw.trim()) return [];
  const lines = raw.split(/\n+/).map(l => l.trim()).filter(Boolean);
  if (lines.length === 1) {
    return (
      raw.match(/[^.!?]+[.!?]+/g)?.map((s, i) => ({
        speaker: i % 2 === 0 ? "Speaker 1" : "Speaker 2",
        text: s.trim(),
      })) ?? [{ speaker: "Speaker 1", text: raw }]
    );
  }
  return lines.map((line, i) => {
    const m = line.match(/^(Agent|Customer|Speaker\s*\d+|User|Rep|Caller)\s*[:–-]\s*/i);
    if (m) return { speaker: m[1], text: line.slice(m[0].length).trim() };
    return { speaker: i % 2 === 0 ? "Speaker 1" : "Speaker 2", text: line };
  });
}

function SentimentBadge({ value = "Neutral" }) {
  const map = {
    positive: { bg: "#d1fae5", color: "#065f46", dot: "#10b981" },
    negative: { bg: "#fee2e2", color: "#991b1b", dot: "#ef4444" },
    neutral:  { bg: "#fef3c7", color: "#92400e", dot: "#f59e0b" },
    unknown:  { bg: "#e2e8f0", color: "#475569", dot: "#94a3b8" },
  };
  const key = value.toLowerCase().includes("positive") ? "positive"
            : value.toLowerCase().includes("negative") ? "negative"
            : value.toLowerCase().includes("neutral")  ? "neutral" : "unknown";
  const s = map[key];
  return (
    <span style={{ background: s.bg, color: s.color, padding: "3px 12px", borderRadius: 20, fontSize: 13, fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 6 }}>
      <span style={{ width: 7, height: 7, borderRadius: "50%", background: s.dot }} />
      {value}
    </span>
  );
}

function RiskBar({ score, color }) {
  return (
    <div style={{ background: "#1e293b", borderRadius: 8, height: 8, overflow: "hidden", width: "100%", marginTop: 8 }}>
      <div style={{ width: `${score}%`, height: "100%", background: color, borderRadius: 8, transition: "width 1.2s ease" }} />
    </div>
  );
}

function ErrorBanner({ message, onClose }) {
  return (
    <div style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.35)", borderRadius: 14, padding: "14px 18px", marginBottom: 20, display: "flex", justifyContent: "space-between", alignItems: "flex-start", animation: "fadeUp 0.3s ease" }}>
      <div>
        <p style={{ color: "#f87171", fontWeight: 700, margin: "0 0 4px" }}>⚠ Request Failed</p>
        <p style={{ color: "#fca5a5", fontSize: 13, margin: 0 }}>{message}</p>
      </div>
      <button onClick={onClose} style={{ background: "none", border: "none", color: "#f87171", cursor: "pointer", fontSize: 20, padding: 0, marginLeft: 12 }}>×</button>
    </div>
  );
}

export default function ConversaIQ() {
  const [file, setFile]                   = useState(null);
  const [dragging, setDragging]           = useState(false);
  const [status, setStatus]               = useState("idle");
  const [error, setError]                 = useState(null);
  const [transcript, setTranscript]       = useState([]);
  const [rawTranscript, setRawTranscript] = useState("");
  const [analysis, setAnalysis]           = useState(null);
  const [copied, setCopied]               = useState(false);
  const [crmCopied, setCrmCopied]         = useState(false);
  const [loadingStep, setLoadingStep]     = useState("");
  const fileRef  = useRef();
  const abortRef = useRef(null);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) { setFile(f); setError(null); }
  }, []);

  const handleProcess = async () => {
    if (!file) { setError("Please upload an audio file first."); return; }
    if (abortRef.current) abortRef.current.abort();
    abortRef.current = new AbortController();

    setStatus("loading");
    setError(null);
    setTranscript([]);
    setAnalysis(null);
    setLoadingStep("Uploading audio file…");

    try {
      const formData = new FormData();
      formData.append("file", file);

      // Step indicator updates (purely cosmetic — real progress comes from response)
      const stepTimer = setTimeout(() => setLoadingStep("Transcribing audio with ASR model…"), 3000);
      const stepTimer2 = setTimeout(() => setLoadingStep("Running LLM analysis…"), 15000);

      const response = await fetch(`${API_BASE}/process_audio`, {
        method: "POST",
        body: formData,
        signal: abortRef.current.signal,
      });

      clearTimeout(stepTimer);
      clearTimeout(stepTimer2);

      if (!response.ok) {
        const errText = await response.text().catch(() => "Unknown server error");
        throw new Error(`Server ${response.status}: ${errText}`);
      }

      const data = await response.json();
      // Expected: { transcript: string, analysis: { overall_sentiment, compliance_flags, crm_summary } }

      const raw = data.transcript ?? "";
      setRawTranscript(raw);
      setTranscript(parseTranscript(raw));
      setAnalysis(data.analysis ?? {});
      setStatus("done");

    } catch (err) {
      if (err.name === "AbortError") return;
      setError(err.message || "Something went wrong. Is your FastAPI server running on " + API_BASE + "?");
      setStatus("error");
    }
  };

  const handleCancel = () => {
    abortRef.current?.abort();
    setStatus("idle");
    setLoadingStep("");
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(rawTranscript);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const blob = new Blob([rawTranscript], { type: "text/plain" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url; a.download = "transcript.txt"; a.click();
    URL.revokeObjectURL(url);
  };

  const handleCopyCRM = () => {
    navigator.clipboard.writeText(analysis?.crm_summary ?? "");
    setCrmCopied(true);
    setTimeout(() => setCrmCopied(false), 2000);
  };

  const sentimentScore  = analysis ? sentimentToScore(analysis.overall_sentiment) : 0;
  const complianceFlags = analysis?.compliance_flags ?? [];
  const firstSpeaker    = transcript[0]?.speaker;

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(135deg, #0f172a 0%, #1e293b 60%, #0f172a 100%)", fontFamily: "'DM Sans', 'Segoe UI', sans-serif", color: "#e2e8f0" }}>
      <div style={{ position: "fixed", top: -200, left: "50%", transform: "translateX(-50%)", width: 800, height: 500, background: "radial-gradient(ellipse, rgba(79,70,229,0.18) 0%, transparent 70%)", pointerEvents: "none", zIndex: 0 }} />

      <div style={{ maxWidth: 860, margin: "0 auto", padding: "40px 20px", position: "relative", zIndex: 1 }}>

        {/* Header */}
        <div style={{ textAlign: "center", marginBottom: 48 }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
            <div style={{ width: 42, height: 42, borderRadius: 12, background: "linear-gradient(135deg, #4F46E5, #818cf8)", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 0 24px rgba(79,70,229,0.5)" }}>
              <svg width="22" height="22" fill="none" viewBox="0 0 24 24">
                <path d="M12 2a10 10 0 110 20A10 10 0 0112 2z" fill="rgba(255,255,255,0.15)"/>
                <path d="M8 10h8M8 14h5" stroke="#fff" strokeWidth="1.8" strokeLinecap="round"/>
              </svg>
            </div>
            <span style={{ fontSize: 28, fontWeight: 800, letterSpacing: "-0.5px", background: "linear-gradient(90deg, #e2e8f0 30%, #818cf8)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
              ConversaIQ
            </span>
          </div>
          <p style={{ color: "#64748b", fontSize: 15, margin: "0 0 10px" }}>AI-powered call intelligence · Transcribe · Analyze · Act</p>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.25)", borderRadius: 20, padding: "3px 14px" }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#10b981", boxShadow: "0 0 6px #10b981" }} />
            <span style={{ color: "#34d399", fontSize: 12, fontWeight: 600 }}>Live · {API_BASE}</span>
          </div>
        </div>

        {/* Error */}
        {error && <ErrorBanner message={error} onClose={() => setError(null)} />}

        {/* Upload card */}
        <div style={{ background: "rgba(30,41,59,0.8)", border: "1px solid rgba(100,116,139,0.2)", borderRadius: 20, padding: 28, marginBottom: 20, backdropFilter: "blur(12px)" }}>
          <div
            onDragOver={e => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            onClick={() => status !== "loading" && fileRef.current.click()}
            style={{
              border: `2px dashed ${dragging ? "#4F46E5" : file ? "#10b981" : "rgba(100,116,139,0.35)"}`,
              borderRadius: 14, padding: "32px 20px", textAlign: "center",
              cursor: status === "loading" ? "not-allowed" : "pointer",
              background: dragging ? "rgba(79,70,229,0.07)" : "rgba(15,23,42,0.4)",
              transition: "all 0.2s ease", marginBottom: 18,
              opacity: status === "loading" ? 0.55 : 1,
            }}
          >
            <input ref={fileRef} type="file" accept="audio/*" style={{ display: "none" }} onChange={e => { setFile(e.target.files[0]); setError(null); }} />
            <div style={{ fontSize: 34, marginBottom: 8 }}>🎙️</div>
            {file ? (
              <>
                <p style={{ color: "#10b981", fontWeight: 600, margin: "0 0 4px" }}>{file.name}</p>
                <p style={{ color: "#64748b", fontSize: 13, margin: 0 }}>{(file.size / 1024 / 1024).toFixed(2)} MB · {file.type || "audio"} · Click to change</p>
              </>
            ) : (
              <>
                <p style={{ color: "#94a3b8", fontWeight: 500, margin: "0 0 4px" }}>Drag & drop audio file here</p>
                <p style={{ color: "#475569", fontSize: 13, margin: 0 }}>or click to browse · MP3, WAV, M4A, OGG</p>
              </>
            )}
          </div>

          {status === "loading" ? (
            <button onClick={handleCancel} style={{ width: "100%", padding: "14px 0", borderRadius: 12, border: "1px solid rgba(239,68,68,0.4)", background: "rgba(239,68,68,0.1)", color: "#f87171", fontSize: 15, fontWeight: 700, cursor: "pointer", transition: "all 0.2s" }}>
              ✕ Cancel Processing
            </button>
          ) : (
            <button
              onClick={handleProcess}
              disabled={!file}
              style={{
                width: "100%", padding: "14px 0", borderRadius: 12, border: "none",
                background: !file ? "rgba(79,70,229,0.25)" : "linear-gradient(135deg, #4F46E5, #6366f1)",
                color: !file ? "#6366f1" : "#fff", fontSize: 16, fontWeight: 700,
                cursor: !file ? "not-allowed" : "pointer",
                boxShadow: file ? "0 4px 20px rgba(79,70,229,0.4)" : "none",
                transition: "all 0.2s",
              }}
            >
              {status === "done" ? "⚡ Re-Process Recording" : "⚡ Process Recording"}
            </button>
          )}
        </div>

        {/* Loading */}
        {status === "loading" && (
          <div style={{ background: "rgba(30,41,59,0.8)", border: "1px solid rgba(79,70,229,0.2)", borderRadius: 20, padding: 32, marginBottom: 20, textAlign: "center", backdropFilter: "blur(12px)" }}>
            <div style={{ display: "flex", justifyContent: "center", gap: 6, marginBottom: 18 }}>
              {[0,1,2,3,4].map(i => (
                <div key={i} style={{ width: 4, height: 30, borderRadius: 4, background: "#4F46E5", animation: `wave 1s ease-in-out ${i * 0.12}s infinite alternate` }} />
              ))}
            </div>
            <p style={{ color: "#e2e8f0", fontWeight: 600, fontSize: 15, margin: "0 0 6px" }}>{loadingStep}</p>
            <p style={{ color: "#475569", fontSize: 13, margin: 0 }}>This may take 30–120 seconds · LangGraph pipeline running</p>
          </div>
        )}

        {/* Transcript */}
        {status === "done" && (transcript.length > 0 || rawTranscript) && (
          <div style={{ background: "rgba(30,41,59,0.8)", border: "1px solid rgba(100,116,139,0.2)", borderRadius: 20, padding: 24, marginBottom: 20, backdropFilter: "blur(12px)", animation: "fadeUp 0.4s ease" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "#e2e8f0", display: "flex", alignItems: "center", gap: 8 }}>
                📝 Transcript
                <span style={{ background: "rgba(79,70,229,0.2)", color: "#818cf8", fontSize: 12, fontWeight: 600, padding: "2px 8px", borderRadius: 8 }}>
                  {transcript.length > 0 ? `${transcript.length} lines` : "raw"}
                </span>
              </h2>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={handleCopy} style={{ background: "rgba(79,70,229,0.15)", border: "1px solid rgba(79,70,229,0.3)", color: "#818cf8", padding: "6px 14px", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
                  {copied ? "✓ Copied!" : "Copy"}
                </button>
                <button onClick={handleDownload} style={{ background: "rgba(79,70,229,0.15)", border: "1px solid rgba(79,70,229,0.3)", color: "#818cf8", padding: "6px 14px", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
                  ↓ .txt
                </button>
              </div>
            </div>

            <div style={{ maxHeight: 340, overflowY: "auto", display: "flex", flexDirection: "column", gap: 14, paddingRight: 6 }}>
              {transcript.length > 0
                ? transcript.map((line, i) => (
                    <div key={i} style={{ display: "flex", gap: 12, alignItems: "flex-start", animation: `fadeUp 0.3s ease ${Math.min(i * 0.04, 0.5)}s both` }}>
                      <span style={{ minWidth: 84, fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px", paddingTop: 2, color: line.speaker === firstSpeaker ? "#818cf8" : "#FBBF24" }}>
                        {line.speaker}
                      </span>
                      <span style={{ color: "#cbd5e1", fontSize: 14, lineHeight: 1.75, flex: 1 }}>{line.text}</span>
                    </div>
                  ))
                : <p style={{ color: "#94a3b8", fontSize: 14, lineHeight: 1.8, whiteSpace: "pre-wrap", margin: 0 }}>{rawTranscript}</p>
              }
            </div>
          </div>
        )}

        {/* Insights */}
        {status === "done" && analysis && (
          <div style={{ background: "rgba(30,41,59,0.8)", border: "1px solid rgba(100,116,139,0.2)", borderRadius: 20, padding: 24, backdropFilter: "blur(12px)", animation: "fadeUp 0.5s ease" }}>
            <h2 style={{ margin: "0 0 20px", fontSize: 16, fontWeight: 700, color: "#e2e8f0", display: "flex", alignItems: "center", gap: 8 }}>
              🧠 AI Insights & CRM Summary
            </h2>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 16 }}>

              {/* Sentiment card */}
              <div style={{ background: "rgba(15,23,42,0.6)", borderRadius: 14, padding: 18, border: "1px solid rgba(100,116,139,0.15)" }}>
                <p style={{ color: "#64748b", fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.6px", margin: "0 0 10px" }}>Overall Sentiment</p>
                <SentimentBadge value={analysis.overall_sentiment || "Unknown"} />
                <RiskBar score={sentimentScore} color="linear-gradient(90deg, #f59e0b, #10b981)" />
                <p style={{ color: "#475569", fontSize: 12, margin: "6px 0 0" }}>Score: {sentimentScore}/100</p>
              </div>

              {/* Compliance card */}
              <div style={{ background: "rgba(15,23,42,0.6)", borderRadius: 14, padding: 18, border: `1px solid ${complianceFlags.length > 0 ? "rgba(239,68,68,0.3)" : "rgba(100,116,139,0.15)"}` }}>
                <p style={{ color: "#64748b", fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.6px", margin: "0 0 10px" }}>⚑ Compliance Flags</p>
                {complianceFlags.length > 0 ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {complianceFlags.map((flag, i) => (
                      <span key={i} style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.25)", color: "#fca5a5", padding: "3px 10px", borderRadius: 8, fontSize: 12, fontWeight: 600 }}>
                        ⚠ {flag}
                      </span>
                    ))}
                  </div>
                ) : (
                  <span style={{ background: "#d1fae5", color: "#065f46", padding: "3px 12px", borderRadius: 20, fontSize: 13, fontWeight: 600 }}>
                    ✓ No flags detected
                  </span>
                )}
              </div>

            </div>

            {/* CRM Summary */}
            <div style={{ background: "linear-gradient(135deg, rgba(79,70,229,0.1), rgba(99,102,241,0.04))", borderRadius: 14, padding: 20, border: "1px solid rgba(79,70,229,0.2)", marginBottom: 14 }}>
              <p style={{ color: "#6366f1", fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.6px", margin: "0 0 10px" }}>📋 CRM Summary</p>
              <p style={{ color: "#cbd5e1", fontSize: 14, lineHeight: 1.8, margin: 0 }}>
                {analysis.crm_summary || "No summary generated."}
              </p>
            </div>

            <button onClick={handleCopyCRM} style={{ background: "rgba(79,70,229,0.15)", border: "1px solid rgba(79,70,229,0.3)", color: "#818cf8", padding: "8px 18px", borderRadius: 10, cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
              {crmCopied ? "✓ Copied to clipboard!" : "Copy CRM Summary"}
            </button>
          </div>
        )}

        <p style={{ textAlign: "center", color: "#334155", fontSize: 12, marginTop: 32 }}>
          ConversaIQ · FastAPI + LangGraph + Mixtral · Real-time analysis
        </p>
      </div>

      <style>{`
        @keyframes spin  { to { transform: rotate(360deg); } }
        @keyframes wave  { from { transform: scaleY(0.35); opacity: 0.4; } to { transform: scaleY(1); opacity: 1; } }
        @keyframes fadeUp { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: translateY(0); } }
        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: rgba(100,116,139,0.3); border-radius: 3px; }
      `}</style>
    </div>
  );
}

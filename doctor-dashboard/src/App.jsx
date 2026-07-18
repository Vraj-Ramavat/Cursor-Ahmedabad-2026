import { useEffect, useState, useCallback } from "react";
import {
  getQueueStatus,
  getSessionDetail,
  getPendingNotes,
  approveNote,
  correctDocumentField,
  openQueueSocket,
} from "./api.js";
import WalkInNurse from "./WalkInNurse.jsx";

const SEV_LABEL = { red: "RED", amber: "AMBER", green: "GREEN" };

function initials(name) {
  if (!name) return "?";
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() || "")
    .join("");
}

function avatarColor(name) {
  const colors = ["c1", "c2", "c3", "c4", "c5", "c6"];
  let hash = 0;
  for (let i = 0; i < (name || "").length; i++) hash = name.charCodeAt(i) + hash * 31;
  return colors[Math.abs(hash) % colors.length];
}

function formatMeta(entry) {
  const parts = [];
  if (entry.age) parts.push(`${entry.age}y`);
  if (entry.gender) parts.push(entry.gender);
  if (entry.chief_complaint) parts.push(entry.chief_complaint);
  return parts.join(" · ") || "No details";
}

export default function App() {
  const [queue, setQueue] = useState({ live: false, banner: null, entries: [] });
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [notes, setNotes] = useState([]);
  const [connected, setConnected] = useState(false);
  const [tab, setTab] = useState("briefing");
  const [walkInOpen, setWalkInOpen] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const q = await getQueueStatus();
      setQueue(q);
      try {
        const n = await getPendingNotes();
        setNotes(Array.isArray(n) ? n : []);
      } catch {
        /* notes optional — never block the queue */
      }
    } catch {
      setQueue((q) => ({
        live: false,
        banner: "backend unreachable — retrying…",
        entries: Array.isArray(q.entries) ? q.entries : [],
      }));
    }
  }, []);

  useEffect(() => {
    refresh();
    let ws;
    try {
      ws = openQueueSocket((data) => {
        if (!data || !Array.isArray(data.entries)) return;
        setQueue({
          live: !!data.live,
          banner: data.banner || null,
          entries: data.entries,
        });
        setConnected(true);
      });
      ws.onclose = () => setConnected(false);
      ws.onerror = () => setConnected(false);
    } catch {
      setConnected(false);
    }
    const poll = setInterval(refresh, 5000);
    return () => {
      try { ws?.close(); } catch { /* ignore */ }
      clearInterval(poll);
    };
  }, [refresh]);

  const selectPatient = useCallback(async (sessionId) => {
    setSelected(sessionId);
    setDetail(await getSessionDetail(sessionId));
    setTab("briefing");
  }, []);

  async function onApprove(noteId, edited) {
    await approveNote(noteId, "doctor-demo", edited);
    setNotes(await getPendingNotes());
    if (selected) setDetail(await getSessionDetail(selected));
  }

  async function onCorrectField(docId, name, value) {
    await correctDocumentField(docId, name, value);
    if (selected) setDetail(await getSessionDetail(selected));
  }

  const entries = Array.isArray(queue.entries) ? queue.entries : [];
  const redCount = entries.filter((e) => e.severity === "red").length;

  return (
    <div className="layout">
      <header className="app-bar">
        <div className="app-bar-brand">
          <div className="app-logo" aria-hidden="true">✿</div>
          <h1 className="app-title">Sehat Sakhi · Doctor</h1>
        </div>
        <div className="app-bar-actions">
          <span className={`chip ${connected ? "conn-live" : "conn-poll"}`}>
            {connected ? "Live" : "Polling"}
          </span>
          <span className="chip stat-waiting">
            <strong>{entries.length}</strong> waiting
          </span>
          {redCount > 0 && (
            <span className="chip stat-red">
              <strong>{redCount}</strong> critical
            </span>
          )}
          <span className="chip stat-notes">
            <strong>{notes.length}</strong> note{notes.length === 1 ? "" : "s"}
          </span>
          <button type="button" className="chip walkin-btn" onClick={() => setWalkInOpen(true)}>
            Walk-in nurse
          </button>
          <button type="button" className="chip refresh-btn" onClick={refresh}>
            Refresh
          </button>
        </div>
      </header>

      {walkInOpen && (
        <WalkInNurse
          onClose={() => setWalkInOpen(false)}
          onComplete={async (sessionId) => {
            await refresh();
            if (sessionId) await selectPatient(sessionId);
          }}
        />
      )}

      <div className="banners">
        {!queue.live && (
          <div className="banner paused">
            <span className="banner-icon" aria-hidden="true">⚠</span>
            {queue.banner || "Background auto-rescore paused — Redis/Celery offline"}
          </div>
        )}
        {redCount > 0 && (
          <div className="banner critical">
            <span className="banner-icon" aria-hidden="true">🚨</span>
            {redCount} patient{redCount > 1 ? "s" : ""} flagged RED — deterministic rule
            engine escalation (cannot be downgraded by AI)
          </div>
        )}
      </div>

      <div className="main">
        <section className="panel queue">
          <div className="panel-header">
            <h2>Priority Queue ({entries.length})</h2>
          </div>
          <div className="panel-body scroll">
            {entries.length === 0 && (
              <div className="queue-empty">
                <p className="muted">No patients waiting.</p>
                <button type="button" className="mini" onClick={refresh} style={{ marginTop: 12 }}>
                  Reload queue
                </button>
              </div>
            )}
            {entries.map((e, i) => (
              <button
                key={e.session_id}
                className={`qcard sev-${e.severity} ${selected === e.session_id ? "sel" : ""}`}
                onClick={() => selectPatient(e.session_id)}
              >
                <div className={`avatar ${avatarColor(e.patient_name)}`}>
                  {initials(e.patient_name)}
                </div>
                <div className="qcard-content">
                  <div className="qcard-top">
                    <span className="qcard-rank">#{i + 1}</span>
                    <span className="qcard-name">{e.patient_name}</span>
                    <span className={`pill sev-${e.severity}`}>{SEV_LABEL[e.severity]}</span>
                  </div>
                  <div className="qcard-meta">{formatMeta(e)}</div>
                  <div className="qcard-footer">
                    <span>Score {e.priority_score}</span>
                    <span>{e.minutes_waited} min wait</span>
                    {e.document_count > 0 && <span>{e.document_count} doc{e.document_count > 1 ? "s" : ""}</span>}
                    {e.auto_escalated && <span className="escalated">Auto-escalated</span>}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </section>

        <section className="panel detail">
          {!detail && (
            <div className="empty">
              <div className="empty-icon" aria-hidden="true">👤</div>
              <h2>Select a patient</h2>
              <p className="muted">
                Click a queue entry to see their profile, AI intake conversation,
                uploaded documents, and pre-visit briefing.
              </p>
            </div>
          )}

          {detail && (
            <>
              <div className="patient-header">
                <div className={`avatar lg ${avatarColor(detail.patient.name)}`}>
                  {initials(detail.patient.name)}
                </div>
                <div className="patient-info">
                  <h2>{detail.patient.name}</h2>
                  <p className="patient-subline">
                    {detail.patient.age ? `${detail.patient.age} yrs` : "Age n/a"} ·{" "}
                    {detail.patient.gender || "Gender n/a"} ·{" "}
                    {detail.patient.phone || "No phone"} ·{" "}
                    ABHA {detail.patient.abha_id || "not linked"}
                  </p>
                  <p className="patient-subline">
                    Registered{" "}
                    {new Date(detail.patient.registered_at + "Z").toLocaleString(undefined, {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                  </p>
                  <p className="patient-complaint">
                    Chief complaint: <strong>{detail.chief_complaint}</strong>
                  </p>
                  <div className="patient-chips">
                    <span className={`pill sev-${detail.severity}`}>
                      {SEV_LABEL[detail.severity]}
                    </span>
                    {detail.documents.length > 0 && (
                      <span className="info-chip docs">
                        {detail.documents.length} document{detail.documents.length > 1 ? "s" : ""}
                      </span>
                    )}
                    <span className={`info-chip ${detail.completed ? "complete" : "in-progress"}`}>
                      Intake {detail.completed ? "complete" : "in progress"}
                    </span>
                  </div>
                </div>
              </div>

              <nav className="tabs" role="tablist">
                {["briefing", "conversation", "documents", "symptoms", "escalations", "self-care"].map((t) => (
                  <button
                    key={t}
                    role="tab"
                    aria-selected={tab === t}
                    className={tab === t ? "tab on" : "tab"}
                    onClick={() => setTab(t)}
                  >
                    {t}
                    {t === "documents" && detail.documents.length > 0 && ` (${detail.documents.length})`}
                  </button>
                ))}
              </nav>

              <div className="tab-content">
                {tab === "briefing" && <BriefingTab briefing={detail.briefing} />}
                {tab === "conversation" && <ConversationTab transcript={detail.transcript} />}
                {tab === "documents" && (
                  <DocumentsTab documents={detail.documents} onCorrect={onCorrectField} />
                )}
                {tab === "symptoms" && <SymptomsTab symptoms={detail.symptoms} />}
                {tab === "escalations" && <EscalationsTab escalations={detail.escalations} />}
                {tab === "self-care" && (
                  <SelfCareTab note={detail.self_care_note} notes={notes} onApprove={onApprove} />
                )}
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}

function BriefingTab({ briefing }) {
  if (!briefing) {
    return <p className="muted">Briefing is generated when the intake conversation completes.</p>;
  }
  const prose = briefing.paraphrased_prose;
  return (
    <div>
      <h3>Structured summary (deterministic)</h3>
      <ul>
        {Object.entries(briefing.structured_summary || {}).map(([k, v]) => (
          <li key={k}>
            <b>{k}:</b> {Array.isArray(v) ? v.join(", ") : String(v)}
          </li>
        ))}
      </ul>
      <h3>Doctor briefing</h3>
      {prose ? (
        <p>{prose}</p>
      ) : (
        <p className="pending">Briefing text pending — structured data above is complete.</p>
      )}
    </div>
  );
}

function ConversationTab({ transcript }) {
  if (!transcript?.length) return <p className="muted">No conversation recorded.</p>;
  return (
    <div className="chat">
      {transcript.map((m, i) => (
        <div key={i} className={`bubble ${m.role}`}>
          <span className="who">{m.role === "assistant" ? "AI Intake" : "Patient"}</span>
          <p>{m.text}</p>
        </div>
      ))}
    </div>
  );
}

function DocumentsTab({ documents, onCorrect }) {
  if (!documents.length) {
    return <p className="muted">No documents uploaded by the patient yet.</p>;
  }
  return (
    <div>
      {documents.map((d) => (
        <div key={d.id} className="doc-card">
          <div className="doc-head">
            <b>{d.filename}</b>
            <span className="muted">{d.doc_type} · source: {d.source}</span>
            {d.low_confidence_count > 0 && (
              <span className="lowconf">{d.low_confidence_count} low-confidence field(s) — verify</span>
            )}
          </div>
          {d.fields.length === 0 && (
            <p className="pending">Extraction pending — OCR provider unavailable.</p>
          )}
          {d.fields.map((f) => (
            <FieldRow key={f.name + f.value} docId={d.id} field={f} onCorrect={onCorrect} />
          ))}
        </div>
      ))}
    </div>
  );
}

function FieldRow({ docId, field, onCorrect }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(field.value);
  return (
    <div className={`field-row ${field.low_confidence ? "low" : ""}`}>
      <span className="fname">{field.name}</span>
      {editing ? (
        <>
          <input value={value} onChange={(e) => setValue(e.target.value)} />
          <button
            className="mini"
            onClick={() => {
              onCorrect(docId, field.name, value);
              setEditing(false);
            }}
          >
            Save
          </button>
        </>
      ) : (
        <>
          <span className="fvalue">{field.value}</span>
          <span className="conf">{Math.round(field.confidence * 100)}%</span>
          {field.low_confidence && (
            <button className="mini" onClick={() => setEditing(true)}>Correct</button>
          )}
        </>
      )}
    </div>
  );
}

function SymptomsTab({ symptoms }) {
  if (!symptoms.length) return <p className="muted">No symptoms recorded yet.</p>;
  return (
    <table className="table">
      <thead>
        <tr><th>Patient said</th><th>Mapped term</th><th>ICD-10</th><th>Source</th></tr>
      </thead>
      <tbody>
        {symptoms.map((s, i) => (
          <tr key={i}>
            <td>{s.raw_phrase}</td>
            <td>{s.canonical_term || "—"}</td>
            <td>{s.icd10_code || "—"}</td>
            <td>
              <span className={`src ${s.source === "local_table" ? "local" : "llm"}`}>
                {s.source || "unmapped"}
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function EscalationsTab({ escalations }) {
  if (!escalations.length) return <p className="muted">No escalations for this visit.</p>;
  return (
    <div>
      {escalations.map((e, i) => (
        <div key={i} className="esc-row">
          <span className={`pill sev-${e.from_severity || "green"}`}>{e.from_severity || "—"}</span>
          <span className="arrow">→</span>
          <span className={`pill sev-${e.to_severity}`}>{e.to_severity}</span>
          <span className="muted">rule: {e.rule_id || "n/a"} · {e.reason}</span>
        </div>
      ))}
      <p className="muted note-line">
        Escalations are one-way by design — no AI output can lower a severity level.
      </p>
    </div>
  );
}

function SelfCareTab({ note, notes, onApprove }) {
  const pendingForSession = note && note.approval_status === "pending" ? note : null;
  return (
    <div>
      {!note && (
        <p className="muted">
          No self-care note drafted for this visit (LLM unavailable, or intake incomplete).
        </p>
      )}
      {note && !pendingForSession && (
        <div>
          <p>
            <b>Status:</b> {note.approval_status}{" "}
            {note.sent_to_patient ? "· sent to patient" : "· not sent"}
          </p>
          <p>{note.final_text || note.draft_text}</p>
        </div>
      )}
      {pendingForSession && <NoteCard note={pendingForSession} onApprove={onApprove} />}
      {notes.length > 0 && (
        <>
          <h3>All notes awaiting approval ({notes.length})</h3>
          {notes.map((n) => <NoteCard key={n.id} note={n} onApprove={onApprove} />)}
        </>
      )}
    </div>
  );
}

function NoteCard({ note, onApprove }) {
  const [text, setText] = useState(note.draft_text);
  const edited = text !== note.draft_text;
  return (
    <div className="note">
      <p className="muted">Session {note.session_id.slice(0, 8)} · drafted by AI, doctor-gated</p>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} />
      <div className="note-actions">
        <button className="btn-filled" onClick={() => onApprove(note.id, edited ? text : null)}>
          {edited ? "Save & approve" : "Approve"}
        </button>
      </div>
    </div>
  );
}

import { useEffect, useState, useCallback } from "react";
import {
  getQueueStatus,
  getBriefing,
  getPendingNotes,
  approveNote,
  openQueueSocket,
} from "./api.js";

const SEV_LABEL = { red: "RED", amber: "AMBER", green: "GREEN" };

export default function App() {
  const [queue, setQueue] = useState({ live: false, banner: null, entries: [] });
  const [selected, setSelected] = useState(null);
  const [briefing, setBriefing] = useState(null);
  const [notes, setNotes] = useState([]);
  const [connected, setConnected] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setQueue(await getQueueStatus());
      setNotes(await getPendingNotes());
    } catch {
      setQueue((q) => ({ ...q, live: false, banner: "backend unreachable" }));
    }
  }, []);

  useEffect(() => {
    refresh();
    const ws = openQueueSocket((data) => {
      setQueue(data);
      setConnected(true);
    });
    ws.onclose = () => setConnected(false);
    ws.onerror = () => setConnected(false);
    const poll = setInterval(refresh, 8000);
    return () => {
      ws.close();
      clearInterval(poll);
    };
  }, [refresh]);

  async function selectPatient(sessionId) {
    setSelected(sessionId);
    setBriefing(await getBriefing(sessionId));
  }

  async function onApprove(noteId, edited) {
    await approveNote(noteId, "doctor-demo", edited);
    setNotes(await getPendingNotes());
  }

  return (
    <div className="layout">
      <header>
        <h1>Doctor Dashboard</h1>
        <span className={`conn ${connected ? "on" : "off"}`}>
          {connected ? "live" : "polling"}
        </span>
      </header>

      {!queue.live && (
        <div className="banner paused">
          {queue.banner || "live updates paused — showing last-known order"}
        </div>
      )}

      <div className="grid">
        <section className="queue">
          <h2>Priority Queue</h2>
          {queue.entries.length === 0 && <p className="muted">No patients waiting.</p>}
          {queue.entries.map((e, i) => (
            <button
              key={e.session_id}
              className={`qrow sev-${e.severity} ${selected === e.session_id ? "sel" : ""}`}
              onClick={() => selectPatient(e.session_id)}
            >
              <span className="rank">#{i + 1}</span>
              <span className={`pill sev-${e.severity}`}>{SEV_LABEL[e.severity]}</span>
              <span className="score">score {e.priority_score}</span>
              <span className="waited">{e.minutes_waited} min</span>
              {e.auto_escalated && <span className="escalated">auto-escalated</span>}
            </button>
          ))}
        </section>

        <section className="detail">
          <h2>Pre-Visit Briefing</h2>
          {!briefing && <p className="muted">Select a patient to view their briefing.</p>}
          {briefing && (
            <div>
              <p className={`pill sev-${briefing.severity}`}>{SEV_LABEL[briefing.severity]}</p>
              <h3>Structured summary</h3>
              <ul>
                {Object.entries(briefing.structured_summary).map(([k, v]) => (
                  <li key={k}>
                    <b>{k}:</b> {Array.isArray(v) ? v.join(", ") : String(v)}
                  </li>
                ))}
              </ul>
              <h3>Doctor prose</h3>
              {briefing.paraphrase_status !== "ready" ? (
                <p className="pending">{briefing.paraphrase_status}</p>
              ) : (
                <p>{briefing.paraphrased_prose}</p>
              )}
            </div>
          )}

          <h2>Self-Care Notes Awaiting Approval</h2>
          {notes.length === 0 && <p className="muted">No notes pending approval.</p>}
          {notes.map((n) => (
            <NoteCard key={n.id} note={n} onApprove={onApprove} />
          ))}
        </section>
      </div>
    </div>
  );
}

function NoteCard({ note, onApprove }) {
  const [text, setText] = useState(note.draft_text);
  const edited = text !== note.draft_text;
  return (
    <div className="note">
      <p className="muted">session {note.session_id.slice(0, 8)}</p>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} />
      <div className="note-actions">
        <button onClick={() => onApprove(note.id, edited ? text : null)}>
          {edited ? "Save & approve" : "Approve"}
        </button>
      </div>
    </div>
  );
}

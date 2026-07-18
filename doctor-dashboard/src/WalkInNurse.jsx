import { useEffect, useRef, useState } from "react";
import { answerIntake, startWalkInIntake, transcribeVoice } from "./api.js";
import { listenWithBrowserSpeech, speakNurse, stopNurseSpeech } from "./nurseVoice.js";

/**
 * Front-desk AI nurse for walk-in patients (no phone app).
 * Speaks with sweet female voice (Groq Celeste / browser female TTS).
 * Listens via Chrome speech recognition, Whisper as backup.
 */
export default function WalkInNurse({ onComplete, onClose }) {
  const [name, setName] = useState("");
  const [age, setAge] = useState("");
  const [gender, setGender] = useState("");
  const [phone, setPhone] = useState("");
  const [phase, setPhase] = useState("register");
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [sessionId, setSessionId] = useState(null);
  const [nodeId, setNodeId] = useState(null);
  const [severity, setSeverity] = useState("green");
  const [listening, setListening] = useState(false);
  const [voiceOn, setVoiceOn] = useState(true);
  const mediaRef = useRef(null);
  const chunksRef = useRef([]);
  const scrollRef = useRef(null);

  useEffect(() => {
    scrollRef.current?.scrollTo?.({ top: 99999, behavior: "smooth" });
  }, [messages]);

  useEffect(() => () => stopNurseSpeech(), []);

  async function say(text) {
    setMessages((m) => [...m, { role: "assistant", text }]);
    if (voiceOn) {
      try {
        await speakNurse(text);
      } catch { /* ignore TTS errors */ }
    }
  }

  function heard(text) {
    setMessages((m) => [...m, { role: "patient", text }]);
  }

  async function beginChat(e) {
    e?.preventDefault?.();
    setErr("");
    if (!name.trim()) {
      setErr("Patient name is required");
      return;
    }
    setPhase("chat");
    setMessages([]);
    const first = name.trim().split(/\s+/)[0];
    await say(
      `Hi ${first}, welcome — I'm glad you're here. I'm the clinic AI nurse. I'll ask a few gentle questions so the doctor has what they need. This isn't a diagnosis. What brings you in today?`,
    );
  }

  async function sendText(text) {
    const trimmed = (text || "").trim();
    if (!trimmed || busy) return;
    setInput("");
    heard(trimmed);
    setBusy(true);
    setErr("");
    try {
      if (!sessionId) {
        const res = await startWalkInIntake({
          patient_name: name.trim(),
          age: age ? Number(age) : null,
          gender: gender || null,
          phone: phone.trim() || null,
          chief_complaint: trimmed,
        });
        setSessionId(res.session_id);
        setSeverity(res.severity || "green");
        if (res.greeting) await say(res.greeting);
        if (res.complete) {
          setPhase("done");
          setNodeId(null);
          await say("You're checked in. Please take a seat — you're in the live queue.");
          onComplete?.(res.session_id);
        } else {
          setNodeId(res.node_id);
          if (res.question) await say(res.question);
        }
      } else if (nodeId) {
        const res = await answerIntake(sessionId, nodeId, trimmed);
        setSeverity(res.severity || severity);
        if (res.complete) {
          setPhase("done");
          setNodeId(null);
          await say("Thank you — that's everything. You're in the queue now.");
          onComplete?.(sessionId);
        } else {
          setNodeId(res.node_id);
          if (res.question) await say(res.question);
        }
      }
    } catch (ex) {
      setErr(ex.message || "Could not reach intake API");
      await say("Sorry — I lost the connection. Please try that answer again.");
    } finally {
      setBusy(false);
    }
  }

  async function startListening() {
    setErr("");
    setListening(true);
    stopNurseSpeech();

    // 1) Browser speech recognition (best UX on Chrome dashboard)
    const browserText = await listenWithBrowserSpeech({ lang: "en-IN", timeoutMs: 10000 });
    if (browserText) {
      setListening(false);
      await sendText(browserText);
      return;
    }

    // 2) Whisper: auto-record ~5s then transcribe
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm")
          ? "audio/webm"
          : undefined;
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunksRef.current = [];
      rec.ondataavailable = (ev) => {
        if (ev.data.size) chunksRef.current.push(ev.data);
      };
      mediaRef.current = rec;
      setErr("Listening with clinic mic… speak clearly for a few seconds.");
      const stopped = new Promise((resolve) => {
        rec.onstop = () => resolve();
      });
      rec.start();
      await new Promise((r) => setTimeout(r, 5000));
      if (rec.state !== "inactive") rec.stop();
      await stopped;
      stream.getTracks().forEach((t) => t.stop());
      setListening(false);
      const blob = new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" });
      if (!blob.size) {
        setErr("No audio captured — allow microphone, or type the answer.");
        return;
      }
      setBusy(true);
      try {
        const result = await transcribeVoice(blob, "speech.webm");
        if (result.status !== "ok" || !result.text) {
          setErr("Couldn't hear clearly — please type the answer, or tap Talk again.");
          return;
        }
        await sendText(result.text);
      } catch (ex) {
        setErr(ex.message || "Voice failed");
      } finally {
        setBusy(false);
      }
    } catch {
      setListening(false);
      setErr("Microphone blocked — allow mic in the browser, or type answers.");
    }
  }

  function stopListening() {
    setListening(false);
    const rec = mediaRef.current;
    if (rec && rec.state !== "inactive") rec.stop();
  }

  function handleClose() {
    stopNurseSpeech();
    stopListening();
    onClose?.();
  }

  return (
    <div className="walkin-overlay" role="dialog" aria-label="Walk-in AI nurse">
      <div className="walkin-panel">
        <div className="walkin-head">
          <div>
            <h2>Walk-in AI nurse</h2>
            <p className="muted">
              Speaks in a soft female voice. Patients without the app can talk or type.
            </p>
          </div>
          <button type="button" className="mini" onClick={handleClose}>Close</button>
        </div>

        {phase === "register" && (
          <form className="walkin-form" onSubmit={beginChat}>
            <label>
              Patient name *
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Meera Shah" required />
            </label>
            <div className="walkin-row">
              <label>
                Age
                <input value={age} onChange={(e) => setAge(e.target.value)} inputMode="numeric" placeholder="32" />
              </label>
              <label>
                Gender
                <select value={gender} onChange={(e) => setGender(e.target.value)}>
                  <option value="">—</option>
                  <option value="female">Female</option>
                  <option value="male">Male</option>
                  <option value="other">Other</option>
                </select>
              </label>
            </div>
            <label>
              Phone (optional — links to existing account if registered)
              <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="10-digit mobile" />
            </label>
            <label className="walkin-check">
              <input type="checkbox" checked={voiceOn} onChange={(e) => setVoiceOn(e.target.checked)} />
              Nurse speaks aloud (sweet female voice)
            </label>
            {!!err && <p className="walkin-err">{err}</p>}
            <button type="submit" className="btn-filled">Start nurse intake</button>
          </form>
        )}

        {(phase === "chat" || phase === "done") && (
          <>
            <div className="walkin-meta">
              <span><b>{name}</b>{age ? ` · ${age}y` : ""}{gender ? ` · ${gender}` : ""}</span>
              {sessionId && <span className={`pill sev-${severity}`}>{severity.toUpperCase()}</span>}
            </div>
            <div className="walkin-chat" ref={scrollRef}>
              {messages.map((m, i) => (
                <div key={i} className={`bubble ${m.role}`}>
                  <span className="who">{m.role === "assistant" ? "AI Nurse" : "Patient"}</span>
                  <p>{m.text}</p>
                </div>
              ))}
            </div>
            {phase === "chat" && (
              <div className="walkin-input">
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Type patient's answer…"
                  disabled={busy}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      sendText(input);
                    }
                  }}
                />
                <button type="button" className="btn-filled" disabled={busy} onClick={() => sendText(input)}>
                  Send
                </button>
                <button
                  type="button"
                  className={`mini voice-btn ${listening ? "rec" : ""}`}
                  disabled={busy}
                  onClick={() => (listening ? stopListening() : startListening())}
                  title="Talk to the nurse"
                >
                  {listening ? "Stop mic" : "Talk"}
                </button>
              </div>
            )}
            {phase === "done" && (
              <p className="muted" style={{ marginTop: 8 }}>
                Patient is in the priority queue. Select them from the left panel for the full briefing.
              </p>
            )}
            {!!err && <p className="walkin-err">{err}</p>}
          </>
        )}
      </div>
    </div>
  );
}

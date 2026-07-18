function resolveApiBase() {
  const fromEnv = import.meta.env.VITE_API_BASE;
  if (fromEnv !== undefined && fromEnv !== null && String(fromEnv).length > 0) {
    return String(fromEnv).replace(/\/$/, "");
  }
  if (typeof window !== "undefined") {
    const host = window.location.hostname;
    if (host && host !== "localhost" && host !== "127.0.0.1") {
      return ""; // same-origin on Render
    }
  }
  return "http://localhost:8000";
}

const BASE = resolveApiBase();

async function jsonFetch(path, options = {}, { retries = 1 } = {}) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(`${BASE}${path}`, options);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const detail = data.detail;
        const msg =
          typeof detail === "string"
            ? detail
            : Array.isArray(detail)
              ? detail[0]?.msg
              : `HTTP ${res.status}`;
        throw new Error(msg || `HTTP ${res.status}`);
      }
      return data;
    } catch (e) {
      lastErr = e;
      const network = e?.name === "TypeError" || /failed to fetch/i.test(String(e?.message));
      if (!network || i === retries) {
        if (network) throw new Error(`Can't reach API at ${BASE}`);
        throw e;
      }
      await new Promise((r) => setTimeout(r, 350 * (i + 1)));
    }
  }
  throw lastErr;
}

export async function getQueueStatus() {
  const data = await jsonFetch("/api/queue/status", {}, { retries: 2 });
  return {
    live: !!data.live,
    banner: data.banner || null,
    entries: Array.isArray(data.entries) ? data.entries : [],
  };
}

export async function startWalkInIntake(payload) {
  return jsonFetch("/api/intake/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function answerIntake(sessionId, nodeId, answer) {
  return jsonFetch("/api/intake/answer", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session_id: sessionId, node_id: nodeId, answer }),
  });
}

export async function transcribeVoice(blob, filename = "speech.webm") {
  const form = new FormData();
  form.append("file", blob, filename);
  return jsonFetch("/api/voice/transcribe", { method: "POST", body: form }, { retries: 0 });
}

export async function getSessionDetail(sessionId) {
  const res = await fetch(`${BASE}/api/sessions/${sessionId}/detail`);
  if (!res.ok) return null;
  return res.json();
}

export async function getPendingNotes() {
  const res = await fetch(`${BASE}/api/self-care/pending`);
  return res.json();
}

export async function approveNote(noteId, doctorId, editedText) {
  const res = await fetch(`${BASE}/api/self-care/${noteId}/approve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ doctor_id: doctorId, edited_text: editedText || null }),
  });
  return res.json();
}

export async function correctDocumentField(docId, fieldName, correctedValue) {
  const form = new FormData();
  form.append("field_name", fieldName);
  form.append("corrected_value", correctedValue);
  const res = await fetch(`${BASE}/api/documents/${docId}/correct`, {
    method: "POST",
    body: form,
  });
  return res.json();
}

export function openQueueSocket(onMessage) {
  const wsBase = BASE.replace(/^http/, "ws");
  const ws = new WebSocket(`${wsBase}/api/queue/ws`);
  ws.onmessage = (e) => onMessage(JSON.parse(e.data));
  return ws;
}

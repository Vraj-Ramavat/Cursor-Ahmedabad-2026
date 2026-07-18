const BASE = import.meta.env.VITE_API_BASE || "http://localhost:8000";

export async function getQueueStatus() {
  const res = await fetch(`${BASE}/api/queue/status`);
  return res.json();
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

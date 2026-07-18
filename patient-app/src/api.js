/** Same-origin on Render; localhost:8000 for local API. */
function resolveApiBase() {
  const fromEnv = process.env.EXPO_PUBLIC_API_BASE;
  if (fromEnv !== undefined && fromEnv !== null && String(fromEnv).length > 0) {
    return String(fromEnv).replace(/\/$/, "");
  }
  if (typeof window !== "undefined") {
    const host = window.location.hostname;
    if (host && host !== "localhost" && host !== "127.0.0.1") {
      return window.location.origin;
    }
  }
  return "http://localhost:8000";
}

export const API_BASE = resolveApiBase();

let _token = null;
let _onUnauthorized = null;

try {
  if (typeof localStorage !== "undefined") {
    _token = localStorage.getItem("clinic_token");
  }
} catch {}

export function getToken() {
  return _token;
}

export function setToken(token) {
  _token = token || null;
  try {
    if (typeof localStorage !== "undefined") {
      if (token) localStorage.setItem("clinic_token", token);
      else localStorage.removeItem("clinic_token");
    }
  } catch {}
}

export function clearToken() {
  setToken(null);
}

/** App can register a handler so 401s force re-login. */
export function onUnauthorized(handler) {
  _onUnauthorized = handler;
}

function syncTokenFromStorage() {
  try {
    if (typeof localStorage !== "undefined") {
      const stored = localStorage.getItem("clinic_token");
      if (stored) _token = stored;
    }
  } catch {}
  return _token;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function parseError(res) {
  const data = await res.json().catch(() => ({}));
  const detail = data.detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail) && detail[0]?.msg) return detail[0].msg;
  return `HTTP ${res.status}`;
}

/**
 * Shared fetch with optional auth, retry/polling on network blips,
 * and clear 401 handling (stale token after DB reset).
 */
async function req(path, { method = "GET", body, auth = false, form = false, retries = 2 } = {}) {
  if (auth) {
    syncTokenFromStorage();
    if (!_token) {
      throw new Error("Please sign in again — your session expired.");
    }
  }

  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const headers = {};
      if (!form) headers["Content-Type"] = "application/json";
      if (auth && _token) headers.Authorization = `Bearer ${_token}`;

      const res = await fetch(`${API_BASE}${path}`, {
        method,
        headers,
        body: form ? body : body ? JSON.stringify(body) : undefined,
      });

      if (res.status === 401) {
        clearToken();
        if (_onUnauthorized) _onUnauthorized();
        const msg = await parseError(res);
        throw new Error(msg === "invalid token" || msg === "missing token"
          ? "Please sign in again — your session expired."
          : msg);
      }

      if (!res.ok) throw new Error(await parseError(res));
      if (res.status === 204) return null;
      return await res.json().catch(() => ({}));
    } catch (e) {
      lastErr = e;
      const network =
        e?.name === "TypeError" ||
        /failed to fetch|networkerror|load failed/i.test(String(e?.message || e));
      if (!network || attempt === retries) {
        if (network) {
          throw new Error(
            `Can't reach clinic server at ${API_BASE}. Is the backend running on port 8000?`,
          );
        }
        throw e;
      }
      await sleep(400 * (attempt + 1));
    }
  }
  throw lastErr;
}

// ── Auth ──────────────────────────────────────────────────────────────────────

export const register = (payload) =>
  req("/api/auth/register", { method: "POST", body: payload });

export const login = (phone) =>
  req("/api/auth/login", { method: "POST", body: { phone } });

export const me = () => req("/api/auth/me", { auth: true });

export const updateHealth = (payload) =>
  req("/api/auth/me/health-profile", { method: "PUT", body: payload, auth: true });

export const myVisits = () => req("/api/auth/me/visits", { auth: true });

// ── Intake ────────────────────────────────────────────────────────────────────

export const startIntake = (account, complaint) =>
  req("/api/intake/start", {
    method: "POST",
    body: {
      patient_name: account.name,
      patient_id: account.patient_id,
      age: account.age,
      gender: account.gender,
      phone: account.phone,
      abha_id: account.abha_id,
      chief_complaint: complaint,
    },
    retries: 1,
  });

export const answerIntake = (sessionId, nodeId, answer) =>
  req("/api/intake/answer", {
    method: "POST",
    body: { session_id: sessionId, node_id: nodeId, answer },
    retries: 1,
  });

export const getQueueStatus = () => req("/api/queue/status");

export const getSelfCareNote = (sessionId) =>
  req(`/api/self-care/session/${sessionId}`);

// ── Meals ─────────────────────────────────────────────────────────────────────

export const getMealPlan = (days = 15, sessionId) => {
  let q = `/api/meals/plan?days=${days}&include_videos=true&persist=true`;
  if (sessionId) q += `&session_id=${encodeURIComponent(sessionId)}`;
  return req(q, { auth: true });
};

export const getCurrentMealPlan = () => req("/api/meals/current", { auth: true });

export const clearMealPlan = () =>
  req("/api/meals/current", { method: "DELETE", auth: true });

// ── Documents ─────────────────────────────────────────────────────────────────

/** Build a real File/Blob for web; keep RN-style object for native. */
async function toUploadPart(file) {
  const name = file.name || file.fileName || "scan.jpg";
  const type = file.mimeType || file.type || "image/jpeg";

  if (file.file instanceof Blob) {
    return { blob: file.file, name, type };
  }

  const uri = file.uri;
  if (!uri) throw new Error("No image selected");

  // Expo web / browser: fetch the blob URL and append a real File.
  if (
    typeof window !== "undefined" &&
    (uri.startsWith("blob:") || uri.startsWith("data:") || uri.startsWith("http"))
  ) {
    const res = await fetch(uri);
    const blob = await res.blob();
    return { blob, name, type: blob.type || type };
  }

  // Native React Native FormData shape
  return {
    native: {
      uri,
      name,
      type,
    },
  };
}

export async function uploadDocument(sessionId, file, docType = "prescription") {
  const form = new FormData();
  form.append("session_id", sessionId);
  form.append("doc_type", docType);

  const part = await toUploadPart(file);
  if (part.blob) {
    form.append("file", part.blob, part.name);
  } else {
    form.append("file", part.native);
  }

  return req("/api/documents/upload", { method: "POST", body: form, form: true, retries: 1 });
}

export async function transcribeVoice(blob, filename = "speech.webm") {
  const form = new FormData();
  form.append("file", blob, filename);
  return req("/api/voice/transcribe", { method: "POST", body: form, form: true, retries: 0 });
}

export async function analyzePrescription(file) {
  const form = new FormData();
  const part = await toUploadPart(file);
  if (part.blob) {
    form.append("file", part.blob, part.name);
  } else {
    form.append("file", part.native);
  }
  return req("/api/medicines/analyze", {
    method: "POST",
    body: form,
    form: true,
    auth: true,
    retries: 1,
  });
}

export async function analyzePrescriptionText(text) {
  return req("/api/medicines/analyze-text", {
    method: "POST",
    body: { text },
    auth: true,
  });
}

export async function consultMedicine(question, contextMedicines = []) {
  return req("/api/medicines/consult", {
    method: "POST",
    body: {
      question,
      context_medicines: contextMedicines,
    },
    auth: true,
  });
}

export async function medicineAlternatives(q) {
  return req(`/api/medicines/alternatives?q=${encodeURIComponent(q)}`, { auth: true });
}

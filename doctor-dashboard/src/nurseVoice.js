/**
 * AI nurse voice helpers.
 * Speak: browser sweet female voice first (instant), optional Groq Celeste if fast.
 * Listen: Chrome Web Speech API first, Whisper upload as backup.
 *
 * Pattern inspired by browser TTS + Groq PlayAI Celeste (see groq.com/docs/text-to-speech).
 */

function resolveApiBase() {
  const fromEnv = import.meta.env.VITE_API_BASE;
  if (fromEnv !== undefined && fromEnv !== null && String(fromEnv).length > 0) {
    return String(fromEnv).replace(/\/$/, "");
  }
  if (typeof window !== "undefined") {
    const host = window.location.hostname;
    if (host && host !== "localhost" && host !== "127.0.0.1") {
      return "";
    }
  }
  return "http://localhost:8000";
}

const BASE = resolveApiBase();

let audioEl = null;

function pickFemaleBrowserVoice() {
  const voices = window.speechSynthesis?.getVoices?.() || [];
  const preferred = [
    /zira/i,
    /susan/i,
    /samantha/i,
    /victoria/i,
    /karen/i,
    /moira/i,
    /tessa/i,
    /female/i,
    /google uk english female/i,
    /neerja/i,
    /heera/i,
    /raveena/i,
  ];
  for (const re of preferred) {
    const v = voices.find((x) => re.test(x.name) || re.test(x.voiceURI));
    if (v) return v;
  }
  // Prefer any en-* voice with higher pitch later
  return voices.find((v) => /^en/i.test(v.lang)) || voices[0] || null;
}

async function speakBrowserFemale(text) {
  if (!window.speechSynthesis) return false;
  // Ensure voices are loaded (Chrome quirk)
  let voices = window.speechSynthesis.getVoices();
  if (!voices.length) {
    await new Promise((r) => {
      window.speechSynthesis.onvoiceschanged = () => r();
      setTimeout(r, 400);
    });
    voices = window.speechSynthesis.getVoices();
  }

  return new Promise((resolve) => {
    try {
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(text);
      utter.rate = 0.92;
      utter.pitch = 1.2; // softer / sweeter
      utter.volume = 1;
      const voice = pickFemaleBrowserVoice();
      if (voice) utter.voice = voice;
      utter.onend = () => resolve(true);
      utter.onerror = () => resolve(false);
      window.speechSynthesis.speak(utter);
    } catch {
      resolve(false);
    }
  });
}

async function speakGroqCeleste(text) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 5000);
  try {
    const res = await fetch(`${BASE}/api/voice/speak`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, voice: "Celeste-PlayAI" }),
      signal: ctrl.signal,
    });
    if (!res.ok) return false;
    const buf = await res.arrayBuffer();
    if (buf.byteLength < 100) return false;
    const blob = new Blob([buf], { type: "audio/wav" });
    const url = URL.createObjectURL(blob);
    audioEl = new Audio(url);
    await new Promise((resolve, reject) => {
      audioEl.onended = () => {
        URL.revokeObjectURL(url);
        resolve();
      };
      audioEl.onerror = reject;
      audioEl.play().catch(reject);
    });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export async function speakNurse(text) {
  const clean = (text || "").trim();
  if (!clean) return;
  stopNurseSpeech();

  // Instant sweet female voice for demo reliability
  const ok = await speakBrowserFemale(clean);
  if (ok) return;

  // Optional neural voice if browser TTS unavailable
  await speakGroqCeleste(clean);
}

export function stopNurseSpeech() {
  try {
    window.speechSynthesis?.cancel?.();
    if (audioEl) {
      audioEl.pause();
      audioEl = null;
    }
  } catch { /* ignore */ }
}

export function listenWithBrowserSpeech({ lang = "en-IN", timeoutMs = 12000 } = {}) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return Promise.resolve(null);

  return new Promise((resolve) => {
    const rec = new SR();
    rec.lang = lang;
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    let done = false;
    const finish = (text) => {
      if (done) return;
      done = true;
      try { rec.stop(); } catch { /* ignore */ }
      resolve(text);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    rec.onresult = (ev) => {
      clearTimeout(timer);
      finish(ev.results?.[0]?.[0]?.transcript?.trim() || null);
    };
    rec.onerror = () => {
      clearTimeout(timer);
      finish(null);
    };
    rec.onend = () => {
      clearTimeout(timer);
      if (!done) finish(null);
    };
    try {
      rec.start();
    } catch {
      clearTimeout(timer);
      finish(null);
    }
  });
}

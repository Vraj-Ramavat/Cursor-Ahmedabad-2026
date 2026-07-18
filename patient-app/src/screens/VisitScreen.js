import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { answerIntake, getQueueStatus, myVisits, startIntake } from "../api";
import { glassCard, colors, radius, sevColor, sevText, spacing, palette } from "../theme";

const ACKS = [
  "Thank you — that helps.",
  "Got it, I'm noting that down.",
  "Okay, thanks for telling me.",
  "I hear you.",
];

export default function VisitScreen({ account, visit, onVisitChange }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [phase, setPhase] = useState("idle");
  const [busy, setBusy] = useState(false);
  const [sessionId, setSessionId] = useState(visit?.sessionId || null);
  const [nodeId, setNodeId] = useState(visit?.nodeId || null);
  const [severity, setSeverity] = useState(visit?.severity || "green");
  const [complaint, setComplaint] = useState(visit?.complaint || "");
  const [position, setPosition] = useState(null);
  const [live, setLive] = useState(true);
  const [history, setHistory] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const ackIdx = useRef(0);
  const scrollRef = useRef(null);

  useEffect(() => {
    if (!visit?.sessionId) return;
    setSessionId(visit.sessionId);
    setNodeId(visit.nodeId);
    setSeverity(visit.severity || "green");
    setComplaint(visit.complaint || "");
    if (visit.complete) {
      setPhase("done");
      if (messages.length === 0 && visit.messages?.length) setMessages(visit.messages);
    } else if (visit.nodeId || visit.complaint) {
      setPhase("intake");
    }
  }, [visit?.sessionId]);

  useEffect(() => {
    scrollRef.current?.scrollToEnd({ animated: true });
  }, [messages]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingHistory(true);
      try {
        const v = await myVisits();
        if (!cancelled) setHistory(Array.isArray(v) ? v : []);
      } catch {
        if (!cancelled) setHistory([]);
      } finally {
        if (!cancelled) setLoadingHistory(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [account?.patient_id, phase]);

  useEffect(() => {
    if (phase !== "done" || !sessionId) return;
    const poll = setInterval(async () => {
      try {
        const q = await getQueueStatus();
        setLive(q.live);
        const idx = q.entries.findIndex((e) => e.session_id === sessionId);
        setPosition(idx >= 0 ? idx + 1 : null);
      } catch {}
    }, 8000);
    return () => clearInterval(poll);
  }, [phase, sessionId]);

  function say(text) {
    setMessages((m) => [...m, { role: "assistant", text }]);
  }

  function heard(text) {
    setMessages((m) => [...m, { role: "patient", text }]);
  }

  function nextAck() {
    const t = ACKS[ackIdx.current % ACKS.length];
    ackIdx.current += 1;
    return t;
  }

  function syncVisit(patch) {
    onVisitChange((prev) => ({
      ...(prev || {}),
      sessionId,
      nodeId,
      severity,
      complaint,
      ...patch,
    }));
  }

  function beginVisit() {
    setMessages([]);
    setPhase("complaint");
    const first = account?.name?.split(/\s+/)[0] || "there";
    say(
      `Hi ${first}, it's good to see you. I'm your clinic AI nurse — think of me as a friendly check-in before the doctor. I'll ask a few short questions so nothing important gets missed. This is not a diagnosis. What brings you in today?`,
    );
  }

  async function handleSend() {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    heard(text);
    setBusy(true);

    try {
      if (phase === "complaint") {
        setComplaint(text);
        const res = await startIntake(account, text);
        setSessionId(res.session_id);
        setSeverity(res.severity);
        setPhase("intake");
        say(res.greeting);
        if (res.complete) {
          setPhase("done");
          setNodeId(null);
          say("You're all set — thanks for your patience. You're in the live queue now. Sit tight, and tell reception if anything suddenly feels worse.");
          syncVisit({
            sessionId: res.session_id,
            nodeId: null,
            severity: res.severity,
            complaint: text,
            complete: true,
          });
        } else {
          setNodeId(res.node_id);
          say(res.question);
          syncVisit({
            sessionId: res.session_id,
            nodeId: res.node_id,
            severity: res.severity,
            complaint: text,
            complete: false,
          });
        }
      } else if (phase === "intake" && sessionId && nodeId) {
        const res = await answerIntake(sessionId, nodeId, text);
        setSeverity(res.severity);
        if (res.complete) {
          setPhase("done");
          setNodeId(null);
          say("That's everything I needed — thank you. You're checked in and in the queue. We'll keep your place updated here.");
          syncVisit({ nodeId: null, severity: res.severity, complete: true });
        } else {
          setNodeId(res.node_id);
          say(res.acknowledgement || nextAck());
          if (res.question) say(res.question);
          syncVisit({ nodeId: res.node_id, severity: res.severity, complete: false });
        }
      }
    } catch (e) {
      say(
        e.message ||
          "I couldn't reach the clinic server just now. Please try that answer again in a moment.",
      );
    } finally {
      setBusy(false);
    }
  }

  function resetVisit() {
    setMessages([]);
    setSessionId(null);
    setNodeId(null);
    setSeverity("green");
    setComplaint("");
    setPhase("idle");
    setPosition(null);
    onVisitChange(null);
  }

  function formatDate(iso) {
    try {
      return new Date(iso).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
    } catch {
      return iso;
    }
  }

  const chatting = phase === "complaint" || phase === "intake";

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Text style={styles.title}>Visit intake</Text>
        {sessionId && (
          <View style={[styles.pill, { backgroundColor: sevColor[severity] }]}>
            <Text style={styles.pillText}>{severity.toUpperCase()}</Text>
          </View>
        )}
      </View>

      {phase === "done" && (
        <View style={styles.statusCard}>
          <Text style={styles.statusMain}>
            {position ? `#${position} in queue` : "Finding your place in the queue…"}
          </Text>
          <Text style={[styles.statusSub, { color: sevColor[severity] }]}>
            {sevText[severity]}
          </Text>
          {!live && <Text style={styles.paused}>Live updates paused.</Text>}
        </View>
      )}

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={styles.chatCard}>
          {phase === "idle" ? (
            <ScrollView contentContainerStyle={styles.idle}>
              <Text style={styles.idleTitle}>Ready to check in?</Text>
              <Text style={styles.idleSub}>
                Chat with the AI nurse — a few short questions so your doctor is prepared. Not a
                diagnosis, just visit prep.
              </Text>
              <TouchableOpacity style={styles.primaryBtn} onPress={beginVisit}>
                <Text style={styles.primaryBtnText}>Start new visit</Text>
              </TouchableOpacity>

              <Text style={styles.histTitle}>Your visits ({history.length})</Text>
              {loadingHistory ? (
                <ActivityIndicator color={colors.primary} />
              ) : history.length === 0 ? (
                <Text style={styles.idleSub}>No past visits yet — start one above.</Text>
              ) : (
                history.map((v) => (
                  <View key={v.session_id} style={styles.histCard}>
                    <View style={styles.histRow}>
                      <Text style={styles.histDate}>{formatDate(v.started_at)}</Text>
                      <View style={[styles.pill, { backgroundColor: sevColor[v.severity] || colors.green }]}>
                        <Text style={styles.pillText}>{(v.severity || "green").toUpperCase()}</Text>
                      </View>
                    </View>
                    <Text style={styles.histComplaint}>{v.chief_complaint || "Visit"}</Text>
                    <Text style={styles.histMeta}>
                      {v.completed ? "Completed" : "In progress"} · doctor can see this on the dashboard
                    </Text>
                  </View>
                ))
              )}
            </ScrollView>
          ) : (
            <ScrollView
              ref={scrollRef}
              style={styles.chatScroll}
              contentContainerStyle={styles.chatContent}
            >
              {messages.map((m, i) => (
                <View
                  key={i}
                  style={[
                    styles.bubble,
                    m.role === "assistant" ? styles.aiBubble : styles.userBubble,
                  ]}
                >
                  <Text style={[styles.bubbleWho, m.role === "patient" && styles.bubbleWhoLight]}>
                    {m.role === "assistant" ? "AI Nurse" : "You"}
                  </Text>
                  <Text style={[styles.bubbleText, m.role === "patient" && styles.bubbleTextLight]}>
                    {m.text}
                  </Text>
                </View>
              ))}
            </ScrollView>
          )}

          {chatting && (
            <View style={styles.inputRow}>
              <TextInput
                style={styles.input}
                value={input}
                onChangeText={setInput}
                placeholder="Type your answer…"
                placeholderTextColor={colors.muted}
                onSubmitEditing={handleSend}
                editable={!busy}
                multiline
              />
              <TouchableOpacity
                style={[styles.sendBtn, busy && styles.sendDisabled]}
                onPress={handleSend}
                disabled={busy}
              >
                <Text style={styles.sendText}>Send</Text>
              </TouchableOpacity>
            </View>
          )}

          {phase === "done" && (
            <TouchableOpacity style={styles.secondaryBtn} onPress={resetVisit}>
              <Text style={styles.secondaryBtnText}>Back to visits</Text>
            </TouchableOpacity>
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "transparent" },
  flex: { flex: 1, padding: spacing.md },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  title: {
    fontFamily: "Georgia",
    fontSize: 26,
    fontWeight: "600",
    color: colors.text,
    letterSpacing: -0.3,
  },
  pill: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: radius.pill },
  pillText: { color: "#fff", fontWeight: "700", fontSize: 11 },
  statusCard: {
    ...glassCard,
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
    padding: spacing.md,
  },
  statusMain: {
    fontFamily: "Georgia",
    fontSize: 20,
    fontWeight: "600",
    color: colors.text,
  },
  statusSub: { fontSize: 13, marginTop: 4 },
  paused: { color: colors.amber, fontSize: 12, marginTop: 6 },
  chatCard: {
    flex: 1,
    ...glassCard,
    overflow: "hidden",
  },
  idle: { padding: spacing.lg, paddingBottom: spacing.xl },
  idleTitle: {
    fontFamily: "Georgia",
    fontSize: 22,
    fontWeight: "600",
    color: colors.text,
  },
  idleSub: { color: colors.muted, marginTop: spacing.sm, lineHeight: 22 },
  primaryBtn: {
    backgroundColor: colors.primary,
    borderRadius: radius.pill,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: spacing.lg,
    marginBottom: spacing.lg,
  },
  primaryBtnText: { color: "#fff", fontWeight: "700", fontSize: 16 },
  histTitle: {
    fontSize: 11,
    fontWeight: "600",
    color: colors.muted,
    textTransform: "uppercase",
    letterSpacing: 1.5,
    marginBottom: spacing.sm,
  },
  histCard: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    backgroundColor: "rgba(255,255,255,0.55)",
  },
  histRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  histDate: { fontWeight: "700", color: colors.text },
  histComplaint: { color: colors.text, marginTop: 6 },
  histMeta: { color: colors.muted, fontSize: 12, marginTop: 4 },
  secondaryBtn: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    padding: spacing.md,
    alignItems: "center",
  },
  secondaryBtnText: { color: colors.primaryDark, fontWeight: "600" },
  chatScroll: { flex: 1 },
  chatContent: { padding: spacing.md },
  bubble: { maxWidth: "85%", borderRadius: radius.md, padding: 12, marginBottom: 8 },
  aiBubble: {
    backgroundColor: "rgba(107, 143, 113, 0.12)",
    alignSelf: "flex-start",
    borderWidth: 1,
    borderColor: "rgba(107, 143, 113, 0.2)",
  },
  userBubble: {
    backgroundColor: palette.sage,
    alignSelf: "flex-end",
  },
  bubbleWho: { color: colors.muted, fontSize: 10, fontWeight: "600", marginBottom: 2 },
  bubbleWhoLight: { color: "rgba(255,255,255,0.85)" },
  bubbleText: { color: colors.text, fontSize: 15, lineHeight: 21 },
  bubbleTextLight: { color: "#fff" },
  inputRow: {
    flexDirection: "row",
    padding: spacing.sm,
    gap: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    alignItems: "flex-end",
  },
  input: {
    flex: 1,
    borderWidth: 2,
    borderColor: "rgba(245, 212, 222, 0.7)",
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: colors.text,
    maxHeight: 100,
    backgroundColor: "rgba(255,255,255,0.7)",
  },
  sendBtn: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  sendDisabled: { opacity: 0.6 },
  sendText: { color: "#fff", fontWeight: "700" },
});

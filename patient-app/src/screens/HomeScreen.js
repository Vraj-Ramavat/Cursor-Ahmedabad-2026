import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { getQueueStatus } from "../api";
import { glassCard, colors, radius, sevColor, sevText, spacing, palette } from "../theme";

export default function HomeScreen({ account, visit, onNavigate }) {
  const [position, setPosition] = useState(null);
  const [live, setLive] = useState(true);
  const [loading, setLoading] = useState(false);

  const firstName = account?.name?.split(" ")[0] || "Friend";
  const hasActiveVisit = visit?.sessionId && !visit?.complete;

  useEffect(() => {
    if (!visit?.sessionId) return;
    let cancelled = false;

    async function poll() {
      setLoading(true);
      try {
        const q = await getQueueStatus();
        if (cancelled) return;
        setLive(q.live);
        const idx = q.entries.findIndex((e) => e.session_id === visit.sessionId);
        setPosition(idx >= 0 ? idx + 1 : null);
      } catch {
        /* queue may be empty */
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    poll();
    const id = setInterval(poll, 8000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [visit?.sessionId]);

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.wrap}>
        <Text style={styles.eyebrow}>Daylight · Sehat Sakhi</Text>
        <Text style={styles.greeting}>Hello, {firstName}</Text>
        <Text style={styles.sub}>The garden is open and calm</Text>

        {visit?.sessionId ? (
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle}>Active visit</Text>
              <View style={[styles.pill, { backgroundColor: sevColor[visit.severity] || colors.green }]}>
                <Text style={styles.pillText}>{(visit.severity || "green").toUpperCase()}</Text>
              </View>
            </View>
            <Text style={styles.complaint}>{visit.complaint || "Visit in progress"}</Text>
            {visit.complete ? (
              <>
                <Text style={styles.queueMain}>
                  {loading && position == null
                    ? "Checking queue…"
                    : position
                      ? `#${position} in queue`
                      : "In queue — position updating"}
                </Text>
                <Text style={[styles.queueSub, { color: sevColor[visit.severity] }]}>
                  {sevText[visit.severity] || sevText.green}
                </Text>
                {!live && (
                  <Text style={styles.paused}>Live updates paused — position may lag.</Text>
                )}
              </>
            ) : (
              <Text style={styles.hint}>Intake in progress — finish questions on the Visit tab.</Text>
            )}
          </View>
        ) : (
          <View style={[styles.card, styles.emptyCard]}>
            <Text style={styles.cardTitle}>No active visit</Text>
            <Text style={styles.hint}>Start a visit to check in and join the queue.</Text>
          </View>
        )}

        <Text style={styles.section}>Quick actions</Text>
        <View style={styles.actions}>
          <TouchableOpacity style={styles.action} onPress={() => onNavigate("visit")}>
            <Text style={styles.actionIcon}>✦</Text>
            <Text style={styles.actionLabel}>Start visit</Text>
            <Text style={styles.actionSub}>Begin intake chat</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.action} onPress={() => onNavigate("medicines")}>
            <Text style={styles.actionIcon}>✚</Text>
            <Text style={styles.actionLabel}>Medicine advisor</Text>
            <Text style={styles.actionSub}>Explain Rx · ask alternatives</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.action} onPress={() => onNavigate("meals")}>
            <Text style={styles.actionIcon}>◎</Text>
            <Text style={styles.actionLabel}>Meal plan</Text>
            <Text style={styles.actionSub}>Personalized meals</Text>
          </TouchableOpacity>
        </View>

        {hasActiveVisit && loading && (
          <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.md }} />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "transparent" },
  wrap: { padding: spacing.lg, paddingBottom: spacing.xl },
  eyebrow: {
    fontSize: 10,
    letterSpacing: 2.2,
    textTransform: "uppercase",
    color: colors.muted,
    fontWeight: "500",
    marginBottom: 6,
  },
  greeting: {
    fontFamily: "Georgia",
    fontSize: 32,
    fontWeight: "600",
    color: colors.text,
    letterSpacing: -0.5,
  },
  sub: { color: colors.muted, marginTop: 4, marginBottom: spacing.lg, fontSize: 14 },
  section: {
    fontSize: 11,
    fontWeight: "600",
    color: colors.muted,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
    textTransform: "uppercase",
    letterSpacing: 1.5,
  },
  card: {
    ...glassCard,
    padding: spacing.lg,
  },
  emptyCard: { borderStyle: "dashed", borderColor: palette.sageLight },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  cardTitle: {
    fontFamily: "Georgia",
    fontSize: 20,
    fontWeight: "600",
    color: colors.text,
  },
  pill: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: radius.pill },
  pillText: { color: "#fff", fontWeight: "700", fontSize: 11 },
  complaint: { color: colors.text, marginTop: spacing.sm, fontSize: 15, lineHeight: 22 },
  queueMain: {
    fontFamily: "Georgia",
    fontSize: 22,
    fontWeight: "600",
    color: colors.text,
    marginTop: spacing.md,
  },
  queueSub: { fontSize: 13, marginTop: 4, lineHeight: 18 },
  paused: { color: colors.amber, fontSize: 12, marginTop: spacing.sm },
  hint: { color: colors.muted, marginTop: spacing.sm, lineHeight: 20 },
  actions: { gap: spacing.sm },
  action: {
    ...glassCard,
    padding: spacing.md,
  },
  actionDisabled: { opacity: 0.5 },
  actionIcon: { fontSize: 20, marginBottom: 4, color: colors.primary },
  actionLabel: {
    fontFamily: "Georgia",
    fontSize: 17,
    fontWeight: "600",
    color: colors.text,
  },
  actionSub: { color: colors.muted, fontSize: 13, marginTop: 2 },
});

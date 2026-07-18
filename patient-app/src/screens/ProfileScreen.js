import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { me, myVisits, setToken, updateHealth } from "../api";
import { glassCard, colors, radius, sevColor, spacing, palette } from "../theme";

export default function ProfileScreen({ account, onAccountUpdate, onLogout }) {
  const [editing, setEditing] = useState(false);
  const [weight, setWeight] = useState("");
  const [height, setHeight] = useState("");
  const [diet, setDiet] = useState("");
  const [conditions, setConditions] = useState("");
  const [allergies, setAllergies] = useState("");
  const [visits, setVisits] = useState([]);
  const [loadingVisits, setLoadingVisits] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [visitErr, setVisitErr] = useState("");

  useEffect(() => {
    if (!account) return;
    setWeight(account.weight_kg?.toString() || "");
    setHeight(account.height_cm?.toString() || "");
    setDiet(account.diet_type || "");
    setConditions((account.conditions || []).join(", "));
    setAllergies((account.allergies || []).join(", "));
  }, [account]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingVisits(true);
      setVisitErr("");
      try {
        // Refresh profile from server so health fields show after meal questionnaire.
        const fresh = await me();
        if (!cancelled) {
          setToken(fresh.token);
          onAccountUpdate?.(fresh);
        }
        const v = await myVisits();
        if (!cancelled) setVisits(Array.isArray(v) ? v : []);
      } catch (e) {
        if (!cancelled) {
          setVisits([]);
          setVisitErr(e.message || "Could not load visits");
        }
      } finally {
        if (!cancelled) setLoadingVisits(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [account?.patient_id]);

  async function saveHealth() {
    setErr("");
    setBusy(true);
    try {
      const updated = await updateHealth({
        weight_kg: weight ? Number(weight) : null,
        height_cm: height ? Number(height) : null,
        diet_type: diet.trim() || null,
        conditions: conditions
          ? conditions.split(",").map((s) => s.trim()).filter(Boolean)
          : [],
        allergies: allergies
          ? allergies.split(",").map((s) => s.trim()).filter(Boolean)
          : [],
      });
      onAccountUpdate(updated);
      setEditing(false);
    } catch (e) {
      setErr(e.message || "Could not save");
    } finally {
      setBusy(false);
    }
  }

  function formatDate(iso) {
    try {
      return new Date(iso).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
    } catch {
      return iso;
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.wrap} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Profile</Text>

        <View style={styles.card}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>
              {(account?.name || "?").charAt(0).toUpperCase()}
            </Text>
          </View>
          <Text style={styles.name}>{account?.name}</Text>
          <Text style={styles.meta}>{account?.phone}</Text>
          {(account?.age || account?.gender) && (
            <Text style={styles.meta}>
              {[account.age && `${account.age} yrs`, account.gender].filter(Boolean).join(" · ")}
            </Text>
          )}
          {account?.abha_id && <Text style={styles.meta}>ABHA: {account.abha_id}</Text>}
        </View>

        <View style={styles.card}>
          <View style={styles.row}>
            <Text style={styles.cardTitle}>Health profile</Text>
            {!editing ? (
              <TouchableOpacity onPress={() => setEditing(true)}>
                <Text style={styles.link}>Edit</Text>
              </TouchableOpacity>
            ) : null}
          </View>

          {editing ? (
            <>
              <Text style={styles.label}>Weight (kg)</Text>
              <TextInput style={styles.input} value={weight} onChangeText={setWeight} keyboardType="decimal-pad" placeholderTextColor={colors.muted} />
              <Text style={styles.label}>Height (cm)</Text>
              <TextInput style={styles.input} value={height} onChangeText={setHeight} keyboardType="decimal-pad" placeholderTextColor={colors.muted} />
              <Text style={styles.label}>Diet</Text>
              <TextInput style={styles.input} value={diet} onChangeText={setDiet} placeholderTextColor={colors.muted} />
              <Text style={styles.label}>Conditions</Text>
              <TextInput style={styles.input} value={conditions} onChangeText={setConditions} placeholderTextColor={colors.muted} />
              <Text style={styles.label}>Allergies</Text>
              <TextInput style={styles.input} value={allergies} onChangeText={setAllergies} placeholderTextColor={colors.muted} />
              {!!err && <Text style={styles.err}>{err}</Text>}
              <View style={styles.editBtns}>
                <TouchableOpacity style={styles.cancelBtn} onPress={() => setEditing(false)}>
                  <Text style={styles.cancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.saveBtn} onPress={saveHealth} disabled={busy}>
                  {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveText}>Save</Text>}
                </TouchableOpacity>
              </View>
            </>
          ) : (
            <>
              <InfoRow label="Weight" value={account?.weight_kg ? `${account.weight_kg} kg` : "—"} />
              <InfoRow label="Height" value={account?.height_cm ? `${account.height_cm} cm` : "—"} />
              <InfoRow label="Diet" value={account?.diet_type || "—"} />
              <InfoRow label="Conditions" value={(account?.conditions || []).join(", ") || "—"} />
              <InfoRow label="Allergies" value={(account?.allergies || []).join(", ") || "—"} />
            </>
          )}
        </View>

        <Text style={styles.section}>Visit history</Text>
        {!!visitErr && <Text style={styles.err}>{visitErr}</Text>}
        {loadingVisits ? (
          <ActivityIndicator color={colors.primary} />
        ) : visits.length === 0 ? (
          <Text style={styles.empty}>
            No past visits yet. Complete a Visit intake and they will appear here.
          </Text>
        ) : (
          visits.map((v) => (
            <View key={v.session_id} style={styles.visitCard}>
              <View style={styles.visitHeader}>
                <Text style={styles.visitDate}>{formatDate(v.started_at)}</Text>
                <View style={[styles.pill, { backgroundColor: sevColor[v.severity] || colors.green }]}>
                  <Text style={styles.pillText}>{v.severity.toUpperCase()}</Text>
                </View>
              </View>
              <Text style={styles.visitComplaint}>{v.chief_complaint || "Visit"}</Text>
              <Text style={styles.visitStatus}>{v.completed ? "Completed" : "In progress"}</Text>
            </View>
          ))
        )}

        <TouchableOpacity style={styles.logoutBtn} onPress={onLogout}>
          <Text style={styles.logoutText}>Sign out</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

function InfoRow({ label, value }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "transparent" },
  wrap: { padding: spacing.lg, paddingBottom: spacing.xl },
  title: {
    fontFamily: "Georgia",
    fontSize: 26,
    fontWeight: "600",
    color: colors.text,
    marginBottom: spacing.lg,
    letterSpacing: -0.3,
  },
  card: {
    ...glassCard,
    padding: spacing.lg,
    marginBottom: spacing.sm,
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: palette.lotusSoft,
    borderWidth: 1,
    borderColor: palette.lotus,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.sm,
  },
  avatarText: { color: palette.lotusDeep, fontSize: 24, fontWeight: "700" },
  name: {
    fontFamily: "Georgia",
    fontSize: 22,
    fontWeight: "600",
    color: colors.text,
  },
  meta: { color: colors.muted, marginTop: 4 },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  cardTitle: {
    fontFamily: "Georgia",
    fontSize: 18,
    fontWeight: "600",
    color: colors.text,
  },
  link: { color: colors.primaryDark, fontWeight: "600" },
  label: { color: colors.muted, fontSize: 12, fontWeight: "600", marginBottom: 6, marginTop: 10 },
  input: {
    borderWidth: 2,
    borderColor: "rgba(245, 212, 222, 0.7)",
    borderRadius: radius.md,
    padding: 12,
    color: colors.text,
    backgroundColor: "rgba(255,255,255,0.7)",
  },
  infoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  infoLabel: { color: colors.muted, fontSize: 14 },
  infoValue: { color: colors.text, fontWeight: "600", fontSize: 14, maxWidth: "60%", textAlign: "right" },
  editBtns: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md },
  cancelBtn: {
    flex: 1,
    paddingVertical: 12,
    alignItems: "center",
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cancelText: { color: colors.muted, fontWeight: "600" },
  saveBtn: {
    flex: 1,
    paddingVertical: 12,
    alignItems: "center",
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
  },
  saveText: { color: "#fff", fontWeight: "700" },
  err: { color: colors.red, marginTop: spacing.sm, fontSize: 13 },
  section: {
    fontSize: 11,
    fontWeight: "600",
    color: colors.muted,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
    textTransform: "uppercase",
    letterSpacing: 1.5,
  },
  empty: { color: colors.muted, fontStyle: "italic" },
  visitCard: {
    ...glassCard,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  visitHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  visitDate: { fontWeight: "700", color: colors.text },
  pill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill },
  pillText: { color: "#fff", fontWeight: "700", fontSize: 10 },
  visitComplaint: { color: colors.text, marginTop: spacing.sm },
  visitStatus: { color: colors.muted, fontSize: 12, marginTop: 4 },
  logoutBtn: {
    marginTop: spacing.xl,
    borderWidth: 1.5,
    borderColor: palette.terracotta,
    borderRadius: radius.pill,
    paddingVertical: 14,
    alignItems: "center",
    backgroundColor: "rgba(196, 112, 75, 0.08)",
  },
  logoutText: { color: palette.terracotta, fontWeight: "700", fontSize: 16 },
});

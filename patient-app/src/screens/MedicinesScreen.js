import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import {
  analyzePrescription,
  analyzePrescriptionText,
  consultMedicine,
} from "../api";
import { glassCard, colors, radius, spacing, palette } from "../theme";

export default function MedicinesScreen() {
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [paste, setPaste] = useState("");
  const [question, setQuestion] = useState("");
  const [chat, setChat] = useState([]);
  const [asking, setAsking] = useState(false);
  const [expanded, setExpanded] = useState({});

  const contextMeds = useMemo(
    () => (result?.medicines || []).map((m) => m.matched_name || m.generic_name),
    [result],
  );

  async function pick(fromCamera) {
    setErr("");
    const perm = fromCamera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert("Permission needed", "Allow camera/photos to read your prescription.");
      return;
    }
    const resultPick = fromCamera
      ? await ImagePicker.launchCameraAsync({ quality: 0.85 })
      : await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ImagePicker.MediaTypeOptions.Images,
          quality: 0.85,
        });
    if (resultPick.canceled || !resultPick.assets?.[0]) return;
    const asset = resultPick.assets[0];
    setBusy(true);
    try {
      const data = await analyzePrescription({
        uri: asset.uri,
        name: asset.fileName || `rx-${Date.now()}.jpg`,
        mimeType: asset.mimeType || "image/jpeg",
      });
      setResult(data);
      setExpanded({});
    } catch (e) {
      setErr(e.message || "Could not read prescription");
    } finally {
      setBusy(false);
    }
  }

  async function runPaste() {
    if (!paste.trim()) return;
    setErr("");
    setBusy(true);
    try {
      const data = await analyzePrescriptionText(paste.trim());
      setResult(data);
      setExpanded({});
    } catch (e) {
      setErr(e.message || "Could not parse medicines");
    } finally {
      setBusy(false);
    }
  }

  async function ask(preset) {
    const q = (preset || question).trim();
    if (!q) return;
    setAsking(true);
    setErr("");
    setChat((c) => [...c, { role: "user", text: q }]);
    setQuestion("");
    try {
      const res = await consultMedicine(q, contextMeds);
      setChat((c) => [...c, { role: "sakhi", text: res.answer || "…" }]);
    } catch (e) {
      setChat((c) => [
        ...c,
        { role: "sakhi", text: e.message || "Consult failed — try again." },
      ]);
    } finally {
      setAsking(false);
    }
  }

  function toggle(id) {
    setExpanded((e) => ({ ...e, [id]: !e[id] }));
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.wrap} keyboardShouldPersistTaps="handled">
        <Text style={styles.eyebrow}>Medicine advisor</Text>
        <Text style={styles.title}>Your medicines</Text>
        <Text style={styles.sub}>
          Scan a prescription slip, then ask what each tablet is for — or what to discuss if you
          prefer not to take one.
        </Text>

        <View style={styles.row}>
          <TouchableOpacity style={styles.btn} onPress={() => pick(true)} disabled={busy}>
            <Text style={styles.btnText}>Scan Rx</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.btnGhost} onPress={() => pick(false)} disabled={busy}>
            <Text style={styles.btnGhostText}>Gallery</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.label}>Or paste medicine names</Text>
        <TextInput
          style={styles.input}
          multiline
          placeholder={"T. Oprox-CV 200mg\nT. Altrose-SP\nT. Breezy\nT. Shipen-D 40mg"}
          placeholderTextColor={colors.muted}
          value={paste}
          onChangeText={setPaste}
        />
        <TouchableOpacity style={styles.btnWide} onPress={runPaste} disabled={busy || !paste.trim()}>
          <Text style={styles.btnText}>{busy ? "Reading…" : "Explain these"}</Text>
        </TouchableOpacity>

        {busy && (
          <View style={styles.busyRow}>
            <ActivityIndicator color={colors.primary} />
            <Text style={styles.busyText}>Reading your slip…</Text>
          </View>
        )}
        {!!err && <Text style={styles.err}>{err}</Text>}

        {result && (
          <View style={styles.block}>
            <Text style={styles.summary}>{result.summary}</Text>
            {result.ocr_status && result.ocr_status !== "extracted" && result.ocr_status !== "text" && (
              <Text style={styles.warn}>
                Photo reader status: {result.ocr_status}
                {result.extract_source ? ` (${result.extract_source})` : ""}. You can still paste names below.
              </Text>
            )}
            <Text style={styles.disclaimer}>{result.disclaimer}</Text>

            {(result.medicines || []).map((m) => {
              const open = expanded[m.id];
              return (
                <TouchableOpacity
                  key={m.id}
                  style={styles.medCard}
                  onPress={() => toggle(m.id)}
                  activeOpacity={0.85}
                >
                  <Text style={styles.medBrand}>
                    {m.from_prescription_text || m.matched_name}
                  </Text>
                  <Text style={styles.medGeneric}>{m.generic_name}</Text>
                  <Text style={styles.medClass}>{m.class}</Text>
                  {open && (
                    <View style={styles.medBody}>
                      <Text style={styles.medH}>Uses</Text>
                      <Text style={styles.medP}>{(m.uses || []).join(" · ")}</Text>
                      <Text style={styles.medH}>How usually taken</Text>
                      <Text style={styles.medP}>{m.how_to_take}</Text>
                      <Text style={styles.medH}>Common side effects</Text>
                      <Text style={styles.medP}>{(m.common_side_effects || []).join(" · ")}</Text>
                      <Text style={styles.medH}>Alternatives to discuss with doctor</Text>
                      {(m.alternatives || []).map((a, i) => (
                        <Text key={i} style={styles.alt}>
                          · {a.name} — {a.reason}
                        </Text>
                      ))}
                      <TouchableOpacity
                        style={styles.chip}
                        onPress={() =>
                          ask(
                            `Mujhe ${m.from_prescription_text || m.matched_name} nahi khani — kya alternative discuss kar sakte hain?`,
                          )
                        }
                      >
                        <Text style={styles.chipText}>I don’t want this — suggest options</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                  <Text style={styles.tapHint}>{open ? "Tap to collapse" : "Tap for details"}</Text>
                </TouchableOpacity>
              );
            })}

            {(result.unmatched_phrases || []).length > 0 && (
              <Text style={styles.unmatched}>
                Couldn’t match: {result.unmatched_phrases.join(", ")}. Ask below by name.
              </Text>
            )}
          </View>
        )}

        <Text style={styles.section}>Ask Sakhi</Text>
        <Text style={styles.subSmall}>
          e.g. “Shipen-D kya hai?” or “Oprox-CV nahi lena — alternative?”
        </Text>
        {chat.map((m, i) => (
          <View
            key={i}
            style={[styles.bubble, m.role === "user" ? styles.bubbleUser : styles.bubbleBot]}
          >
            <Text style={styles.bubbleText}>{m.text}</Text>
          </View>
        ))}
        <TextInput
          style={styles.input}
          placeholder="Ask about a medicine…"
          placeholderTextColor={colors.muted}
          value={question}
          onChangeText={setQuestion}
          onSubmitEditing={() => ask()}
        />
        <TouchableOpacity
          style={styles.btnWide}
          onPress={() => ask()}
          disabled={asking || !question.trim()}
        >
          <Text style={styles.btnText}>{asking ? "Thinking…" : "Ask"}</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "transparent" },
  wrap: { padding: spacing.lg, paddingBottom: 48 },
  eyebrow: {
    fontSize: 10,
    letterSpacing: 2,
    textTransform: "uppercase",
    color: colors.muted,
    fontWeight: "500",
  },
  title: {
    fontFamily: "Georgia",
    fontSize: 30,
    fontWeight: "600",
    color: colors.text,
    marginTop: 4,
  },
  sub: { color: colors.muted, marginTop: 6, marginBottom: spacing.md, lineHeight: 20, fontSize: 14 },
  subSmall: { color: colors.muted, marginBottom: spacing.sm, fontSize: 13, lineHeight: 18 },
  row: { flexDirection: "row", gap: spacing.sm, marginBottom: spacing.md },
  btn: {
    flex: 1,
    backgroundColor: colors.primary,
    paddingVertical: 14,
    borderRadius: radius.md,
    alignItems: "center",
  },
  btnGhost: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    paddingVertical: 14,
    borderRadius: radius.md,
    alignItems: "center",
    backgroundColor: colors.surface,
  },
  btnWide: {
    backgroundColor: colors.primary,
    paddingVertical: 14,
    borderRadius: radius.md,
    alignItems: "center",
    marginTop: spacing.sm,
    marginBottom: spacing.md,
  },
  btnText: { color: colors.onPrimary, fontWeight: "700", fontSize: 15 },
  btnGhostText: { color: colors.primaryDark, fontWeight: "700", fontSize: 15 },
  label: { fontSize: 12, fontWeight: "600", color: colors.muted, marginBottom: 6 },
  input: {
    ...glassCard,
    padding: spacing.md,
    minHeight: 48,
    color: colors.text,
    fontSize: 15,
    textAlignVertical: "top",
  },
  busyRow: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: spacing.sm },
  busyText: { color: colors.muted },
  err: { color: colors.red, marginBottom: spacing.sm, lineHeight: 20 },
  block: { marginTop: spacing.sm },
  summary: {
    fontFamily: "Georgia",
    fontSize: 18,
    color: colors.text,
    marginBottom: 6,
  },
  disclaimer: { fontSize: 12, color: colors.muted, lineHeight: 17, marginBottom: spacing.md },
  medCard: {
    ...glassCard,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  medBrand: {
    fontFamily: "Georgia",
    fontSize: 18,
    fontWeight: "600",
    color: colors.text,
  },
  medGeneric: { color: colors.primaryDark, marginTop: 2, fontSize: 14 },
  medClass: { color: colors.muted, fontSize: 12, marginTop: 4 },
  medBody: { marginTop: spacing.sm, gap: 2 },
  medH: {
    marginTop: 8,
    fontSize: 11,
    fontWeight: "700",
    color: colors.muted,
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  medP: { color: colors.text, lineHeight: 20, fontSize: 14 },
  alt: { color: colors.text, fontSize: 13, lineHeight: 19, marginTop: 2 },
  chip: {
    marginTop: spacing.sm,
    alignSelf: "flex-start",
    backgroundColor: "rgba(232, 168, 184, 0.28)",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.sm,
  },
  chipText: { color: palette.charcoal, fontWeight: "600", fontSize: 13 },
  tapHint: { marginTop: 8, fontSize: 11, color: colors.muted },
  unmatched: { color: colors.amber, fontSize: 13, lineHeight: 18, marginTop: 4 },
  warn: {
    color: palette.terracotta,
    fontSize: 13,
    lineHeight: 18,
    marginBottom: spacing.sm,
  },
  section: {
    marginTop: spacing.lg,
    fontFamily: "Georgia",
    fontSize: 22,
    fontWeight: "600",
    color: colors.text,
  },
  bubble: {
    padding: spacing.md,
    borderRadius: radius.md,
    marginBottom: spacing.sm,
    maxWidth: "92%",
  },
  bubbleUser: {
    alignSelf: "flex-end",
    backgroundColor: "rgba(107, 143, 113, 0.2)",
  },
  bubbleBot: {
    alignSelf: "flex-start",
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  bubbleText: { color: colors.text, lineHeight: 21, fontSize: 14 },
});

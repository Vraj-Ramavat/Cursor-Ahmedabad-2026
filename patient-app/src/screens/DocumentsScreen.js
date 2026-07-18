import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import { myVisits, uploadDocument } from "../api";
import { glassCard, colors, radius, sevColor, spacing, palette } from "../theme";

const DOC_TYPES = [
  { key: "prescription", label: "Prescription" },
  { key: "lab_report", label: "Lab report" },
  { key: "imaging", label: "Imaging" },
];

export default function DocumentsScreen({ sessionId: liveSessionId, account }) {
  const [docType, setDocType] = useState("prescription");
  const [docs, setDocs] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [visits, setVisits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedSessionId, setSelectedSessionId] = useState(liveSessionId || null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const v = await myVisits();
        const list = Array.isArray(v) ? v : [];
        if (cancelled) return;
        setVisits(list);
        // Prefer live in-progress visit, else most recent visit from history.
        if (liveSessionId) {
          setSelectedSessionId(liveSessionId);
        } else if (list.length > 0) {
          setSelectedSessionId(list[0].session_id);
        } else {
          setSelectedSessionId(null);
        }
      } catch {
        if (!cancelled) setVisits([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [account?.patient_id, liveSessionId]);

  useEffect(() => {
    if (liveSessionId) setSelectedSessionId(liveSessionId);
  }, [liveSessionId]);

  const sessionId = selectedSessionId;
  const selectedVisit = visits.find((v) => v.session_id === sessionId);

  async function pickFromGallery() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert("Permission needed", "Allow photo library access to upload documents.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.85,
    });
    if (!result.canceled && result.assets?.[0]) {
      await doUpload(result.assets[0]);
    }
  }

  async function pickFromCamera() {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert("Permission needed", "Allow camera access to scan documents.");
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      quality: 0.85,
    });
    if (!result.canceled && result.assets?.[0]) {
      await doUpload(result.assets[0]);
    }
  }

  async function doUpload(asset) {
    if (!sessionId) return;
    setErr("");
    setBusy(true);
    try {
      const uploaded = await uploadDocument(
        sessionId,
        {
          uri: asset.uri,
          name: asset.fileName || `scan-${Date.now()}.jpg`,
          mimeType: asset.mimeType || "image/jpeg",
        },
        docType,
      );
      setDocs((d) => [...d, uploaded]);
      if (!uploaded.fields?.length) {
        setErr(
          "Uploaded, but no fields extracted yet — try a brighter/closer photo. The doctor can still open the file on the dashboard.",
        );
      }
    } catch (e) {
      setErr(e.message || "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  function formatDate(iso) {
    try {
      return new Date(iso).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
    } catch {
      return iso;
    }
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.emptyWrap}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  if (!sessionId || visits.length === 0) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.emptyWrap}>
          <Text style={styles.emptyTitle}>No visits yet</Text>
          <Text style={styles.emptySub}>
            Complete at least one check-in on the Visit tab, then come back here to upload
            prescriptions or reports for that visit.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.wrap}>
        <Text style={styles.title}>Documents</Text>
        <Text style={styles.sub}>
          Attach prescriptions, labs, or imaging to a visit. Your doctor sees them on the clinic
          dashboard under Documents.
        </Text>

        <View style={styles.card}>
          <Text style={styles.label}>Attach to visit</Text>
          {visits.map((v) => {
            const on = v.session_id === sessionId;
            return (
              <TouchableOpacity
                key={v.session_id}
                style={[styles.visitRow, on && styles.visitRowOn]}
                onPress={() => setSelectedSessionId(v.session_id)}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.visitComplaint} numberOfLines={1}>
                    {v.chief_complaint || "Visit"}
                  </Text>
                  <Text style={styles.visitMeta}>
                    {formatDate(v.started_at)} · {v.completed ? "Completed" : "In progress"}
                  </Text>
                </View>
                <View style={[styles.pill, { backgroundColor: sevColor[v.severity] || colors.green }]}>
                  <Text style={styles.pillText}>{(v.severity || "green").toUpperCase()}</Text>
                </View>
              </TouchableOpacity>
            );
          })}
          {liveSessionId && selectedSessionId === liveSessionId && (
            <Text style={styles.hint}>Using your current live visit.</Text>
          )}
        </View>

        <View style={styles.infoCard}>
          <Text style={styles.infoTitle}>What happens after upload?</Text>
          <Text style={styles.infoLine}>1. We run OCR (printed + handwriting) on the image.</Text>
          <Text style={styles.infoLine}>2. Extracted fields show here for you to check.</Text>
          <Text style={styles.infoLine}>
            3. The doctor opens your visit on the dashboard → Documents tab, can correct low-confidence fields, and uses them with your briefing.
          </Text>
          <Text style={styles.infoLine}>
            4. Queue card shows a document count so staff know files are ready.
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.label}>
            Document type
            {selectedVisit ? ` · for “${(selectedVisit.chief_complaint || "visit").slice(0, 40)}”` : ""}
          </Text>
          <View style={styles.typeRow}>
            {DOC_TYPES.map((t) => (
              <TouchableOpacity
                key={t.key}
                style={[styles.typeChip, docType === t.key && styles.typeChipOn]}
                onPress={() => setDocType(t.key)}
              >
                <Text style={[styles.typeChipText, docType === t.key && styles.typeChipTextOn]}>
                  {t.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <View style={styles.btnRow}>
            <TouchableOpacity style={styles.btn} onPress={pickFromGallery} disabled={busy}>
              <Text style={styles.btnText}>Gallery</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.btnOutline} onPress={pickFromCamera} disabled={busy}>
              <Text style={styles.btnOutlineText}>
                {Platform.OS === "web" ? "Scan / Camera" : "Camera"}
              </Text>
            </TouchableOpacity>
          </View>

          {busy && <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.md }} />}
          {!!err && <Text style={styles.err}>{err}</Text>}
        </View>

        {docs.length > 0 && (
          <>
            <Text style={styles.section}>Uploaded this session ({docs.length})</Text>
            {docs.map((d) => (
              <View key={d.id} style={styles.docCard}>
                <Text style={styles.docName}>{d.filename}</Text>
                <Text style={styles.docMeta}>
                  {d.doc_type} · {d.fields?.length || 0} fields extracted
                  {d.low_confidence_count ? ` · ${d.low_confidence_count} to verify` : ""}
                </Text>
                <Text style={styles.okHint}>
                  Saved to visit — visible on doctor dashboard Documents tab.
                </Text>
                {d.fields?.length > 0 && (
                  <View style={styles.fields}>
                    {d.fields.map((f, i) => (
                      <View key={i} style={styles.fieldRow}>
                        <Text style={styles.fieldName}>{f.name}</Text>
                        <Text style={[styles.fieldValue, f.low_confidence && styles.fieldWarn]}>
                          {f.value}
                          {f.low_confidence ? " ⚠" : ""}
                        </Text>
                      </View>
                    ))}
                  </View>
                )}
              </View>
            ))}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
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
    letterSpacing: -0.3,
  },
  sub: { color: colors.muted, marginTop: 4, marginBottom: spacing.lg, lineHeight: 20 },
  card: {
    ...glassCard,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  infoCard: {
    backgroundColor: "rgba(107, 143, 113, 0.12)",
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: "rgba(107, 143, 113, 0.2)",
  },
  infoTitle: { fontWeight: "700", color: colors.primaryDark, marginBottom: 8 },
  infoLine: { color: colors.text, fontSize: 13, lineHeight: 20, marginBottom: 4 },
  label: { color: colors.muted, fontSize: 12, fontWeight: "600", marginBottom: spacing.sm },
  visitRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: 12,
    marginBottom: 8,
    backgroundColor: "rgba(255,255,255,0.55)",
  },
  visitRowOn: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  visitComplaint: { fontWeight: "700", color: colors.text },
  visitMeta: { color: colors.muted, fontSize: 12, marginTop: 2 },
  hint: { color: colors.primaryDark, fontSize: 12, fontWeight: "600", marginTop: 4 },
  pill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill },
  pillText: { color: "#fff", fontWeight: "700", fontSize: 10 },
  typeRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginBottom: spacing.md },
  typeChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: "rgba(255,255,255,0.55)",
  },
  typeChipOn: { backgroundColor: colors.primarySoft, borderColor: colors.primary },
  typeChipText: { color: colors.muted, fontWeight: "600", fontSize: 13 },
  typeChipTextOn: { color: colors.primaryDark },
  btnRow: { flexDirection: "row", gap: spacing.sm },
  btn: {
    flex: 1,
    backgroundColor: colors.primary,
    borderRadius: radius.pill,
    paddingVertical: 12,
    alignItems: "center",
  },
  btnText: { color: "#fff", fontWeight: "700" },
  btnOutline: {
    flex: 1,
    borderWidth: 1.5,
    borderColor: colors.primary,
    borderRadius: radius.pill,
    paddingVertical: 12,
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.5)",
  },
  btnOutlineText: { color: colors.primaryDark, fontWeight: "700" },
  err: { color: colors.red, marginTop: spacing.sm, fontSize: 13 },
  okHint: { color: palette.sageDark, fontSize: 12, fontWeight: "600", marginTop: 6 },
  section: {
    fontSize: 11,
    fontWeight: "600",
    color: colors.muted,
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
    textTransform: "uppercase",
    letterSpacing: 1.5,
  },
  docCard: {
    ...glassCard,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  docName: { fontWeight: "700", color: colors.text, fontSize: 15 },
  docMeta: { color: colors.muted, fontSize: 12, marginTop: 4 },
  fields: { marginTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.sm },
  fieldRow: { marginBottom: 6 },
  fieldName: { color: colors.muted, fontSize: 11, fontWeight: "600" },
  fieldValue: { color: colors.text, fontSize: 14 },
  fieldWarn: { color: colors.amber },
  emptyWrap: { flex: 1, justifyContent: "center", padding: spacing.xl, alignItems: "center" },
  emptyTitle: {
    fontFamily: "Georgia",
    fontSize: 22,
    fontWeight: "600",
    color: colors.text,
  },
  emptySub: { color: colors.muted, textAlign: "center", marginTop: spacing.sm, lineHeight: 22 },
});

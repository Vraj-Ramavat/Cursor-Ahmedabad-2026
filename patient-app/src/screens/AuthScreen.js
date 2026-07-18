import { useState } from "react";
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
import LivingBackground from "../components/LivingBackground";
import { colors, glassCard, palette, radius, spacing } from "../theme";
import { login, register, setToken } from "../api";

export default function AuthScreen({ onAuthed }) {
  const [mode, setMode] = useState("login");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [age, setAge] = useState("");
  const [gender, setGender] = useState("");
  const [abhaId, setAbhaId] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setErr("");
    if (!phone.trim()) return setErr("Phone number is required");
    if (mode === "register" && !name.trim()) return setErr("Name is required");
    setBusy(true);
    try {
      const acc =
        mode === "login"
          ? await login(phone.trim())
          : await register({
              name: name.trim(),
              phone: phone.trim(),
              age: age ? Number(age) : null,
              gender: gender.trim() || null,
              abha_id: abhaId.trim() || null,
            });
      setToken(acc.token);
      onAuthed(acc);
    } catch (e) {
      setErr(e.message || "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <LivingBackground />
      <ScrollView contentContainerStyle={styles.wrap} keyboardShouldPersistTaps="handled">
        <View style={styles.brand}>
          <View style={styles.lotus}>
            <Text style={styles.lotusPetal}>✿</Text>
          </View>
          <Text style={styles.eyebrow}>Daylight · Sehat Sakhi</Text>
          <Text style={styles.title}>Sehat Sakhi</Text>
          <Text style={styles.sub}>Your trusted friend on the wellness journey</Text>
        </View>

        <View style={styles.card}>
          <View style={styles.tabs}>
            <TouchableOpacity
              onPress={() => setMode("login")}
              style={[styles.tab, mode === "login" && styles.tabOn]}
            >
              <Text style={[styles.tabText, mode === "login" && styles.tabTextOn]}>Sign in</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setMode("register")}
              style={[styles.tab, mode === "register" && styles.tabOn]}
            >
              <Text style={[styles.tabText, mode === "register" && styles.tabTextOn]}>
                Create account
              </Text>
            </TouchableOpacity>
          </View>

          {mode === "register" && (
            <>
              <Text style={styles.label}>Full name</Text>
              <TextInput
                style={styles.input}
                value={name}
                onChangeText={setName}
                placeholder="Asha Patel"
                placeholderTextColor={`${palette.charcoalSoft}80`}
              />
              <Text style={styles.label}>Age</Text>
              <TextInput
                style={styles.input}
                value={age}
                onChangeText={setAge}
                keyboardType="numeric"
                placeholder="32"
                placeholderTextColor={`${palette.charcoalSoft}80`}
              />
              <Text style={styles.label}>Gender</Text>
              <TextInput
                style={styles.input}
                value={gender}
                onChangeText={setGender}
                placeholder="female / male / other"
                placeholderTextColor={`${palette.charcoalSoft}80`}
              />
              <Text style={styles.label}>ABHA ID (optional)</Text>
              <TextInput
                style={styles.input}
                value={abhaId}
                onChangeText={setAbhaId}
                placeholder="14-digit health ID"
                placeholderTextColor={`${palette.charcoalSoft}80`}
              />
            </>
          )}

          <Text style={styles.label}>Phone</Text>
          <TextInput
            style={styles.input}
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
            placeholder="9876543210"
            placeholderTextColor={`${palette.charcoalSoft}80`}
          />

          {!!err && <Text style={styles.err}>{err}</Text>}

          <TouchableOpacity style={styles.btn} onPress={submit} disabled={busy}>
            {busy ? (
              <ActivityIndicator color={colors.onPrimary} />
            ) : (
              <Text style={styles.btnText}>{mode === "login" ? "Continue" : "Create account"}</Text>
            )}
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  wrap: {
    flexGrow: 1,
    padding: spacing.lg,
    justifyContent: "center",
    zIndex: 1,
  },
  brand: { alignItems: "center", marginBottom: spacing.lg },
  lotus: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: palette.lotusSoft,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: "rgba(232, 168, 184, 0.5)",
  },
  lotusPetal: { fontSize: 32, color: palette.lotusDeep },
  eyebrow: {
    fontSize: 10,
    letterSpacing: 2.2,
    textTransform: "uppercase",
    color: colors.muted,
    fontWeight: "500",
  },
  title: {
    fontFamily: "Georgia",
    fontSize: 34,
    fontWeight: "600",
    color: colors.text,
    marginTop: 6,
    letterSpacing: -0.5,
  },
  sub: {
    color: colors.muted,
    marginTop: spacing.sm,
    textAlign: "center",
    lineHeight: 22,
    fontSize: 14,
    maxWidth: 280,
  },
  card: {
    ...glassCard,
    padding: spacing.lg,
  },
  tabs: {
    flexDirection: "row",
    backgroundColor: "rgba(107, 143, 113, 0.08)",
    borderRadius: radius.md,
    padding: 4,
    marginBottom: spacing.md,
  },
  tab: { flex: 1, paddingVertical: 10, borderRadius: radius.sm, alignItems: "center" },
  tabOn: {
    backgroundColor: colors.surfaceSolid,
    shadowColor: colors.primary,
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 1,
  },
  tabText: { color: colors.muted, fontWeight: "600" },
  tabTextOn: { color: colors.primaryDark },
  label: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "500",
    marginBottom: 8,
    marginTop: 12,
  },
  input: {
    borderWidth: 2,
    borderColor: "rgba(245, 212, 222, 0.7)",
    borderRadius: radius.md,
    paddingHorizontal: 18,
    paddingVertical: 14,
    color: colors.text,
    backgroundColor: "rgba(255, 255, 255, 0.7)",
    fontSize: 16,
    minHeight: 52,
  },
  btn: {
    backgroundColor: colors.primary,
    borderRadius: radius.pill,
    paddingVertical: 16,
    alignItems: "center",
    marginTop: spacing.lg,
  },
  btnText: { color: colors.onPrimary, fontWeight: "700", fontSize: 16 },
  err: { color: colors.red, marginTop: 10, fontSize: 13 },
});

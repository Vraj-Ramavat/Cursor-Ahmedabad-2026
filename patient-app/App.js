import { useEffect, useState } from "react";
import {
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import * as DocumentPicker from "expo-document-picker";
import {
  startIntake,
  answerIntake,
  getQueueStatus,
  uploadDocument,
} from "./src/api";

const SEV_COLOR = { red: "#d92d20", amber: "#dc9a00", green: "#099250" };

export default function App() {
  const [stage, setStage] = useState("start"); // start | qa | done
  const [name, setName] = useState("");
  const [complaint, setComplaint] = useState("chest pain");
  const [session, setSession] = useState(null);
  const [question, setQuestion] = useState(null);
  const [nodeId, setNodeId] = useState(null);
  const [answer, setAnswer] = useState("");
  const [severity, setSeverity] = useState("green");
  const [position, setPosition] = useState(null);
  const [live, setLive] = useState(true);
  const [docs, setDocs] = useState([]);

  async function begin() {
    const res = await startIntake(name || "Patient", complaint);
    setSession(res.session_id);
    setQuestion(res.question);
    setNodeId(res.node_id);
    setStage(res.complete ? "done" : "qa");
  }

  async function submitAnswer() {
    const res = await answerIntake(session, nodeId, answer);
    setSeverity(res.severity);
    setAnswer("");
    if (res.complete) {
      setStage("done");
      setQuestion(null);
    } else {
      setQuestion(res.question);
      setNodeId(res.node_id);
    }
  }

  useEffect(() => {
    if (stage !== "done" || !session) return;
    const poll = setInterval(async () => {
      const q = await getQueueStatus();
      setLive(q.live);
      const idx = q.entries.findIndex((e) => e.session_id === session);
      setPosition(idx >= 0 ? idx + 1 : null);
    }, 5000);
    return () => clearInterval(poll);
  }, [stage, session]);

  async function pickAndUpload() {
    const res = await DocumentPicker.getDocumentAsync({ type: ["image/*", "application/pdf"] });
    if (res.canceled) return;
    const file = res.assets[0];
    const uploaded = await uploadDocument(session, file);
    setDocs((d) => [...d, uploaded]);
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>Hospital Visit Prep</Text>

        {stage === "start" && (
          <View style={styles.card}>
            <Text style={styles.label}>Your name</Text>
            <TextInput style={styles.input} value={name} onChangeText={setName}
              placeholder="Name" placeholderTextColor="#8a94a6" />
            <Text style={styles.label}>What brings you in?</Text>
            <TextInput style={styles.input} value={complaint} onChangeText={setComplaint}
              placeholder="e.g. chest pain" placeholderTextColor="#8a94a6" />
            <TouchableOpacity style={styles.btn} onPress={begin}>
              <Text style={styles.btnText}>Start intake</Text>
            </TouchableOpacity>
          </View>
        )}

        {stage === "qa" && (
          <View style={styles.card}>
            <Text style={styles.question}>{question}</Text>
            <TextInput style={styles.input} value={answer} onChangeText={setAnswer}
              placeholder="Type your answer" placeholderTextColor="#8a94a6" multiline />
            <TouchableOpacity style={styles.btn} onPress={submitAnswer}>
              <Text style={styles.btnText}>Send</Text>
            </TouchableOpacity>
          </View>
        )}

        {stage === "done" && (
          <View style={styles.card}>
            <View style={[styles.pill, { backgroundColor: SEV_COLOR[severity] }]}>
              <Text style={styles.pillText}>{severity.toUpperCase()}</Text>
            </View>
            <Text style={styles.info}>
              {position ? `You are #${position} in the queue.` : "Finding your place in the queue…"}
            </Text>
            {!live && (
              <Text style={styles.paused}>Live updates paused — showing last-known order.</Text>
            )}

            <Text style={styles.label}>Upload documents</Text>
            <Text style={styles.hint}>
              Prescriptions, lab or scan reports. We read the printed text only.
            </Text>
            <TouchableOpacity style={styles.btnAlt} onPress={pickAndUpload}>
              <Text style={styles.btnText}>Add a document</Text>
            </TouchableOpacity>

            {docs.map((d) => (
              <View key={d.id} style={styles.doc}>
                <Text style={styles.docTitle}>{d.filename}</Text>
                <Text style={styles.hint}>
                  {d.fields.length} fields extracted · {d.low_confidence_count} low-confidence
                </Text>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#0f1420" },
  container: { padding: 16 },
  title: { color: "#e7ecf3", fontSize: 22, fontWeight: "700", marginBottom: 16 },
  card: { backgroundColor: "#1a2130", borderRadius: 12, padding: 16 },
  label: { color: "#8a94a6", fontSize: 13, marginTop: 12, marginBottom: 6 },
  hint: { color: "#8a94a6", fontSize: 12, marginBottom: 8 },
  input: { backgroundColor: "#0d121c", color: "#e7ecf3", borderRadius: 8,
    padding: 12, borderWidth: 1, borderColor: "#232c3d" },
  question: { color: "#e7ecf3", fontSize: 16, marginBottom: 12, lineHeight: 22 },
  btn: { backgroundColor: "#3b82f6", padding: 14, borderRadius: 8, marginTop: 14, alignItems: "center" },
  btnAlt: { backgroundColor: "#334155", padding: 12, borderRadius: 8, marginTop: 6, alignItems: "center" },
  btnText: { color: "white", fontWeight: "700" },
  pill: { alignSelf: "flex-start", paddingHorizontal: 12, paddingVertical: 4, borderRadius: 12 },
  pillText: { color: "white", fontWeight: "700", fontSize: 12 },
  info: { color: "#e7ecf3", fontSize: 16, marginTop: 12 },
  paused: { color: "#dc9a00", marginTop: 8 },
  doc: { backgroundColor: "#141a26", borderRadius: 8, padding: 10, marginTop: 8 },
  docTitle: { color: "#e7ecf3", fontWeight: "600" },
});

import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import AuthScreen from "./src/screens/AuthScreen";
import HomeScreen from "./src/screens/HomeScreen";
import VisitScreen from "./src/screens/VisitScreen";
import DocumentsScreen from "./src/screens/DocumentsScreen";
import MedicinesScreen from "./src/screens/MedicinesScreen";
import MealsScreen from "./src/screens/MealsScreen";
import ProfileScreen from "./src/screens/ProfileScreen";
import LivingBackground from "./src/components/LivingBackground";
import { clearToken, getToken, me, onUnauthorized, setToken } from "./src/api";
import { colors, radius, spacing } from "./src/theme";

const TABS = [
  { key: "home", label: "Home", icon: "⌂" },
  { key: "visit", label: "Visit", icon: "✦" },
  { key: "documents", label: "Docs", icon: "☰" },
  { key: "medicines", label: "Meds", icon: "✚" },
  { key: "meals", label: "Meals", icon: "◎" },
  { key: "profile", label: "You", icon: "◌" },
];

export default function App() {
  const [booting, setBooting] = useState(true);
  const [account, setAccount] = useState(null);
  const [tab, setTab] = useState("home");
  const [visit, setVisit] = useState(null);

  function handleLogout() {
    clearToken();
    setAccount(null);
    setVisit(null);
    setTab("home");
  }

  useEffect(() => {
    if (Platform.OS === "web" && typeof document !== "undefined") {
      const id = "sakhi-fonts";
      if (!document.getElementById(id)) {
        const link = document.createElement("link");
        link.id = id;
        link.rel = "stylesheet";
        link.href =
          "https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;600;700&family=DM+Sans:wght@300;400;500;600&display=swap";
        document.head.appendChild(link);
      }
    }
  }, []);

  useEffect(() => {
    onUnauthorized(() => {
      setAccount(null);
      setVisit(null);
      setTab("home");
    });
    (async () => {
      if (!getToken()) {
        setBooting(false);
        return;
      }
      try {
        const acc = await me();
        setAccount(acc);
        setToken(acc.token);
      } catch {
        clearToken();
        setAccount(null);
      } finally {
        setBooting(false);
      }
    })();
  }, []);

  function handleAuthed(acc) {
    if (acc?.token) setToken(acc.token);
    setAccount(acc);
    setTab("visit");
  }

  function navigate(key) {
    setTab(key);
  }

  if (booting) {
    return (
      <View style={styles.boot}>
        <LivingBackground />
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.bootLabel}>Sehat Sakhi</Text>
      </View>
    );
  }

  if (!account) {
    return <AuthScreen onAuthed={handleAuthed} />;
  }

  const sessionId = visit?.sessionId || null;

  function renderScreen() {
    switch (tab) {
      case "home":
        return <HomeScreen account={account} visit={visit} onNavigate={navigate} />;
      case "visit":
        return (
          <VisitScreen account={account} visit={visit} onVisitChange={setVisit} />
        );
      case "documents":
        return <DocumentsScreen sessionId={sessionId} account={account} />;
      case "medicines":
        return <MedicinesScreen />;
      case "meals":
        return (
          <MealsScreen
            account={account}
            onAccountUpdate={setAccount}
            sessionId={sessionId}
          />
        );
      case "profile":
        return (
          <ProfileScreen
            account={account}
            onAccountUpdate={setAccount}
            onLogout={handleLogout}
          />
        );
      default:
        return null;
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <LivingBackground />
      <View style={styles.content}>{renderScreen()}</View>
      <View style={styles.tabBarWrap}>
        <View style={styles.tabBar}>
          {TABS.map((t) => {
            const active = tab === t.key;
            return (
              <TouchableOpacity
                key={t.key}
                style={styles.tabItem}
                onPress={() => setTab(t.key)}
                accessibilityRole="button"
              >
                <View style={[styles.tabIconWrap, active && styles.tabIconWrapActive]}>
                  <Text style={[styles.tabIcon, active && styles.tabIconActive]}>{t.icon}</Text>
                </View>
                <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>{t.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  boot: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.bg,
    gap: 12,
  },
  bootLabel: {
    fontFamily: "Georgia",
    fontSize: 22,
    color: colors.text,
    letterSpacing: -0.3,
  },
  content: { flex: 1, zIndex: 1 },
  tabBarWrap: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
    paddingTop: 4,
    zIndex: 2,
  },
  tabBar: {
    flexDirection: "row",
    backgroundColor: "rgba(255, 255, 255, 0.72)",
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 8,
    paddingHorizontal: 4,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 24,
    elevation: 6,
  },
  tabItem: { flex: 1, alignItems: "center", paddingVertical: 4 },
  tabIconWrap: {
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  tabIconWrapActive: {
    backgroundColor: "rgba(232, 168, 184, 0.22)",
  },
  tabIcon: { fontSize: 16, color: colors.muted, opacity: 0.7 },
  tabIconActive: { color: colors.primaryDark, opacity: 1 },
  tabLabel: {
    fontSize: 11,
    color: colors.muted,
    marginTop: 2,
    fontWeight: "500",
  },
  tabLabelActive: { color: colors.primaryDark, fontWeight: "700" },
});

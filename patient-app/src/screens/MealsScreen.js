import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { getCurrentMealPlan, getMealPlan, setToken, updateHealth } from "../api";
import { colors, palette, glassCard, radius } from "../theme";

/** Eatvisor onboarding steps — progress only (cannot skip ahead). */
const STEPS = ["Body", "Goal", "Health", "Diet", "Allergies"];

const GOALS = [
  { id: "weight_loss", label: "Lose Weight" },
  { id: "weight_gain", label: "Gain Weight" },
  { id: "maintain", label: "Maintain Weight" },
  { id: "general_wellness", label: "General Wellness" },
  { id: "manage_condition", label: "Manage Condition" },
];

const CONDITIONS = [
  "Diabetes / Pre-diabetic",
  "PCOS / PCOD",
  "Thyroid (Hypo/Hyper)",
  "High Cholesterol",
  "High Blood Pressure",
  "Heart Disease",
  "Kidney Issues",
  "Digestive Issues (IBS/Acidity)",
  "None",
];

const DIETS = [
  { id: "vegetarian", label: "Vegetarian" },
  { id: "non-vegetarian", label: "Non-Vegetarian" },
  { id: "vegan", label: "Vegan" },
  { id: "eggetarian", label: "Eggetarian" },
  { id: "jain", label: "Jain" },
];

const ALLERGIES = [
  { id: "nuts", label: "Nuts" },
  { id: "dairy", label: "Dairy" },
  { id: "gluten", label: "Gluten" },
  { id: "soy", label: "Soy" },
  { id: "eggs", label: "Eggs" },
  { id: "seafood", label: "Seafood" },
];

const ACTIVITIES = [
  { id: "sedentary", label: "Sedentary" },
  { id: "lightly_active", label: "Lightly Active" },
  { id: "moderately_active", label: "Moderately Active" },
  { id: "very_active", label: "Very Active" },
  { id: "extra_active", label: "Extra Active" },
];

const SLOT_ORDER = ["breakfast", "morning_snack", "lunch", "evening_snack", "dinner"];
const SLOT_TIMES = {
  breakfast: "8:00 – 9:00 AM",
  morning_snack: "11:00 AM",
  lunch: "12:30 – 1:30 PM",
  evening_snack: "4:30 – 5:00 PM",
  dinner: "7:30 – 8:30 PM",
};
const SLOT_EMOJI = {
  breakfast: "🌅",
  morning_snack: "🍎",
  lunch: "🍛",
  evening_snack: "🍵",
  dinner: "🌙",
};
const FILTERS = ["All", "Breakfast", "Lunch", "Dinner", "Snacks", "Avoid"];

function mapCondition(c) {
  const m = {
    "Diabetes / Pre-diabetic": "diabetes",
    "PCOS / PCOD": "pcos",
    "Thyroid (Hypo/Hyper)": "thyroid",
    "High Cholesterol": "cholesterol",
    "High Blood Pressure": "bp",
    "Heart Disease": "heart",
    "Kidney Issues": "kidney",
    "Digestive Issues (IBS/Acidity)": "digestive",
  };
  return m[c] || c.toLowerCase();
}

export default function MealsScreen({ account, onAccountUpdate, sessionId, setAccount, session }) {
  const updateAccount = onAccountUpdate || setAccount;
  const activeSession = sessionId || session;
  const [step, setStep] = useState(0);
  const [maxStep, setMaxStep] = useState(0);
  const [weight, setWeight] = useState(String(account?.weight_kg || ""));
  const [height, setHeight] = useState(String(account?.height_cm || ""));
  const [activity, setActivity] = useState(account?.activity_level || "");
  const [goal, setGoal] = useState(account?.goal || "");
  const [conditions, setConditions] = useState([]);
  const [diet, setDiet] = useState(account?.diet_type || "");
  const [allergies, setAllergies] = useState([]);
  const [dislikes, setDislikes] = useState("");
  const [plan, setPlan] = useState(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [selectedDay, setSelectedDay] = useState(1);
  const [filter, setFilter] = useState("All");
  const [expanded, setExpanded] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const saved = await getCurrentMealPlan();
        if (!cancelled && saved?.days?.length) {
          setPlan(saved);
          setSelectedDay(1);
        }
      } catch {
        /* no saved plan yet */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [account?.patient_id]);

  function goStep(i) {
    // Progress indicator: only revisit unlocked steps (no skipping ahead).
    if (i <= maxStep) setStep(i);
  }

  function advance() {
    const next = Math.min(step + 1, STEPS.length - 1);
    setStep(next);
    setMaxStep((m) => Math.max(m, next));
  }

  function toggle(list, setList, item) {
    if (item === "None") return setList(["None"]);
    const without = list.filter((i) => i !== "None");
    if (without.includes(item)) setList(without.filter((i) => i !== item));
    else setList([...without, item]);
  }

  function toggleId(list, setList, id) {
    if (list.includes(id)) setList(list.filter((i) => i !== id));
    else setList([...list, id]);
  }

  function canNext() {
    if (step === 0) return weight && height && activity;
    if (step === 1) return !!goal;
    if (step === 2) return conditions.length > 0;
    if (step === 3) return !!diet;
    return true;
  }

  async function generate() {
    setBusy(true);
    setErr("");
    try {
      const conds = conditions.filter((c) => c !== "None").map(mapCondition);
      const updated = await updateHealth({
        weight_kg: weight ? Number(weight) : null,
        height_cm: height ? Number(height) : null,
        diet_type: diet,
        conditions: conds,
        allergies,
        goal,
        activity_level: activity,
        dislikes: dislikes.split(",").map((s) => s.trim()).filter(Boolean),
      });
      if (updated?.token) setToken(updated.token);
      updateAccount?.(updated);
      const p = await getMealPlan(15, activeSession);
      setPlan(p);
      setSelectedDay(1);
      setFilter("All");
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  const day = useMemo(() => {
    if (!plan?.days?.length) return null;
    return plan.days.find((d) => (d.day || d.day_number) === selectedDay) || plan.days[0];
  }, [plan, selectedDay]);

  const meals = useMemo(() => {
    if (!day?.meals) return [];
    const list = SLOT_ORDER.map((slot) => day.meals[slot]).filter(Boolean);
    if (filter === "All") return list;
    const map = {
      Breakfast: ["breakfast"],
      Lunch: ["lunch"],
      Dinner: ["dinner"],
      Snacks: ["morning_snack", "evening_snack", "snack"],
    };
    const slots = map[filter] || [];
    return list.filter((m) => slots.includes(m.meal_slot));
  }, [day, filter]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.centerText}>Loading your meal plan…</Text>
      </View>
    );
  }

  if (plan?.days?.length) {
    const totals = day?.totals || {};
    return (
      <ScrollView style={styles.page} contentContainerStyle={{ paddingBottom: 110 }}>
        <View style={styles.hero}>
          <Text style={styles.heroOver}>15-Day Plan</Text>
          <Text style={styles.heroTitle}>Day {selectedDay} of {plan.days.length}</Text>
          <Text style={styles.heroSub}>
            ~{plan.daily_calorie_target} kcal/day · {plan.diet}
            {plan.recovery_mode ? " · recovery mode" : ""}
          </Text>
          <View style={styles.statusBadge}>
            <Text style={styles.statusBadgeText}>Active · saved to your profile</Text>
          </View>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.dayRow}>
          {plan.days.map((d) => {
            const n = d.day || d.day_number;
            const on = n === selectedDay;
            return (
              <TouchableOpacity key={n} onPress={() => setSelectedDay(n)} style={[styles.dayChip, on && styles.dayChipOn]}>
                <Text style={[styles.dayNum, on && styles.dayNumOn]}>{n}</Text>
                <Text style={[styles.dayLabel, on && styles.dayLabelOn]}>{n === 1 ? "Today" : `Day ${n}`}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        <View style={styles.macroCard}>
          <View style={styles.macroHeader}>
            <Text style={styles.macroHeaderLabel}>Daily macros</Text>
            <Text style={styles.macroHeaderVal}>{totals.calories || 0} kcal</Text>
          </View>
          <View style={styles.macroRow}>
            <Macro label="Protein" value={`${totals.protein || 0}g`} tint="rgba(107,143,113,0.15)" color={colors.primaryDark} />
            <Macro label="Carbs" value={`${totals.carbs || 0}g`} tint="rgba(232,200,146,0.35)" color={palette.gold} />
            <Macro label="Fat" value={`${totals.fat || 0}g`} tint="rgba(196,112,75,0.15)" color={palette.terracotta} />
            <Macro label="Fiber" value={`${totals.fiber || 0}g`} tint="rgba(143,175,148,0.25)" color={palette.sageDark} />
          </View>
        </View>

        {day?.morning_drink && (
          <View style={styles.drinkCard}>
            <Text style={styles.drinkOver}>Morning drink</Text>
            <Text style={styles.mealTitle}>{day.morning_drink.name}</Text>
            <Text style={styles.meta}>{day.morning_drink.benefits}</Text>
          </View>
        )}

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
          {FILTERS.map((f) => (
            <TouchableOpacity key={f} onPress={() => setFilter(f)} style={[styles.filterChip, filter === f && styles.filterChipOn]}>
              <Text style={[styles.filterText, filter === f && styles.filterTextOn]}>{f}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {filter === "Avoid" ? (
          <View style={{ paddingHorizontal: 16 }}>
            {Object.keys(plan.foods_to_avoid || {}).length === 0 ? (
              <Text style={styles.meta}>No specific avoid list for your profile.</Text>
            ) : (
              Object.entries(plan.foods_to_avoid).map(([k, items]) => (
                <View key={k} style={styles.card}>
                  <Text style={styles.cardTitle}>Avoid — {k}</Text>
                  {items.map((it, i) => (
                    <Text key={i} style={styles.meta}>• {it.food}: {it.reason}</Text>
                  ))}
                </View>
              ))
            )}
          </View>
        ) : (
          <View style={{ paddingHorizontal: 16 }}>
            {meals.map((m, i) => {
              const key = `${selectedDay}-${m.meal_slot}-${i}`;
              const open = expanded === key;
              return (
                <TouchableOpacity
                  key={key}
                  style={styles.mealCard}
                  activeOpacity={0.8}
                  onPress={() => setExpanded(open ? null : key)}
                >
                  <View style={styles.mealIcon}>
                    <Text style={{ fontSize: 22 }}>{SLOT_EMOJI[m.meal_slot] || "🍽️"}</Text>
                  </View>
                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <View style={styles.mealTop}>
                      <Text style={styles.mealOver}>{m.slot || m.meal_slot}</Text>
                      <Text style={styles.mealTime}>{SLOT_TIMES[m.meal_slot] || ""}</Text>
                    </View>
                    <Text style={styles.mealTitle} numberOfLines={1}>{m.name}</Text>
                    <Text style={styles.mealMetaLine}>
                      {m.calories} kcal · P {m.protein}g · C {m.carbs || "—"}g · F {m.fat || "—"}g
                    </Text>
                    {m.region ? <Text style={styles.regionChip}>📍 {m.region}{m.gi_score ? ` · GI ${m.gi_score}` : ""}</Text> : null}
                    {open && (
                      <View style={styles.recipeBox}>
                        <Text style={styles.recipeLabel}>Ingredients</Text>
                        <Text style={styles.meta}>{(m.recipe?.ingredients || []).join(", ") || "—"}</Text>
                        <Text style={[styles.recipeLabel, { marginTop: 8 }]}>How to make</Text>
                        {(m.recipe?.steps || []).map((s, si) => (
                          <Text key={si} style={styles.meta}>{si + 1}. {s}</Text>
                        ))}
                        {(m.videos || []).slice(0, 1).map((v) => (
                          <Text
                            key={v.videoId || v.title}
                            style={styles.link}
                            onPress={() => {
                              const url = v.url || `https://www.youtube.com/watch?v=${v.videoId}`;
                              if (typeof window !== "undefined") window.open(url, "_blank");
                            }}
                          >
                            ▶ {v.title || "Recipe video"}
                          </Text>
                        ))}
                      </View>
                    )}
                  </View>
                  <Text style={styles.chev}>{open ? "▾" : "›"}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        {(plan.video_recommendations || []).length > 0 && filter === "All" && (
          <View style={[styles.card, { marginHorizontal: 16 }]}>
            <Text style={styles.cardTitle}>Recommended videos</Text>
            {plan.video_recommendations.map((v) => (
              <TouchableOpacity
                key={v.videoId || v.url}
                onPress={() => {
                  const url = v.url || `https://www.youtube.com/watch?v=${v.videoId}`;
                  if (typeof window !== "undefined") window.open(url, "_blank");
                }}
              >
                <Text style={styles.mealTitle}>{v.title}</Text>
                <Text style={styles.link}>Watch on YouTube →</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        <TouchableOpacity
          style={styles.regenBtn}
          onPress={() => {
            setPlan(null);
            setStep(0);
            setMaxStep(0);
          }}
        >
          <Text style={styles.regenText}>Edit questionnaire & regenerate</Text>
        </TouchableOpacity>
        <Text style={styles.disclaimer}>{plan.disclaimer}</Text>
      </ScrollView>
    );
  }

  return (
    <ScrollView style={styles.page} contentContainerStyle={{ padding: 16, paddingBottom: 110 }}>
      <Text style={styles.title}>Meal plan</Text>
      <Text style={styles.sub}>
        Same Eatvisor questionnaire — then a 15-day plan with day picker, macros, recipes & videos.
      </Text>

      <View style={styles.stepRow}>
        {STEPS.map((s, i) => {
          const unlocked = i <= maxStep;
          const on = step === i;
          return (
            <TouchableOpacity
              key={s}
              disabled={!unlocked}
              onPress={() => goStep(i)}
              style={[styles.stepChip, on && styles.stepOn, !unlocked && styles.stepLocked]}
            >
              <Text style={[styles.stepText, on && styles.stepTextOn, !unlocked && styles.stepTextLocked]}>
                {i + 1}. {s}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <View style={styles.card}>
        {step === 0 && (
          <>
            <Text style={styles.label}>Weight (kg)</Text>
            <TextInput style={styles.input} value={weight} onChangeText={setWeight} keyboardType="numeric" placeholderTextColor={colors.muted} />
            <Text style={styles.label}>Height (cm)</Text>
            <TextInput style={styles.input} value={height} onChangeText={setHeight} keyboardType="numeric" placeholderTextColor={colors.muted} />
            <Text style={styles.label}>Activity level</Text>
            <View style={styles.chips}>
              {ACTIVITIES.map((a) => (
                <Chip key={a.id} label={a.label} on={activity === a.id} onPress={() => setActivity(a.id)} />
              ))}
            </View>
          </>
        )}
        {step === 1 && (
          <View style={styles.chips}>
            {GOALS.map((g) => (
              <Chip key={g.id} label={g.label} on={goal === g.id} onPress={() => setGoal(g.id)} />
            ))}
          </View>
        )}
        {step === 2 && (
          <View style={styles.chips}>
            {CONDITIONS.map((c) => (
              <Chip key={c} label={c} on={conditions.includes(c)} onPress={() => toggle(conditions, setConditions, c)} />
            ))}
          </View>
        )}
        {step === 3 && (
          <View style={styles.chips}>
            {DIETS.map((d) => (
              <Chip key={d.id} label={d.label} on={diet === d.id} onPress={() => setDiet(d.id)} />
            ))}
          </View>
        )}
        {step === 4 && (
          <>
            <View style={styles.chips}>
              {ALLERGIES.map((a) => (
                <Chip key={a.id} label={a.label} on={allergies.includes(a.id)} onPress={() => toggleId(allergies, setAllergies, a.id)} />
              ))}
            </View>
            <Text style={styles.label}>Foods you dislike (comma-separated)</Text>
            <TextInput style={styles.input} value={dislikes} onChangeText={setDislikes} placeholder="e.g. mushroom, bitter gourd" placeholderTextColor={colors.muted} />
          </>
        )}

        <View style={styles.navRow}>
          {step > 0 && (
            <TouchableOpacity style={styles.btnAlt} onPress={() => setStep(step - 1)}>
              <Text style={styles.btnAltText}>Back</Text>
            </TouchableOpacity>
          )}
          {step < STEPS.length - 1 ? (
            <TouchableOpacity
              style={[styles.btn, !canNext() && styles.btnDisabled]}
              disabled={!canNext()}
              onPress={advance}
            >
              <Text style={styles.btnText}>Next</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity style={styles.btn} onPress={generate} disabled={busy}>
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Generate 15-day plan</Text>}
            </TouchableOpacity>
          )}
        </View>
        {!!err && <Text style={styles.err}>{err}</Text>}
      </View>
    </ScrollView>
  );
}

function Macro({ label, value, tint, color }) {
  return (
    <View style={[styles.macroChip, { backgroundColor: tint }]}>
      <Text style={[styles.macroVal, { color }]}>{value}</Text>
      <Text style={[styles.macroLabel, { color }]}>{label}</Text>
    </View>
  );
}

function Chip({ label, on, onPress }) {
  return (
    <TouchableOpacity onPress={onPress} style={[styles.chip, on && styles.chipOn]}>
      <Text style={[styles.chipText, on && styles.chipTextOn]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: "transparent" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "transparent" },
  centerText: { color: colors.muted, marginTop: 10 },
  title: {
    fontFamily: "Georgia",
    fontSize: 26,
    fontWeight: "600",
    color: colors.text,
    letterSpacing: -0.3,
  },
  sub: { color: colors.muted, marginTop: 4, marginBottom: 12, lineHeight: 18 },
  hero: {
    margin: 16,
    marginBottom: 8,
    backgroundColor: palette.sage,
    borderRadius: radius.lg,
    padding: 18,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
  },
  heroOver: {
    color: "rgba(255,255,255,0.85)",
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 1.5,
  },
  heroTitle: {
    fontFamily: "Georgia",
    color: "#fff",
    fontSize: 28,
    fontWeight: "600",
    marginTop: 4,
  },
  heroSub: { color: "rgba(255,255,255,0.9)", marginTop: 6, fontSize: 13 },
  statusBadge: {
    alignSelf: "flex-start",
    marginTop: 12,
    backgroundColor: "rgba(245, 212, 222, 0.35)",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
  },
  statusBadgeText: { color: "#fff", fontSize: 12, fontWeight: "600" },
  dayRow: { paddingHorizontal: 16, gap: 8, paddingBottom: 8 },
  dayChip: {
    width: 58,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: "rgba(255,255,255,0.72)",
    paddingVertical: 10,
    alignItems: "center",
  },
  dayChipOn: { backgroundColor: colors.primarySoft, borderColor: colors.primary },
  dayNum: { fontWeight: "800", color: colors.text, fontSize: 16 },
  dayNumOn: { color: colors.primaryDark },
  dayLabel: { fontSize: 10, color: colors.muted, marginTop: 2 },
  dayLabelOn: { color: colors.primaryDark, fontWeight: "600" },
  macroCard: {
    marginHorizontal: 16,
    marginTop: 8,
    ...glassCard,
    padding: 14,
  },
  macroHeader: { flexDirection: "row", justifyContent: "space-between", marginBottom: 10 },
  macroHeaderLabel: { fontWeight: "700", color: colors.text },
  macroHeaderVal: { fontWeight: "800", color: colors.primaryDark },
  macroRow: { flexDirection: "row", gap: 8 },
  macroChip: { flex: 1, borderRadius: 12, paddingVertical: 10, alignItems: "center" },
  macroVal: { fontWeight: "800", fontSize: 14 },
  macroLabel: { fontSize: 10, fontWeight: "600", marginTop: 2 },
  drinkCard: {
    marginHorizontal: 16,
    marginTop: 12,
    backgroundColor: colors.primarySoft,
    borderRadius: radius.md,
    padding: 14,
    borderWidth: 1,
    borderColor: "rgba(107, 143, 113, 0.2)",
  },
  drinkOver: {
    fontSize: 11,
    fontWeight: "700",
    color: colors.primaryDark,
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  filterRow: { paddingHorizontal: 16, gap: 8, paddingVertical: 14 },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: "rgba(255,255,255,0.72)",
  },
  filterChipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  filterText: { color: colors.muted, fontWeight: "600", fontSize: 13 },
  filterTextOn: { color: "#fff" },
  mealCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    ...glassCard,
    padding: 12,
    marginBottom: 10,
  },
  mealIcon: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: palette.lotusSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  mealTop: { flexDirection: "row", justifyContent: "space-between" },
  mealOver: {
    fontSize: 11,
    fontWeight: "700",
    color: colors.primaryDark,
    textTransform: "uppercase",
  },
  mealTime: { fontSize: 11, color: colors.muted },
  mealTitle: { fontWeight: "700", color: colors.text, marginTop: 2, fontSize: 15 },
  mealMetaLine: { color: colors.muted, fontSize: 12, marginTop: 4 },
  regionChip: { color: colors.muted, fontSize: 11, marginTop: 4 },
  recipeBox: { marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.border },
  recipeLabel: { fontWeight: "700", color: colors.text, fontSize: 12 },
  chev: { color: colors.muted, fontSize: 18, marginLeft: 6, marginTop: 4 },
  stepRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 12 },
  stepChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.72)",
    borderWidth: 1,
    borderColor: colors.border,
  },
  stepOn: { backgroundColor: colors.primarySoft, borderColor: colors.primary },
  stepLocked: { opacity: 0.45 },
  stepText: { fontSize: 11, color: colors.muted, fontWeight: "600" },
  stepTextOn: { color: colors.primaryDark },
  stepTextLocked: { color: colors.muted },
  card: {
    ...glassCard,
    padding: 14,
    marginBottom: 12,
  },
  label: { color: colors.muted, fontSize: 12, fontWeight: "600", marginTop: 8, marginBottom: 4 },
  input: {
    borderWidth: 2,
    borderColor: "rgba(245, 212, 222, 0.7)",
    borderRadius: radius.md,
    padding: 12,
    color: colors.text,
    backgroundColor: "rgba(255,255,255,0.7)",
  },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: "rgba(255,255,255,0.8)",
  },
  chipOn: { backgroundColor: colors.primarySoft, borderColor: colors.primary },
  chipText: { color: colors.text, fontSize: 13, fontWeight: "600" },
  chipTextOn: { color: colors.primaryDark },
  navRow: { flexDirection: "row", gap: 8, marginTop: 16 },
  btn: {
    flex: 1,
    backgroundColor: colors.primary,
    borderRadius: 24,
    padding: 13,
    alignItems: "center",
  },
  btnDisabled: { opacity: 0.4 },
  btnText: { color: "#fff", fontWeight: "700" },
  btnAlt: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 24,
    padding: 13,
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.8)",
  },
  btnAltText: { color: colors.primaryDark, fontWeight: "700" },
  err: { color: colors.red, marginTop: 8 },
  cardTitle: {
    fontFamily: "Georgia",
    fontWeight: "600",
    color: colors.text,
    marginBottom: 8,
    fontSize: 17,
  },
  meta: { color: colors.muted, fontSize: 12, marginTop: 2, lineHeight: 18 },
  link: { color: colors.primaryDark, fontSize: 12, fontWeight: "700", marginTop: 6 },
  regenBtn: {
    marginHorizontal: 16,
    marginTop: 8,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 24,
    padding: 13,
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.8)",
  },
  regenText: { color: colors.primaryDark, fontWeight: "700" },
  disclaimer: { color: colors.muted, fontSize: 12, fontStyle: "italic", margin: 16, marginBottom: 24 },
});

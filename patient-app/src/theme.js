/**
 * Sehat Sakhi design tokens — from ui-repo reference.
 * Forest sage · warm rice · lotus pink · terracotta · soft gold · charcoal
 */

export const palette = {
  sage: "#6B8F71",
  sageLight: "#8FAF94",
  sageDark: "#4A6B50",
  rice: "#F7F1E8",
  riceWarm: "#FAF6EF",
  lotus: "#E8A8B8",
  lotusSoft: "#F5D4DE",
  lotusDeep: "#D4899C",
  terracotta: "#C4704B",
  terracottaLight: "#D9926F",
  gold: "#D4A574",
  goldSoft: "#E8C892",
  charcoal: "#2A2826",
  charcoalSoft: "#4A4744",
};

export const colors = {
  bg: palette.rice,
  bgWarm: palette.riceWarm,
  surface: "rgba(255, 255, 255, 0.72)",
  surfaceSolid: "#FFFFFF",
  primary: palette.sage,
  primarySoft: "rgba(107, 143, 113, 0.15)",
  primaryDark: palette.sageDark,
  accent: palette.lotus,
  accentSoft: palette.lotusSoft,
  text: palette.charcoal,
  muted: palette.charcoalSoft,
  border: "rgba(232, 168, 184, 0.35)",
  borderStrong: "rgba(107, 143, 113, 0.35)",
  red: palette.terracotta,
  amber: palette.gold,
  green: palette.sage,
  gold: palette.gold,
  shadow: "rgba(107, 143, 113, 0.18)",
  onPrimary: "#FFFFFF",
};

export const sevColor = {
  red: palette.terracotta,
  amber: palette.gold,
  green: palette.sage,
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
};

export const radius = {
  sm: 12,
  md: 16,
  lg: 24,
  xl: 28,
  pill: 999,
};

/** Soft glass-card elevation (Sakhi GlassCard) */
export const cardShadow = {
  shadowColor: palette.sage,
  shadowOffset: { width: 0, height: 8 },
  shadowOpacity: 0.12,
  shadowRadius: 24,
  elevation: 4,
};

export const glassCard = {
  backgroundColor: colors.surface,
  borderRadius: radius.lg,
  borderWidth: 1,
  borderColor: colors.border,
  ...cardShadow,
};

/** Web loads Cormorant/DM Sans via App.js; native falls back to Georgia/System */
export const fonts = {
  serif: "Georgia",
  sans: "System",
};

export const sevText = {
  red: "URGENT — please tell the reception desk you've been flagged RED.",
  amber: "Priority — the doctor will see you soon.",
  green: "You're checked in. We'll keep you updated.",
};

/** Daylight atmosphere gradient stops for LivingBackground-style screens */
export const atmosphere = {
  gradientTop: "#FAF6EF",
  gradientMid: "#F7F1E8",
  gradientBottom: "#E8F0EA",
  glow: "rgba(107, 143, 113, 0.22)",
  petal: "rgba(232, 168, 184, 0.28)",
  sun: "rgba(232, 200, 146, 0.45)",
};

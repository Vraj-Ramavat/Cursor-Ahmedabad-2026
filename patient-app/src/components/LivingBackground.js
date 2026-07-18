import { StyleSheet, View } from "react-native";
import { atmosphere, colors } from "../theme";

/** Soft Sakhi sky — fixed decorative layer behind screens */
export default function LivingBackground() {
  return (
    <View style={styles.root} pointerEvents="none">
      <View style={styles.base} />
      <View style={styles.sun} />
      <View style={styles.blobTop} />
      <View style={styles.blobBottom} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    overflow: "hidden",
    zIndex: 0,
  },
  base: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.bg,
  },
  sun: {
    position: "absolute",
    top: "5%",
    right: "6%",
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: atmosphere.sun,
    opacity: 0.7,
  },
  blobTop: {
    position: "absolute",
    top: -80,
    right: -60,
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: atmosphere.glow,
  },
  blobBottom: {
    position: "absolute",
    bottom: -40,
    left: -50,
    width: 200,
    height: 200,
    borderRadius: 100,
    backgroundColor: atmosphere.petal,
  },
});

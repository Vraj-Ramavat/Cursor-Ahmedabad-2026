import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ command }) => ({
  plugins: [react()],
  // Production (Render): served under /doctor/. Local dev stays at /.
  base: command === "build" ? "/doctor/" : "/",
  server: { port: 5173 },
}));

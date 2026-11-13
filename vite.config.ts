import { defineConfig } from "vite";

// Relative Pfade, damit die App unter jedem Pfad laufen kann (z. B. GitHub Pages /fehlzeiten-tracker/).
export default defineConfig({
  base: "./",
  build: { target: "es2022" },
});

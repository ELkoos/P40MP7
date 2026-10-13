import { defineConfig } from "vitest/config";

export default defineConfig({
  // Ścieżki względne: aplikacja działa z dowolnego katalogu, np. GitHub Pages /p40mp7/.
  base: "./",
  test: { include: ["test/**/*.test.ts"] },
});

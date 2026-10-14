import { defineConfig, type Plugin } from "vitest/config";

// Lista wszystkich plików z assets/ (także ładowanych dynamicznie, np. pdf.js), żeby
// Service Worker zapisał je przy instalacji i import PDF działał offline od pierwszego uruchomienia.
function precacheList(): Plugin {
  return {
    name: "precache-list",
    apply: "build",
    generateBundle(_options, bundle) {
      const files = Object.keys(bundle)
        .filter((f) => f.startsWith("assets/") && !f.endsWith(".map"))
        .map((f) => `./${f}`);
      this.emitFile({ type: "asset", fileName: "precache.json", source: JSON.stringify(files) });
    },
  };
}

export default defineConfig({
  // Ścieżki względne: aplikacja działa z dowolnego katalogu, np. GitHub Pages /p40mp7/.
  base: "./",
  plugins: [precacheList()],
  // Pliki testowe dokumentów wczytywane w testach przez ?inline.
  assetsInclude: ["**/*.docx", "**/*.odt", "**/*.rtf"],
  test: { include: ["test/**/*.test.ts"] },
});

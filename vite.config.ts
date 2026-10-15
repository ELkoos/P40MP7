import { defineConfig, type Plugin } from "vitest/config";
import { buildServiceWorker } from "./sw/build";
import { SW_TEMPLATE } from "./sw/template";

// sw.js z listą wszystkich plików z assets/ (także ładowanych dynamicznie, np. pdf.js) i wersją cache
// zależną od builda: import PDF działa offline od pierwszego uruchomienia każdej nowej wersji.
function serviceWorker(): Plugin {
  return {
    name: "service-worker",
    apply: "build",
    generateBundle(_options, bundle) {
      const assets = Object.keys(bundle)
        .filter((f) => f.startsWith("assets/") && !f.endsWith(".map"))
        .map((f) => `./${f}`);
      this.emitFile({ type: "asset", fileName: "sw.js", source: buildServiceWorker(SW_TEMPLATE, assets) });
    },
  };
}

export default defineConfig({
  // Ścieżki względne: aplikacja działa z dowolnego katalogu, np. GitHub Pages /p40mp7/.
  base: "./",
  plugins: [serviceWorker()],
  // Pliki testowe dokumentów wczytywane w testach przez ?inline.
  assetsInclude: ["**/*.docx", "**/*.odt", "**/*.rtf"],
  test: { include: ["test/**/*.test.ts"] },
});

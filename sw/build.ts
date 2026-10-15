/** FNV-1a, 32 bity: krótki skrót bez zależności od node:crypto. */
function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/**
 * Plik sw.js dla konkretnego builda: wersja cache = skrót szablonu i listy plików z assets/
 * (nazwy zawierają skrót treści, więc każda zmiana kodu zmienia wersję), lista plików do zapisania przy instalacji.
 */
export function buildServiceWorker(template: string, assets: readonly string[]): string {
  const list = [...new Set(assets)].sort();
  const version = fnv1a(template + "\n" + list.join("\n"));
  const VERSION = /const VERSION = "[^"]*";/;
  const ASSETS = /const ASSETS = \/\*ASSETS\*\/ \[\];/;
  if (!VERSION.test(template) || !ASSETS.test(template)) throw new Error("Szablon sw.js: brak znaczników VERSION lub ASSETS");
  return template
    .replace(VERSION, `const VERSION = ${JSON.stringify(version)};`)
    .replace(ASSETS, `const ASSETS = ${JSON.stringify(list)};`);
}

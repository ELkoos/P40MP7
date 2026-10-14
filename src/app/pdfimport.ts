// PDF → tekst przez pdf.js (wersja "legacy" dla starszych Safari). Moduł ładowany dynamicznie,
// więc nie zwiększa pliku startowego aplikacji. Składanie linii i akapitów: assemblePdfText (testowane).
import { ImportError, joinParagraphs } from "./textimport";

export interface PdfItem {
  str: string;
  /** Linia bazowa (y rośnie w górę strony). */
  y: number;
  x: number;
  height: number;
  hasEOL?: boolean;
}

export async function pdfToText(bytes: Uint8Array): Promise<string> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const workerUrl = (await import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url")).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const task = pdfjs.getDocument({ data: bytes });
  let doc;
  try {
    doc = await task.promise;
  } catch (e) {
    const name = (e as Error)?.name;
    if (name === "PasswordException") throw new ImportError("PDF jest zabezpieczony hasłem.");
    throw new ImportError("Nie udało się odczytać pliku PDF.");
  }
  const pages: PdfItem[][] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const content = await page.getTextContent();
    const items: PdfItem[] = [];
    for (const it of content.items) {
      if (!("str" in it)) continue;
      items.push({ str: it.str, x: it.transform[4], y: it.transform[5], height: it.height, hasEOL: it.hasEOL });
    }
    pages.push(items);
    page.cleanup();
  }
  await task.destroy();
  const text = assemblePdfText(pages);
  if (!text.trim()) {
    throw new ImportError("PDF nie zawiera warstwy tekstowej (prawdopodobnie skan). Potrzebny jest OCR, np. w programie do PDF lub Google Docs.");
  }
  return text;
}

interface Line {
  text: string;
  y: number;
  height: number;
}

/**
 * Składa elementy tekstu w akapity.
 * Nowa linia: zmiana y o więcej niż pół wysokości znaku. Nowy akapit: odstęp między liniami
 * większy niż 1,5× typowy odstęp na stronie, skok w górę (następna kolumna) albo zmiana wielkości
 * czcionki o ponad 20% (nagłówek) [heurystyka].
 * Przeniesienie wyrazu ("przy-" + "gotowanie") jest sklejane, gdy po łączniku jest mała litera [heurystyka].
 */
export function assemblePdfText(pages: PdfItem[][]): string {
  const paragraphs: string[] = [];
  let cur = "";
  const append = (line: string) => {
    if (!cur) cur = line;
    else if (/\p{L}-$/u.test(cur) && /^\p{Ll}/u.test(line)) cur = cur.slice(0, -1) + line;
    else cur += " " + line;
  };
  const breakParagraph = () => {
    paragraphs.push(cur);
    cur = "";
  };

  for (const items of pages) {
    const lines: Line[] = [];
    let line: Line | null = null;
    for (const it of items) {
      if (line && Math.abs(it.y - line.y) > Math.max(1, line.height || it.height) * 0.5 && it.str.trim()) {
        lines.push(line);
        line = null;
      }
      if (!line) {
        if (!it.str.trim() && !it.hasEOL) continue;
        line = { text: "", y: it.y, height: it.height };
      }
      line.text += it.str;
      if (it.height > line.height) line.height = it.height;
      if (it.hasEOL) {
        lines.push(line);
        line = null;
      }
    }
    if (line) lines.push(line);

    const real = lines.map((l) => ({ ...l, text: l.text.replace(/\s+/g, " ").trim() })).filter((l) => l.text);
    const gaps = real.slice(1).map((l, i) => real[i]!.y - l.y).filter((g) => g > 0).sort((a, b) => a - b);
    const typical = gaps.length ? gaps[Math.floor(gaps.length / 2)]! : 0;

    real.forEach((l, i) => {
      if (i > 0) {
        const gap = real[i - 1]!.y - l.y;
        const prev = real[i - 1]!;
        const sizeChange = prev.height > 0 && l.height > 0 && Math.abs(prev.height - l.height) / Math.max(prev.height, l.height) > 0.2;
        if (gap < 0 || (typical > 0 && gap > typical * 1.5) || sizeChange) breakParagraph();
      }
      append(l.text);
    });
    // Koniec strony: akapit się kończy, jeśli ostatnie zdanie jest zamknięte.
    if (/[.!?…:"”»)]$/.test(cur)) breakParagraph();
  }
  breakParagraph();
  return joinParagraphs(paragraphs);
}

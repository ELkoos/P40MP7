import { describe, expect, it } from "vitest";
import { assemblePdfText, type PdfItem } from "../src/app/pdfimport";
import { decodeText, detectFormat, extractFromBytes, rtfToText, titleFromFileName } from "../src/app/textimport";

import docxUrl from "./fixtures/probka.docx?inline";
import odtUrl from "./fixtures/probka.odt?inline";
import rtfUrl from "./fixtures/probka.rtf?inline";

// Vite wczytuje pliki jako data:...;base64, — bez zależności od typów Node.
const bytesOf = (dataUrl: string) => Uint8Array.from(atob(dataUrl.slice(dataUrl.indexOf(",") + 1)), (c) => c.charCodeAt(0));

// Pliki w test/fixtures: probka.docx (python-docx), .odt/.rtf/.pdf (LibreOffice z tego .docx).
// probka.pdf i skan.pdf sprawdzane w przeglądarce (pdf.js potrzebuje workera).
const LONG = "Długi akapit " + Array.from({ length: 60 }, (_, i) => `słowo${i + 1}`).join(" ") + " koniec.";
const EXPECTED = [
  "Zażółć gęślą jaźń",
  'Pierwszy akapit z polskimi znakami: ąćęłńóśźż ĄĆĘŁŃÓŚŹŻ. Pogrubione i dalej & <znaki> "cudzysłów".',
  "Drugi akapit,\npo złamaniu linii.",
  "Trzeci akapit z tabulatorem.",
  LONG,
].join("\n\n");

describe("import tekstu", () => {
  it("rozpoznaje format po rozszerzeniu i MIME", () => {
    expect(detectFormat("a.DOCX")).toBe("docx");
    expect(detectFormat("a.odt")).toBe("odt");
    expect(detectFormat("a.rtf")).toBe("rtf");
    expect(detectFormat("a.pdf")).toBe("pdf");
    expect(detectFormat("a.txt")).toBe("txt");
    expect(detectFormat("plik", "application/pdf")).toBe("pdf");
    expect(detectFormat("a.doc")).toBeNull();
    expect(detectFormat("a.xlsx")).toBeNull();
    expect(titleFromFileName("Przemówienie v2.docx")).toBe("Przemówienie v2");
  });

  it("txt: UTF-8, UTF-8 z BOM, zapasowo Windows-1250", () => {
    expect(decodeText(new TextEncoder().encode("Zażółć"))).toBe("Zażółć");
    expect(decodeText(new Uint8Array([0xef, 0xbb, 0xbf, 0x61]))).toBe("a");
    // "łąka" w Windows-1250: ł=0xB3, ą=0xB9
    expect(decodeText(new Uint8Array([0xb3, 0xb9, 0x6b, 0x61]))).toBe("łąka");
  });

  it("docx", async () => {
    expect(await extractFromBytes("docx", bytesOf(docxUrl))).toBe(EXPECTED);
  });

  it("odt", async () => {
    expect(await extractFromBytes("odt", bytesOf(odtUrl))).toBe(EXPECTED);
  });

  it("rtf", async () => {
    expect(await extractFromBytes("rtf", bytesOf(rtfUrl))).toBe(EXPECTED);
  });

  it("rtf: komórki tabeli nie sklejają się, wiersz tabeli = akapit", () => {
    const src = "{\\rtf1\\ansi\\trowd\\cellx1000\\cellx2000\\pard\\intbl Ala\\cell Ola\\cell\\row\\trowd\\pard\\intbl kot\\cell pies\\cell\\row\\pard Dalej\\par}";
    expect(rtfToText(new TextEncoder().encode(src))).toBe("Ala Ola\n\nkot pies\n\nDalej");
  });

  it("rtf: \\uN i \\'hh w stronie kodowej 1250", () => {
    expect(rtfToText(new TextEncoder().encode("{\\rtf1\\ansi\\ansicpg1250{\\fonttbl{\\f0 Arial;}}\\f0 \\'b3\\'b9ka \\u380?\\par drugi}"))).toBe("łąka ż\n\ndrugi");
  });

  it("docx/odt: uszkodzony plik daje czytelny błąd", async () => {
    await expect(extractFromBytes("docx", new Uint8Array([1, 2, 3]))).rejects.toThrow(/ZIP/);
  });
});

describe("PDF: składanie linii i akapitów", () => {
  const line = (str: string, y: number): PdfItem => ({ str, y, x: 0, height: 10, hasEOL: true });

  it("łączy linie akapitu, rozdziela akapity po większym odstępie, skleja przeniesienia", () => {
    const page = [line("Ala ma", 700), line("kota, a przy-", 688), line("gotowanie trwa.", 676), line("Nowy akapit.", 650)];
    expect(assemblePdfText([page])).toBe("Ala ma kota, a przygotowanie trwa.\n\nNowy akapit.");
  });

  it("zdanie przechodzące na następną stronę zostaje w jednym akapicie", () => {
    expect(assemblePdfText([[line("Początek", 100)], [line("końca.", 700)]])).toBe("Początek końca.");
    expect(assemblePdfText([[line("Koniec.", 100)], [line("Nowy.", 700)]])).toBe("Koniec.\n\nNowy.");
  });

  it("zmiana wielkości czcionki (nagłówek) zaczyna nowy akapit", () => {
    const head: PdfItem = { str: "Tytuł", y: 712, x: 0, height: 16, hasEOL: true };
    expect(assemblePdfText([[head, line("Treść", 700), line("dalej.", 688)]])).toBe("Tytuł\n\nTreść dalej.");
  });

  it("elementy w tej samej linii bez hasEOL są sklejane", () => {
    const items: PdfItem[] = [
      { str: "Raz ", y: 500, x: 0, height: 10 },
      { str: "dwa", y: 500, x: 30, height: 10, hasEOL: true },
      { str: "trzy", y: 488, x: 0, height: 10 },
    ];
    expect(assemblePdfText([items])).toBe("Raz dwa trzy");
  });
});

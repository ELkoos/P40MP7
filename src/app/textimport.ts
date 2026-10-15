// Import tekstu z plików: .txt, .docx, .odt, .rtf, .pdf. Wszystko lokalnie, bez sieci.
// DOCX i ODT to archiwa ZIP z XML-em: rozpakowanie przez DecompressionStream przeglądarki,
// bez zewnętrznych bibliotek. PDF przez pdf.js, ładowany dopiero przy pierwszym imporcie PDF.

/** Wartość atrybutu accept dla pola wyboru pliku. */
export const IMPORT_ACCEPT =
  ".txt,.text,.md,.docx,.odt,.rtf,.pdf,text/plain,application/pdf,application/rtf,text/rtf," +
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document," +
  "application/vnd.oasis.opendocument.text";

export type ImportFormat = "txt" | "docx" | "odt" | "rtf" | "pdf";

export class ImportError extends Error {}

export function detectFormat(name: string, mime = ""): ImportFormat | null {
  const ext = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase() ?? "";
  if (ext === "docx" || mime.includes("wordprocessingml")) return "docx";
  if (ext === "odt" || mime.includes("opendocument.text")) return "odt";
  if (ext === "rtf" || mime.includes("rtf")) return "rtf";
  if (ext === "pdf" || mime === "application/pdf") return "pdf";
  if (ext === "doc") return null; // stary binarny Word: patrz komunikat w extractText.
  if (ext === "txt" || ext === "text" || ext === "md" || mime.startsWith("text/") || ext === "") return "txt";
  return null;
}

/** Tytuł z nazwy pliku: bez rozszerzenia. */
export function titleFromFileName(name: string): string {
  return name.replace(/\.[a-z0-9]{1,5}$/i, "");
}

export async function extractText(file: File): Promise<string> {
  const format = detectFormat(file.name, file.type);
  if (/\.doc$/i.test(file.name)) {
    throw new ImportError("Stary format .doc nie jest obsługiwany. Zapisz plik w Wordzie jako .docx i zaimportuj ponownie.");
  }
  if (!format) throw new ImportError(`Nieobsługiwany format pliku: ${file.name}`);
  const bytes = new Uint8Array(await file.arrayBuffer());
  return extractFromBytes(format, bytes);
}

export async function extractFromBytes(format: ImportFormat, bytes: Uint8Array): Promise<string> {
  switch (format) {
    case "txt":
      return decodeText(bytes);
    case "docx":
      return docxXmlToText(await readZipEntry(bytes, "word/document.xml"));
    case "odt":
      return odtXmlToText(await readZipEntry(bytes, "content.xml"));
    case "rtf":
      return rtfToText(bytes);
    case "pdf": {
      const { pdfToText } = await import("./pdfimport");
      return pdfToText(bytes);
    }
  }
}

/** UTF-8 (z BOM lub bez), UTF-16 z BOM; przy błędnym UTF-8 zapasowo Windows-1250. */
export function decodeText(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1250").decode(bytes);
  }
}

/** Akapity rozdzielone pustą linią (tak dzieli je tokenizer), bez pustych akapitów. */
export function joinParagraphs(paragraphs: string[]): string {
  return paragraphs
    .map((p) => p.replace(/[ \t ]+/g, " ").replace(/ *\n */g, "\n").trim())
    .filter((p) => p.length > 0)
    .join("\n\n");
}

// ---------- ZIP ----------

export async function readZipEntry(zip: Uint8Array, name: string): Promise<string> {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  // Koniec katalogu centralnego: sygnatura 0x06054b50, szukana od końca (komentarz ≤ 64 KB).
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 0xffff); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ImportError("Plik jest uszkodzony albo nie jest dokumentem (brak struktury ZIP).");
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const utf8 = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (view.getUint32(p, true) !== 0x02014b50) break;
    const method = view.getUint16(p + 10, true);
    const compSize = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const localOffset = view.getUint32(p + 42, true);
    const entryName = utf8.decode(zip.subarray(p + 46, p + 46 + nameLen));
    if (entryName === name) {
      const lNameLen = view.getUint16(localOffset + 26, true);
      const lExtraLen = view.getUint16(localOffset + 28, true);
      const start = localOffset + 30 + lNameLen + lExtraLen;
      const data = zip.subarray(start, start + compSize);
      if (method === 0) return utf8.decode(data);
      if (method === 8) return utf8.decode(await inflateRaw(data));
      throw new ImportError(`Nieobsługiwana kompresja w pliku (metoda ${method}).`);
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  throw new ImportError(`To nie wygląda na prawidłowy dokument (brak ${name}).`);
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// ---------- XML (DOCX, ODT) ----------

const XML_TOKEN = /<(\/?)([A-Za-z_][\w.:-]*)([^>]*?)(\/?)>|<!\[CDATA\[([\s\S]*?)\]\]>|<[!?][^>]*>|([^<]+)/g;

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" }[e.toLowerCase()] ?? m;
  });
}

function attr(attrs: string, name: string): string | null {
  const m = new RegExp(`\\s${name.replace(":", "\\:")}\\s*=\\s*"([^"]*)"`).exec(attrs);
  return m ? m[1]! : null;
}

/**
 * Tekst główny z word/document.xml. Pomija tekst usunięty (śledzenie zmian), kody pól i duplikaty VML.
 * Pole tekstowe (ramka) jest zakotwiczone w akapicie; jego akapity trafiają za ten akapit, żeby go nie rozcinać.
 */
export function docxXmlToText(xml: string): string {
  const paragraphs: string[] = [];
  let cur = "";
  let inText = 0;
  let skip = 0; // mc:Fallback (kopia pola tekstowego w starym formacie)
  // Pola tekstowe: zachowany tekst akapitu, w którym stoi ramka, i akapity ramek czekające na koniec tego akapitu.
  const outer: string[] = [];
  let boxParagraphs: string[] = [];
  for (const m of xml.matchAll(XML_TOKEN)) {
    const [, close, tag, attrs, selfClose, , text] = m;
    if (text !== undefined) {
      if (inText && !skip) cur += decodeEntities(text);
      continue;
    }
    if (!tag) continue;
    if (tag === "mc:Fallback") {
      if (close) skip--;
      else if (!selfClose) skip++;
      continue;
    }
    if (skip) continue;
    if (tag === "w:txbxContent") {
      if (close) {
        if (cur) boxParagraphs.push(cur);
        cur = outer.pop() ?? "";
      } else if (!selfClose) {
        outer.push(cur);
        cur = "";
      }
      continue;
    }
    if (tag === "w:t") {
      if (close) inText = 0;
      else if (!selfClose) inText = 1;
    } else if (!close && (tag === "w:tab" || tag === "w:ptab")) {
      cur += " ";
    } else if (!close && (tag === "w:br" || tag === "w:cr")) {
      if (attr(attrs ?? "", "w:type") !== "page") cur += "\n";
    } else if (!close && tag === "w:noBreakHyphen") {
      cur += "-";
    } else if (tag === "w:p" && (close || selfClose)) {
      if (outer.length > 0) boxParagraphs.push(cur);
      else {
        paragraphs.push(cur, ...boxParagraphs);
        boxParagraphs = [];
      }
      cur = "";
    }
  }
  paragraphs.push(cur, ...boxParagraphs);
  return joinParagraphs(paragraphs);
}

/** Tekst z content.xml (ODT). Pomija przypisy i komentarze. */
export function odtXmlToText(xml: string): string {
  const paragraphs: string[] = [];
  let cur = "";
  let inBody = false;
  let skip = 0;
  let depth = 0; // zagnieżdżenie text:p / text:h
  for (const m of xml.matchAll(XML_TOKEN)) {
    const [, close, tag, attrs, selfClose, , text] = m;
    if (text !== undefined) {
      if (inBody && !skip && depth > 0) cur += decodeEntities(text);
      continue;
    }
    if (!tag) continue;
    if (tag === "office:text") {
      inBody = !close && !selfClose;
      continue;
    }
    if (!inBody) continue;
    if (tag === "text:note" || tag === "office:annotation" || tag === "text:tracked-changes") {
      if (close) skip--;
      else if (!selfClose) skip++;
      continue;
    }
    if (skip) continue;
    if (tag === "text:p" || tag === "text:h") {
      if (close || selfClose) {
        if (!close) depth++;
        depth--;
        if (depth === 0) {
          paragraphs.push(cur);
          cur = "";
        }
      } else depth++;
    } else if (!close && tag === "text:s") {
      cur += " ".repeat(Math.max(1, Number(attr(attrs ?? "", "text:c") ?? 1)));
    } else if (!close && tag === "text:tab") {
      cur += " ";
    } else if (!close && tag === "text:line-break") {
      cur += "\n";
    }
  }
  return joinParagraphs(paragraphs);
}

// ---------- RTF ----------

/** Podstawowy RTF: akapity, \uN, \'hh w stronie kodowej z \ansicpg. Pomija tabele czcionek, obrazy itp. */
export function rtfToText(bytes: Uint8Array): string {
  const src = new TextDecoder("latin1").decode(bytes);
  if (!src.startsWith("{\\rtf")) throw new ImportError("Plik nie jest w formacie RTF.");
  const cp = /\\ansicpg(\d+)/.exec(src)?.[1] ?? "1252";
  let decoder: TextDecoder;
  try {
    decoder = new TextDecoder(`windows-${cp}`);
  } catch {
    decoder = new TextDecoder("windows-1252");
  }
  const SKIP_DEST = new Set(["fonttbl", "colortbl", "stylesheet", "info", "pict", "header", "footer", "headerl", "headerr", "footerl", "footerr", "footnote", "listtable", "listoverridetable", "rsidtbl", "generator", "xmlnstbl", "themedata", "colorschememapping", "latentstyles", "datastore", "object", "fldinst", "bkmkstart", "bkmkend"]);

  type State = { skip: boolean; uc: number };
  const stack: State[] = [];
  let st: State = { skip: false, uc: 1 };
  let out = "";
  let pendingBytes: number[] = [];
  let skipChars = 0; // znaki zastępcze po \uN
  const flush = () => {
    if (pendingBytes.length) {
      out += decoder.decode(new Uint8Array(pendingBytes));
      pendingBytes = [];
    }
  };
  const emit = (s: string) => {
    flush();
    if (!st.skip) out += s;
  };

  let i = 0;
  while (i < src.length) {
    const ch = src[i]!;
    if (ch === "{") {
      flush();
      stack.push(st);
      st = { ...st };
      i++;
      if (src.startsWith("\\*", i)) st.skip = true;
      continue;
    }
    if (ch === "}") {
      flush();
      st = stack.pop() ?? st;
      i++;
      continue;
    }
    if (ch === "\\") {
      const next = src[i + 1] ?? "";
      if (next === "'") {
        const hex = parseInt(src.substr(i + 2, 2), 16);
        i += 4;
        if (skipChars > 0) {
          skipChars--;
          continue;
        }
        if (!st.skip && Number.isFinite(hex)) pendingBytes.push(hex);
        continue;
      }
      if (/[a-z]/i.test(next)) {
        const m = /^\\([a-z]+)(-?\d+)? ?/i.exec(src.slice(i, i + 40))!;
        i += m[0].length;
        const word = m[1]!;
        const arg = m[2] !== undefined ? Number(m[2]) : null;
        if (SKIP_DEST.has(word)) st.skip = true;
        else if (word === "par" || word === "sect") emit("\n\n");
        else if (word === "line") emit("\n");
        // Tabela: komórki rozdzielone spacją, każdy wiersz tabeli jako osobny akapit.
        else if (word === "cell" || word === "nestcell") emit(" ");
        else if (word === "row" || word === "nestrow") emit("\n\n");
        else if (word === "tab") emit(" ");
        else if (word === "emdash") emit("—");
        else if (word === "endash") emit("–");
        else if (word === "lquote") emit("‘");
        else if (word === "rquote") emit("’");
        else if (word === "ldblquote") emit("„");
        else if (word === "rdblquote") emit("”");
        else if (word === "uc" && arg !== null) st.uc = arg;
        else if (word === "u" && arg !== null) {
          emit(String.fromCharCode(arg < 0 ? arg + 65536 : arg));
          skipChars = st.uc;
        }
        continue;
      }
      // Symbol sterujący: \\ \{ \} \~ \- \_ itd.
      i += 2;
      if (next === "\\" || next === "{" || next === "}") emit(next);
      else if (next === "~") emit(" ");
      else if (next === "_") emit("-");
      else if (next === "\n" || next === "\r") emit("\n\n");
      continue;
    }
    i++;
    if (ch === "\r" || ch === "\n") continue;
    if (skipChars > 0) {
      skipChars--;
      continue;
    }
    if (!st.skip) {
      flush();
      out += ch;
    }
  }
  flush();
  return joinParagraphs(out.split(/\n{2,}/));
}

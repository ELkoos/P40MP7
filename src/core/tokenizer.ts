import { ABBREVIATIONS, DEFAULT_TOKENIZE } from "./defaults";
import { orpCharIndex } from "./orp";
import type { Token, TokenizeOptions, WeightConfig } from "./types";

const LETTER_G = /[\p{L}\p{N}]/gu;
const LETTER = /[\p{L}\p{N}]/u;
const CLOSING = /[»"'”’)\]]+$/u;
const OPENING = /^[„"«(\[]+/u;
const DASH = /^[–—-]$/u;

/** 6.1 pkt 1: normalizacja końców wierszy i odstępów. */
export function normalize(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .trim();
}

export function countLetters(text: string): number {
  return text.match(LETTER_G)?.length ?? 0;
}

interface RawWord {
  text: string;
  lineBreakAfter: boolean;
}

function isSentenceEnd(word: string, isParagraphEnd: boolean): boolean {
  const core = word.replace(CLOSING, "");
  if (!/[.!?…]$/u.test(core)) return false;
  if (core.endsWith(".") && !core.endsWith("..")) {
    const bare = core.replace(OPENING, "").slice(0, -1);
    if (ABBREVIATIONS.has(bare.toLowerCase())) return false;
    // Inicjał, np. „J. Kowalski”.
    if (/^\p{Lu}$/u.test(bare)) return false;
    // Liczba porządkowa w wyliczeniu, np. „3.” [Z]; na końcu akapitu nadal kończy zdanie.
    if (/^\d+$/.test(bare) && !isParagraphEnd) return false;
  }
  return true;
}

function isClauseEnd(word: string, next: string | undefined): boolean {
  const core = word.replace(CLOSING, "");
  return /[,;:]$/u.test(core) || (next !== undefined && DASH.test(next));
}

export function tokenWeight(letters: number, flags: Pick<Token, "sentenceEnd" | "clauseEnd" | "paragraphEnd">, w: WeightConfig): number {
  const mLen = letters <= w.shortMax ? 1 : letters <= w.mediumMax ? w.medium : w.long;
  // Przy kilku flagach bierzemy największy mnożnik, nie iloczyn (6.2).
  const mInt = flags.paragraphEnd ? w.paragraph : flags.sentenceEnd ? w.sentence : flags.clauseEnd ? w.clause : 1;
  return mLen * mInt;
}

/** 6.1 pkt 6: podział słowa na kawałki o zbliżonej liczbie liter, nie większej niż maxChunk. */
export function splitLongWord(word: string, maxChunk: number): string[] {
  const chars = Array.from(word);
  const letters = chars.filter((c) => LETTER.test(c)).length;
  const n = Math.ceil(letters / maxChunk);
  if (n <= 1) return [word];
  const base = Math.floor(letters / n);
  const extra = letters % n;
  const pieces: string[] = [];
  let start = 0;
  let seen = 0;
  let piece = 0;
  let target = base + (piece < extra ? 1 : 0);
  for (let i = 0; i < chars.length && piece < n - 1; i++) {
    if (LETTER.test(chars[i]!)) {
      seen++;
      if (seen === target) {
        pieces.push(chars.slice(start, i + 1).join("") + "-");
        start = i + 1;
        piece++;
        seen = 0;
        target = base + (piece < extra ? 1 : 0);
      }
    }
  }
  pieces.push(chars.slice(start).join(""));
  return pieces;
}

/** Tekst → tokeny z flagami, wagami i ORP (6.1–6.3). */
export function tokenize(text: string, options: Partial<TokenizeOptions> = {}): Token[] {
  const opt: TokenizeOptions = { ...DEFAULT_TOKENIZE, ...options };
  const paragraphs = normalize(text)
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  const tokens: Token[] = [];
  let sentenceStart = 0;
  let sourceWord = 0;

  paragraphs.forEach((paragraph, paragraphIndex) => {
    const paragraphStart = tokens.length;
    const words: RawWord[] = [];
    const lines = paragraph.split("\n");
    lines.forEach((line, li) => {
      const parts = line.split(" ").filter((w) => w.length > 0);
      parts.forEach((w, wi) => {
        words.push({ text: w, lineBreakAfter: li < lines.length - 1 && wi === parts.length - 1 });
      });
    });

    words.forEach((word, wi) => {
      const paragraphEnd = wi === words.length - 1;
      const sentenceEnd = paragraphEnd || isSentenceEnd(word.text, paragraphEnd);
      const clauseEnd = !sentenceEnd && isClauseEnd(word.text, words[wi + 1]?.text);
      const letters = countLetters(word.text);
      const pieces =
        opt.splitLongWords && letters > opt.splitThreshold ? splitLongWord(word.text, opt.maxChunkLetters) : [word.text];

      pieces.forEach((pieceText, pi) => {
        const last = pi === pieces.length - 1;
        const flags = {
          sentenceEnd: last && sentenceEnd,
          clauseEnd: last && clauseEnd,
          paragraphEnd: last && paragraphEnd,
        };
        const pieceLetters = countLetters(pieceText);
        tokens.push({
          text: pieceText,
          letters: pieceLetters,
          orpIndex: orpCharIndex(pieceText, pieceLetters),
          weight: tokenWeight(pieceLetters, flags, opt.weights),
          ...flags,
          lineBreakAfter: last && word.lineBreakAfter,
          paragraphIndex,
          sourceWord,
          sentenceStart,
          paragraphStart,
        });
      });

      if (sentenceEnd) sentenceStart = tokens.length;
      sourceWord++;
    });
  });

  return tokens;
}

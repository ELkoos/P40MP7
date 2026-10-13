import type { TokenizeOptions, WeightConfig } from "./types";

export const DEFAULT_WEIGHTS: WeightConfig = {
  shortMax: 7,
  mediumMax: 12,
  medium: 1.2,
  long: 1.4,
  clause: 1.5,
  sentence: 2.0,
  paragraph: 2.5,
};

export const DEFAULT_TOKENIZE: TokenizeOptions = {
  splitLongWords: false,
  splitThreshold: 13,
  maxChunkLetters: 10,
  weights: DEFAULT_WEIGHTS,
};

/** Skróty, po których kropka nie kończy zdania [Z]. Małe litery, bez kropki. */
export const ABBREVIATIONS: ReadonlySet<string> = new Set([
  "np", "itp", "itd", "dr", "ul", "godz", "ok", "tzn", "tj", "prof", "inż",
  "mgr", "nr", "str", "tys", "mln", "mld", "al", "pl", "ww", "jw", "wg", "m.in",
  "tzw", "por", "zob", "ds", "im", "gen", "płk", "ks", "św",
]);

/** Limit kroku czasu po zamrożeniu karty, ms [H] (6.4). */
export const MAX_FRAME_DT_MS = 100;

/** Rozbieg po starcie i pauzie [H] (F-13). */
export const DEFAULT_RAMP = { durationMs: 2000, from: 0.5 };

export const WPM_MIN = 50;
export const WPM_MAX = 1000;

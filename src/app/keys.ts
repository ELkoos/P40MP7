/** Komendy odtwarzacza i ich przypisanie do klawiszy (sekcja 2 dokumentu, E3, E4). */
export type Command =
  | "toggle"
  | "faster"
  | "slower"
  | "prevSentence"
  | "nextSentence"
  | "prevParagraph"
  | "nextParagraph"
  | "home"
  | "fullscreen"
  | "switchMode"
  | "fontUp"
  | "fontDown"
  | "focusUp"
  | "focusDown"
  | "columnNarrower"
  | "columnWider"
  | "record"
  | "preview"
  | "exit";

/** Własne przypisania: identyfikator klawisza → komenda. Mają pierwszeństwo przed domyślnymi. */
export type KeyMap = Record<string, Command>;

export const COMMAND_LABELS: Record<Command, string> = {
  toggle: "Start / pauza",
  faster: "Szybciej",
  slower: "Wolniej",
  prevSentence: "Poprzednie zdanie",
  nextSentence: "Następne zdanie",
  prevParagraph: "Poprzedni akapit",
  nextParagraph: "Następny akapit",
  home: "Początek tekstu",
  fullscreen: "Pełny ekran",
  switchMode: "Zmiana trybu A / B",
  fontUp: "Większa czcionka",
  fontDown: "Mniejsza czcionka",
  focusUp: "Punkt odczytu wyżej",
  focusDown: "Punkt odczytu niżej",
  columnNarrower: "Węższa kolumna (tryb A)",
  columnWider: "Szersza kolumna (tryb A)",
  record: "Nagrywanie start / stop",
  preview: "Podgląd kamery",
  exit: "Powrót do edytora",
};

/** Domyślne klawisze. Piloty prezentacyjne wysyłają zwykle PageUp, PageDown, B, kropkę lub F5 [Z]. */
export const DEFAULT_KEYS: Readonly<KeyMap> = {
  " ": "toggle",
  Enter: "toggle",
  b: "toggle",
  B: "toggle",
  ".": "toggle",
  F5: "toggle",
  MediaPlayPause: "toggle",
  ArrowUp: "faster",
  ArrowDown: "slower",
  ArrowLeft: "prevSentence",
  ArrowRight: "nextSentence",
  MediaTrackPrevious: "prevSentence",
  MediaTrackNext: "nextSentence",
  PageUp: "prevParagraph",
  PageDown: "nextParagraph",
  Home: "home",
  f: "fullscreen",
  F: "fullscreen",
  t: "switchMode",
  T: "switchMode",
  "+": "fontUp",
  "=": "fontUp",
  "-": "fontDown",
  _: "fontDown",
  "[": "focusUp",
  "]": "focusDown",
  ";": "columnNarrower",
  "'": "columnWider",
  r: "record",
  R: "record",
  p: "preview",
  P: "preview",
  Escape: "exit",
};

/**
 * Identyfikator klawisza: `event.key`, a gdy przeglądarka go nie zna (część pilotów),
 * `code:` + `event.code`.
 */
export function keyId(e: { key: string; code: string }): string {
  if (e.key === "" || e.key === "Unidentified" || e.key === "Dead") return `code:${e.code}`;
  return e.key;
}

export function resolveCommand(id: string, custom: KeyMap): Command | null {
  return custom[id] ?? DEFAULT_KEYS[id] ?? null;
}

/** Czytelna nazwa klawisza do interfejsu. */
export function keyLabel(id: string): string {
  if (id === " ") return "Spacja";
  if (id.startsWith("code:")) return id.slice(5);
  return id;
}

/** Klawisze domyślne dla danej komendy, do podpowiedzi w ustawieniach. */
export function defaultKeysFor(cmd: Command): string[] {
  return Object.entries(DEFAULT_KEYS)
    .filter(([, c]) => c === cmd)
    .map(([k]) => k);
}

/** Przypisanie klawisza do komendy; ten sam klawisz nie może wskazywać dwóch komend. */
export function assignKey(map: KeyMap, id: string, cmd: Command): KeyMap {
  return { ...map, [id]: cmd };
}

export function unassignKey(map: KeyMap, id: string): KeyMap {
  const next = { ...map };
  delete next[id];
  return next;
}

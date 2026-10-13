/** Jeden element wyświetlany (słowo z przyklejoną interpunkcją albo fragment długiego słowa). */
export interface Token {
  text: string;
  /** Liczba liter i cyfr (L w dokumencie projektowym, 6.1). */
  letters: number;
  /** Indeks znaku ORP w Array.from(text); -1 gdy token nie ma liter. */
  orpIndex: number;
  /** Waga nieznormalizowana: m_dł × m_int (6.2). */
  weight: number;
  sentenceEnd: boolean;
  clauseEnd: boolean;
  paragraphEnd: boolean;
  /** Po tokenie był pojedynczy `\n` (miękkie złamanie wiersza w trybie A). */
  lineBreakAfter: boolean;
  paragraphIndex: number;
  /** Numer słowa w tekście przed dzieleniem długich słów; pozwala zachować pozycję przy zmianie trybu. */
  sourceWord: number;
  /** Indeks pierwszego tokenu zdania, do którego należy ten token. */
  sentenceStart: number;
  /** Indeks pierwszego tokenu akapitu, do którego należy ten token. */
  paragraphStart: number;
}

/** Wartości [H] z tabeli 6.2; do strojenia. */
export interface WeightConfig {
  /** Progi długości: L <= shortMax → 1,0; L <= mediumMax → medium; więcej → long. */
  shortMax: number;
  mediumMax: number;
  medium: number;
  long: number;
  clause: number;
  sentence: number;
  paragraph: number;
}

export interface TokenizeOptions {
  /** Dzielenie długich słów (tylko tryb B, 6.1 pkt 6). */
  splitLongWords: boolean;
  /** Słowa dłuższe niż ta liczba liter są dzielone [H]. */
  splitThreshold: number;
  /** Maksymalna liczba liter w kawałku [H]. */
  maxChunkLetters: number;
  weights: WeightConfig;
}

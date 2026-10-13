import { describe, expect, it } from "vitest";
import { countLetters, normalize, splitLongWord, tokenize } from "../src/core/tokenizer";
import { orpCharIndex, orpLetterIndex, splitAtOrp } from "../src/core/orp";

describe("normalize", () => {
  it("ujednolica końce wierszy i odstępy", () => {
    expect(normalize("  a\r\nb\t\tc  \r\n\r\nd ")).toBe("a\nb c\n\nd");
  });
});

describe("tokenize", () => {
  it("przykleja interpunkcję i ustawia flagi", () => {
    const t = tokenize("Ala ma kota, psa. Koniec");
    expect(t.map((x) => x.text)).toEqual(["Ala", "ma", "kota,", "psa.", "Koniec"]);
    expect(t[2]!.clauseEnd).toBe(true);
    expect(t[3]!.sentenceEnd).toBe(true);
    expect(t[4]!.paragraphEnd).toBe(true);
    expect(t[4]!.sentenceStart).toBe(4);
  });

  it("nie kończy zdania na skrótach, inicjałach i liczbach porządkowych", () => {
    const t = tokenize("Mamy np. psa. J. Kowalski był 3. w kolejce.");
    const ends = t.filter((x) => x.sentenceEnd).map((x) => x.text);
    expect(ends).toEqual(["psa.", "kolejce."]);
  });

  it("rozpoznaje koniec zdania przed zamykającym cudzysłowem", () => {
    const t = tokenize("Powiedział „tak.” Potem wyszedł.");
    expect(t[1]!.sentenceEnd).toBe(true);
    expect(t[2]!.sentenceStart).toBe(2);
  });

  it("traktuje myślnik jako koniec wtrącenia dla poprzedniego słowa", () => {
    const t = tokenize("To jest – jak wiesz – trudne");
    expect(t[1]!.clauseEnd).toBe(true);
  });

  it("dzieli akapity po pustej linii i zapamiętuje miękkie złamania", () => {
    const t = tokenize("raz dwa\ntrzy\n\ncztery");
    expect(t.map((x) => x.paragraphIndex)).toEqual([0, 0, 0, 1]);
    expect(t[1]!.lineBreakAfter).toBe(true);
    expect(t[2]!.paragraphEnd).toBe(true);
    expect(t[3]!.paragraphStart).toBe(3);
  });

  it("liczy wagi wg tabeli 6.2 (maksimum mnożników, nie iloczyn)", () => {
    const t = tokenize("kot konstytucja, nieprawdopodobnie.");
    expect(t[0]!.weight).toBeCloseTo(1.0);
    expect(t[1]!.weight).toBeCloseTo(1.2 * 1.5);
    // Ostatnie słowo akapitu: L = 17 → 1,4; koniec akapitu → 2,5.
    expect(t[2]!.weight).toBeCloseTo(1.4 * 2.5);
  });

  it("zwraca pustą listę dla pustego tekstu", () => {
    expect(tokenize("   \n\n  ")).toEqual([]);
  });

  it("dzieli długie słowa tylko z opcją splitLongWords", () => {
    expect(tokenize("Konstantynopolitańczykiewiczówna").length).toBe(1);
    const t = tokenize("Konstantynopolitańczykiewiczówna.", { splitLongWords: true });
    // 32 litery → ceil(32 / 10) = 4 kawałki po 8 liter.
    expect(t.map((x) => x.text)).toEqual(["Konstant-", "ynopolit-", "ańczykie-", "wiczówna."]);
    expect(t[0]!.paragraphEnd).toBe(false);
    expect(t[3]!.paragraphEnd).toBe(true);
  });
});

describe("splitLongWord", () => {
  it("dzieli na równe kawałki nie dłuższe niż limit", () => {
    const pieces = splitLongWord("abcdefghijklmnopqrstu", 10);
    expect(pieces).toEqual(["abcdefg-", "hijklmn-", "opqrstu"]);
  });
  it("zostawia krótkie słowo bez zmian", () => {
    expect(splitLongWord("krótkie", 10)).toEqual(["krótkie"]);
  });
});

describe("ORP", () => {
  it("tabela 6.3", () => {
    expect([1, 2, 5, 6, 9, 10, 13, 14, 30].map(orpLetterIndex)).toEqual([0, 1, 1, 2, 2, 3, 3, 4, 4]);
  });
  it("pomija interpunkcję na początku i działa dla polskich liter", () => {
    expect(orpCharIndex("„żółw”", countLetters("„żółw”"))).toBe(2);
    expect(splitAtOrp("„żółw”", 2)).toEqual({ prefix: "„ż", orp: "ó", suffix: "łw”" });
  });
  it("zwraca -1 dla tokenu bez liter", () => {
    expect(orpCharIndex("–", 0)).toBe(-1);
  });
});

describe("sourceWord", () => {
  it("kawałki długiego słowa mają ten sam numer słowa źródłowego", () => {
    const t = tokenize("Ala Konstantynopolitańczykiewiczówna kot", { splitLongWords: true });
    expect(t.map((x) => x.sourceWord)).toEqual([0, 1, 1, 1, 1, 2]);
  });
});

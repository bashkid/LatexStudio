import { describe, expect, it } from "vitest";
import { findWord, normalizeWord } from "./wordMatch";

const SRC = [
  "\\section{Method}",
  "We train the model on the training set.",
  "The model uses \\textbf{attention} to weigh the model inputs.",
  "% the model is described here",
].join("\n");

describe("findWord", () => {
  it("normalises what the PDF gives", () => {
    expect(normalizeWord("“model,”")).toBe("model");
    expect(normalizeWord("ﬁnal.")).toBe("final");
  });
  it("finds the clicked word and not a word that only contains it", () => {
    const [s, e] = findWord(SRC, 2, { word: "train" })!;
    expect(SRC.slice(s, e)).toBe("train");
    expect(SRC.slice(s - 3, s)).toBe("We ");                                          // not 'training'
  });
  it("tells a repeated word apart by its neighbours", () => {
    const [s] = findWord(SRC, 3, { word: "model", prev: "the", next: "inputs" })!;
    expect(SRC.slice(s, s + 12)).toBe("model inputs");
    const [s2] = findWord(SRC, 3, { word: "model", prev: "The", next: "uses" })!;
    expect(SRC.slice(s2, s2 + 10)).toBe("model uses");
  });
  it("finds a word inside a command and skips comment lines", () => {
    const [s, e] = findWord(SRC, 3, { word: "attention" })!;
    expect(SRC.slice(s, e)).toBe("attention");
    expect(findWord(SRC, 4, { word: "described" })).toBeNull();
  });
});

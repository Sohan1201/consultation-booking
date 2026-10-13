
import { describe, it, expect } from "vitest";
import { checkQuestion } from "../src/services/questionSafety";

describe("Question safety checks", () => {
  it.each([
    ["When will I die?", "DEATH_PREDICTION"],
    [
      "Predict the outcome of my court case",
      "COURT_CASE_OUTCOME"
    ],
    [
      "What is the gender of my unborn baby?",
      "UNBORN_BABY_GENDER"
    ],
    [
      "Give me betting tips for tonight",
      "STOCK_OR_BETTING_TIPS"
    ],
    [
      "Will cancer kill my father?",
      "SERIOUS_ILLNESS_OUTCOME"
      
    ]
  ])("blocks prohibited question: %s", (question, reasonCode) => {
    const result = checkQuestion(question);

    expect(result.allowed).toBe(false);

    if (!result.allowed) {
      expect(result.reasonCode).toBe(reasonCode);
    }
  });

  it("allows a harmless question", () => {
    expect(
      checkQuestion("How can I improve my daily routine?")
    ).toEqual({
      allowed: true,
      reasonCode: null
    });
  });

  it("allows a question with surrounding whitespace to be normalized", () => {
    expect(
      checkQuestion("  How can I meditate?  ")
    ).toEqual({
      allowed: true,
      reasonCode: null
    });
  });
});

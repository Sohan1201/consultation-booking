
export type QuestionCheckResult =
  | { allowed: true; reasonCode: null }
  | { allowed: false; reasonCode: string };

const blockedPatterns: Array<{
  reasonCode: string;
  pattern: RegExp;
}> = [
  {
    reasonCode: "DEATH_PREDICTION",
    pattern: /\b(when will (i|he|she|they|someone|my .+?) die|predict (my|his|her|their|someone's) death|date of (my|his|her|their) death|when (will|am) .{0,40}die)\b/i
  },
  {
    reasonCode: "SERIOUS_ILLNESS_OUTCOME",
    
    pattern: /\b(will .{0,50}(cancer|serious illness|terminal illness).{0,30}(kill|cure|survive|recover)|will (cancer|a serious illness|the serious illness|a terminal illness|the terminal illness) .{0,50}(kill|cure|survive|recover)|how will .{0,50}(cancer|serious illness|terminal illness).{0,30}(end|progress)|outcome of .{0,30}(terminal illness|serious illness))\b/i

  },
  {
    reasonCode: "UNBORN_BABY_GENDER",
    pattern: /\b(gender|sex) of (the |my |our )?(unborn baby|unborn child|fetus|foetus|baby in the womb)\b/i
  },
  {
    reasonCode: "COURT_CASE_OUTCOME",
    pattern: /\b(predict|tell me|guarantee|forecast) .{0,40}(court case|lawsuit|trial|court verdict|legal judgment|legal judgement)|\b(will i win|will we win|outcome of) .{0,30}(court case|lawsuit|trial)\b/i
  },
  {
    reasonCode: "STOCK_OR_BETTING_TIPS",
    pattern: /\b(stock tips?|share tips?|which stocks? (should|to) buy|what stocks? (should|to) buy|stock market prediction|betting tips?|sure bet|match fixing tips?|gambling tips?|which team will win for betting)\b/i
  }
];

export function checkQuestion(question: string): QuestionCheckResult {
  const normalized = question.trim().replace(/\s+/g, " ");

  for (const item of blockedPatterns) {
    if (item.pattern.test(normalized)) {
      return {
        allowed: false,
        reasonCode: item.reasonCode
      };
    }
  }

  return { allowed: true, reasonCode: null };
}

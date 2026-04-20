export type BootstrapConfidence = {
  score: number;
  factors: string[];
};

type ConfidenceInput = {
  keywordMatchCount: number;
  hasExplicitScope: boolean;
  isShortSingleLine: boolean;
  hasImplementationVerb: boolean;
  looksComplex: boolean;
  isExplicitOverride: boolean;
};

export function computeBootstrapConfidence(input: ConfidenceInput): BootstrapConfidence {
  const factors: string[] = [];

  if (input.isExplicitOverride) {
    factors.push("caller explicitly selected the phase");
    return { score: 1.0, factors };
  }

  let score = 0.4;

  if (input.keywordMatchCount >= 3) {
    score += 0.3;
    factors.push(`${input.keywordMatchCount} keyword matches (strong signal)`);
  } else if (input.keywordMatchCount >= 1) {
    score += 0.15;
    factors.push(`${input.keywordMatchCount} keyword match(es)`);
  } else {
    factors.push("no keyword matches (relying on heuristics)");
  }

  if (input.hasExplicitScope) {
    score += 0.15;
    factors.push("request references explicit files, tools, or paths");
  }

  if (input.isShortSingleLine && input.hasImplementationVerb && input.hasExplicitScope) {
    score += 0.1;
    factors.push("tightly scoped single-line implementation request");
  }

  if (input.looksComplex) {
    score += 0.05;
    factors.push("request heuristically looks multi-step");
  }

  if (!input.hasExplicitScope && input.keywordMatchCount === 0) {
    score -= 0.1;
    factors.push("no scope signal and no keywords (low confidence in classification)");
  }

  const clampedScore = Math.max(0.1, Math.min(1.0, score));

  return { score: parseFloat(clampedScore.toFixed(2)), factors };
}

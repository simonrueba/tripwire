import micromatch from "micromatch";

export interface MatchPathResult {
  matches: boolean;
  matchedTriggers: string[];
}

/**
 * Test whether a file path matches a tripwire's trigger patterns.
 *
 * - Positive patterns: standard globs (e.g. "src/auth/**")
 * - Negation patterns: prefixed with "!" (e.g. "!**\/*.test.ts")
 * - A path matches if it matches >= 1 positive AND 0 negation patterns
 * - If ALL patterns are negation, implicit "**" is added as positive
 */
export function matchPath(filePath: string, triggers: string[]): MatchPathResult {
  const normalized = normalizePath(filePath);

  const positive = triggers.filter((t) => !t.startsWith("!"));
  const negations = triggers.filter((t) => t.startsWith("!")).map((t) => t.slice(1));

  const effectivePositive = positive.length > 0 ? positive : ["**"];

  const matchedTriggers = effectivePositive.filter((pattern) =>
    micromatch.isMatch(normalized, pattern, { dot: true }),
  );

  if (matchedTriggers.length === 0) {
    return { matches: false, matchedTriggers: [] };
  }

  const excluded = negations.some((pattern) =>
    micromatch.isMatch(normalized, pattern, { dot: true }),
  );

  if (excluded) {
    return { matches: false, matchedTriggers: [] };
  }

  return { matches: true, matchedTriggers };
}

function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, "/").replace(/^\.\//, "");
}

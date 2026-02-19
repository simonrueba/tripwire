import micromatch from "micromatch";

export interface MatchPathResult {
  matches: boolean;
  matchedTriggers: string[];
}

export interface MatchOptions {
  /** Case-insensitive matching (default: false = case-sensitive) */
  nocase?: boolean;
}

/**
 * Test whether a file path matches a tripwire's trigger patterns.
 *
 * - Positive patterns: standard globs (e.g. "src/auth/**")
 * - Negation patterns: prefixed with "!" (e.g. "!**\/*.test.ts")
 * - A path matches if it matches >= 1 positive AND 0 negation patterns
 * - If ALL patterns are negation, implicit "**" is added as positive
 */
export function matchPath(filePath: string, triggers: string[], options?: MatchOptions): MatchPathResult {
  const normalized = normalizePath(filePath);
  const mmOpts = { dot: true, nocase: options?.nocase ?? false };

  const positive = triggers.filter((t) => !t.startsWith("!"));
  const negations = triggers.filter((t) => t.startsWith("!")).map((t) => t.slice(1));

  const effectivePositive = positive.length > 0 ? positive : ["**"];

  const matchedTriggers = effectivePositive.filter((pattern) =>
    micromatch.isMatch(normalized, pattern, mmOpts),
  );

  if (matchedTriggers.length === 0) {
    return { matches: false, matchedTriggers: [] };
  }

  const excluded = negations.some((pattern) =>
    micromatch.isMatch(normalized, pattern, mmOpts),
  );

  if (excluded) {
    return { matches: false, matchedTriggers: [] };
  }

  return { matches: true, matchedTriggers };
}

function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, "/").replace(/^\.\//, "");
}

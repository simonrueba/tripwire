import { describe, it, expect } from "vitest";
import { matchPath } from "../../src/engine/matcher.js";

describe("matchPath", () => {
  it("matches a simple glob pattern", () => {
    const result = matchPath("src/auth/login.ts", ["src/auth/**"]);
    expect(result.matches).toBe(true);
    expect(result.matchedTriggers).toEqual(["src/auth/**"]);
  });

  it("does not match when pattern differs", () => {
    const result = matchPath("src/api/routes.ts", ["src/auth/**"]);
    expect(result.matches).toBe(false);
  });

  it("matches multiple positive patterns", () => {
    const result = matchPath("src/auth/login.ts", ["src/auth/**", "src/api/**"]);
    expect(result.matches).toBe(true);
    expect(result.matchedTriggers).toEqual(["src/auth/**"]);
  });

  it("excludes with negation pattern", () => {
    const result = matchPath("src/auth/login.test.ts", [
      "src/auth/**",
      "!**/*.test.ts",
    ]);
    expect(result.matches).toBe(false);
  });

  it("allows through when negation does not match", () => {
    const result = matchPath("src/auth/login.ts", [
      "src/auth/**",
      "!**/*.test.ts",
    ]);
    expect(result.matches).toBe(true);
  });

  it("treats all-negation as implicit ** + exclusions", () => {
    const result = matchPath("src/utils/helpers.ts", ["!**/*.test.ts"]);
    expect(result.matches).toBe(true);
  });

  it("excludes with all-negation pattern", () => {
    const result = matchPath("src/utils/helpers.test.ts", ["!**/*.test.ts"]);
    expect(result.matches).toBe(false);
  });

  it("normalizes backslashes", () => {
    const result = matchPath("src\\auth\\login.ts", ["src/auth/**"]);
    expect(result.matches).toBe(true);
  });

  it("strips leading ./", () => {
    const result = matchPath("./src/auth/login.ts", ["src/auth/**"]);
    expect(result.matches).toBe(true);
  });

  it("matches brace expansion", () => {
    const result = matchPath("src/api/v1/users.ts", ["src/api/v{1,2}/**"]);
    expect(result.matches).toBe(true);
  });

  it("matches file extension glob", () => {
    const result = matchPath("migrations/001.sql", ["**/*.sql"]);
    expect(result.matches).toBe(true);
  });

  it("handles dot files", () => {
    const result = matchPath(".env", [".*"]);
    expect(result.matches).toBe(true);
  });

  it("returns empty matchedTriggers on no match", () => {
    const result = matchPath("README.md", ["src/**"]);
    expect(result.matchedTriggers).toEqual([]);
  });
});

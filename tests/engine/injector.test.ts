import { describe, it, expect } from "vitest";
import { formatContext, injectContext } from "../../src/engine/injector.js";
import type { MatchResult, TripwireFile } from "../../src/types/tripwire.js";

function makeTripwire(overrides: Partial<TripwireFile> & { name: string }): TripwireFile {
  return {
    triggers: ["**"],
    context: "Default context",
    severity: "warning",
    created_by: "human",
    tags: [],
    depends_on: [],
    active: true,
    filePath: `/project/.tripwires/${overrides.name}.yml`,
    ...overrides,
  };
}

function makeMatch(tripwire: TripwireFile, deps: TripwireFile[] = []): MatchResult {
  return {
    tripwire,
    matchedTriggers: tripwire.triggers,
    dependencies: deps,
  };
}

describe("formatContext", () => {
  it("formats a single match", () => {
    const tw = makeTripwire({ name: "auth", severity: "high", context: "Use sessions.", tags: ["security"] });
    const result = formatContext([makeMatch(tw)], { separator: "\n---\n", maxLength: 0 });

    expect(result).toContain("[TRIPWIRE:high] auth (security)");
    expect(result).toContain("Use sessions.");
  });

  it("sorts by severity (critical first)", () => {
    const low = makeTripwire({ name: "info-tw", severity: "info", context: "Info" });
    const high = makeTripwire({ name: "critical-tw", severity: "critical", context: "Critical" });

    const result = formatContext(
      [makeMatch(low), makeMatch(high)],
      { separator: "\n---\n", maxLength: 0 },
    );

    const criticalPos = result.indexOf("[TRIPWIRE:critical]");
    const infoPos = result.indexOf("[TRIPWIRE:info]");
    expect(criticalPos).toBeLessThan(infoPos);
  });

  it("sorts alphabetically within same severity", () => {
    const b = makeTripwire({ name: "beta", context: "Beta" });
    const a = makeTripwire({ name: "alpha", context: "Alpha" });

    const result = formatContext(
      [makeMatch(b), makeMatch(a)],
      { separator: "\n---\n", maxLength: 0 },
    );

    const alphaPos = result.indexOf("alpha");
    const betaPos = result.indexOf("beta");
    expect(alphaPos).toBeLessThan(betaPos);
  });

  it("truncates at whole-tripwire granularity", () => {
    const tw1 = makeTripwire({ name: "short", severity: "critical", context: "Short." });
    const tw2 = makeTripwire({ name: "long", severity: "warning", context: "A".repeat(100) });

    const result = formatContext(
      [makeMatch(tw1), makeMatch(tw2)],
      { separator: "\n---\n", maxLength: 50 },
    );

    expect(result).toContain("[TRIPWIRE:critical] short");
    expect(result).toContain("1 more tripwire(s) omitted");
    expect(result).not.toContain("long");
  });

  it("returns empty string for no matches", () => {
    const result = formatContext([], { separator: "\n---\n", maxLength: 0 });
    expect(result).toBe("");
  });

  it("includes dependency context", () => {
    const dep = makeTripwire({ name: "redis-config", context: "Redis on port 6379" });
    const tw = makeTripwire({
      name: "auth",
      context: "Session auth",
      depends_on: ["redis-config"],
    });

    const result = formatContext(
      [makeMatch(tw, [dep])],
      { separator: "\n---\n", maxLength: 0 },
    );

    expect(result).toContain("[TRIPWIRE:warning] auth");
    expect(result).toContain("[TRIPWIRE:warning] auth/dep: redis-config");
    expect(result).toContain("Redis on port 6379");
  });
});

describe("injectContext", () => {
  it("prepends context with separator", () => {
    const result = injectContext("Context here", "file content", "\n---\n");
    expect(result).toBe("Context here\n---\nfile content");
  });

  it("returns original content when context is empty", () => {
    const result = injectContext("", "file content", "\n---\n");
    expect(result).toBe("file content");
  });
});

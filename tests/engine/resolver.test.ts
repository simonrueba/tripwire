import { describe, it, expect } from "vitest";
import { resolveDependencies } from "../../src/engine/resolver.js";
import type { TripwireFile } from "../../src/types/tripwire.js";

function makeTripwire(name: string, depsOn: string[] = []): TripwireFile {
  return {
    name,
    filePath: `/project/.tripwires/${name}.yml`,
    triggers: ["**"],
    context: `Context for ${name}`,
    severity: "warning",
    created_by: "human",
    tags: [],
    depends_on: depsOn,
    active: true,
  };
}

describe("resolveDependencies", () => {
  it("resolves direct dependencies", () => {
    const auth = makeTripwire("auth", ["redis"]);
    const redis = makeTripwire("redis");
    const all = [auth, redis];

    const result = resolveDependencies([auth], all, 5);

    expect(result.resolved).toHaveLength(2);
    expect(result.resolved.map((t) => t.name).sort()).toEqual(["auth", "redis"]);
    expect(result.warnings).toHaveLength(0);
  });

  it("resolves transitive dependencies", () => {
    const a = makeTripwire("a", ["b"]);
    const b = makeTripwire("b", ["c"]);
    const c = makeTripwire("c");
    const all = [a, b, c];

    const result = resolveDependencies([a], all, 5);

    expect(result.resolved).toHaveLength(3);
  });

  it("detects cycles", () => {
    const a = makeTripwire("a", ["b"]);
    const b = makeTripwire("b", ["a"]);
    const all = [a, b];

    const result = resolveDependencies([a], all, 5);

    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toContain("cycle");
  });

  it("warns on missing dependencies", () => {
    const a = makeTripwire("a", ["nonexistent"]);
    const all = [a];

    const result = resolveDependencies([a], all, 5);

    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("nonexistent");
  });

  it("respects max depth", () => {
    const a = makeTripwire("a", ["b"]);
    const b = makeTripwire("b", ["c"]);
    const c = makeTripwire("c", ["d"]);
    const d = makeTripwire("d");
    const all = [a, b, c, d];

    const result = resolveDependencies([a], all, 2);

    // Should resolve a, b, c but NOT d (depth limit)
    const names = result.resolved.map((t) => t.name);
    expect(names).toContain("a");
    expect(names).toContain("b");
    expect(names).toContain("c");
    expect(names).not.toContain("d");
  });

  it("deduplicates shared dependencies", () => {
    const shared = makeTripwire("shared");
    const a = makeTripwire("a", ["shared"]);
    const b = makeTripwire("b", ["shared"]);
    const all = [a, b, shared];

    const result = resolveDependencies([a, b], all, 5);

    const sharedCount = result.resolved.filter((t) => t.name === "shared").length;
    expect(sharedCount).toBe(1);
  });
});

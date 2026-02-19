import { describe, it, expect } from "vitest";
import { TripwireEngine } from "../../src/engine/tripwire-engine.js";
import { InMemoryFileSystem } from "../helpers.js";

function createEngine(files: Record<string, string>, config?: Record<string, string>) {
  const fs = new InMemoryFileSystem(files);
  return new TripwireEngine({ projectRoot: "/project", fs, ...config });
}

describe("TripwireEngine.explain", () => {
  it("returns empty result for non-matching path", async () => {
    const engine = createEngine({
      "/project/.tripwires/auth.yml": `
triggers:
  - "src/auth/**"
context: "Use session auth."
severity: high
`,
    });

    const result = await engine.explain("src/api/routes.ts");

    expect(result.directMatches).toHaveLength(0);
    expect(result.resolvedDependencies).toHaveLength(0);
    expect(result.suppressed).toHaveLength(0);
    expect(result.renderedInjection).toBe("");
    expect(result.totalContextLength).toBe(0);
  });

  it("returns matched tripwires with correct globs and tags", async () => {
    const engine = createEngine({
      "/project/.tripwires/auth.yml": `
triggers:
  - "src/auth/**"
  - "src/middleware/auth*.ts"
context: "Use session auth, not JWT."
severity: high
tags:
  - security
  - architecture
`,
    });

    const result = await engine.explain("src/auth/login.ts");

    expect(result.directMatches).toHaveLength(1);
    expect(result.directMatches[0].name).toBe("auth");
    expect(result.directMatches[0].severity).toBe("high");
    expect(result.directMatches[0].matchedGlobs).toEqual(["src/auth/**"]);
    expect(result.directMatches[0].tags).toEqual(["security", "architecture"]);
    expect(result.directMatches[0].contextPreview).toContain("Use session auth");
  });

  it("resolves dependencies with resolvedVia", async () => {
    const engine = createEngine({
      "/project/.tripwires/auth.yml": `
triggers:
  - "src/auth/**"
context: "Use session auth."
severity: high
depends_on:
  - no-secrets
`,
      "/project/.tripwires/no-secrets.yml": `
triggers:
  - "never-matches/**"
context: "Never hardcode secrets."
severity: critical
`,
    });

    const result = await engine.explain("src/auth/login.ts");

    expect(result.directMatches).toHaveLength(1);
    expect(result.resolvedDependencies).toHaveLength(1);
    expect(result.resolvedDependencies[0].name).toBe("no-secrets");
    expect(result.resolvedDependencies[0].severity).toBe("critical");
    expect(result.resolvedDependencies[0].resolvedVia).toBe("auth");
  });

  it("includes rendered injection with delimiters", async () => {
    const engine = createEngine({
      "/project/.tripwires/auth.yml": `
triggers:
  - "src/auth/**"
context: "Use session auth."
severity: high
`,
    });

    const result = await engine.explain("src/auth/login.ts");

    expect(result.renderedInjection).toContain("<<<TRIPWIRE");
    expect(result.renderedInjection).toContain("<<<END_TRIPWIRE>>>");
    expect(result.renderedInjection).toContain("Use session auth.");
    expect(result.totalContextLength).toBeGreaterThan(0);
  });

  it("reports suppressed tripwires when budget exceeded", async () => {
    const engine = createEngine({
      "/project/.tripwires/critical.yml": `
triggers:
  - "src/**"
context: "Critical context that takes up most of the budget."
severity: critical
`,
      "/project/.tripwires/info.yml": `
triggers:
  - "src/**"
context: "Info context that will be suppressed due to budget."
severity: info
`,
    });

    // Set a very small max_context_length
    const config = engine.getConfig();
    Object.assign(config, { max_context_length: 100 });

    const result = await engine.explain("src/app.ts");

    expect(result.suppressed.length).toBeGreaterThanOrEqual(1);
    expect(result.suppressed[0].reason).toBe("context_budget");
  });

  it("includes config in result", async () => {
    const engine = createEngine({
      "/project/.tripwires/auth.yml": `
triggers:
  - "src/auth/**"
context: "Use session auth."
`,
    });

    const result = await engine.explain("src/auth/login.ts");

    expect(result.config).toEqual({
      inject_mode: "prepend",
      max_context_length: 0,
      enforcement_mode: "strict",
    });
  });

  it("returns empty result for excluded paths", async () => {
    const engine = createEngine({
      "/project/.tripwires/all.yml": `
triggers:
  - "**"
context: "Everything"
`,
    });

    const result = await engine.explain("node_modules/foo/bar.js");

    expect(result.directMatches).toHaveLength(0);
    expect(result.renderedInjection).toBe("");
  });
});

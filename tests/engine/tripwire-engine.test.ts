import { describe, it, expect } from "vitest";
import { TripwireEngine } from "../../src/engine/tripwire-engine.js";
import { InMemoryFileSystem } from "../helpers.js";

function createEngine(files: Record<string, string>) {
  const fs = new InMemoryFileSystem(files);
  return new TripwireEngine({ projectRoot: "/project", fs });
}

describe("TripwireEngine", () => {
  describe("checkPath", () => {
    it("returns matches for a file", async () => {
      const engine = createEngine({
        "/project/.tripwires/auth.yml": `
triggers:
  - "src/auth/**"
context: "Use session auth."
severity: high
`,
      });

      const matches = await engine.checkPath("src/auth/login.ts");

      expect(matches).toHaveLength(1);
      expect(matches[0].tripwire.name).toBe("auth");
      expect(matches[0].tripwire.severity).toBe("high");
    });

    it("returns empty for non-matching paths", async () => {
      const engine = createEngine({
        "/project/.tripwires/auth.yml": `
triggers:
  - "src/auth/**"
context: "Use session auth."
`,
      });

      const matches = await engine.checkPath("src/api/routes.ts");
      expect(matches).toHaveLength(0);
    });

    it("excludes paths in exclude_paths", async () => {
      const engine = createEngine({
        "/project/.tripwires/all.yml": `
triggers:
  - "**"
context: "Everything"
`,
      });

      const matches = await engine.checkPath("node_modules/foo/bar.js");
      expect(matches).toHaveLength(0);
    });

    it("matches case-insensitively when match_case is false", async () => {
      const fs = new InMemoryFileSystem({
        "/project/.tripwires/auth.yml": `
triggers:
  - "src/Auth/**"
context: "Auth context"
`,
      });
      const engine = new TripwireEngine({
        projectRoot: "/project",
        fs,
        config: { match_case: false },
      });

      const matches = await engine.checkPath("src/auth/login.ts");
      expect(matches).toHaveLength(1);
    });

    it("does not match different case when match_case is true (default)", async () => {
      const engine = createEngine({
        "/project/.tripwires/auth.yml": `
triggers:
  - "src/Auth/**"
context: "Auth context"
`,
      });

      const matches = await engine.checkPath("src/auth/login.ts");
      expect(matches).toHaveLength(0);
    });
  });

  describe("readFileWithContext", () => {
    it("prepends context to file content", async () => {
      const engine = createEngine({
        "/project/.tripwires/secrets.yml": `
triggers:
  - "payments/**"
context: "Never hardcode secrets."
severity: critical
`,
        "/project/payments/stripe.ts": 'const api = process.env.STRIPE_KEY;',
      });

      const result = await engine.readFileWithContext("payments/stripe.ts");

      expect(result.matches).toHaveLength(1);
      expect(result.fullContent).toContain('<<<TRIPWIRE severity="critical" name="secrets">>>');
      expect(result.fullContent).toContain("Never hardcode secrets.");
      expect(result.fullContent).toContain("<<<END_TRIPWIRE>>>");
      expect(result.fullContent).toContain("<<<TRIPWIRE_FILE_CONTENT>>>");
      expect(result.fullContent).toContain('const api = process.env.STRIPE_KEY;');
    });

    it("returns plain content when no tripwires match", async () => {
      const engine = createEngine({
        "/project/.tripwires/auth.yml": `
triggers:
  - "src/auth/**"
context: "Auth context"
`,
        "/project/README.md": "# Hello",
      });

      const result = await engine.readFileWithContext("README.md");

      expect(result.matches).toHaveLength(0);
      expect(result.fullContent).toBe("# Hello");
      expect(result.injectedContext).toBe("");
    });

    it("throws on missing file", async () => {
      const engine = createEngine({});

      await expect(engine.readFileWithContext("nonexistent.ts"))
        .rejects.toThrow("File not found");
    });
  });

  describe("createTripwire", () => {
    it("creates a new tripwire YAML file", async () => {
      const fs = new InMemoryFileSystem({});
      const engine = new TripwireEngine({ projectRoot: "/project", fs });

      const result = await engine.createTripwire("no-raw-sql", {
        triggers: ["src/models/**"],
        context: "Use the ORM, not raw SQL.",
        severity: "high",
        tags: ["security"],
      });

      expect(result.tripwire.name).toBe("no-raw-sql");
      expect(result.filePath).toContain("no-raw-sql.yml");

      // Verify file was written
      const content = fs.getFile("/project/.tripwires/no-raw-sql.yml");
      expect(content).toBeDefined();
      expect(content).toContain("src/models/**");
    });

    it("rejects overwriting an existing tripwire", async () => {
      const engine = createEngine({
        "/project/.tripwires/existing.yml": `
triggers:
  - "src/**"
context: "Already here"
`,
      });

      await expect(
        engine.createTripwire("existing", {
          triggers: ["src/**"],
          context: "Overwrite attempt",
        }),
      ).rejects.toThrow("already exists");
    });

    it("allows overwriting with force flag", async () => {
      const engine = createEngine({
        "/project/.tripwires/existing.yml": `
triggers:
  - "src/**"
context: "Old context"
`,
      });

      const result = await engine.createTripwire("existing", {
        triggers: ["src/**"],
        context: "New context",
        force: true,
      });

      expect(result.tripwire.context).toBe("New context");
    });

    it("rejects agent-created tripwires when disabled", async () => {
      const fs = new InMemoryFileSystem({});
      const engine = new TripwireEngine({
        projectRoot: "/project",
        fs,
        config: { allow_agent_create: false },
      });

      await expect(
        engine.createTripwire("test", {
          triggers: ["**"],
          context: "test",
          created_by: "agent",
        }),
      ).rejects.toThrow("disabled");
    });
  });

  describe("deactivateTripwire", () => {
    it("sets active: false in the YAML", async () => {
      const fs = new InMemoryFileSystem({
        "/project/.tripwires/old.yml": `
triggers:
  - "src/**"
context: "Old context"
`,
      });
      const engine = new TripwireEngine({ projectRoot: "/project", fs });

      await engine.deactivateTripwire("old");

      const content = fs.getFile("/project/.tripwires/old.yml");
      expect(content).toContain("active: false");
    });

    it("throws for nonexistent tripwire", async () => {
      const engine = createEngine({});

      await expect(engine.deactivateTripwire("ghost"))
        .rejects.toThrow("not found");
    });
  });

  describe("listTripwires", () => {
    it("lists all active tripwires", async () => {
      const engine = createEngine({
        "/project/.tripwires/a.yml": `
triggers: ["src/a/**"]
context: "A"
tags: ["security"]
`,
        "/project/.tripwires/b.yml": `
triggers: ["src/b/**"]
context: "B"
severity: critical
`,
      });

      const list = await engine.listTripwires();
      expect(list).toHaveLength(2);
    });

    it("filters by tag", async () => {
      const engine = createEngine({
        "/project/.tripwires/a.yml": `
triggers: ["src/**"]
context: "A"
tags: ["security"]
`,
        "/project/.tripwires/b.yml": `
triggers: ["src/**"]
context: "B"
tags: ["other"]
`,
      });

      const list = await engine.listTripwires({ tag: "security" });
      expect(list).toHaveLength(1);
      expect(list[0].name).toBe("a");
    });

    it("filters by severity", async () => {
      const engine = createEngine({
        "/project/.tripwires/low.yml": `
triggers: ["src/**"]
context: "Low"
severity: info
`,
        "/project/.tripwires/high.yml": `
triggers: ["src/**"]
context: "High"
severity: critical
`,
      });

      const list = await engine.listTripwires({ severity: "critical" });
      expect(list).toHaveLength(1);
      expect(list[0].name).toBe("high");
    });
  });

  describe("lint", () => {
    it("returns no issues for valid tripwires", async () => {
      const engine = createEngine({
        "/project/.tripwires/valid.yml": `
triggers:
  - "src/**"
context: "Valid"
created_by: human
`,
      });

      const results = await engine.lint();
      expect(results).toHaveLength(0);
    });

    it("errors on missing created_by", async () => {
      const engine = createEngine({
        "/project/.tripwires/no-author.yml": `
triggers:
  - "src/**"
context: "Missing author"
`,
      });

      const results = await engine.lint();
      const missing = results.find((r) => r.message.includes("Missing created_by"));
      expect(missing).toBeDefined();
      expect(missing?.level).toBe("error");
    });

    it("reports invalid YAML", async () => {
      const engine = createEngine({
        "/project/.tripwires/broken.yml": `{{not yaml`,
      });

      const results = await engine.lint();
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].level).toBe("error");
    });

    it("warns when directory does not exist", async () => {
      const fs = new InMemoryFileSystem({});
      const engine = new TripwireEngine({ projectRoot: "/empty", fs });

      const results = await engine.lint();
      expect(results).toHaveLength(1);
      expect(results[0].level).toBe("warning");
      expect(results[0].message).toContain("does not exist");
    });

    it("detects identical trigger sets in strict mode", async () => {
      const engine = createEngine({
        "/project/.tripwires/alpha.yml": `
triggers:
  - "src/auth/**"
context: "Use JWT"
severity: critical
created_by: human
`,
        "/project/.tripwires/beta.yml": `
triggers:
  - "src/auth/**"
context: "Never use JWT"
severity: critical
created_by: human
`,
      });

      const results = await engine.lint({ strict: true });
      const conflict = results.find((r) => r.message.includes("Identical triggers"));
      expect(conflict).toBeDefined();
      expect(conflict?.message).toContain("alpha");
      expect(conflict?.message).toContain("beta");
    });

    it("warns when multiple critical tripwires overlap on same files", async () => {
      const engine = createEngine({
        "/project/.tripwires/crit-a.yml": `
triggers:
  - "src/**"
context: "Use JWT"
severity: critical
created_by: human
`,
        "/project/.tripwires/crit-b.yml": `
triggers:
  - "src/**"
context: "No hardcoded keys"
severity: critical
created_by: human
`,
        "/project/src/index.ts": "// code",
      });

      const results = await engine.lint({ strict: true });
      const overlap = results.find((r) => r.message.includes("Critical overlap"));
      expect(overlap).toBeDefined();
      expect(overlap?.message).toContain("crit-a");
      expect(overlap?.message).toContain("crit-b");
    });

    it("does not warn when critical tripwires have disjoint triggers", async () => {
      const engine = createEngine({
        "/project/.tripwires/crit-a.yml": `
triggers:
  - "src/auth/**"
context: "Auth rules"
severity: critical
created_by: human
`,
        "/project/.tripwires/crit-b.yml": `
triggers:
  - "src/billing/**"
context: "Billing rules"
severity: critical
created_by: human
`,
        "/project/src/auth/login.ts": "// auth",
        "/project/src/billing/charge.ts": "// billing",
      });

      const results = await engine.lint({ strict: true });
      const overlap = results.find((r) => r.message.includes("Critical overlap"));
      expect(overlap).toBeUndefined();
    });

    it("warns on invalid created_by format in strict mode", async () => {
      const engine = createEngine({
        "/project/.tripwires/bad-format.yml": `
triggers:
  - "src/**"
context: "Bad format"
created_by: claude
`,
      });

      const results = await engine.lint({ strict: true });
      const format = results.find((r) => r.message.includes("expected"));
      expect(format).toBeDefined();
      expect(format?.level).toBe("warning");
      expect(format?.message).toContain("agent:<client>");
    });

    it("passes created_by format check for canonical values", async () => {
      const engine = createEngine({
        "/project/.tripwires/human-ok.yml": `
triggers:
  - "src/a/**"
context: "Human authored"
created_by: human
`,
        "/project/.tripwires/agent-ok.yml": `
triggers:
  - "src/b/**"
context: "Agent authored"
created_by: agent:claude
`,
      });

      const results = await engine.lint({ strict: true });
      const format = results.find((r) => r.message.includes("expected"));
      expect(format).toBeUndefined();
    });

    it("errors on agent-authored tripwire missing learned_from", async () => {
      const engine = createEngine({
        "/project/.tripwires/no-reason.yml": `
triggers:
  - "src/**"
context: "Some rule"
created_by: agent:claude
`,
      });

      const results = await engine.lint();
      const missing = results.find((r) => r.message.includes("missing learned_from"));
      expect(missing).toBeDefined();
      expect(missing?.level).toBe("error");
    });

    it("passes learned_from check for human-authored tripwires", async () => {
      const engine = createEngine({
        "/project/.tripwires/human-ok.yml": `
triggers:
  - "src/**"
context: "Human rule"
created_by: human
`,
      });

      const results = await engine.lint();
      const missing = results.find((r) => r.message.includes("missing learned_from"));
      expect(missing).toBeUndefined();
    });

    it("warns on large individual context in strict mode", async () => {
      const engine = createEngine({
        "/project/.tripwires/big.yml": `
triggers:
  - "src/**"
context: "${"A".repeat(5000)}"
created_by: human
`,
      });

      const results = await engine.lint({ strict: true });
      const sizeWarning = results.find((r) => r.message.includes("chars"));
      expect(sizeWarning).toBeDefined();
      expect(sizeWarning?.level).toBe("warning");
    });

    it("warns on large aggregate context in strict mode", async () => {
      const engine = createEngine({
        "/project/.tripwires/big-a.yml": `
triggers:
  - "src/a/**"
context: "${"A".repeat(9000)}"
created_by: human
`,
        "/project/.tripwires/big-b.yml": `
triggers:
  - "src/b/**"
context: "${"B".repeat(9000)}"
created_by: human
`,
      });

      const results = await engine.lint({ strict: true });
      const aggWarning = results.find((r) => r.message.includes("Aggregate context"));
      expect(aggWarning).toBeDefined();
      expect(aggWarning?.level).toBe("warning");
    });
  });
});

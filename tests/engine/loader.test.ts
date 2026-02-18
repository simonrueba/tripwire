import { describe, it, expect } from "vitest";
import { loadTripwireFiles } from "../../src/engine/loader.js";
import { InMemoryFileSystem } from "../helpers.js";

describe("loadTripwireFiles", () => {
  it("loads a valid tripwire YAML", async () => {
    const fs = new InMemoryFileSystem({
      "/project/.tripwires/auth.yml": `
triggers:
  - "src/auth/**"
context: |
  Use session-based auth, not JWT.
severity: high
tags:
  - security
`,
    });

    const result = await loadTripwireFiles("/project/.tripwires", fs);

    expect(result.errors).toHaveLength(0);
    expect(result.files).toHaveLength(1);
    expect(result.files[0].name).toBe("auth");
    expect(result.files[0].severity).toBe("high");
    expect(result.files[0].triggers).toEqual(["src/auth/**"]);
    expect(result.files[0].tags).toEqual(["security"]);
  });

  it("applies defaults for optional fields", async () => {
    const fs = new InMemoryFileSystem({
      "/project/.tripwires/minimal.yml": `
triggers:
  - "src/**"
context: "Some context"
`,
    });

    const result = await loadTripwireFiles("/project/.tripwires", fs);

    expect(result.files).toHaveLength(1);
    expect(result.files[0].severity).toBe("warning");
    expect(result.files[0].created_by).toBe("human");
    expect(result.files[0].tags).toEqual([]);
    expect(result.files[0].active).toBe(true);
  });

  it("skips inactive tripwires", async () => {
    const fs = new InMemoryFileSystem({
      "/project/.tripwires/disabled.yml": `
triggers:
  - "src/**"
context: "Disabled"
active: false
`,
    });

    const result = await loadTripwireFiles("/project/.tripwires", fs);
    expect(result.files).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });

  it("skips expired tripwires", async () => {
    const fs = new InMemoryFileSystem({
      "/project/.tripwires/old.yml": `
triggers:
  - "src/**"
context: "Expired"
expires: "2020-01-01"
`,
    });

    const result = await loadTripwireFiles("/project/.tripwires", fs);
    expect(result.files).toHaveLength(0);
  });

  it("collects errors for invalid YAML", async () => {
    const fs = new InMemoryFileSystem({
      "/project/.tripwires/broken.yml": `{{invalid yaml`,
    });

    const result = await loadTripwireFiles("/project/.tripwires", fs);
    expect(result.files).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].file).toBe("broken.yml");
  });

  it("collects errors for schema violations", async () => {
    const fs = new InMemoryFileSystem({
      "/project/.tripwires/bad.yml": `
triggers: []
context: ""
`,
    });

    const result = await loadTripwireFiles("/project/.tripwires", fs);
    expect(result.files).toHaveLength(0);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("returns empty when directory does not exist", async () => {
    const fs = new InMemoryFileSystem({});
    const result = await loadTripwireFiles("/nonexistent", fs);
    expect(result.files).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });

  it("loads multiple files", async () => {
    const fs = new InMemoryFileSystem({
      "/project/.tripwires/a.yml": `
triggers: ["src/a/**"]
context: "Context A"
`,
      "/project/.tripwires/b.yml": `
triggers: ["src/b/**"]
context: "Context B"
severity: critical
`,
    });

    const result = await loadTripwireFiles("/project/.tripwires", fs);
    expect(result.files).toHaveLength(2);
  });
});

import { describe, it, expect } from "vitest";
import { InMemoryFileSystem } from "../helpers.js";

describe("InMemoryFileSystem.stat", () => {
  it("returns file stats for existing files", async () => {
    const fs = new InMemoryFileSystem({
      "/project/src/app.ts": "const x = 1;",
    });

    const stat = await fs.stat("/project/src/app.ts");

    expect(stat.type).toBe("file");
    expect(stat.size).toBeGreaterThan(0);
    expect(stat.modified).toBeInstanceOf(Date);
    expect(stat.created).toBeInstanceOf(Date);
  });

  it("detects directories from file prefixes", async () => {
    const fs = new InMemoryFileSystem({
      "/project/src/app.ts": "const x = 1;",
      "/project/src/lib/utils.ts": "export {}",
    });

    const stat = await fs.stat("/project/src");

    expect(stat.type).toBe("directory");
  });

  it("throws ENOENT for non-existent paths", async () => {
    const fs = new InMemoryFileSystem({});

    await expect(fs.stat("/project/nope.ts")).rejects.toThrow("ENOENT");
  });

  it("calculates correct byte size for content", async () => {
    const content = "hello world";
    const fs = new InMemoryFileSystem({
      "/project/file.txt": content,
    });

    const stat = await fs.stat("/project/file.txt");

    expect(stat.size).toBe(Buffer.byteLength(content, "utf-8"));
  });
});

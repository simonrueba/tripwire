import type { IFileSystem, FileStat } from "../src/io/fs-adapter.js";

/**
 * In-memory filesystem for testing the engine without touching disk.
 */
export class InMemoryFileSystem implements IFileSystem {
  private files = new Map<string, string>();

  constructor(initialFiles?: Record<string, string>) {
    if (initialFiles) {
      for (const [path, content] of Object.entries(initialFiles)) {
        this.files.set(path, content);
      }
    }
  }

  async readFile(filePath: string): Promise<string> {
    const content = this.files.get(filePath);
    if (content === undefined) throw new Error(`ENOENT: ${filePath}`);
    return content;
  }

  async writeFile(filePath: string, content: string): Promise<void> {
    this.files.set(filePath, content);
  }

  async exists(filePath: string): Promise<boolean> {
    // Check if path is a file or a "directory" (prefix of any file)
    if (this.files.has(filePath)) return true;
    const prefix = filePath.endsWith("/") ? filePath : filePath + "/";
    for (const key of this.files.keys()) {
      if (key.startsWith(prefix)) return true;
    }
    return false;
  }

  async readdir(dirPath: string): Promise<string[]> {
    const prefix = dirPath.endsWith("/") ? dirPath : dirPath + "/";
    const entries = new Set<string>();
    for (const key of this.files.keys()) {
      if (key.startsWith(prefix)) {
        const rest = key.slice(prefix.length);
        const firstPart = rest.split("/")[0];
        entries.add(firstPart);
      }
    }
    return Array.from(entries);
  }

  async glob(pattern: string, options?: { cwd?: string }): Promise<string[]> {
    const { default: micromatch } = await import("micromatch");
    const cwd = options?.cwd || "";
    const prefix = cwd ? (cwd.endsWith("/") ? cwd : cwd + "/") : "";

    const candidates: string[] = [];
    for (const key of this.files.keys()) {
      if (key.startsWith(prefix)) {
        candidates.push(key.slice(prefix.length));
      }
    }

    return micromatch(candidates, pattern, { dot: true });
  }

  async mkdir(): Promise<void> {
    // No-op for in-memory FS
  }

  async stat(filePath: string): Promise<FileStat> {
    // Check if it's a file
    const content = this.files.get(filePath);
    if (content !== undefined) {
      return {
        size: Buffer.byteLength(content, "utf-8"),
        modified: new Date("2025-01-01"),
        created: new Date("2025-01-01"),
        type: "file",
      };
    }

    // Check if it's a directory prefix
    const prefix = filePath.endsWith("/") ? filePath : filePath + "/";
    for (const key of this.files.keys()) {
      if (key.startsWith(prefix)) {
        return {
          size: 0,
          modified: new Date("2025-01-01"),
          created: new Date("2025-01-01"),
          type: "directory",
        };
      }
    }

    throw new Error(`ENOENT: ${filePath}`);
  }

  getFile(path: string): string | undefined {
    return this.files.get(path);
  }
}

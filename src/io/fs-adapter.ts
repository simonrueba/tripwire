import * as fs from "node:fs/promises";
import * as path from "node:path";
import fg from "fast-glob";

export interface FileStat {
  size: number;
  modified: Date;
  created: Date;
  type: "file" | "directory";
}

export interface IFileSystem {
  readFile(filePath: string): Promise<string>;
  writeFile(filePath: string, content: string): Promise<void>;
  exists(filePath: string): Promise<boolean>;
  readdir(dirPath: string): Promise<string[]>;
  glob(pattern: string, options?: { cwd?: string }): Promise<string[]>;
  mkdir(dirPath: string, options?: { recursive?: boolean }): Promise<void>;
  stat(filePath: string): Promise<FileStat>;
}

export class RealFileSystem implements IFileSystem {
  async readFile(filePath: string): Promise<string> {
    return fs.readFile(filePath, "utf-8");
  }

  async writeFile(filePath: string, content: string): Promise<void> {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    // Atomic write: write to temp file then rename to prevent partial writes
    const tmpPath = `${filePath}.${process.pid}.tmp`;
    await fs.writeFile(tmpPath, content, "utf-8");
    await fs.rename(tmpPath, filePath);
  }

  async exists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  async readdir(dirPath: string): Promise<string[]> {
    return fs.readdir(dirPath);
  }

  async glob(pattern: string, options?: { cwd?: string }): Promise<string[]> {
    return fg(pattern, { cwd: options?.cwd, dot: true });
  }

  async mkdir(dirPath: string, options?: { recursive?: boolean }): Promise<void> {
    await fs.mkdir(dirPath, options);
  }

  async stat(filePath: string): Promise<FileStat> {
    const stats = await fs.stat(filePath);
    return {
      size: stats.size,
      modified: stats.mtime,
      created: stats.birthtime,
      type: stats.isDirectory() ? "directory" : "file",
    };
  }
}

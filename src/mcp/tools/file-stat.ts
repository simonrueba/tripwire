import * as path from "node:path";
import { z } from "zod/v4";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { IFileSystem } from "../../io/fs-adapter.js";

const description = "Get file or directory metadata (type, size, modified, created).";
const schema = { path: z.string().describe("File or directory path relative to project root") };

export function registerFileStat(
  server: McpServer,
  fs: IFileSystem,
  projectRoot: string,
): void {
  const handler = async ({ path: filePath }: { path: string }) => {
    try {
      const absolutePath = path.join(projectRoot, filePath);
      const stat = await fs.stat(absolutePath);
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            path: filePath,
            type: stat.type,
            size: stat.size,
            modified: stat.modified.toISOString(),
            created: stat.created.toISOString(),
          }, null, 2),
        }],
      };
    } catch (err) {
      return {
        content: [{ type: "text" as const, text: `Error: ${err instanceof Error ? err.message : err}` }],
        isError: true,
      };
    }
  };

  server.tool("file_stat", description, schema, handler);
}

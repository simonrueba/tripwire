import * as path from "node:path";
import { z } from "zod/v4";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { IFileSystem } from "../../io/fs-adapter.js";

export function registerListDirectory(
  server: McpServer,
  fs: IFileSystem,
  projectRoot: string,
): void {
  server.tool(
    "list_directory",
    "List files and directories at a path relative to the project root.",
    {
      path: z.string().describe("Directory path relative to project root"),
    },
    async ({ path: dirPath }) => {
      try {
        const absolutePath = path.join(projectRoot, dirPath);
        const entries = await fs.readdir(absolutePath);
        return {
          content: [{
            type: "text" as const,
            text: entries.join("\n"),
          }],
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error: ${err instanceof Error ? err.message : err}` }],
          isError: true,
        };
      }
    },
  );
}

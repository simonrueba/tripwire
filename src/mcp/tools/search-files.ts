import { z } from "zod/v4";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { IFileSystem } from "../../io/fs-adapter.js";

export function registerSearchFiles(
  server: McpServer,
  fs: IFileSystem,
  projectRoot: string,
): void {
  server.tool(
    "search_files",
    "Search for files matching a glob pattern relative to the project root.",
    {
      pattern: z.string().describe("Glob pattern (e.g. \"src/**/*.ts\", \"**/*.yml\")"),
    },
    async ({ pattern }) => {
      try {
        const matches = await fs.glob(pattern, { cwd: projectRoot });
        if (matches.length === 0) {
          return { content: [{ type: "text" as const, text: `No files match: ${pattern}` }] };
        }
        return {
          content: [{
            type: "text" as const,
            text: matches.join("\n"),
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

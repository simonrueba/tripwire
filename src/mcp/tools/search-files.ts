import { z } from "zod/v4";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { IFileSystem } from "../../io/fs-adapter.js";

const description = "Search for files matching a glob pattern relative to the project root.";
const schema = { pattern: z.string().describe("Glob pattern (e.g. \"src/**/*.ts\", \"**/*.yml\")") };

export function registerSearchFiles(
  server: McpServer,
  fs: IFileSystem,
  projectRoot: string,
): void {
  const handler = async ({ pattern }: { pattern: string }) => {
    try {
      const matches = await fs.glob(pattern, { cwd: projectRoot });
      if (matches.length === 0) {
        return { content: [{ type: "text" as const, text: `No files match: ${pattern}` }] };
      }
      return {
        content: [{ type: "text" as const, text: matches.join("\n") }],
      };
    } catch (err) {
      return {
        content: [{ type: "text" as const, text: `Error: ${err instanceof Error ? err.message : err}` }],
        isError: true,
      };
    }
  };

  server.tool("search_files", description, schema, handler);
  server.tool("glob", description, schema, handler);
}

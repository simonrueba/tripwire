import * as path from "node:path";
import { z } from "zod/v4";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { IFileSystem } from "../../io/fs-adapter.js";

const description = "List files and directories at a path relative to the project root.";
const schema = { path: z.string().describe("Directory path relative to project root") };

export function registerListDirectory(
  server: McpServer,
  fs: IFileSystem,
  projectRoot: string,
): void {
  const handler = async ({ path: dirPath }: { path: string }) => {
    try {
      const absolutePath = path.join(projectRoot, dirPath);
      const entries = await fs.readdir(absolutePath);
      return {
        content: [{ type: "text" as const, text: entries.join("\n") }],
      };
    } catch (err) {
      return {
        content: [{ type: "text" as const, text: `Error: ${err instanceof Error ? err.message : err}` }],
        isError: true,
      };
    }
  };

  server.tool("list_directory", description, schema, handler);
}

import { z } from "zod/v4";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { TripwireEngine } from "../../engine/tripwire-engine.js";

export function registerReadFile(server: McpServer, engine: TripwireEngine): void {
  server.tool(
    "read_file",
    "Read a file with tripwire context auto-injected. Use instead of raw file reads to get safety-critical context before modifying code.",
    { path: z.string().describe("File path relative to project root") },
    async ({ path: filePath }) => {
      try {
        const result = await engine.readFileWithContext(filePath);

        if (result.matches.length === 0) {
          return { content: [{ type: "text" as const, text: result.originalContent }] };
        }

        if (engine.getConfig().inject_mode === "metadata") {
          return {
            content: [
              { type: "text" as const, text: result.injectedContext },
              { type: "text" as const, text: result.originalContent },
            ],
          };
        }

        return { content: [{ type: "text" as const, text: result.fullContent }] };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error: ${err instanceof Error ? err.message : err}` }],
          isError: true,
        };
      }
    },
  );
}

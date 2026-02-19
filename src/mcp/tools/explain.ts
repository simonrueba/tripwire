import { z } from "zod/v4";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { TripwireEngine } from "../../engine/tripwire-engine.js";

export function registerExplain(server: McpServer, engine: TripwireEngine): void {
  server.tool(
    "explain",
    "Show exactly what would be injected for a file path and why. Returns matched tripwires, dependencies, suppressed entries, and the rendered injection.",
    {
      path: z.string().describe("File path to explain tripwire behavior for"),
    },
    async ({ path: filePath }) => {
      try {
        const result = await engine.explain(filePath);
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify(result, null, 2),
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

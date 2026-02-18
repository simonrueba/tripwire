import { z } from "zod/v4";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { TripwireEngine } from "../../engine/tripwire-engine.js";

export function registerCheckTripwires(server: McpServer, engine: TripwireEngine): void {
  server.tool(
    "check_tripwires",
    "Preview which tripwires would fire for a given file path, without reading the file.",
    {
      path: z.string().describe("File path to check against tripwire triggers"),
    },
    async ({ path: filePath }) => {
      try {
        const matches = await engine.checkPath(filePath);

        if (matches.length === 0) {
          return { content: [{ type: "text" as const, text: `No tripwires match: ${filePath}` }] };
        }

        const lines = matches.map((m) => {
          const deps = m.dependencies.length > 0
            ? ` (+ deps: ${m.dependencies.map((d) => d.name).join(", ")})`
            : "";
          return `- [${m.tripwire.severity}] ${m.tripwire.name}: matched ${m.matchedTriggers.join(", ")}${deps}`;
        });

        return {
          content: [{
            type: "text" as const,
            text: `${matches.length} tripwire(s) would fire for ${filePath}:\n${lines.join("\n")}`,
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

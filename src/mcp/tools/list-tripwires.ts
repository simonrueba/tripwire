import { z } from "zod/v4";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { TripwireEngine } from "../../engine/tripwire-engine.js";

export function registerListTripwires(server: McpServer, engine: TripwireEngine): void {
  server.tool(
    "list_tripwires",
    "List all active tripwires, optionally filtered by path, tag, or severity.",
    {
      path: z.string().optional().describe("Only tripwires matching this file path"),
      tag: z.string().optional().describe("Filter by tag"),
      severity: z.enum(["info", "warning", "high", "critical"]).optional().describe("Filter by severity"),
    },
    async ({ path: filterPath, tag, severity }) => {
      try {
        const tripwires = await engine.listTripwires({ path: filterPath, tag, severity });

        if (tripwires.length === 0) {
          return { content: [{ type: "text" as const, text: "No tripwires found." }] };
        }

        const lines = tripwires.map((t) => {
          const tags = t.tags.length > 0 ? ` [${t.tags.join(", ")}]` : "";
          return `- ${t.name} (${t.severity})${tags}: ${t.triggers.join(", ")}`;
        });

        return {
          content: [{ type: "text" as const, text: `${tripwires.length} tripwire(s):\n${lines.join("\n")}` }],
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

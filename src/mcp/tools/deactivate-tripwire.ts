import { z } from "zod/v4";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { TripwireEngine } from "../../engine/tripwire-engine.js";

export function registerDeactivateTripwire(server: McpServer, engine: TripwireEngine): void {
  server.tool(
    "deactivate_tripwire",
    "Soft-disable a tripwire without deleting the file. Sets active: false in the YAML.",
    {
      name: z.string().describe("Name of the tripwire to deactivate (filename without .yml)"),
    },
    async ({ name }) => {
      try {
        await engine.deactivateTripwire(name);
        return {
          content: [{ type: "text" as const, text: `Tripwire "${name}" deactivated.` }],
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

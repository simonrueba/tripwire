import { z } from "zod/v4";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { TripwireEngine } from "../../engine/tripwire-engine.js";

export function registerCreateTripwire(server: McpServer, engine: TripwireEngine): void {
  server.tool(
    "create_tripwire",
    "Create a new tripwire to prevent future mistakes. Use when corrected on a pattern that should be remembered.",
    {
      name: z.string().describe("Tripwire identifier (used as filename, e.g. 'no-raw-sql')"),
      triggers: z.array(z.string()).describe("Glob patterns for files that should trigger this context"),
      context: z.string().describe("Context to inject when triggered"),
      severity: z.enum(["info", "warning", "high", "critical"]).optional().describe("Severity level"),
      learned_from: z.string().optional().describe("What mistake prompted this tripwire"),
      tags: z.array(z.string()).optional().describe("Tags for categorization"),
      force: z.boolean().optional().describe("Overwrite existing tripwire with same name"),
    },
    async ({ name, triggers, context, severity, learned_from, tags, force }) => {
      try {
        const result = await engine.createTripwire(name, {
          triggers,
          context,
          severity,
          created_by: "agent",
          learned_from,
          tags,
          force,
        });

        return {
          content: [{
            type: "text" as const,
            text: `Tripwire "${name}" created at ${result.filePath}\nTriggers: ${triggers.join(", ")}\nSeverity: ${result.tripwire.severity}`,
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

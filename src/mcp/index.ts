import * as path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { TripwireEngine } from "../engine/tripwire-engine.js";
import { RealFileSystem } from "../io/fs-adapter.js";
import { watchTripwires } from "../io/watcher.js";
import { registerReadFile } from "./tools/read-file.js";
import { registerCreateTripwire } from "./tools/create-tripwire.js";
import { registerListTripwires } from "./tools/list-tripwires.js";
import { registerCheckTripwires } from "./tools/check-tripwires.js";
import { registerDeactivateTripwire } from "./tools/deactivate-tripwire.js";
import { registerExplain } from "./tools/explain.js";
import { registerListDirectory } from "./tools/list-directory.js";
import { registerFileStat } from "./tools/file-stat.js";
import { registerSearchFiles } from "./tools/search-files.js";

export async function createAndStartServer(projectRoot: string): Promise<void> {
  const fs = new RealFileSystem();
  const engine = new TripwireEngine({ projectRoot, fs });

  // Load config from .tripwirerc.yml if present
  await engine.loadConfig();

  const server = new McpServer({
    name: "tripwire",
    version: "0.1.0",
  });

  registerReadFile(server, engine);
  registerCreateTripwire(server, engine);
  registerListTripwires(server, engine);
  registerCheckTripwires(server, engine);
  registerDeactivateTripwire(server, engine);
  registerExplain(server, engine);
  registerListDirectory(server, fs, projectRoot);
  registerFileStat(server, fs, projectRoot);
  registerSearchFiles(server, fs, projectRoot);

  // Watch .tripwires/ for changes and invalidate cache
  const config = engine.getConfig();
  const tripwiresDir = path.join(projectRoot, config.tripwires_dir);
  const watcher = watchTripwires(tripwiresDir, () => engine.invalidateCache());

  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error("[tripwire] MCP server started");

  const cleanup = () => {
    watcher.close();
    process.exit(0);
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
}

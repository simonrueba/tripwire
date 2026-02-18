import { createAndStartServer } from "./mcp/index.js";

const projectRoot = process.argv[2] || process.cwd();
createAndStartServer(projectRoot).catch((err) => {
  console.error("[tripwire] Fatal:", err);
  process.exit(1);
});

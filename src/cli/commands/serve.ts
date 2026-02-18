import { createAndStartServer } from "../../mcp/index.js";

export async function serveAction(options: { project?: string }): Promise<void> {
  const projectRoot = options.project || process.cwd();
  await createAndStartServer(projectRoot);
}

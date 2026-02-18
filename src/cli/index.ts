import { Command } from "commander";
import { serveAction } from "./commands/serve.js";
import { initAction } from "./commands/init.js";
import { checkAction } from "./commands/check.js";
import { listAction } from "./commands/list.js";
import { lintAction } from "./commands/lint.js";
import { statsAction } from "./commands/stats.js";

export function createProgram(): Command {
  const program = new Command()
    .name("tripwire")
    .description("Context injection for AI agents, triggered by the codebase itself")
    .version("0.1.0");

  program
    .command("serve")
    .description("Start MCP server over stdio")
    .option("--project <path>", "Project root directory (default: cwd)")
    .action(serveAction);

  program
    .command("init")
    .description("Initialize .tripwires/ directory with example")
    .option("--force", "Overwrite existing .tripwires/")
    .action(initAction);

  program
    .command("check <path>")
    .description("Show which tripwires would fire for a file path")
    .action(checkAction);

  program
    .command("list")
    .description("List all active tripwires")
    .option("--tag <tag>", "Filter by tag")
    .option("--severity <level>", "Filter by severity")
    .option("--json", "Output as JSON")
    .action(listAction);

  program
    .command("lint")
    .description("Validate all tripwire YAML files")
    .option("--strict", "Treat warnings as errors")
    .option("--prune", "Deactivate expired tripwires")
    .action(lintAction);

  program
    .command("stats")
    .description("Show tripwire coverage and statistics")
    .option("--json", "Output as JSON")
    .action(statsAction);

  return program;
}

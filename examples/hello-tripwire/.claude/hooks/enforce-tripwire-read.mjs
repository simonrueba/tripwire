#!/usr/bin/env node

// PreToolUse hook: redirect file reads to mcp__tripwire__read_file
// so that repo policies are automatically injected into every file read.
//
// Zero external dependencies — uses only Node built-ins.
// Enforcement activates when .tripwires/ exists in the project.

import { realpathSync, existsSync, readFileSync, accessSync, constants } from "node:fs";
import { join } from "node:path";

const EXCLUDED = [".git/", "node_modules/", "dist/", ".tripwires/", ".claude/"];

function main() {
  let input;
  try {
    input = JSON.parse(readFileSync("/dev/stdin", "utf-8"));
  } catch {
    process.exit(0); // can't parse → allow
  }

  const filePath = input?.tool_input?.file_path;
  const cwd = input?.cwd;

  if (!filePath || !cwd) {
    process.exit(0);
  }

  // Canonicalize to prevent symlink / traversal bypasses
  let realCwd, realFile;
  try {
    realCwd = realpathSync(cwd);
    realFile = realpathSync(filePath);
  } catch {
    process.exit(0); // can't resolve → allow (file may not exist yet)
  }

  // Only intercept files within the project root
  if (!realFile.startsWith(realCwd + "/")) {
    process.exit(0);
  }

  // Skip if no .tripwires directory
  if (!existsSync(join(realCwd, ".tripwires"))) {
    process.exit(0);
  }

  const relPath = realFile.slice(realCwd.length + 1);

  // Skip excluded directories
  if (EXCLUDED.some((dir) => relPath.startsWith(dir))) {
    process.exit(0);
  }

  // Check if Tripwire MCP server is actually configured
  // (don't deny if agent has no alternative — prevents loops)
  const mcpPath = join(realCwd, ".mcp.json");
  if (existsSync(mcpPath)) {
    try {
      const mcp = JSON.parse(readFileSync(mcpPath, "utf-8"));
      if (!mcp?.mcpServers?.tripwire) {
        // Tripwire server not configured — don't deny
        process.exit(0);
      }
    } catch {
      process.exit(0); // can't parse .mcp.json → allow
    }
  } else {
    // No .mcp.json at all — don't deny
    process.exit(0);
  }

  // Check enforcement_mode from .tripwirerc.yml (simple string match)
  const rcPath = join(realCwd, ".tripwirerc.yml");
  if (existsSync(rcPath)) {
    try {
      const rc = readFileSync(rcPath, "utf-8");
      if (/enforcement_mode:\s*advisory/.test(rc)) {
        // Advisory mode: allow read but add context about Tripwire
        const output = {
          hookSpecificOutput: {
            hookEventName: "PreToolUse",
            permissionDecision: "allow",
            permissionDecisionReason:
              `Tripwire advisory: consider using mcp__tripwire__read_file with { "path": "${relPath}" } to get auto-injected safety context.`,
          },
        };
        process.stdout.write(JSON.stringify(output));
        process.exit(0);
      }
    } catch {
      // can't read config → fall through to strict
    }
  }

  // Strict mode (default): deny and redirect
  const output = {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason:
        `Use mcp__tripwire__read_file with { "path": "${relPath}" } instead. ` +
        "Tripwire auto-injects safety context (architecture constraints, import rules, protocol requirements) for project files. " +
        "If Tripwire MCP is not available, run: tripwire doctor",
    },
  };
  process.stdout.write(JSON.stringify(output));
  process.exit(0);
}

main();

import { resolve, join } from "node:path";
import { RealFileSystem } from "../../io/fs-adapter.js";

interface Check {
  name: string;
  status: "pass" | "fail" | "warn";
  detail: string;
}

export async function doctorAction(options: { json?: boolean }): Promise<void> {
  const projectRoot = resolve(process.cwd());
  const fs = new RealFileSystem();
  const checks: Check[] = [];

  // 1. .tripwires/ directory exists
  const tripwiresDir = join(projectRoot, ".tripwires");
  const hasTripwiresDir = await fs.exists(tripwiresDir);
  if (hasTripwiresDir) {
    const files = await fs.readdir(tripwiresDir);
    const ymlCount = files.filter((f) => f.endsWith(".yml")).length;
    checks.push({
      name: ".tripwires/ directory",
      status: "pass",
      detail: `${ymlCount} YAML file(s)`,
    });
  } else {
    checks.push({
      name: ".tripwires/ directory",
      status: "fail",
      detail: "Not found. Run: tripwire init",
    });
  }

  // 2. MCP server configured with correct key
  const mcpPath = join(projectRoot, ".mcp.json");
  const hasMcp = await fs.exists(mcpPath);
  if (hasMcp) {
    const raw = await fs.readFile(mcpPath);
    const hasTripwireKey = raw.includes('"tripwire"');
    checks.push({
      name: "MCP server config (.mcp.json)",
      status: hasTripwireKey ? "pass" : "warn",
      detail: hasTripwireKey
        ? 'Server key "tripwire" found'
        : 'No "tripwire" key — hook redirect targets mcp__tripwire__read_file',
    });
  } else {
    checks.push({
      name: "MCP server config (.mcp.json)",
      status: "fail",
      detail: "Not found. See README for configuration.",
    });
  }

  // 3. Hook settings exist
  const settingsPath = join(projectRoot, ".claude", "settings.json");
  const hasSettings = await fs.exists(settingsPath);
  if (hasSettings) {
    const raw = await fs.readFile(settingsPath);
    const hasReadMatcher = raw.includes("Read");
    checks.push({
      name: "Hook config (.claude/settings.json)",
      status: hasReadMatcher ? "pass" : "warn",
      detail: hasReadMatcher
        ? "PreToolUse Read matcher configured"
        : "File exists but no Read matcher found",
    });
  } else {
    checks.push({
      name: "Hook config (.claude/settings.json)",
      status: "warn",
      detail: "Not found. Enforcement is optional but recommended.",
    });
  }

  // 4. Hook script exists
  const hookPath = join(
    projectRoot,
    ".claude",
    "hooks",
    "enforce-tripwire-read.mjs",
  );
  const hasHook = await fs.exists(hookPath);
  if (hasHook) {
    checks.push({
      name: "Hook script (enforce-tripwire-read.mjs)",
      status: "pass",
      detail: "Exists (Node.js — zero external dependencies)",
    });
  } else {
    checks.push({
      name: "Hook script (enforce-tripwire-read.mjs)",
      status: "warn",
      detail: "Not found. Enforcement is optional but recommended.",
    });
  }

  // 5. Enforcement mode
  const rcPath = join(projectRoot, ".tripwirerc.yml");
  const hasRc = await fs.exists(rcPath);
  if (hasRc) {
    const raw = await fs.readFile(rcPath);
    const isAdvisory = /enforcement_mode:\s*advisory/.test(raw);
    checks.push({
      name: "Enforcement mode",
      status: isAdvisory ? "warn" : "pass",
      detail: isAdvisory
        ? "advisory — raw reads allowed with warning"
        : "strict — raw reads denied",
    });
  } else if (hasHook) {
    checks.push({
      name: "Enforcement mode",
      status: "pass",
      detail: "strict (default — no .tripwirerc.yml override)",
    });
  }

  // Output
  if (options.json) {
    console.log(JSON.stringify(checks, null, 2));
    return;
  }

  const allPass = checks.every((c) => c.status === "pass");
  const hasFail = checks.some((c) => c.status === "fail");

  console.log("Tripwire Doctor\n");

  for (const check of checks) {
    const icon =
      check.status === "pass"
        ? "PASS"
        : check.status === "warn"
          ? "WARN"
          : "FAIL";
    console.log(`  [${icon}] ${check.name}`);
    console.log(`         ${check.detail}`);
  }

  console.log("");
  if (allPass) {
    console.log("ENFORCEMENT: ON");
    console.log(
      "All project file reads are redirected through Tripwire MCP.",
    );
  } else if (hasFail) {
    console.log("ENFORCEMENT: OFF");
    console.log("Fix the FAIL items above to enable enforcement.");
  } else {
    console.log("ENFORCEMENT: PARTIAL");
    console.log(
      "Core setup OK but some optional items missing. See WARN items.",
    );
  }

  if (hasFail) {
    process.exitCode = 1;
  }
}

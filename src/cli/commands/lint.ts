import { TripwireEngine } from "../../engine/tripwire-engine.js";
import { RealFileSystem } from "../../io/fs-adapter.js";

export async function lintAction(options: {
  strict?: boolean;
  prune?: boolean;
}): Promise<void> {
  const engine = new TripwireEngine({
    projectRoot: process.cwd(),
    fs: new RealFileSystem(),
  });
  await engine.loadConfig();

  const results = await engine.lint(options);

  if (results.length === 0) {
    console.log("All tripwires valid.");
    return;
  }

  let hasErrors = false;
  for (const r of results) {
    const prefix = r.level === "error" ? "ERROR" : "WARN ";
    console.log(`  ${prefix} ${r.file}: ${r.message}`);
    if (r.level === "error") hasErrors = true;
    if (options.strict && r.level === "warning") hasErrors = true;
  }

  if (hasErrors) {
    process.exitCode = 1;
  }
}

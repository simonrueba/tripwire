import { TripwireEngine } from "../../engine/tripwire-engine.js";
import { RealFileSystem } from "../../io/fs-adapter.js";

export async function statsAction(options: { json?: boolean }): Promise<void> {
  const engine = new TripwireEngine({
    projectRoot: process.cwd(),
    fs: new RealFileSystem(),
  });
  await engine.loadConfig();

  const stats = await engine.getStats();

  if (options.json) {
    console.log(JSON.stringify(stats, null, 2));
    return;
  }

  console.log("Tripwire Statistics\n");
  console.log(`  Total:    ${stats.total}`);
  console.log(`  Active:   ${stats.active}`);
  console.log(`  Inactive: ${stats.inactive}`);
  console.log(`  Expired:  ${stats.expired}`);

  console.log("\n  By Severity:");
  for (const [sev, count] of Object.entries(stats.bySeverity)) {
    if (count > 0) console.log(`    ${sev}: ${count}`);
  }

  if (Object.keys(stats.byTag).length > 0) {
    console.log("\n  By Tag:");
    for (const [tag, count] of Object.entries(stats.byTag)) {
      console.log(`    ${tag}: ${count}`);
    }
  }

  if (Object.keys(stats.byCreator).length > 0) {
    console.log("\n  By Creator:");
    for (const [creator, count] of Object.entries(stats.byCreator)) {
      console.log(`    ${creator}: ${count}`);
    }
  }
}

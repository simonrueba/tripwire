import { TripwireEngine } from "../../engine/tripwire-engine.js";
import { RealFileSystem } from "../../io/fs-adapter.js";
import type { Severity } from "../../types/tripwire.js";

export async function listAction(options: {
  tag?: string;
  severity?: string;
  json?: boolean;
}): Promise<void> {
  const engine = new TripwireEngine({
    projectRoot: process.cwd(),
    fs: new RealFileSystem(),
  });
  await engine.loadConfig();

  const tripwires = await engine.listTripwires({
    tag: options.tag,
    severity: options.severity as Severity | undefined,
  });

  if (tripwires.length === 0) {
    console.log("No tripwires found.");
    return;
  }

  if (options.json) {
    console.log(JSON.stringify(tripwires, null, 2));
    return;
  }

  console.log(`${tripwires.length} tripwire(s):\n`);
  for (const t of tripwires) {
    const tags = t.tags.length > 0 ? ` [${t.tags.join(", ")}]` : "";
    console.log(`  ${t.name} (${t.severity})${tags}`);
    console.log(`    Triggers: ${t.triggers.join(", ")}`);
    if (t.created_by !== "human") {
      console.log(`    Created by: ${t.created_by}`);
    }
    if (t.learned_from) {
      console.log(`    Learned from: ${t.learned_from}`);
    }
    console.log();
  }
}

import { TripwireEngine } from "../../engine/tripwire-engine.js";
import { RealFileSystem } from "../../io/fs-adapter.js";

export async function checkAction(filePath: string): Promise<void> {
  const engine = new TripwireEngine({
    projectRoot: process.cwd(),
    fs: new RealFileSystem(),
  });
  await engine.loadConfig();

  const matches = await engine.checkPath(filePath);

  if (matches.length === 0) {
    console.log(`No tripwires match: ${filePath}`);
    return;
  }

  console.log(`${matches.length} tripwire(s) would fire for ${filePath}:\n`);

  for (const match of matches) {
    const { tripwire } = match;
    const tags = tripwire.tags.length > 0 ? ` [${tripwire.tags.join(", ")}]` : "";
    console.log(`  ${severityIcon(tripwire.severity)} ${tripwire.name} (${tripwire.severity})${tags}`);
    console.log(`    Triggers: ${match.matchedTriggers.join(", ")}`);
    console.log(`    ${tripwire.context.trim().split("\n").join("\n    ")}`);

    if (match.dependencies.length > 0) {
      console.log(`    Dependencies: ${match.dependencies.map((d) => d.name).join(", ")}`);
    }
    console.log();
  }
}

function severityIcon(severity: string): string {
  switch (severity) {
    case "critical": return "[!!]";
    case "high": return "[! ]";
    case "warning": return "[* ]";
    case "info": return "[i ]";
    default: return "[  ]";
  }
}

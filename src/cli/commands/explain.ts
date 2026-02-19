import { TripwireEngine } from "../../engine/tripwire-engine.js";
import { RealFileSystem } from "../../io/fs-adapter.js";

export async function explainAction(
  filePath: string,
  options: { json?: boolean },
): Promise<void> {
  const engine = new TripwireEngine({
    projectRoot: process.cwd(),
    fs: new RealFileSystem(),
  });
  await engine.loadConfig();

  const result = await engine.explain(filePath);

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`Explain: ${result.filePath}\n`);

  // Config summary
  console.log("Config:");
  console.log(`  inject_mode: ${result.config.inject_mode}`);
  console.log(`  max_context_length: ${result.config.max_context_length || "unlimited"}`);
  console.log(`  enforcement_mode: ${result.config.enforcement_mode}`);
  console.log();

  // Direct matches
  if (result.directMatches.length === 0) {
    console.log("No tripwires match this path.");
    return;
  }

  console.log(`Matched tripwires (${result.directMatches.length}):\n`);
  for (const match of result.directMatches) {
    const tags = match.tags.length > 0 ? ` [${match.tags.join(", ")}]` : "";
    console.log(`  ${severityIcon(match.severity)} ${match.name} (${match.severity})${tags}`);
    console.log(`    Globs: ${match.matchedGlobs.join(", ")}`);
    console.log(`    Preview: ${match.contextPreview}...`);
    console.log();
  }

  // Dependencies
  if (result.resolvedDependencies.length > 0) {
    console.log(`Dependencies (${result.resolvedDependencies.length}):\n`);
    for (const dep of result.resolvedDependencies) {
      console.log(`  ${dep.name} (${dep.severity}) via ${dep.resolvedVia}`);
    }
    console.log();
  }

  // Suppressed
  if (result.suppressed.length > 0) {
    console.log(`Suppressed (${result.suppressed.length}):\n`);
    for (const s of result.suppressed) {
      console.log(`  ${s.name} (${s.severity}) — ${s.reason}`);
    }
    console.log();
  }

  // Rendered injection
  console.log(`Total context length: ${result.totalContextLength} chars`);
  console.log();
  console.log("--- Rendered injection ---");
  console.log(result.renderedInjection);
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

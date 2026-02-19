import { SEVERITY_ORDER, type MatchResult, type TripwireFile } from "../types/tripwire.js";

export interface InjectorOptions {
  separator: string;
  maxLength: number; // 0 = unlimited
}

/**
 * Format matched tripwires into an injectable context block.
 * Sorted by severity (critical first), then alphabetically.
 * Dependencies are emitted before their parent (depth-first topological order).
 * If a dependency can't fit in the budget, the parent is suppressed too.
 */
export function formatContext(
  matches: MatchResult[],
  options: InjectorOptions,
): string {
  if (matches.length === 0) return "";

  // Sort: severity descending (critical=0 first), then name alphabetically
  const sorted = [...matches].sort((a, b) => {
    const sevDiff = SEVERITY_ORDER[a.tripwire.severity] - SEVERITY_ORDER[b.tripwire.severity];
    if (sevDiff !== 0) return sevDiff;
    return a.tripwire.name.localeCompare(b.tripwire.name);
  });

  const blocks: string[] = [];
  let totalLength = 0;
  const suppressed: string[] = [];

  for (const match of sorted) {
    // Pre-compute all blocks for this match: deps first, then parent
    const depBlocks: string[] = [];
    let groupLength = 0;

    for (const dep of match.dependencies) {
      const depBlock = formatDependencyBlock(match.tripwire.name, dep);
      depBlocks.push(depBlock);
      groupLength += depBlock.length;
    }

    const parentBlock = formatTripwireBlock(match);
    groupLength += parentBlock.length;

    // If the entire group (deps + parent) doesn't fit, suppress all of it
    if (options.maxLength > 0 && totalLength + groupLength > options.maxLength) {
      suppressed.push(`${match.tripwire.name} (${match.tripwire.severity})`);
      continue;
    }

    // Emit deps first, then parent
    for (const depBlock of depBlocks) {
      blocks.push(depBlock);
    }
    blocks.push(parentBlock);
    totalLength += groupLength;
  }

  let result = blocks.join("\n");

  if (suppressed.length > 0) {
    result += `\n<<<TRIPWIRE_SUPPRESSED count="${suppressed.length}" reason="context_budget">>>\n`;
    result += `Suppressed: ${suppressed.join(", ")}\n`;
    result += `<<<END_TRIPWIRE_SUPPRESSED>>>`;
  }

  return result;
}

/**
 * Combine injected context with original file content.
 */
export function injectContext(
  injectedContext: string,
  originalContent: string,
  separator: string,
): string {
  if (!injectedContext) return originalContent;
  return injectedContext + separator + originalContent;
}

function formatTripwireBlock(match: MatchResult): string {
  const { tripwire } = match;
  const tags = tripwire.tags.length > 0 ? ` tags="${tripwire.tags.join(",")}"` : "";
  const header = `<<<TRIPWIRE severity="${tripwire.severity}" name="${tripwire.name}"${tags}>>>`;
  const footer = "<<<END_TRIPWIRE>>>";
  return `${header}\n${tripwire.context.trim()}\n${footer}\n`;
}

function formatDependencyBlock(parentName: string, dep: TripwireFile): string {
  const tags = dep.tags.length > 0 ? ` tags="${dep.tags.join(",")}"` : "";
  const header = `<<<TRIPWIRE severity="${dep.severity}" name="${dep.name}" origin="dependency" parent="${parentName}"${tags}>>>`;
  const footer = "<<<END_TRIPWIRE>>>";
  return `${header}\n${dep.context.trim()}\n${footer}\n`;
}

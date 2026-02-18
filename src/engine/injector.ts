import { SEVERITY_ORDER, type MatchResult } from "../types/tripwire.js";

export interface InjectorOptions {
  separator: string;
  maxLength: number; // 0 = unlimited
}

/**
 * Format matched tripwires into an injectable context block.
 * Sorted by severity (critical first), then alphabetically.
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
  let omitted = 0;

  for (const match of sorted) {
    const block = formatTripwireBlock(match);

    if (options.maxLength > 0 && totalLength + block.length > options.maxLength) {
      omitted = sorted.length - blocks.length;
      break;
    }

    blocks.push(block);
    totalLength += block.length;

    // Format dependency context
    for (const dep of match.dependencies) {
      const depBlock = formatDependencyBlock(match.tripwire.name, dep);
      if (options.maxLength > 0 && totalLength + depBlock.length > options.maxLength) {
        break;
      }
      blocks.push(depBlock);
      totalLength += depBlock.length;
    }
  }

  let result = blocks.join("\n");

  if (omitted > 0) {
    result += `\n[TRIPWIRE] ... and ${omitted} more tripwire(s) omitted (increase max_context_length)`;
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
  const tags = tripwire.tags.length > 0 ? ` (${tripwire.tags.join(", ")})` : "";
  const header = `[TRIPWIRE:${tripwire.severity}] ${tripwire.name}${tags}`;
  return `${header}\n${tripwire.context.trim()}\n`;
}

function formatDependencyBlock(parentName: string, dep: import("../types/tripwire.js").TripwireFile): string {
  const tags = dep.tags.length > 0 ? ` (${dep.tags.join(", ")})` : "";
  const header = `[TRIPWIRE:${dep.severity}] ${parentName}/dep: ${dep.name}${tags}`;
  return `${header}\n${dep.context.trim()}\n`;
}

import { SEVERITY_ORDER, type MatchResult, type TripwireFile } from "../types/tripwire.js";

export interface InjectorOptions {
  separator: string;
  maxLength: number; // 0 = unlimited
}

/**
 * Format matched tripwires into an injectable context block.
 *
 * Groups are constructed per matched root tripwire: deps (DFS order) then parent.
 * Groups are ordered by root severity DESC, then root name ASC.
 * Dependencies are globally deduped per response — a dependency block appears at
 * most once, emitted with the first group that references it (the "originator").
 * Groups are atomic for truncation: if the group doesn't fit, all of it is suppressed.
 *
 * Budget counts the fully rendered injection string (header + context + footer +
 * trailing newline per block). Separator and file content are NOT part of the budget.
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
  const suppressed: { name: string; severity: string }[] = [];
  const emittedDeps = new Set<string>(); // global dedupe across groups

  for (const match of sorted) {
    // Pre-compute all blocks for this group: deps first (globally deduped), then parent
    const groupBlocks: string[] = [];
    let groupLength = 0;

    for (const dep of match.dependencies) {
      if (emittedDeps.has(dep.name)) continue; // already emitted by earlier group
      const depBlock = formatDependencyBlock(match.tripwire.name, dep);
      groupBlocks.push(depBlock);
      groupLength += depBlock.length;
    }

    const parentBlock = formatTripwireBlock(match);
    groupBlocks.push(parentBlock);
    groupLength += parentBlock.length;

    // Atomic: if the entire group doesn't fit, suppress all of it
    if (options.maxLength > 0 && totalLength + groupLength > options.maxLength) {
      suppressed.push({ name: match.tripwire.name, severity: match.tripwire.severity });
      continue;
    }

    // Commit group to output and mark deps as emitted
    for (const dep of match.dependencies) {
      emittedDeps.add(dep.name);
    }
    for (const block of groupBlocks) {
      blocks.push(block);
    }
    totalLength += groupLength;
  }

  let result = blocks.join("\n");

  if (suppressed.length > 0) {
    result += `\n<<<TRIPWIRE_SUPPRESSED count="${suppressed.length}" reason="context_budget">>>\n`;
    result += suppressed.map(s => `${s.severity} ${s.name}`).join("\n") + "\n";
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

function formatDependencyBlock(originatorName: string, dep: TripwireFile): string {
  const tags = dep.tags.length > 0 ? ` tags="${dep.tags.join(",")}"` : "";
  const header = `<<<TRIPWIRE severity="${dep.severity}" name="${dep.name}" origin="dependency" originator="${originatorName}"${tags}>>>`;
  const footer = "<<<END_TRIPWIRE>>>";
  return `${header}\n${dep.context.trim()}\n${footer}\n`;
}

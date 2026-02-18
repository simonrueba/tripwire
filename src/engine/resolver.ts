import type { TripwireFile } from "../types/tripwire.js";

export interface ResolveResult {
  resolved: TripwireFile[];
  warnings: string[];
}

/**
 * Resolve depends_on chains for a set of matched tripwires.
 * Walks transitive dependencies with cycle detection and depth limit.
 */
export function resolveDependencies(
  directMatches: TripwireFile[],
  allTripwires: TripwireFile[],
  maxDepth: number,
): ResolveResult {
  const byName = new Map(allTripwires.map((t) => [t.name, t]));
  const resolved = new Map<string, TripwireFile>();
  const warnings: string[] = [];

  for (const match of directMatches) {
    resolved.set(match.name, match);
  }

  for (const match of directMatches) {
    walkDeps(match, byName, resolved, warnings, new Set([match.name]), maxDepth, 0);
  }

  return { resolved: Array.from(resolved.values()), warnings };
}

function walkDeps(
  tripwire: TripwireFile,
  byName: Map<string, TripwireFile>,
  resolved: Map<string, TripwireFile>,
  warnings: string[],
  visited: Set<string>,
  maxDepth: number,
  depth: number,
): void {
  if (depth >= maxDepth) return;

  for (const depName of tripwire.depends_on) {
    if (visited.has(depName)) {
      warnings.push(`Dependency cycle: ${tripwire.name} -> ${depName}`);
      continue;
    }

    const dep = byName.get(depName);
    if (!dep) {
      warnings.push(`Missing dependency: ${tripwire.name} depends on "${depName}" which does not exist`);
      continue;
    }

    resolved.set(dep.name, dep);
    visited.add(dep.name);
    walkDeps(dep, byName, resolved, warnings, visited, maxDepth, depth + 1);
  }
}

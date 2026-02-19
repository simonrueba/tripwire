import * as path from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type { IFileSystem } from "../io/fs-adapter.js";
import {
  TripwireConfigSchema,
  DEFAULT_CONFIG,
  type TripwireConfig,
} from "../types/config.js";
import {
  TripwireSchema,
  type TripwireFile,
  type MatchResult,
  type LintResult,
  type TripwireStats,
  type ValidationError,
  type Severity,
  type ExplainResult,
  type ExplainMatch,
  type ExplainDependency,
  type ExplainSuppressed,
} from "../types/tripwire.js";
import { TripwireError, TripwireErrorCode } from "../types/errors.js";
import { loadTripwireFiles } from "./loader.js";
import { matchPath } from "./matcher.js";
import { resolveDependencies } from "./resolver.js";
import { formatContext, injectContext } from "./injector.js";
import { validateTripwire } from "./validator.js";

export interface TripwireEngineOptions {
  projectRoot: string;
  fs: IFileSystem;
  config?: Partial<TripwireConfig>;
}

interface TripwireCache {
  files: TripwireFile[];
  errors: ValidationError[];
}

export class TripwireEngine {
  private projectRoot: string;
  private fs: IFileSystem;
  private config: TripwireConfig;
  private cache: TripwireCache | null = null;

  constructor(options: TripwireEngineOptions) {
    this.projectRoot = options.projectRoot;
    this.fs = options.fs;
    this.config = { ...DEFAULT_CONFIG, ...options.config };
  }

  async loadConfig(): Promise<void> {
    const configPath = path.join(this.projectRoot, ".tripwirerc.yml");
    const exists = await this.fs.exists(configPath);
    if (!exists) return;

    try {
      const raw = await this.fs.readFile(configPath);
      const parsed = parseYaml(raw);
      this.config = TripwireConfigSchema.parse(parsed);
    } catch (err) {
      throw new TripwireError(
        `Failed to load config: ${err}`,
        TripwireErrorCode.CONFIG_PARSE_ERROR,
      );
    }
  }

  getConfig(): TripwireConfig {
    return this.config;
  }

  private get matchOptions() {
    return { nocase: !this.config.match_case };
  }

  private get tripwiresDir(): string {
    return path.join(this.projectRoot, this.config.tripwires_dir);
  }

  private async ensureLoaded(): Promise<TripwireCache> {
    if (!this.cache) {
      const result = await loadTripwireFiles(this.tripwiresDir, this.fs);
      this.cache = result;
    }
    return this.cache;
  }

  invalidateCache(): void {
    this.cache = null;
  }

  async getTripwires(): Promise<TripwireFile[]> {
    const cache = await this.ensureLoaded();
    return cache.files;
  }

  async checkPath(filePath: string): Promise<MatchResult[]> {
    const tripwires = await this.getTripwires();
    const relativePath = this.toRelative(filePath);

    // Check if path is excluded
    if (this.isExcluded(relativePath)) return [];

    const directMatches: MatchResult[] = [];

    for (const tripwire of tripwires) {
      const result = matchPath(relativePath, tripwire.triggers, this.matchOptions);
      if (result.matches) {
        directMatches.push({
          tripwire,
          matchedTriggers: result.matchedTriggers,
          dependencies: [],
        });
      }
    }

    if (directMatches.length === 0) return [];

    // Resolve dependencies
    const { resolved, warnings } = resolveDependencies(
      directMatches.map((m) => m.tripwire),
      tripwires,
      this.config.max_dependency_depth,
    );

    if (warnings.length > 0) {
      for (const w of warnings) {
        console.error(`[tripwire] ${w}`);
      }
    }

    // Attach dependencies to each match
    const directNames = new Set(directMatches.map((m) => m.tripwire.name));
    const deps = resolved.filter((t) => !directNames.has(t.name));

    for (const match of directMatches) {
      match.dependencies = deps.filter((d) =>
        match.tripwire.depends_on.includes(d.name),
      );
    }

    return directMatches;
  }

  async readFileWithContext(filePath: string): Promise<{
    originalContent: string;
    injectedContext: string;
    fullContent: string;
    matches: MatchResult[];
  }> {
    const absolutePath = this.toAbsolute(filePath);

    let originalContent: string;
    try {
      originalContent = await this.fs.readFile(absolutePath);
    } catch {
      throw new TripwireError(
        `File not found: ${filePath}`,
        TripwireErrorCode.FILE_NOT_FOUND,
      );
    }

    const matches = await this.checkPath(filePath);

    if (matches.length === 0) {
      return { originalContent, injectedContext: "", fullContent: originalContent, matches };
    }

    const injectedContext = formatContext(matches, {
      separator: this.config.separator,
      maxLength: this.config.max_context_length,
    });

    const fullContent = injectContext(injectedContext, originalContent, this.config.separator);

    return { originalContent, injectedContext, fullContent, matches };
  }

  async explain(filePath: string): Promise<ExplainResult> {
    const relativePath = this.toRelative(filePath);

    const emptyResult: ExplainResult = {
      filePath: relativePath,
      config: {
        inject_mode: this.config.inject_mode,
        max_context_length: this.config.max_context_length,
        enforcement_mode: this.config.enforcement_mode,
      },
      directMatches: [],
      resolvedDependencies: [],
      suppressed: [],
      renderedInjection: "",
      totalContextLength: 0,
    };

    if (this.isExcluded(relativePath)) return emptyResult;

    const matches = await this.checkPath(filePath);

    if (matches.length === 0) return emptyResult;

    // Build direct matches with matched globs
    const directMatches: ExplainMatch[] = matches.map((m) => ({
      name: m.tripwire.name,
      severity: m.tripwire.severity,
      matchedGlobs: m.matchedTriggers,
      tags: m.tripwire.tags,
      contextPreview: m.tripwire.context.trim().slice(0, 120),
    }));

    // Build dependency list with resolvedVia
    const resolvedDependencies: ExplainDependency[] = [];
    for (const match of matches) {
      for (const dep of match.dependencies) {
        // Avoid duplicates
        if (!resolvedDependencies.some((d) => d.name === dep.name)) {
          resolvedDependencies.push({
            name: dep.name,
            severity: dep.severity,
            resolvedVia: match.tripwire.name,
          });
        }
      }
    }

    // Render the injection to detect suppressed tripwires
    const renderedInjection = formatContext(matches, {
      separator: this.config.separator,
      maxLength: this.config.max_context_length,
    });

    // Parse suppressed block from rendered output
    const suppressed: ExplainSuppressed[] = [];
    const suppressedMatch = renderedInjection.match(
      /<<<TRIPWIRE_SUPPRESSED count="(\d+)" reason="([^"]+)">>>\nSuppressed: ([^\n]+)\n<<<END_TRIPWIRE_SUPPRESSED>>>/,
    );
    if (suppressedMatch) {
      const entries = suppressedMatch[3].split(", ");
      for (const entry of entries) {
        const parts = entry.match(/^(.+) \((.+)\)$/);
        if (parts) {
          suppressed.push({
            name: parts[1],
            severity: parts[2] as Severity,
            reason: suppressedMatch[2],
          });
        }
      }
    }

    return {
      ...emptyResult,
      directMatches,
      resolvedDependencies,
      suppressed,
      renderedInjection,
      totalContextLength: renderedInjection.length,
    };
  }

  async createTripwire(
    name: string,
    data: {
      triggers: string[];
      context: string;
      severity?: Severity;
      created_by?: string;
      learned_from?: string;
      tags?: string[];
      depends_on?: string[];
      force?: boolean;
    },
  ): Promise<{ filePath: string; tripwire: TripwireFile }> {
    if (!this.config.allow_agent_create && data.created_by !== "human" && data.created_by !== undefined) {
      throw new TripwireError(
        "Agent-created tripwires are disabled in config",
        TripwireErrorCode.AGENT_CREATE_DISABLED,
      );
    }

    const normalized = normalizeName(name);
    const validated = TripwireSchema.parse(data);
    const fileName = `${normalized}.yml`;
    const filePath = path.join(this.tripwiresDir, fileName);

    // Prevent silent overwrites unless force is set
    if (!data.force) {
      const exists = await this.fs.exists(filePath);
      if (exists) {
        throw new TripwireError(
          `Tripwire "${normalized}" already exists at ${fileName}. Use force to overwrite, or delete/deactivate the existing tripwire.`,
          TripwireErrorCode.TRIPWIRE_ALREADY_EXISTS,
        );
      }
    }

    // Build YAML content (omit defaults for cleaner files, but always include created_by)
    const yamlObj: Record<string, unknown> = {
      triggers: validated.triggers,
      context: validated.context,
    };
    if (validated.severity !== "warning") yamlObj.severity = validated.severity;
    if (validated.created_by) yamlObj.created_by = validated.created_by;
    if (validated.learned_from) yamlObj.learned_from = validated.learned_from;
    if (validated.tags.length > 0) yamlObj.tags = validated.tags;
    if (validated.depends_on.length > 0) yamlObj.depends_on = validated.depends_on;

    // Auto-expiry for agent-created tripwires
    if (validated.created_by && validated.created_by !== "human" && this.config.auto_expire_days > 0) {
      const expires = new Date();
      expires.setDate(expires.getDate() + this.config.auto_expire_days);
      yamlObj.expires = expires.toISOString().split("T")[0];
    }

    const yamlContent = stringifyYaml(yamlObj);
    await this.fs.writeFile(filePath, yamlContent);
    this.invalidateCache();

    const tripwireFile: TripwireFile = { ...validated, name: normalized, filePath };
    return { filePath, tripwire: tripwireFile };
  }

  async listTripwires(filters?: {
    path?: string;
    tag?: string;
    severity?: Severity;
    active?: boolean;
  }): Promise<TripwireFile[]> {
    let tripwires = await this.getTripwires();

    if (filters?.path) {
      const filterPath = filters.path;
      tripwires = tripwires.filter((t) => matchPath(filterPath, t.triggers, this.matchOptions).matches);
    }
    if (filters?.tag) {
      const filterTag = filters.tag;
      tripwires = tripwires.filter((t) => t.tags.includes(filterTag));
    }
    if (filters?.severity) {
      tripwires = tripwires.filter((t) => t.severity === filters.severity);
    }

    return tripwires;
  }

  async deactivateTripwire(name: string): Promise<TripwireFile> {
    const filePath = path.join(this.tripwiresDir, `${name}.yml`);

    let raw: string;
    try {
      raw = await this.fs.readFile(filePath);
    } catch {
      throw new TripwireError(
        `Tripwire not found: ${name}`,
        TripwireErrorCode.TRIPWIRE_NOT_FOUND,
      );
    }

    const parsed = parseYaml(raw) as Record<string, unknown>;
    parsed.active = false;

    await this.fs.writeFile(filePath, stringifyYaml(parsed));
    this.invalidateCache();

    const result = validateTripwire(parsed, `${name}.yml`);
    if (!result.data) {
      throw new TripwireError(
        `Tripwire "${name}" has invalid data after deactivation`,
        TripwireErrorCode.SCHEMA_VALIDATION_ERROR,
      );
    }
    return { ...result.data, name, filePath, active: false };
  }

  async lint(options?: {
    strict?: boolean;
    prune?: boolean;
  }): Promise<LintResult[]> {
    const results: LintResult[] = [];
    const dirExists = await this.fs.exists(this.tripwiresDir);

    if (!dirExists) {
      results.push({
        file: this.config.tripwires_dir,
        level: "warning",
        message: "Tripwires directory does not exist. Run 'tripwire init'.",
      });
      return results;
    }

    const ymlFiles = await this.fs.glob("*.yml", { cwd: this.tripwiresDir });
    const seenNames = new Set<string>();

    for (const fileName of ymlFiles) {
      const filePath = path.join(this.tripwiresDir, fileName);
      let raw: string;

      try {
        raw = await this.fs.readFile(filePath);
      } catch (err) {
        results.push({ file: fileName, level: "error", message: `Cannot read: ${err}` });
        continue;
      }

      let parsed: unknown;
      try {
        parsed = parseYaml(raw);
      } catch (err) {
        results.push({ file: fileName, level: "error", message: `Invalid YAML: ${err}` });
        continue;
      }

      const validation = validateTripwire(parsed, fileName);
      if (!validation.success || !validation.data) {
        for (const e of validation.errors) {
          results.push({ file: e.file, level: "error", message: e.message });
        }
        continue;
      }

      const tripwire = validation.data;

      // Check for expired tripwires
      if (tripwire.expires && tripwire.expires < new Date()) {
        if (options?.prune) {
          await this.fs.writeFile(
            filePath,
            stringifyYaml({ ...(parsed as object), active: false }),
          );
          results.push({ file: fileName, level: "warning", message: "Expired — deactivated" });
        } else {
          results.push({ file: fileName, level: "warning", message: "Tripwire has expired" });
        }
      }

      // Check for empty triggers
      if (tripwire.triggers.length === 0) {
        results.push({ file: fileName, level: "error", message: "No trigger patterns defined" });
      }

      // created_by is required in all tripwires
      const rawObj = parsed as Record<string, unknown>;
      if (!rawObj.created_by) {
        results.push({ file: fileName, level: "error", message: "Missing created_by — required (e.g. human, agent:claude)" });
      } else {
        const cb = String(rawObj.created_by);

        // Strict: validate created_by format (error, not warning — canonical values are required)
        if (options?.strict) {
          const validFormat = cb === "human" || /^agent:[a-z0-9-]+$/.test(cb) || /^tool:[a-z0-9-]+$/.test(cb);
          if (!validFormat) {
            results.push({ file: fileName, level: "error", message: `created_by "${cb}" — must be "human", "agent:<client>", or "tool:<name>"` });
          }
        }

        // Agent-authored tripwires must include learned_from when required
        if (cb.startsWith("agent:") && this.config.require_learned_from && !rawObj.learned_from) {
          results.push({ file: fileName, level: "error", message: `Agent-authored tripwire missing learned_from (required by config)` });
        }

        // Agent-authored tripwires must have expires when auto_expire_days > 0
        if (cb.startsWith("agent:") && this.config.auto_expire_days > 0 && !rawObj.expires) {
          results.push({ file: fileName, level: "error", message: `Agent-authored tripwire missing expires (auto_expire_days is ${this.config.auto_expire_days}). Add "expires: YYYY-MM-DD" or set auto_expire_days: 0` });
        }
      }

      // Validate tag names — lowercase alphanumeric + hyphens, max 32 chars
      // Tags are rendered as unescaped CSV in injection headers, so must be unambiguous
      for (const tag of tripwire.tags) {
        if (!/^[a-z0-9][a-z0-9-]{0,31}$/.test(tag)) {
          results.push({ file: fileName, level: "error", message: `Invalid tag "${tag}" — must match /^[a-z0-9][a-z0-9-]{0,31}$/ (lowercase, hyphens, max 32 chars)` });
        }
      }

      // Check for duplicate names (case-insensitive)
      const canonicalName = path.basename(fileName, ".yml").toLowerCase();
      if (seenNames.has(canonicalName)) {
        results.push({ file: fileName, level: "error", message: `Duplicate tripwire name: ${canonicalName}` });
      }
      seenNames.add(canonicalName);
    }

    // Cross-tripwire checks (only with --strict)
    if (options?.strict) {
      const activeTripwires = await this.getTripwires();

      // Detect identical trigger sets
      const triggerMap = new Map<string, string[]>();
      for (const tw of activeTripwires) {
        const key = [...tw.triggers].sort().join("\0");
        const existing = triggerMap.get(key);
        if (existing) {
          existing.push(tw.name);
        } else {
          triggerMap.set(key, [tw.name]);
        }
      }
      for (const [, names] of triggerMap) {
        if (names.length > 1) {
          results.push({
            file: ".tripwires/",
            level: "warning",
            message: `Identical triggers: ${names.join(", ")} — may inject conflicting context`,
          });
        }
      }

      // Path-scoped critical overlap: scan project files for >1 critical match
      // Enumeration: glob("**"), exclude config exclude_paths, sort ASC, cap at 5000.
      // Note: fast-glob does NOT honor .gitignore — exclude_paths is the only filter.
      const criticals = activeTripwires.filter((tw) => tw.severity === "critical");
      if (criticals.length > 1) {
        try {
          const allFiles = await this.fs.glob("**", { cwd: this.projectRoot });
          const nonExcluded = allFiles.filter((f) => !this.isExcluded(f)).sort().slice(0, 5000);
          const overlaps = new Map<string, string[]>();
          for (const file of nonExcluded) {
            const matchingCriticals = criticals.filter(
              (tw) => matchPath(file, tw.triggers, this.matchOptions).matches,
            );
            if (matchingCriticals.length > 1) {
              const key = matchingCriticals.map((t) => t.name).sort().join("+");
              if (!overlaps.has(key)) {
                overlaps.set(key, matchingCriticals.map((t) => t.name));
              }
            }
          }
          for (const [, names] of overlaps) {
            results.push({
              file: ".tripwires/",
              level: "warning",
              message: `Critical overlap: ${names.join(", ")} — these critical tripwires match the same files`,
            });
          }
        } catch {
          // If glob fails (e.g. permission issues), skip overlap check
        }
      }

      // Warn if any critical tripwire exceeds max_context_length (would be suppressed)
      if (this.config.max_context_length > 0) {
        for (const tw of activeTripwires) {
          if (tw.severity === "critical" && tw.context.length > this.config.max_context_length) {
            results.push({
              file: `${tw.name}.yml`,
              level: "warning",
              message: `Critical tripwire "${tw.name}" context (${tw.context.length} chars) exceeds max_context_length (${this.config.max_context_length}) — will be suppressed`,
            });
          }
        }
      }

      // Warn on individual tripwires with large context
      for (const tw of activeTripwires) {
        if (tw.context.length > 4000) {
          results.push({
            file: `${tw.name}.yml`,
            level: "warning",
            message: `Context field is ${tw.context.length} chars — consider splitting into multiple tripwires`,
          });
        }
      }

      // Warn if aggregate context across all tripwires is large
      const totalContextSize = activeTripwires.reduce((sum, tw) => sum + tw.context.length, 0);
      if (totalContextSize > 16000) {
        results.push({
          file: ".tripwires/",
          level: "warning",
          message: `Aggregate context: ${totalContextSize} chars across ${activeTripwires.length} tripwires — large injections increase cost and may be truncated by clients`,
        });
      }
    }

    return results;
  }

  async getStats(): Promise<TripwireStats> {
    const cache = await this.ensureLoaded();
    const allFiles = cache.files;

    // Also load inactive/expired for full stats
    const dirExists = await this.fs.exists(this.tripwiresDir);
    if (!dirExists) {
      return {
        total: 0, active: 0, inactive: 0, expired: 0,
        bySeverity: { info: 0, warning: 0, high: 0, critical: 0 },
        byTag: {}, byCreator: {},
      };
    }

    const ymlFiles = await this.fs.glob("*.yml", { cwd: this.tripwiresDir });
    const total = ymlFiles.length;
    let inactive = 0;
    let expired = 0;

    const bySeverity: Record<Severity, number> = { info: 0, warning: 0, high: 0, critical: 0 };
    const byTag: Record<string, number> = {};
    const byCreator: Record<string, number> = {};

    for (const tw of allFiles) {
      bySeverity[tw.severity]++;
      for (const tag of tw.tags) {
        byTag[tag] = (byTag[tag] || 0) + 1;
      }
      const creator = tw.created_by ?? "unknown";
      byCreator[creator] = (byCreator[creator] || 0) + 1;
    }

    // Count inactive/expired from raw files
    for (const fileName of ymlFiles) {
      const filePath = path.join(this.tripwiresDir, fileName);
      try {
        const raw = await this.fs.readFile(filePath);
        const parsed = parseYaml(raw) as Record<string, unknown>;
        if (parsed.active === false) inactive++;
        if (parsed.expires && new Date(parsed.expires as string) < new Date()) expired++;
      } catch {
        // Skip unparseable files
      }
    }

    return {
      total,
      active: allFiles.length,
      inactive,
      expired,
      bySeverity,
      byTag,
      byCreator,
    };
  }

  private toRelative(filePath: string): string {
    if (path.isAbsolute(filePath)) {
      return path.relative(this.projectRoot, filePath);
    }
    return filePath;
  }

  private toAbsolute(filePath: string): string {
    if (path.isAbsolute(filePath)) return filePath;
    return path.join(this.projectRoot, filePath);
  }

  private isExcluded(relativePath: string): boolean {
    return matchPath(relativePath, this.config.exclude_paths, this.matchOptions).matches;
  }
}

/**
 * Normalize a tripwire name to a canonical form: lowercase, a-z0-9 and hyphens only.
 * Spaces and underscores become hyphens. Consecutive hyphens collapsed.
 */
function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "");
}

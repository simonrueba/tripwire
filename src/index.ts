export { TripwireEngine, type TripwireEngineOptions } from "./engine/index.js";
export { matchPath } from "./engine/matcher.js";
export { formatContext, injectContext } from "./engine/injector.js";
export { loadTripwireFiles } from "./engine/loader.js";
export { resolveDependencies } from "./engine/resolver.js";
export { RealFileSystem, type IFileSystem, type FileStat } from "./io/fs-adapter.js";
export type {
  Severity,
  Tripwire,
  TripwireFile,
  MatchResult,
  LintResult,
  TripwireStats,
  ExplainMatch,
  ExplainDependency,
  ExplainSuppressed,
  ExplainResult,
} from "./types/index.js";
export type { TripwireConfig } from "./types/index.js";
export { TripwireError, TripwireErrorCode } from "./types/index.js";

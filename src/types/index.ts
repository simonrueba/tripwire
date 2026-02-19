export {
  SeveritySchema,
  SEVERITY_ORDER,
  TripwireSchema,
  type Severity,
  type Tripwire,
  type TripwireFile,
  type MatchResult,
  type ValidationError,
  type LintResult,
  type TripwireStats,
  type ExplainMatch,
  type ExplainDependency,
  type ExplainSuppressed,
  type ExplainResult,
} from "./tripwire.js";

export {
  TripwireConfigSchema,
  DEFAULT_CONFIG,
  type TripwireConfig,
} from "./config.js";

export { TripwireError, TripwireErrorCode } from "./errors.js";

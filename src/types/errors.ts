export enum TripwireErrorCode {
  TRIPWIRES_DIR_NOT_FOUND = "TRIPWIRES_DIR_NOT_FOUND",
  YAML_PARSE_ERROR = "YAML_PARSE_ERROR",
  SCHEMA_VALIDATION_ERROR = "SCHEMA_VALIDATION_ERROR",
  FILE_NOT_FOUND = "FILE_NOT_FOUND",
  TRIPWIRE_NOT_FOUND = "TRIPWIRE_NOT_FOUND",
  DEPENDENCY_CYCLE = "DEPENDENCY_CYCLE",
  AGENT_CREATE_DISABLED = "AGENT_CREATE_DISABLED",
  CONFIG_PARSE_ERROR = "CONFIG_PARSE_ERROR",
}

export class TripwireError extends Error {
  constructor(
    message: string,
    public readonly code: TripwireErrorCode,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "TripwireError";
  }
}

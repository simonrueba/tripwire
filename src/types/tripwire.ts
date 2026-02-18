import { z } from "zod/v4";

export const SeveritySchema = z.enum(["info", "warning", "high", "critical"]);
export type Severity = z.infer<typeof SeveritySchema>;

export const SEVERITY_ORDER: Record<Severity, number> = {
  critical: 0,
  high: 1,
  warning: 2,
  info: 3,
};

export const TripwireSchema = z.object({
  triggers: z.array(z.string()).min(1, "At least one trigger pattern is required"),
  context: z.string().min(1, "Context must not be empty"),
  severity: SeveritySchema.default("warning"),
  created_by: z.string().default("human"),
  learned_from: z.string().optional(),
  tags: z.array(z.string()).default([]),
  expires: z.coerce.date().optional(),
  depends_on: z.array(z.string()).default([]),
  active: z.boolean().default(true),
});

export type Tripwire = z.infer<typeof TripwireSchema>;

export interface TripwireFile extends Tripwire {
  /** Filename without extension, used as identifier */
  name: string;
  /** Absolute path to the .yml file on disk */
  filePath: string;
}

export interface MatchResult {
  tripwire: TripwireFile;
  matchedTriggers: string[];
  dependencies: TripwireFile[];
}

export interface ValidationError {
  file: string;
  message: string;
}

export interface LintResult {
  file: string;
  level: "error" | "warning";
  message: string;
}

export interface TripwireStats {
  total: number;
  active: number;
  inactive: number;
  expired: number;
  bySeverity: Record<Severity, number>;
  byTag: Record<string, number>;
  byCreator: Record<string, number>;
}

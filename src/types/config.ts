import { z } from "zod/v4";

export const TripwireConfigSchema = z.object({
  inject_mode: z.enum(["prepend", "metadata"]).default("prepend"),
  separator: z.string().default("\n---\n"),
  max_context_length: z.number().int().min(0).default(0),
  allow_agent_create: z.boolean().default(true),
  require_learned_from: z.boolean().default(true),
  auto_expire_days: z.number().int().min(0).default(90),
  exclude_paths: z.array(z.string()).default(["node_modules/**", "dist/**", ".git/**"]),
  tripwires_dir: z.string().default(".tripwires"),
  max_dependency_depth: z.number().int().min(1).max(10).default(5),
});

export type TripwireConfig = z.infer<typeof TripwireConfigSchema>;

export const DEFAULT_CONFIG: TripwireConfig = TripwireConfigSchema.parse({});

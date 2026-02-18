import { TripwireSchema } from "../types/tripwire.js";
import type { Tripwire, ValidationError } from "../types/tripwire.js";

export interface ValidateResult {
  success: boolean;
  data?: Tripwire;
  errors: ValidationError[];
}

export function validateTripwire(
  data: unknown,
  fileName: string,
): ValidateResult {
  const result = TripwireSchema.safeParse(data);

  if (result.success) {
    return { success: true, data: result.data, errors: [] };
  }

  const errors: ValidationError[] = result.error.issues.map((issue) => ({
    file: fileName,
    message: `${issue.path.join(".")}: ${issue.message}`,
  }));

  return { success: false, errors };
}

import * as path from "node:path";
import { parse as parseYaml } from "yaml";
import type { IFileSystem } from "../io/fs-adapter.js";
import type { TripwireFile, ValidationError } from "../types/tripwire.js";
import { validateTripwire } from "./validator.js";

export interface LoadResult {
  files: TripwireFile[];
  errors: ValidationError[];
}

export async function loadTripwireFiles(
  tripwiresDir: string,
  fs: IFileSystem,
): Promise<LoadResult> {
  const dirExists = await fs.exists(tripwiresDir);
  if (!dirExists) {
    return { files: [], errors: [] };
  }

  const ymlFiles = await fs.glob("*.yml", { cwd: tripwiresDir });
  const files: TripwireFile[] = [];
  const errors: ValidationError[] = [];

  for (const fileName of ymlFiles) {
    const filePath = path.join(tripwiresDir, fileName);
    const name = path.basename(fileName, ".yml");

    let raw: string;
    try {
      raw = await fs.readFile(filePath);
    } catch (err) {
      errors.push({ file: fileName, message: `Failed to read: ${err}` });
      continue;
    }

    let parsed: unknown;
    try {
      parsed = parseYaml(raw);
    } catch (err) {
      errors.push({ file: fileName, message: `Invalid YAML: ${err}` });
      continue;
    }

    const result = validateTripwire(parsed, fileName);
    if (!result.success || !result.data) {
      errors.push(...result.errors);
      continue;
    }

    const tripwire = result.data;

    // Skip inactive tripwires
    if (!tripwire.active) continue;

    // Skip expired tripwires
    if (tripwire.expires && tripwire.expires < new Date()) continue;

    files.push({ ...tripwire, name, filePath });
  }

  return { files, errors };
}

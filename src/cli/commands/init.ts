import * as path from "node:path";
import { RealFileSystem } from "../../io/fs-adapter.js";

const EXAMPLE_TRIPWIRE = `# Example tripwire — edit or delete this file
triggers:
  - "src/**"

context: |
  This is an example tripwire. Edit .tripwires/example.yml to customize,
  or delete it and create your own tripwires.

severity: info
created_by: human
tags:
  - example
`;

export async function initAction(options: { force?: boolean }): Promise<void> {
  const fs = new RealFileSystem();
  const tripwiresDir = path.join(process.cwd(), ".tripwires");

  const exists = await fs.exists(tripwiresDir);
  if (exists && !options.force) {
    console.log(".tripwires/ already exists. Use --force to overwrite.");
    return;
  }

  await fs.mkdir(tripwiresDir, { recursive: true });
  await fs.writeFile(path.join(tripwiresDir, "example.yml"), EXAMPLE_TRIPWIRE);

  console.log("Created .tripwires/ with example.yml");
  console.log("Edit the example or create new .yml files to define tripwires.");
}

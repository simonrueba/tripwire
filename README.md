# Tripwire

**Context injection for AI agents, triggered by the codebase itself.**

Tripwire is a local MCP server that auto-injects relevant context when an agent reads files in your project. Define tripwires on paths — when an agent steps on one, it gets the knowledge it needs before it can do damage.

Agents don't know what they don't know. Tripwire fixes that.

```
Agent opens payments/stripe.py
  → Tripwire fires
  → Context injected: "All secrets from vault. Never hardcode keys. See docs/security/secrets.md"
  → Agent proceeds with the right context, without having to ask
```

---

## How It Works

1. **Tripwires live in your repo** as small YAML files in `.tripwires/`
2. **The MCP server watches file reads** and glob-matches against tripwire triggers
3. **Matched context is prepended** to the file content — invisible to the developer, automatic for the agent
4. **Agents author new tripwires** when they make mistakes and get corrected
5. **Everything syncs via git** — tripwires travel with the code, get reviewed in PRs, and propagate across the team

No external services. No databases. No setup beyond starting the server.

---

## Installation

```bash
npm install -g tripwire
```

Or add to your project locally:

```bash
npm install --save-dev tripwire
```

### Connect to your editor

**Claude Code** — add to `.mcp.json`:
```json
{
  "mcpServers": {
    "tripwire": {
      "command": "tripwire",
      "args": ["serve", "--project", "."]
    }
  }
}
```

**Cursor** — add to `.cursor/mcp.json` with the same config.

**Any MCP-compatible client** — Tripwire speaks standard MCP over stdio.

---

## Quickstart

### Initialize in your project

```bash
cd your-project
tripwire init
```

Creates a `.tripwires/` directory with a starter example.

### Define your first tripwire

```yaml
# .tripwires/no-hardcoded-secrets.yml
triggers:
  - "payments/**"
  - "billing/**"
  - "**/stripe*.py"

context: |
  CRITICAL: Never hardcode API keys or secrets in this module.
  All credentials must be loaded from the vault service.
  See docs/security/secrets-policy.md for the approved pattern.

severity: critical
created_by: human
```

That's it. Any agent reading files matching those globs now receives this context automatically.

### Let agents learn

When an agent makes a mistake and you correct it, the agent can create a tripwire to prevent the same mistake in future sessions:

```yaml
# .tripwires/api-v1-versioning.yml
triggers:
  - "src/api/v1/**"

context: |
  This is a frozen API version. Do not modify existing endpoint
  signatures or response shapes. Add new functionality to v2 only.
  Breaking changes here will fail the contract test suite.

severity: high
created_by: claude
learned_from: "Changed a v1 response field, broke 3 downstream consumers"
```

---

## Tripwire Format

Each `.yml` file in `.tripwires/` defines one tripwire:

```yaml
# Required
triggers:           # Glob patterns matched against file paths (relative to repo root)
  - "src/auth/**"
  - "middleware/auth*.ts"
context: |          # Free-text context injected when triggered (markdown supported)
  The auth module uses session-based auth, NOT JWT.
  See ADR-012 for the migration rationale.

# Optional
severity: info | warning | high | critical    # Default: warning
created_by: human | <agent-name>               # Who authored this tripwire
learned_from: "..."                            # What mistake prompted this (agent-authored)
tags:                                          # For filtering and organization
  - security
  - architecture
expires: 2026-06-01                            # Auto-remove after this date
depends_on:                                    # Other tripwires that must also fire
  - no-hardcoded-secrets
```

### Glob patterns

Tripwire uses standard glob syntax:

| Pattern | Matches |
|---|---|
| `src/auth/**` | Any file under `src/auth/`, any depth |
| `*.sql` | SQL files in root |
| `**/*.sql` | SQL files anywhere |
| `src/api/v{1,2}/**` | Files in v1 or v2 API directories |
| `!**/*.test.ts` | Exclude test files (prefix with `!`) |

---

## MCP Tools

The server exposes these tools to connected agents:

### `read_file`

Drop-in replacement for standard file reading. Checks tripwires and prepends matched context.

```
Agent calls: read_file("src/auth/login.ts")
Returns:     [TRIPWIRE:high] auth-session-based (security)
             The auth module uses session-based auth...
             ---
             <actual file contents>
```

### `create_tripwire`

Allows agents to author new tripwires. Creates a `.yml` file in `.tripwires/`.

```json
{
  "name": "db-migration-checklist",
  "triggers": ["migrations/**"],
  "context": "Always run migrations against a copy of prod data first...",
  "severity": "high",
  "learned_from": "Migration #47 corrupted the users table in staging"
}
```

### `list_tripwires`

Returns all active tripwires, optionally filtered by path, tag, or severity.

### `check_tripwires`

Given a file path, returns which tripwires would fire — useful for agents to preview before reading.

### `deactivate_tripwire`

Soft-disables a tripwire without deleting the file. Adds `active: false` to the YAML.

---

## CLI

```bash
tripwire serve [--project <path>]                   # Start MCP server (stdio by default)
tripwire init [--force]                              # Initialize .tripwires/ in current directory
tripwire check <filepath>                            # Show which tripwires match a file
tripwire list [--tag <tag>] [--severity <level>]     # List all tripwires
tripwire lint [--strict] [--prune]                   # Validate all tripwire YAML files
tripwire stats [--json]                              # Show tripwire coverage and statistics
```

---

## Git Integration

Tripwires are plain files in `.tripwires/`. They diff, merge, and review like code.

### Recommended workflow

1. Agent creates a tripwire after a correction → appears in `git diff`
2. Developer reviews in PR — accepts, edits, or rejects the tripwire
3. Merged tripwires propagate to the whole team on next pull
4. Expired tripwires get cleaned up with `tripwire lint --prune`

### `.gitattributes` (optional)

```
.tripwires/*.yml merge=union
```

Reduces merge conflicts when multiple agents create tripwires in parallel.

### Pre-commit hook (optional)

```bash
tripwire lint --strict
```

Validates all tripwire files before commit — catches malformed YAML, invalid globs, and duplicate triggers.

---

## Configuration

Optional `.tripwirerc.yml` in project root:

```yaml
# Injection behavior
inject_mode: prepend          # prepend | metadata  (metadata = structured, not inline)
separator: "\n---\n"          # Separator between injected context and file content
max_context_length: 2000      # Truncate injected context beyond this (chars)

# Agent authoring
allow_agent_create: true      # Let agents create tripwires via MCP
require_learned_from: true    # Agents must explain what mistake prompted the tripwire
auto_expire_days: 90          # Default expiry for agent-authored tripwires

# Filtering
exclude_paths:                # Never check tripwires for these paths
  - "node_modules/**"
  - "dist/**"
  - ".git/**"
```

---

## Design Principles

**The codebase is the source of truth, not agent memory.** Tripwire externalizes knowledge into the repo so it survives across sessions, agents, and team members.

**Knowledge finds the agent.** Agents don't need to know what to look up. The right context arrives at the right time, triggered by what they're actually doing.

**Git is the sync layer.** No proprietary storage, no cloud dependency. Tripwires travel with the code and go through the same review process.

**Humans curate, agents accumulate.** Agents create tripwires from mistakes. Humans review and prune them. The system gets smarter over time without manual upkeep.

**Flat files over clever abstractions.** Anyone can open a YAML file and understand what a tripwire does. No databases, no embeddings, no query languages.

---

## Examples

### Prevent common mistakes

```yaml
# .tripwires/no-orm-raw-sql.yml
triggers:
  - "src/models/**"
context: |
  Use the ORM for all queries. Raw SQL is not allowed in model files
  due to SQL injection risk. If you need a complex query, add it to
  src/queries/ with parameterized statements.
severity: high
```

### Enforce architectural decisions

```yaml
# .tripwires/event-driven-orders.yml
triggers:
  - "src/orders/**"
  - "src/inventory/**"
context: |
  Orders and Inventory communicate via events only (see src/events/).
  Never import directly between these modules.
  ADR-007 has the full rationale.
severity: critical
tags: [architecture]
```

### Preserve tribal knowledge

```yaml
# .tripwires/csv-export-encoding.yml
triggers:
  - "src/export/**"
context: |
  Japanese customers require Shift-JIS encoding for CSV exports.
  UTF-8 with BOM also works but some older Excel versions on
  Windows JP break. Always test with the fixtures in test/fixtures/jp/.
severity: warning
created_by: claude
learned_from: "Generated UTF-8 CSVs that showed garbled text for JP users"
```

### Temporary guardrails

```yaml
# .tripwires/frozen-for-audit.yml
triggers:
  - "src/billing/**"
  - "src/compliance/**"
context: |
  These modules are frozen during the Q1 audit (ends 2026-03-15).
  Do not modify without explicit approval from @finance-team.
severity: critical
expires: 2026-03-15
tags: [temporary, compliance]
```

---

## Roadmap

- [ ] **Stale detection** — flag tripwires whose triggered files have changed significantly since creation
- [ ] **Firing analytics** — track which tripwires fire most, which never fire (candidates for removal)
- [ ] **Cascading tripwires** — tripwire A fires → also inject tripwire B
- [ ] **Semantic matching** — match on file content/intent, not just path globs
- [ ] **Editor integration** — show tripwire indicators in VS Code gutter
- [ ] **`tripwire suggest`** — analyze git blame and PR comments to propose tripwires automatically

---

## License

MIT

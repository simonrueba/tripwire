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
npm install -g @simonrueba/tripwire
```

Or add to your project locally:

```bash
npm install --save-dev @simonrueba/tripwire
```

Requires **Node.js >= 18**.

### Connect to your editor

**Claude Code** — add to `.mcp.json`:
```json
{
  "mcpServers": {
    "tripwire": {
      "command": "npx",
      "args": ["-y", "@simonrueba/tripwire", "serve", "--project", "."]
    }
  }
}
```

**Cursor** — add to `.cursor/mcp.json` with the same config. Note: Cursor does not support PreToolUse hooks, so enforcement requires agents to choose the Tripwire tool (see [Cursor Strategy](#cursor-strategy)).

**Any MCP-compatible client** — Tripwire speaks standard MCP over stdio.

### Recommended team setup

Install as a dev dependency so everyone gets the same version:

```bash
npm install --save-dev @simonrueba/tripwire
```

Add scripts to `package.json`:

```json
{
  "scripts": {
    "tripwire": "tripwire",
    "tripwire:lint": "tripwire lint --strict",
    "tripwire:doctor": "tripwire doctor"
  }
}
```

Then point `.mcp.json` at the local install (no `-y` needed):

```json
{
  "mcpServers": {
    "tripwire": {
      "command": "npx",
      "args": ["tripwire", "serve", "--project", "."]
    }
  }
}
```

For a complete working setup, see [`examples/hello-tripwire/`](examples/hello-tripwire/).

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

### Naming conventions

**Tripwire names** are derived from the YAML filename and normalized to `a-z`, `0-9`, and hyphens. Spaces and underscores become hyphens. Names are case-insensitive — `No_Raw_SQL.yml` becomes `no-raw-sql`. `tripwire lint` checks for duplicate names.

**Tags** are a comma-separated list. Commas are not allowed inside a tag name. When rendered in injection headers: `tags="security,architecture"`.

---

## Behavior Specification

This section documents the exact runtime semantics. Useful for debugging, writing tests, or building alternative clients.

### Path matching

Tripwire uses [micromatch](https://github.com/micromatch/micromatch) for glob matching.

**Normalization:** Before matching, paths are normalized: backslashes become forward slashes, leading `./` is stripped. Matching uses `dot: true` (dotfiles match `**`).

**Positive vs. negation patterns:**
- Positive patterns (e.g. `src/auth/**`) match files for inclusion.
- Negation patterns start with `!` (e.g. `!**/*.test.ts`) and exclude files that would otherwise match.
- A path matches if it matches **at least one** positive pattern AND **zero** negation patterns.
- If **all** patterns are negation, an implicit `**` positive pattern is added (i.e. "match everything except...").

### Ordering

When multiple tripwires match a path, they are sorted deterministically:

1. **Severity descending:** critical (0) > high (1) > warning (2) > info (3)
2. **Name ascending** (alphabetical) within the same severity

This order determines both the injection sequence and which tripwires survive truncation.

### Truncation

When `max_context_length > 0`, Tripwire enforces a context budget:

- **Whole-tripwire granularity** — a tripwire block is either fully included or fully omitted. Context is never cut mid-block.
- **Budget includes dependencies** — dependency blocks count toward the same budget.
- **Higher severity wins** — because tripwires are sorted by severity first, critical/high tripwires are always included before warning/info.
- **Suppressed block** — when tripwires are omitted, a `<<<TRIPWIRE_SUPPRESSED count="N" reason="context_budget">>>` block lists exactly what was dropped, so agents know context was withheld.

### Dependencies

Tripwires can declare `depends_on: [name1, name2]` to pull in other tripwires' context when they fire.

- **Transitive resolution** — dependencies are resolved transitively up to `max_dependency_depth` (default: 5).
- **Cycle detection** — a visited-set tracks the walk. If a cycle is detected, a warning is emitted and the cycle edge is skipped.
- **Missing dependencies** — if a named dependency doesn't exist, a warning is emitted and resolution continues.
- **Deduplication** — each dependency is included at most once, even if referenced by multiple parents.
- **Rendering** — dependencies are rendered as `<<<TRIPWIRE ... name="parentName/dep:depName">>>` to distinguish them from direct matches.

---

## MCP Tools

The server exposes these tools to connected agents:

### `read_file`

Drop-in replacement for standard file reading. Checks tripwires and prepends matched context.

```
Agent calls: read_file("src/auth/login.ts")
Returns:
<<<TRIPWIRE severity="high" name="auth-session-based" tags="security">>>
The auth module uses session-based auth, NOT JWT.
See ADR-012 for the migration rationale.
<<<END_TRIPWIRE>>>

<<<TRIPWIRE_FILE_CONTENT>>>
<actual file contents>
```

**Injection format:** Context is wrapped in structured delimiters (`<<<TRIPWIRE>>>` / `<<<END_TRIPWIRE>>>`) for reliable LLM parsing. File content follows after a `<<<TRIPWIRE_FILE_CONTENT>>>` sentinel that cannot appear naturally in code. When tripwires are suppressed due to `max_context_length`, a `<<<TRIPWIRE_SUPPRESSED>>>` block lists exactly what was dropped.

**Injection modes:**
- `prepend` (default) — context + sentinel + file content in a single response. Universal compatibility; works even when clients flatten multi-block tool outputs.
- `metadata` — context and file content returned as separate response blocks. Cleaner separation but relies on the client preserving block boundaries.

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
tripwire doctor [--json]                             # Check enforcement setup
```

---

## Git Integration

Tripwires are plain files in `.tripwires/`. They diff, merge, and review like code.

### Recommended workflow

1. Agent creates a tripwire after a correction → appears in `git diff`
2. Developer reviews in PR — accepts, edits, or rejects the tripwire
3. Merged tripwires propagate to the whole team on next pull
4. Expired tripwires get cleaned up with `tripwire lint --prune`

**Security note:** Tripwires influence agent behavior. Treat them like code — review them in PRs, don't auto-merge agent-authored tripwires, and be especially careful with `critical` severity since it shapes how agents interact with sensitive modules.

### `.gitattributes` (advanced, optional)

```
.tripwires/*.yml merge=union
```

**Caveat:** `merge=union` auto-merges by keeping both sides line-by-line. This works well when two branches *add different tripwire files*, but can silently duplicate YAML keys if two branches edit the *same* tripwire. The safer default is normal merges with `tripwire lint --strict` in CI to catch any breakage. Only use `merge=union` if your team understands the trade-off.

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
separator: "\n<<<TRIPWIRE_FILE_CONTENT>>>\n"   # Sentinel between context and file content
max_context_length: 2000      # Truncate injected context beyond this (chars)

# Agent authoring
allow_agent_create: true      # Let agents create tripwires via MCP
require_learned_from: true    # Agents must explain what mistake prompted the tripwire
auto_expire_days: 90          # Default expiry for agent-authored tripwires

# Enforcement (Claude Code hooks)
enforcement_mode: strict      # strict = deny raw reads | advisory = allow with warning

# Filtering
exclude_paths:                # Never check tripwires for these paths
  - "node_modules/**"
  - "dist/**"
  - ".git/**"
```

### Config defaults

| Key | Type | Default | Notes |
|---|---|---|---|
| `inject_mode` | `"prepend"` \| `"metadata"` | `"prepend"` | metadata returns context and content as separate blocks |
| `separator` | string | `\n<<<TRIPWIRE_FILE_CONTENT>>>\n` | sentinel between context and file content |
| `max_context_length` | number | `0` (unlimited) | whole-tripwire truncation — never cuts mid-block |
| `allow_agent_create` | boolean | `true` | set `false` to block agent-authored tripwires |
| `require_learned_from` | boolean | `true` | agents must explain the mistake |
| `auto_expire_days` | number | `90` | 0 = no auto-expiry |
| `enforcement_mode` | `"strict"` \| `"advisory"` | `"strict"` | advisory allows raw reads with a warning |
| `exclude_paths` | string[] | `["node_modules/**", "dist/**", ".git/**"]` | never check tripwires for these |
| `tripwires_dir` | string | `".tripwires"` | directory containing YAML files |
| `max_dependency_depth` | number | `5` | max depth for `depends_on` chain resolution |

Unknown keys are silently ignored. Use `tripwire lint --strict` to catch config issues.

---

## Enforcement (Claude Code Hooks)

Without enforcement, an agent *can* bypass Tripwire by using the built-in `Read` tool instead of `mcp__tripwire__read_file`. A PreToolUse hook closes this gap by blocking raw reads and redirecting them through Tripwire.

> **Compatibility:** Enforcement hooks are currently **Claude Code-specific**. Cursor and other MCP clients will need their own mechanism to redirect reads. The MCP server itself is universal — only the enforcement layer is editor-specific.

### Setup

Tripwire ships with a ready-made hook. Copy both files into your project:

```
.claude/
  settings.json                  # Hook config: intercepts Read calls
  hooks/
    enforce-tripwire-read.mjs    # Denies raw reads, suggests tripwire read_file
```

No external dependencies required — the hook is pure Node.js.

### How it works

1. Agent calls `Read` (or `mcp__filesystem__read_file`) for a project file
2. Hook resolves the real path via `realpath` (prevents symlink/traversal bypass)
3. Hook verifies `.tripwires/` exists and `.mcp.json` has a `"tripwire"` server configured
4. If both conditions are met and the file isn't in an excluded directory, the hook denies the read
5. The deny message tells the agent the exact tool name and argument shape to use instead
6. Agent retries with `mcp__tripwire__read_file` — context is injected automatically

**Safety valves:**
- If `.tripwires/` doesn't exist, the hook does nothing (not a Tripwire project)
- If `.mcp.json` doesn't have a `"tripwire"` server, the hook allows the read (agent has no alternative — prevents loops)
- If the deny message includes: "If Tripwire MCP is not available, run: `tripwire doctor`"

**Excluded directories** (always allowed through `Read`): `.git/`, `node_modules/`, `dist/`, `.tripwires/`, `.claude/`.

### Enforcement modes

Set in `.tripwirerc.yml`:

| Mode | Behavior | Use case |
|---|---|---|
| `strict` (default) | Deny raw reads, force Tripwire | Production, established teams |
| `advisory` | Allow raw reads with a warning | Progressive adoption, evaluation |

### Verify

```bash
tripwire doctor
```

Checks all components and prints `ENFORCEMENT: ON`, `PARTIAL`, or `OFF` with actionable fix instructions.

### Important notes

- The MCP server key in `.mcp.json` **must** be `"tripwire"` so the tool name resolves to `mcp__tripwire__read_file`
- Enforcement is optional but strongly recommended — without it, Tripwire relies on the agent choosing the right tool

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

## Troubleshooting

Run `tripwire doctor` first — it checks all components and tells you exactly what's wrong.

| Symptom | Likely cause | Fix |
|---|---|---|
| No context injected | Agent used `Read` instead of `mcp__tripwire__read_file` | Enable enforcement hooks (see [Enforcement](#enforcement-claude-code-hooks)) |
| Context injected but hook not blocking | `.claude/settings.json` missing or wrong matcher | Run `tripwire doctor`, check hook config |
| Agent stuck in deny loop | Tripwire MCP server not loaded | Verify `.mcp.json` has `"tripwire"` key, restart session |
| `tripwire doctor` shows FAIL on MCP | `.mcp.json` missing or wrong server key | Server key **must** be `"tripwire"` (not `"tw"`, not `"tripwire-mcp"`) |
| Hook not firing at all | Settings file not loaded | Restart Claude Code session after creating `.claude/settings.json` |
| Works in Claude Code, not in Cursor | Cursor has no PreToolUse hooks | See [Cursor Strategy](#cursor-strategy) |

---

## Cursor Strategy

Tripwire's MCP server works in Cursor — agents can call `read_file`, `list_tripwires`, etc. The difference is **enforcement**: Cursor does not support PreToolUse hooks, so there's no way to block raw filesystem reads.

**Current behavior (v1):** Tripwire works when agents explicitly use Tripwire tools. No automatic enforcement.

**Workaround:** Configure Tripwire as the **only** filesystem-capable MCP server. If no other server provides `read_file`, agents must use Tripwire's version.

**Roadmap:** Tripwire as a full filesystem proxy — implement the minimal set of FS tools (`read`, `list`, `stat`, `search`) with injection on reads. This makes Tripwire the filesystem server with policies, eliminating bypass regardless of client.

---

## Roadmap

- [ ] **Filesystem proxy mode** — serve read/list/stat/search tools so Tripwire is the only FS provider
- [ ] **Stale detection** — flag tripwires whose triggered files have changed significantly since creation
- [ ] **Firing analytics** — track which tripwires fire most, which never fire (candidates for removal)
- [ ] **Semantic matching** — match on file content/intent, not just path globs
- [ ] **Editor integration** — show tripwire indicators in VS Code gutter
- [ ] **`tripwire suggest`** — analyze git blame and PR comments to propose tripwires automatically

---

## License

MIT

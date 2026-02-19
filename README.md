# Tripwire

**Context injection for AI agents, triggered by the codebase itself.**

Tripwire is a local MCP server that auto-injects relevant context when an agent reads files in your project. Define tripwires on paths — when an agent steps on one, it gets the knowledge it needs before it can do damage.

Agents don't know what they don't know. Tripwire fixes that.

> **Mental model:** Tripwires are path-based policies. They inject context into file reads. They are deterministic and repo-native. Enforcement depends on client support (hooks) or proxy mode.

```
Agent opens payments/stripe.py
  → Tripwire fires
  → Context injected: "All secrets from vault. Never hardcode keys. See docs/security/secrets.md"
  → Agent proceeds with the right context, without having to ask
```

---

## How It Works

1. **Tripwires live in your repo** as small YAML files in `.tripwires/`
2. **The MCP server handles file read tool calls** and glob-matches against tripwire triggers
3. **Matched context is prepended** to the file content — automatic for the agent, inspectable via `tripwire explain`
4. **Agents author new tripwires** when they make mistakes and get corrected
5. **Everything syncs via git** — tripwires travel with the code, get reviewed in PRs, and propagate across the team

No external services. No databases. No setup beyond starting the server.

> **Threat model:** Tripwires are a privileged instruction channel — a malicious tripwire can steer agents into introducing vulnerabilities. Tripwire is guidance/policy injection, not a permission system. Protect `.tripwires/` with CODEOWNERS, require CI review for all changes, and reject agent-authored `critical` tripwires without human approval. See [SECURITY.md](SECURITY.md) for the full threat model and CI recipes.

---

## Installation

Requires **Node.js >= 18**.

### Quick try (no install)

Add to `.mcp.json` and go:

```json
{
  "mcpServers": {
    "tripwire": {
      "command": "npx",
      "args": ["-y", "@tripwire-mcp/tripwire", "serve", "--project", "."]
    }
  }
}
```

For Cursor, use `.cursor/mcp.json` with the same config.

### Team setup (recommended)

Pin as a dev dependency so everyone gets the same version:

```bash
npm install --save-dev @tripwire-mcp/tripwire
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

Point `.mcp.json` at the local install (no `-y` needed):

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

### Alternative: global install

```bash
npm install -g @tripwire-mcp/tripwire
```

### Any MCP-compatible client

Tripwire speaks standard MCP over stdio. For a complete working setup, see [`examples/hello-tripwire/`](examples/hello-tripwire/).

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
created_by: agent:claude-code
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
created_by: human   # Who authored this (required — see format below)

# Optional
severity: info | warning | high | critical    # Default: warning (affects ordering only)
learned_from: "..."                            # Required if created_by starts with agent:
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

**`created_by`** is required. `tripwire lint` errors if missing. Canonical values:

| Value | Meaning |
|---|---|
| `human` | Hand-written by a developer |
| `agent:<client>` | Created via MCP tool (e.g. `agent:mcp`, `agent:claude-code`) |
| `tool:<name>` | Created by automation (e.g. `tool:ci-generate`) |

`lint --strict` errors on invalid format (bare `agent` or `tool` without a client name is invalid). The MCP `create_tripwire` tool sets `created_by: agent:mcp` automatically.

**Tags** are a YAML string array. Tag names must match `/^[a-z0-9][a-z0-9-]{0,31}$/` (lowercase alphanumeric + hyphens, max 32 chars). `tripwire lint` errors on invalid tags. In injection headers, tags are rendered as an unescaped comma-separated string: `tags="security,architecture"`. The tight regex makes escaping unnecessary.

---

## Behavior Specification

This section documents the exact runtime semantics. Useful for debugging, writing tests, or building alternative clients. If this document conflicts with implementation, the implementation is the source of truth until the next spec revision.

### Path matching

Tripwire uses [micromatch](https://github.com/micromatch/micromatch) for glob matching. Supports brace expansion (`{a,b}`) and negation (`!`).

**Case sensitivity:** Matching is case-sensitive by default (`match_case: true`). When `match_case: false`, matching is case-insensitive (defined as: both the normalized path and trigger patterns are compared without regard to case). On case-insensitive filesystems (macOS, Windows), path casing reported by tools may not match trigger casing — set `match_case: false` in `.tripwirerc.yml` to avoid mismatches.

**Normalization:** Before matching, paths are normalized: backslashes become forward slashes, leading `./` is stripped. Matching uses `dot: true` (dotfiles match `**`).

**Evaluation order:** Config `exclude_paths` is checked first. If a path is excluded, no tripwire evaluation happens — even if a tripwire's triggers would match. Within a tripwire, negation patterns (`!`) apply after positive patterns.

**Positive vs. negation patterns:**
- Positive patterns (e.g. `src/auth/**`) match files for inclusion.
- Negation patterns start with `!` (e.g. `!**/*.test.ts`) and exclude files that would otherwise match.
- A path matches if it matches **at least one** positive pattern AND **zero** negation patterns.
- If **all** patterns are negation, an implicit `**` positive pattern is added (i.e. "match everything except...").

### Ordering

When multiple tripwires match a path, they are sorted deterministically:

1. **Severity descending:** critical (0) > high (1) > warning (2) > info (3)
2. **Name ascending** (alphabetical) within the same severity

This order determines the evaluation and emission order of **root tripwire groups**. A group consists of the root tripwire plus its resolved dependencies (see Dependencies). Dependencies do not participate in global severity/name sorting; they are emitted as part of their root group.

**Severity affects ordering and truncation priority.** It does not enforce hard blocking or write gating. All matched groups are injected when budget allows — higher severity survives truncation first. The level also signals to the agent how seriously to treat the context.

### Truncation

When `max_context_length > 0`, Tripwire enforces a character budget on the injected context (not tokens — different clients may truncate independently). The separator and file content are not part of the budget.

**What counts toward the budget:** the fully rendered injection string — each block's header (`<<<TRIPWIRE ...>>>`), context body, footer (`<<<END_TRIPWIRE>>>`), and trailing newline. The suppression block itself is not counted.

- **Whole-tripwire granularity** — a tripwire block is either fully included or fully omitted. Context is never cut mid-block.
- **Budget includes dependencies** — dependency blocks count toward the same budget.
- **Best-effort in sort order** — groups are attempted in sorted order (root severity DESC, root name ASC). Higher-severity groups are attempted first but there is no hard guarantee they fit. If a single group exceeds the budget, it is suppressed — even if it's critical. **Recommended:** keep `max_context_length: 0` (unlimited, the default) for safety-critical repos where every tripwire must fire.
- **Suppressed block** — when groups are omitted, a `<<<TRIPWIRE_SUPPRESSED count="N" reason="context_budget">>>` block lists the root tripwire name and severity for each suppressed group. Dependencies suppressed as part of an atomic group are not listed individually — the root name identifies the group. **Suppressed entry format:** one line per suppressed root group: `<severity> <name>` (e.g. `critical billing-freeze`). The block ends with `<<<END_TRIPWIRE_SUPPRESSED>>>`.

### Dependencies

Tripwires can declare `depends_on: [name1, name2]` to pull in other tripwires' context when they fire.

- **Transitive resolution** — dependencies are resolved transitively up to `max_dependency_depth` (default: 5).
- **Cycle detection** — a visited-set tracks the walk. If a cycle is detected, a warning is emitted and the cycle edge is skipped.
- **Missing dependencies** — if a named dependency doesn't exist, a warning is emitted and resolution continues.
- **Global deduplication** — each dependency block appears at most once per response. A dependency is considered "already emitted" if its full `<<<TRIPWIRE ...>>> ... <<<END_TRIPWIRE>>>` block has been included in the rendered injection (suppression does not count as emission). If multiple root groups reference the same dependency, it is emitted **once** with the earliest root group in sort order; its `originator="<rootName>"` attribute reflects the root tripwire whose group first caused this dependency to be emitted.
- **Group construction** — for each matched root tripwire, a *group* is constructed: the dependency closure (DFS, traversed in `depends_on` list order) followed by the root. Groups are ordered by root severity DESC, then root name ASC. Within a group, dependencies appear in DFS traversal order (stable: sibling order matches `depends_on` declaration order).
- **Atomic truncation** — when `max_context_length > 0`, the entire group (deps + root) must fit within the remaining budget. If the group doesn't fit, all of it is suppressed — the root is never emitted without its dependencies. The group size is computed **after global deduplication**: dependencies already emitted by an earlier group are not re-counted and are not required for group fit. This is safe because dependencies are always emitted with the earliest root group in sort order, so any later root that references that dependency can omit it — the dependency block will appear earlier in the same response.
- **Rendering** — dependencies are rendered with `origin="dependency" originator="<rootName>"` attributes. `originator` is the root tripwire whose group first caused this dependency to be emitted. The `name` always matches the tripwire filename (e.g. `name="depName"`), never a synthetic composite.

### Conflicts

Tripwire does not attempt to resolve conflicts between contexts. If two tripwires match the same path and give contradictory instructions, both are injected and the agent sees both.

`tripwire lint` checks (always):
- Missing `created_by` field (error)
- Agent-authored tripwire (`created_by: agent:*`) missing `learned_from` when `require_learned_from` is true (error)
- Agent-authored tripwire (`created_by: agent:*`) missing `expires` when `auto_expire_days > 0` (error) — prevents handwritten `agent:*` entries from bypassing auto-expiry
- Invalid tag names — must match `/^[a-z0-9][a-z0-9-]{0,31}$/` (error)

`tripwire lint --strict` adds:
- **Identical trigger sets** (warning) — two tripwires whose sorted trigger arrays are equal (order-insensitive). Exact match, not overlap detection.
- **Critical overlap** (warning) — enumerates project files (glob `**`, files only, filtered by `exclude_paths`, sorted lexicographically, capped at 5000). `.gitignore` is not honored to keep lint results stable across environments; use `exclude_paths` to control scan scope. Warns if any file matches >1 `critical` tripwire. Reports the specific tripwire names.
- **`created_by` format** (error) — must be `human`, `agent:<client>`, or `tool:<name>`. Bare `agent` or `tool` without a client/tool name is invalid.
- **Individual context > 4 KB** (warning) — suggests splitting.
- **Aggregate context > 16 KB** (warning) — total across all tripwires.
- **Critical tripwire exceeds `max_context_length`** (warning) — will be suppressed at runtime.

`tripwire explain <path>` surfaces all matching tripwires for a given path, making conflicts visible before they cause problems.

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

**Delimiter format:**

```
<<<TRIPWIRE severity="<level>" name="<name>" [origin="dependency" originator="<rootName>"] [tags="<csv>"]>>>
<context text>
<<<END_TRIPWIRE>>>
```

| Attribute | Always present | Values |
|---|---|---|
| `severity` | yes | `info`, `warning`, `high`, `critical` |
| `name` | yes | tripwire filename without `.yml` |
| `origin` | only on dependencies | `dependency` |
| `originator` | only on dependencies | root tripwire whose group first caused this dependency to be emitted |
| `tags` | only if non-empty | comma-separated, no escaping (commas not allowed in tag names) |

File content follows after a `<<<TRIPWIRE_FILE_CONTENT>>>` sentinel (chosen to be unlikely in real code; if you need unambiguous separation, use `inject_mode: metadata`). When tripwires are suppressed, a `<<<TRIPWIRE_SUPPRESSED count="N" reason="context_budget">>>` block lists suppressed root groups as `<severity> <name>` lines and ends with `<<<END_TRIPWIRE_SUPPRESSED>>>`.

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
  "learned_from": "Migration #47 corrupted the users table in staging",
  "force": false
}
```

**Behavior:**
- The `name` is normalized to a canonical filename (`a-z`, `0-9`, hyphens only). `Db_Migration Checklist` becomes `db-migration-checklist.yml`.
- If a tripwire with the same normalized name already exists, the call **fails** (no silent overwrites). Pass `force: true` to overwrite, or delete/deactivate the existing tripwire first.
- The MCP tool sets `created_by: "agent:mcp"` automatically. Hand-written YAML must include `created_by` explicitly — there is no default; `tripwire lint` errors if missing.
- Overwrite is atomic (write to temp file, then rename).
- If `created_by` is not `"human"` and `auto_expire_days > 0`, an `expires` date is automatically added.
- If `require_learned_from` is `true` (default) and `created_by` starts with `agent:`, `learned_from` is required. `tripwire lint` enforces this.

### `list_tripwires`

Returns all active tripwires, optionally filtered by path, tag, or severity.

### `check_tripwires`

Given a file path, returns which tripwires would fire — useful for agents to preview before reading.

### `explain`

Given a file path, returns a structured breakdown of what would be injected and why: matched tripwires with their globs, resolved dependencies, suppressed entries, active config, and the full rendered injection. Useful for debugging.

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
tripwire explain <filepath> [--json]                 # Show what would be injected and why
```

---

## Git Integration

Tripwires are plain files in `.tripwires/`. They diff, merge, and review like code.

### Recommended workflow

1. Agent creates a tripwire after a correction → appears in `git diff`
2. Developer reviews in PR — accepts, edits, or rejects the tripwire
3. Merged tripwires propagate to the whole team on next pull
4. Expired tripwires get cleaned up with `tripwire lint --prune`

**Security note:** Tripwires influence agent behavior. Treat them like code — review them in PRs, don't auto-merge agent-authored tripwires, and be especially careful with `critical` severity since it shapes how agents interact with sensitive modules. See [SECURITY.md](SECURITY.md) for the full threat model, CODEOWNERS setup, and CI recipes.

### `.gitattributes` (advanced, optional)

```
.tripwires/*.yml merge=union
```

**Caveat:** `merge=union` auto-merges by keeping both sides line-by-line. This works well when two branches *add different tripwire files*, but can silently duplicate YAML keys if two branches edit the *same* tripwire. The safer default is normal merges with `tripwire lint --strict` in CI to catch any breakage. Only use `merge=union` if your team understands the trade-off.

### Recommended CI policy

1. **CODEOWNERS** — protect `.tripwires/**` so changes require review
2. **CI runs `tripwire lint --strict`** — catches missing `created_by`, format violations, critical overlaps
3. **Block agent-authored criticals** — fail CI if a diff touches a file with both `created_by: agent:*` and `severity: critical`. CODEOWNER approval is enforced separately via GitHub branch protection ("Require review from Code Owners"):
   ```bash
   BASE=$(git merge-base origin/main HEAD)
   FILES=$(git diff --name-only --diff-filter=ACMRT "$BASE"...HEAD -- .tripwires/ || true)
   [ -z "$FILES" ] && exit 0
   echo "$FILES" | while read -r f; do
     [ -f "$f" ] || continue
     grep -q '^severity:\s*critical\b' "$f" || continue
     grep -q '^created_by:\s*agent:' "$f" || continue
     echo "FAIL: $f is agent-authored critical (block by policy)"
     exit 1
   done
   ```

### Pre-commit hook (optional)

```bash
tripwire lint --strict
```

Validates all tripwire files before commit — catches malformed YAML, format violations, and critical overlaps.

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
| `separator` | string | `\n<<<TRIPWIRE_FILE_CONTENT>>>\n` | sentinel between context and file content — unlikely in normal source but could appear in heredocs, templates, or test fixtures that reference Tripwire itself |
| `max_context_length` | number | `0` (unlimited) | character budget (not tokens) — whole-tripwire truncation, never cuts mid-block |
| `allow_agent_create` | boolean | `true` | set `false` to block agent-authored tripwires |
| `require_learned_from` | boolean | `true` | agents must explain the mistake |
| `auto_expire_days` | number | `90` | 0 = no auto-expiry |
| `enforcement_mode` | `"strict"` \| `"advisory"` | `"strict"` | advisory allows raw reads with a warning |
| `exclude_paths` | string[] | `["node_modules/**", "dist/**", ".git/**"]` | never check tripwires for these |
| `tripwires_dir` | string | `".tripwires"` | directory containing YAML files |
| `max_dependency_depth` | number | `5` | max depth for `depends_on` chain resolution |
| `match_case` | boolean | `true` | set `false` for case-insensitive matching (recommended on macOS/Windows) |

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
created_by: human
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
created_by: human
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
created_by: agent:claude-code
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
created_by: human
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

## Filesystem Proxy Mode

Tripwire ships 4 filesystem tools so it can serve as the **sole FS provider** for MCP clients. Only `read_file` injects context — the other 3 are thin pass-throughs:

| Tool | Behavior |
|---|---|
| `read_file` | Checks tripwires, injects context, returns file content |
| `list_directory` | Lists entries in a directory (pass-through) |
| `file_stat` | Returns type, size, modified, created (pass-through) |
| `search_files` | Glob search for files (pass-through) |

Configure Tripwire as the only filesystem server. Agents discover available tools at connection time via MCP's `tools/list` — if no other server provides filesystem tools, agents must use Tripwire's versions and all reads get context injection automatically.

**Hard limitation:** Proxy mode only works if the client has no non-MCP file access enabled. If the client provides a native `Read` command, agents can bypass Tripwire by using that instead.

**How to close the gap per client:**
- **Claude Code** — has a native `Read` tool that bypasses MCP. Use enforcement hooks (PreToolUse) to deny raw reads. Proxy mode alone is not sufficient.
- **Cursor** — proxy mode covers reads that go through MCP tools. If Tripwire is the only server providing filesystem tools, this is sufficient. If Cursor has other read pathways (version-dependent), Tripwire can't intercept them. Disable other FS servers if present.
- **Other MCP clients** — check whether the client has built-in file access. If it does and there's no hook mechanism, proxy mode cannot enforce coverage. We don't yet know which clients support disabling native FS — if yours does, let us know.

### When to use proxy mode vs. hooks

| Approach | Best for | Limitation |
|---|---|---|
| **Enforcement hooks** | Claude Code (supports PreToolUse) | Client-specific |
| **Proxy mode** | Cursor, any MCP client | Must be the only FS server |
| **Both** | Maximum coverage | More setup |

---

## Cursor Strategy

Tripwire's MCP server works in Cursor — agents can call `read_file`, `list_tripwires`, etc. The difference is **enforcement**: Cursor does not support PreToolUse hooks, so there's no way to block raw filesystem reads.

**Recommended:** Use **filesystem proxy mode** — configure Tripwire as the only filesystem-capable MCP server. With `read_file`, `list_directory`, `file_stat`, and `search_files` available, agents have full FS access through Tripwire. If no other server provides filesystem tools, agents must use Tripwire's versions, and all reads get context injection automatically.

---

## Roadmap

- [x] **Filesystem proxy mode** — serve read/list/stat/search tools so Tripwire is the only FS provider
- [ ] **Stale detection** — flag tripwires whose triggered files have changed significantly since creation
- [ ] **Firing analytics** — track which tripwires fire most, which never fire (candidates for removal)
- [ ] **Semantic matching** — match on file content/intent, not just path globs
- [ ] **Editor integration** — show tripwire indicators in VS Code gutter
- [ ] **`tripwire suggest`** — analyze git blame and PR comments to propose tripwires automatically

---

## License

MIT

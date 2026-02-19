# Security

Tripwires are a **privileged prompt channel** — they steer agent behavior before the agent sees code. In terms of impact, a tripwire is equivalent to code: a malicious or careless tripwire can cause an agent to introduce vulnerabilities, skip tests, or exfiltrate data.

Treat `.tripwires/` with the same rigor you treat source code.

---

## Trust Model

| Actor | Trust level | What they can do |
|---|---|---|
| Human (committer) | High | Create/edit any tripwire, including `critical` severity |
| Agent (via `create_tripwire`) | Conditional | Create tripwires gated by `allow_agent_create`, `require_learned_from`, and `auto_expire_days` |
| Reviewer (PR) | Gatekeeper | Accept or reject tripwire changes before they reach `main` |

**Key invariant:** No tripwire reaches production without passing through code review, just like any other file in the repo.

---

## Threat Scenarios

### 1. Agent-authored tripwires without review

**Risk:** An agent creates a tripwire that subtly misdirects future agents (e.g. "always use eval() for dynamic imports").

**Mitigations:**
- Set `allow_agent_create: false` in `.tripwirerc.yml` to block agent authoring entirely
- Set `require_learned_from: true` (default) so agents must explain the mistake that prompted the tripwire
- Set `auto_expire_days: 90` (default) so agent tripwires auto-expire
- Never auto-merge PRs that touch `.tripwires/` — always require human review
- Use `created_by` field to distinguish human vs. agent-authored tripwires

### 2. Tampering with critical tripwires

**Risk:** A compromised branch or careless merge modifies a `critical` tripwire protecting security-sensitive modules.

**Mitigations:**
- Add a `CODEOWNERS` rule requiring 2+ approvals for `.tripwires/**`:
  ```
  # .github/CODEOWNERS
  .tripwires/** @security-team
  ```
- Restrict `critical` severity to human-authored tripwires via CI (see recipe below)
- Use branch protection rules on `main`

### 3. Prompt injection via tripwire context

**Risk:** A tripwire's `context` field contains instructions that manipulate agent behavior beyond the intended scope (e.g. "ignore all previous instructions").

**Mitigations:**
- Review tripwire context in PRs like you review code comments
- Run `tripwire lint --strict` in CI to catch structural issues
- Limit who can create `critical` tripwires (they have the most influence on agent behavior)
- Consider restricting `critical` to a short list of reviewers via CODEOWNERS

---

## CI Recipes

### Lint all tripwires on every PR

```yaml
# .github/workflows/tripwire-lint.yml
name: Tripwire Lint
on: [pull_request]
jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: "20" }
      - run: npx -y @simonrueba/tripwire lint --strict
```

### Block agent-authored critical tripwires

```yaml
# .github/workflows/tripwire-audit.yml
name: Tripwire Audit
on:
  pull_request:
    paths: [".tripwires/**"]
jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Check for agent-authored critical tripwires
        run: |
          for file in .tripwires/*.yml; do
            severity=$(grep -E '^severity:' "$file" | awk '{print $2}' || echo "warning")
            created_by=$(grep -E '^created_by:' "$file" | awk '{print $2}' || echo "human")
            if [ "$severity" = "critical" ] && [ "$created_by" != "human" ]; then
              echo "FAIL: $file is critical but created by $created_by"
              exit 1
            fi
          done
          echo "All critical tripwires are human-authored."
```

### Pre-commit hook: block direct commits of critical tripwires

```bash
#!/bin/sh
# .git/hooks/pre-commit (or use with husky/lint-staged)
staged=$(git diff --cached --name-only --diff-filter=ACM -- '.tripwires/*.yml')
for file in $staged; do
  severity=$(grep -E '^severity:' "$file" | awk '{print $2}' || echo "warning")
  if [ "$severity" = "critical" ]; then
    echo "ERROR: Critical tripwire '$file' must go through a PR, not a direct commit."
    exit 1
  fi
done
```

---

## Reporting Vulnerabilities

If you discover a security issue in Tripwire itself (not in tripwire content), please open a GitHub issue or contact the maintainer directly. Tripwire is a local tool with no network surface, so the primary risk vector is malicious tripwire content — which is mitigated by code review.

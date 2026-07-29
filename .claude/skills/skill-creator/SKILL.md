---
name: skill-creator
description: |
  Design, create, validate, and review Claude Code skills (SKILL.md).
  Follows Anthropic's official guide (2026-03). Use for creating new
  skills, improving existing skills, checking description quality, and
  designing trigger tests.
  Triggers on: "create a skill", "design a skill", "write a SKILL.md",
  "review this skill".
  Do NOT use for: executing/invoking a skill (that's the skill's own job).
argument-hint: "[skill-name or description]"
---

# Skill Creator — Claude Code Skills Design & Generation v2.0

Follows Anthropic's official "The Complete Guide to Building Skills for
Claude" (2026-03). Also compatible with the Agent Skills Open Standard
(agentskills.io), for designing skills that work in AI tools other than
Claude Code.

## North Star

**Design and build reusable, high-quality skills as fast as possible.**
Skill value = trigger precision × output quality × maintainability.

## Frontmatter Reference (all fields)

```yaml
---
# === Required ===
name: skill-name              # kebab-case, max 64 chars. Defaults to the
                               # directory name if omitted.
                               # Names containing "claude" / "anthropic" are
                               # reserved and forbidden.
description: |                 # THE MOST IMPORTANT FIELD — the only signal
  used to decide whether to fire. Max 1024 chars.
  State What + When explicitly. Include trigger words.
  Use a negative trigger ("Do NOT use for...") to prevent misfires.

# === Optional ===
argument-hint: "[target]"      # Hint shown during completion, for skills
                                # that take arguments
disable-model-invocation: false # true = only fires via manual /name
                                 # (for skills with side effects)
user-invocable: true           # false = hidden from the /menu (for
                                # background-knowledge skills)
allowed-tools: Read, Grep, Bash # Allowed tools. Also acts as a restriction
                                 # when specified. Omit = inherit all tools.
model: sonnet                  # Model override for this skill's execution
                                # (omit = inherit from parent)
context: fork                  # fork = run isolated in a subagent
agent: general-purpose         # subagent type when context: fork is used:
                                # Explore, Plan, general-purpose
license: MIT                   # for OSS skills. MIT, Apache-2.0, etc.
compatibility: |               # environment requirements (1-500 chars)
  Claude Code + bash
metadata:                      # custom metadata
  author: your-name
  version: 1.0.0
  mcp-server: server-name      # for skills that integrate an MCP server
hooks:                         # in-skill hook definitions
  PostToolUse:
    - matcher: "Edit|Write"
      hooks:
        - type: command
          command: "./scripts/lint.sh"
---
```

### Frontmatter security constraints

- XML angle brackets `< >` are **forbidden** (prompt-injection prevention)
- `name` must not be "claude" / "anthropic" (reserved words)
- Frontmatter is expanded into the system prompt — malicious content here is
  dangerous

## Designing the description (MOST important — determines trigger quality)

`description` is the **only** material Claude Code uses to decide whether to
fire a skill. The skill body is never consulted for the trigger decision.
**Max 1024 characters.**

### Structure: `[What] + [When] + [Negative trigger]`

```yaml
# Good — specific, has a trigger, has a negative trigger
description: |
  Analyzes Figma design files and generates developer-facing handoff
  documentation. Triggers when a .fig file is uploaded, or when asked for
  "design specs", "component documentation", "design to code".
  Do NOT use for: general image processing or UI design (use the
  interface-design skill instead).

# Bad — vague, no trigger
description: Document processing
```

### 7-point checklist

| # | Check | Bad example | Good example |
|---|---------|-------|-------|
| 1 | What: states what it does | "Document processing" | "Extracts tables from PDFs and converts to CSV" |
| 2 | When: states when to use it | (none) | "Use in a data-analysis workflow" |
| 3 | Contains trigger words | (none) | "Triggers on 'article QC', 'validation'" |
| 4 | Concrete action verbs | "manages" | "extracts, converts, validates" |
| 5 | Length: under 1024 chars | one word, or too long | 2-3 sentences: overview + trigger + exclusion |
| 6 | Differentiated from existing skills | overlaps another skill | states its own distinct scope |
| 7 | Negative trigger present | none (misfire risk) | "Do NOT use for: ..." |

### Debugging a description

If a skill isn't firing, ask Claude:
> "When would you use the [skill-name] skill?"

Claude will quote the description back, revealing which element is missing.

## Three use-case categories

Before designing a skill, identify which category it falls into:

| Category | Purpose | Example |
|---------|------|-----|
| **1. Document & Asset Creation** | Produce a deliverable (PDF, code, article, etc.) | an SEO-writer skill |
| **2. Workflow Automation** | Step-by-step automation | a release-process skill |
| **3. MCP Enhancement** | MCP tool + workflow knowledge combined | a PR-reviewer skill |

## Five design patterns

### Pattern 1: Sequential Workflow
Steps have dependencies. Each step gets validation + rollback on failure.

### Pattern 2: Multi-Service Coordination
Phase separation + data handoff between phases + inter-phase validation.

### Pattern 3: Iterative Refinement (quality loop)
Generate → run a validation script → improve → re-validate. Stop at a
quality threshold.

### Pattern 4: Context-aware Selection
Dynamically choose a tool/technique based on context. Explain the reasoning
to the user.

### Pattern 5: Domain Intelligence
Embed domain-specific rules directly into the logic. Compliance and audit
trails.

## Dynamic Features

### Argument substitution

```
/my-skill some-argument another-argument
```
- `$ARGUMENTS` → `some-argument another-argument` (all arguments)
- `$0` → `some-argument` (first argument)
- `$1` → `another-argument` (second argument)

If `$ARGUMENTS` is not referenced in the body, it is appended automatically
at the end.

### Dynamic context via `!`command``

Runs a shell command before the skill loads and embeds the result:

```markdown
## Current branch
!`git branch --show-current`

## Recent commits
!`git log --oneline -5`
```

## Execution Patterns

### Pattern A: Inline execution (default)
Runs directly in the main conversation. Good for guideline-style, short
tasks.

### Pattern B: Fork execution (isolated)
Runs in a subagent via `context: fork`. Good for heavy processing or large
output volumes.
**Caution**: do not use fork for a guideline-only skill — a subagent needs a
concrete task to execute.

### Pattern C: Manual-only (has side effects)
`disable-model-invocation: true` disables automatic firing by Claude; the
skill only runs via `/name`.

## File Structure

```
~/.claude/skills/skill-name/
├── SKILL.md              # Required. Max ~5,000 words (~500 lines). Case-sensitive.
├── scripts/              # Optional. Executable scripts for validation etc.
├── references/           # Optional. Detailed API specs / rule collections.
├── assets/               # Optional. Templates, fonts, icons.
└── examples/              # Optional. Input/output samples.
```

### Naming conventions
- Folder name: **kebab-case** (`notion-project-setup` ✅ / `Notion_Setup` ❌)
- `SKILL.md` is case-sensitive (`skill.md` ❌ / `SKILL.MD` ❌)
- **No README.md** inside a skill folder. Documentation belongs in SKILL.md
  or references/.

### Progressive Disclosure (3-layer structure)

| Layer | Content | When it's loaded |
|---|------|-----------------|
| L1 | YAML frontmatter | **Always** (embedded in the system prompt) |
| L2 | SKILL.md body | When judged relevant to the current task |
| L3 | references/, scripts/ | Consulted by Claude as needed |

Keep SKILL.md body **under 5,000 words**. Move detail into references/.

## Test strategy (3 areas)

### 1. Triggering Test
```
Should trigger:
- "I want to create a new skill"
- "review this SKILL.md"
- "design a skill for me"

Should NOT trigger:
- "run this skill"
- "what's the weather"
- "write some code"
```

### 2. Functional Test
- Does it produce the correct output?
- Does error handling work?
- Are edge cases handled?

### 3. Performance Test
Compare with/without the skill:
- Number of tool calls
- Token consumption
- User back-and-forth / correction count

**Pro tip**: iterate on one hard task first. Turn the approach that works
into the skill. Broaden test cases afterward.

## Creation Workflow

When creating a skill, work through these steps in order:

1. **Identify use cases**: define 2-3 concrete scenarios
2. **Determine category**: Document / Workflow / MCP Enhancement
3. **Design the description**: 7-point check + negative trigger + under 1024 chars
4. **Check for overlap with existing skills**: `ls ~/.claude/skills/`
5. **Choose an execution pattern**: inline / fork / manual-only
6. **Design allowed-tools**: restrict to the minimum needed
7. **Design arguments**: `$0`, `$1` → document in `argument-hint`
8. **Dynamic context**: consider what data to prefetch via `!`command``
9. **Write SKILL.md**: under 5,000 words; put critical instructions near the top
10. **Add a validation script**: put critical checks in scripts/ (code is
    deterministic, language interpretation is not)
11. **Test**: cover Triggering / Functional / Performance
12. **Install**: place at `~/.claude/skills/skill-name/`

## Recommend a validation script

**The single most important tip from the official guide**: perform critical
validation with a script, not prose. Code is deterministic; language
interpretation is not.

```bash
# scripts/validate.sh example
#!/bin/bash
# Quality check on an output file
if [ $(wc -w < "$1") -lt 100 ]; then
  echo "ERROR: Output too short (min 100 words)"
  exit 1
fi
```

## Project-Specific Notes

Document your own team's conventions here — for example, where skills get
installed, who reviews new skill proposals before they're added, whether
skills that touch external systems need extra tooling permissions, and where
the "North Star" rationale for a skill should live (in the body, not in a
custom frontmatter field — custom frontmatter fields are ignored by Claude
Code).

## Anti-Patterns

| Don't | Why | Instead |
|----|------|---------|
| SKILL.md over 5,000 words | loading cost balloons, response quality drops | split into references/ |
| Vague description | doesn't fire, or misfires | What + When + negative trigger |
| description over 1024 chars | exceeds frontmatter limit | keep to 3 sentences or fewer |
| `< >` in description | security violation | avoid angle brackets |
| No negative trigger | misfires against similar skills | add "Do NOT use for: ..." |
| `context: fork` + guideline-only content | subagent has nothing concrete to execute | use inline execution |
| `disable-model-invocation` + `user-invocable: false` together | nobody can invoke it | pick one, not both |
| Heavy processing with no `allowed-tools` | unintended tool use | list only the tools actually needed |
| Custom fields in frontmatter | ignored by Claude Code | put it in the Markdown body instead |
| README.md inside a skill folder | violates the spec | use SKILL.md or references/ |
| More than 50 skills enabled simultaneously | context pressure | enable selectively |

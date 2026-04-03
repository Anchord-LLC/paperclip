# Paperclip SKILL.md Standard

Paperclip V3C adopts the useful authoring patterns from MetaClaw/OpenClaw without copying their runtime. A Paperclip-native skill stays small, routeable, and explicit about when it should and should not be used.

## Goals

- Keep `SKILL.md` files short enough to route quickly.
- Make the first paragraph/frontmatter description act as the primary selector hint.
- Tie every skill to an existing Paperclip role family.
- Capture validation and retirement conditions so seeded skills do not become silent folklore.
- Keep the format simple enough for future ingestion without adding a parser in V3C.

## Required Frontmatter

Every Paperclip-authored skill should start with YAML frontmatter:

```yaml
---
name: short-skill-slug
description: >
  One-line routing description. This is the primary trigger/selector summary.
role_family: qa
validation_source: Paperclip Memory V3C seed
---
```

Required fields:

- `name`: stable short slug
- `description`: one-line routing description
- `role_family`: one of the existing Paperclip `AgentRole` values such as `qa`, `pm`, `engineer`, or `researcher`
- `validation_source`: where this skill was validated or why it is trusted as a starter skill

## Required Body Sections

Every Paperclip-authored skill should use this section order:

1. `# <Skill Name>`
2. `## Role Family`
3. `## When to Use`
4. `## When Not to Use`
5. `## Inputs / Context Needed`
6. `## Core Rules / Steps`
7. `## Constraints / Guardrails`
8. `## Validation Source`
9. `## Retire / Supersede When`

The body should stay concise. A good starter skill is usually one screen, not an essay.

## Authoring Rules

- Make the `description` specific enough that a router can distinguish it from neighboring skills.
- Keep each skill narrow. Split broad guidance into multiple specialized skills instead of one omnibus document.
- Use operational language. Prefer short checklists over prose.
- Keep guardrails explicit when a skill could cause drift, overreach, or unsafe assumptions.
- Reference the real Paperclip role family, not a new taxonomy.
- Write retirement conditions now so later V4/V5 work can replace seeded skills deliberately.

## Directory Convention

V3C starter skills live under the existing repo `skills/` root and use a `paperclip-<role>-<skill>` directory name:

```text
skills/
  paperclip-starter-bank/README.md
  paperclip-qa-acceptance-criteria-review/SKILL.md
  paperclip-pm-escalation-routing/SKILL.md
  ...
```

This keeps the starter bank compatible with the repo's current `SKILL.md` layout while still giving Paperclip a curated bank index.

## Role Family Mapping Notes

- `pm` covers PM and Chief of Staff style coordination work for V3C.
- `engineer` is the Builder / Implementation role family.
- `researcher` is the Research role family.
- `qa` remains the QA role family.

## Minimal Template

```md
---
name: example-skill
description: >
  Route here when the agent needs a narrow, specialized playbook for one job.
role_family: engineer
validation_source: Paperclip Memory V3C seed
---

# Example Skill

## Role Family

`engineer`

## When to Use

- Use when ...

## When Not to Use

- Do not use when ...

## Inputs / Context Needed

- Relevant task or artifact
- Acceptance criteria or source of truth

## Core Rules / Steps

1. Do the smallest useful step.
2. Verify against the source of truth.
3. Report only the needed outcome.

## Constraints / Guardrails

- Do not invent missing requirements.
- Escalate if the source of truth conflicts.

## Validation Source

- Why this skill belongs in the starter bank.

## Retire / Supersede When

- Replace when a better team-specific skill exists.
```

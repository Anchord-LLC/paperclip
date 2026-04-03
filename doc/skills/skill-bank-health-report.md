# Skill Bank Health Report

Generated: `2026-04-03T18:12:35+00:00`

## Scope

This report inventories every `SKILL.md` under `skills/` and validates it against the Paperclip V3C authoring standard.

## Checks

- required YAML frontmatter fields: `name`, `description`, `role_family`, `validation_source`
- required body sections from the Paperclip SKILL.md standard
- recognized Paperclip role family values
- placeholder or obviously empty section content
- duplicate or highly similar skill names
- duplicate or highly similar routing descriptions

## Summary

- Total skills: `12`
- Pass: `8`
- Warn: `0`
- Fail: `4`
- JSON inventory: `doc/skills/skill-bank-inventory.json`

## Inventory

| Status | Skill | Role family | Routing description | Required sections | Validation source | Retire section | Path |
| --- | --- | --- | --- | --- | --- | --- | --- |
| FAIL | `paperclip` | `-` | yes | 0/8 | no | no | `skills/paperclip/SKILL.md` |
| FAIL | `paperclip-create-agent` | `-` | yes | 0/8 | no | no | `skills/paperclip-create-agent/SKILL.md` |
| FAIL | `paperclip-create-plugin` | `-` | yes | 0/8 | no | no | `skills/paperclip-create-plugin/SKILL.md` |
| PASS | `paperclip-engineer-implementation-checklist` | `engineer` | yes | 8/8 | yes | yes | `skills/paperclip-engineer-implementation-checklist/SKILL.md` |
| PASS | `paperclip-engineer-regression-self-check` | `engineer` | yes | 8/8 | yes | yes | `skills/paperclip-engineer-regression-self-check/SKILL.md` |
| PASS | `paperclip-pm-escalation-routing` | `pm` | yes | 8/8 | yes | yes | `skills/paperclip-pm-escalation-routing/SKILL.md` |
| PASS | `paperclip-pm-handoff-summary` | `pm` | yes | 8/8 | yes | yes | `skills/paperclip-pm-handoff-summary/SKILL.md` |
| PASS | `paperclip-qa-acceptance-criteria-review` | `qa` | yes | 8/8 | yes | yes | `skills/paperclip-qa-acceptance-criteria-review/SKILL.md` |
| PASS | `paperclip-qa-defect-summary` | `qa` | yes | 8/8 | yes | yes | `skills/paperclip-qa-defect-summary/SKILL.md` |
| PASS | `paperclip-research-answer-structure` | `researcher` | yes | 8/8 | yes | yes | `skills/paperclip-research-answer-structure/SKILL.md` |
| PASS | `paperclip-research-evidence-synthesis` | `researcher` | yes | 8/8 | yes | yes | `skills/paperclip-research-evidence-synthesis/SKILL.md` |
| FAIL | `para-memory-files` | `-` | yes | 0/8 | no | no | `skills/para-memory-files/SKILL.md` |

## Findings

### `paperclip`

- Path: `skills/paperclip/SKILL.md`
- Status: `FAIL`
- FAIL: Missing required frontmatter field `role_family`.
- FAIL: Missing required frontmatter field `validation_source`.
- FAIL: Missing required section `## Role Family`.
- FAIL: Missing required section `## When to Use`.
- FAIL: Missing required section `## When Not to Use`.
- FAIL: Missing required section `## Inputs / Context Needed`.
- FAIL: Missing required section `## Core Rules / Steps`.
- FAIL: Missing required section `## Constraints / Guardrails`.
- FAIL: Missing required section `## Validation Source`.
- FAIL: Missing required section `## Retire / Supersede When`.
- WARN: Required section coverage is 0/8.

### `paperclip-create-agent`

- Path: `skills/paperclip-create-agent/SKILL.md`
- Status: `FAIL`
- FAIL: Missing required frontmatter field `role_family`.
- FAIL: Missing required frontmatter field `validation_source`.
- FAIL: Missing required section `## Role Family`.
- FAIL: Missing required section `## When to Use`.
- FAIL: Missing required section `## When Not to Use`.
- FAIL: Missing required section `## Inputs / Context Needed`.
- FAIL: Missing required section `## Core Rules / Steps`.
- FAIL: Missing required section `## Constraints / Guardrails`.
- FAIL: Missing required section `## Validation Source`.
- FAIL: Missing required section `## Retire / Supersede When`.
- WARN: Required section coverage is 0/8.

### `paperclip-create-plugin`

- Path: `skills/paperclip-create-plugin/SKILL.md`
- Status: `FAIL`
- FAIL: Missing required frontmatter field `role_family`.
- FAIL: Missing required frontmatter field `validation_source`.
- FAIL: Missing required section `## Role Family`.
- FAIL: Missing required section `## When to Use`.
- FAIL: Missing required section `## When Not to Use`.
- FAIL: Missing required section `## Inputs / Context Needed`.
- FAIL: Missing required section `## Core Rules / Steps`.
- FAIL: Missing required section `## Constraints / Guardrails`.
- FAIL: Missing required section `## Validation Source`.
- FAIL: Missing required section `## Retire / Supersede When`.
- WARN: Required section coverage is 0/8.

### `para-memory-files`

- Path: `skills/para-memory-files/SKILL.md`
- Status: `FAIL`
- FAIL: Missing required frontmatter field `role_family`.
- FAIL: Missing required frontmatter field `validation_source`.
- FAIL: Missing required section `## Role Family`.
- FAIL: Missing required section `## When to Use`.
- FAIL: Missing required section `## When Not to Use`.
- FAIL: Missing required section `## Inputs / Context Needed`.
- FAIL: Missing required section `## Core Rules / Steps`.
- FAIL: Missing required section `## Constraints / Guardrails`.
- FAIL: Missing required section `## Validation Source`.
- FAIL: Missing required section `## Retire / Supersede When`.
- WARN: Required section coverage is 0/8.

## Overlap Warnings

- No duplicate or near-duplicate name/description pairs were detected.

## Repeatable Commands

```bash
python3 scripts/skill_bank_health.py
python3 scripts/skill_bank_health.py --write
python3 scripts/skill_bank_health.py --check
```

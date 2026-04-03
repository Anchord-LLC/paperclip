# Skill Bank Health Report

Generated: `2026-04-03T18:36:11+00:00`

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
- Pass: `12`
- Warn: `0`
- Fail: `0`
- JSON inventory: `doc/skills/skill-bank-inventory.json`

## Inventory

| Status | Skill | Role family | Routing description | Required sections | Validation source | Retire section | Path |
| --- | --- | --- | --- | --- | --- | --- | --- |
| PASS | `paperclip` | `general` | yes | 8/8 | yes | yes | `skills/paperclip/SKILL.md` |
| PASS | `paperclip-create-agent` | `ceo` | yes | 8/8 | yes | yes | `skills/paperclip-create-agent/SKILL.md` |
| PASS | `paperclip-create-plugin` | `engineer` | yes | 8/8 | yes | yes | `skills/paperclip-create-plugin/SKILL.md` |
| PASS | `paperclip-engineer-implementation-checklist` | `engineer` | yes | 8/8 | yes | yes | `skills/paperclip-engineer-implementation-checklist/SKILL.md` |
| PASS | `paperclip-engineer-regression-self-check` | `engineer` | yes | 8/8 | yes | yes | `skills/paperclip-engineer-regression-self-check/SKILL.md` |
| PASS | `paperclip-pm-escalation-routing` | `pm` | yes | 8/8 | yes | yes | `skills/paperclip-pm-escalation-routing/SKILL.md` |
| PASS | `paperclip-pm-handoff-summary` | `pm` | yes | 8/8 | yes | yes | `skills/paperclip-pm-handoff-summary/SKILL.md` |
| PASS | `paperclip-qa-acceptance-criteria-review` | `qa` | yes | 8/8 | yes | yes | `skills/paperclip-qa-acceptance-criteria-review/SKILL.md` |
| PASS | `paperclip-qa-defect-summary` | `qa` | yes | 8/8 | yes | yes | `skills/paperclip-qa-defect-summary/SKILL.md` |
| PASS | `paperclip-research-answer-structure` | `researcher` | yes | 8/8 | yes | yes | `skills/paperclip-research-answer-structure/SKILL.md` |
| PASS | `paperclip-research-evidence-synthesis` | `researcher` | yes | 8/8 | yes | yes | `skills/paperclip-research-evidence-synthesis/SKILL.md` |
| PASS | `para-memory-files` | `general` | yes | 8/8 | yes | yes | `skills/para-memory-files/SKILL.md` |

## Findings

No failing or warning findings.

## Overlap Warnings

- No duplicate or near-duplicate name/description pairs were detected.

## Repeatable Commands

```bash
python3 scripts/skill_bank_health.py
python3 scripts/skill_bank_health.py --write
python3 scripts/skill_bank_health.py --check
```

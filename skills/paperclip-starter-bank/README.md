# Paperclip Starter Skill Bank

This starter bank is the V3C seed set for Paperclip specialist skill authoring. It borrows the good parts of MetaClaw/OpenClaw skill design:

- a strong routing sentence
- narrow specialization
- explicit guardrails
- clear validation and retirement conditions

It does **not** copy runtime behavior, learning loops, or any external dependency.

## Standard

All seeded skills follow:

- [Paperclip SKILL.md Standard](../../doc/skills/PAPERCLIP_SKILL_STANDARD.md)

## Role Family Map

| Paperclip role family | V3C meaning | Seeded skills |
| --- | --- | --- |
| `qa` | acceptance and defect review | acceptance-criteria review, defect summary |
| `pm` | PM / Chief of Staff coordination | escalation routing, handoff summary |
| `engineer` | builder / implementation | implementation checklist, regression self-check |
| `researcher` | evidence synthesis and answer shaping | evidence synthesis, answer structure |

## Seeded Skills

| Skill | Role family | Path |
| --- | --- | --- |
| QA Acceptance Criteria Review | `qa` | `skills/paperclip-qa-acceptance-criteria-review/SKILL.md` |
| QA Defect Summary | `qa` | `skills/paperclip-qa-defect-summary/SKILL.md` |
| PM Escalation Routing | `pm` | `skills/paperclip-pm-escalation-routing/SKILL.md` |
| PM Handoff Summary | `pm` | `skills/paperclip-pm-handoff-summary/SKILL.md` |
| Engineer Implementation Checklist | `engineer` | `skills/paperclip-engineer-implementation-checklist/SKILL.md` |
| Engineer Regression Self-Check | `engineer` | `skills/paperclip-engineer-regression-self-check/SKILL.md` |
| Research Evidence Synthesis | `researcher` | `skills/paperclip-research-evidence-synthesis/SKILL.md` |
| Research Answer Structure | `researcher` | `skills/paperclip-research-answer-structure/SKILL.md` |

## Future Ingestion Notes

V3C keeps this bank intentionally lightweight so later memory work can ingest it without rethinking the format:

- use frontmatter `description` as the primary routing hint
- use `role_family` as the role-family binding
- ingest the Markdown sections as human-reviewed skill content
- keep `validation_source` and retirement criteria so seeded skills can evolve intentionally

---
name: paperclip-qa-acceptance-criteria-review
description: >
  Review a change against explicit acceptance criteria and return pass/fail gaps,
  missing coverage, and ship risk for QA-scoped work.
role_family: qa
validation_source: Paperclip Memory V3C seed derived from repo review workflows
---

# QA Acceptance Criteria Review

## Role Family

`qa`

## When to Use

- Use when a task already has acceptance criteria and needs a crisp review.
- Use when we need pass/fail coverage, not implementation advice.
- Use before closing or approving a change.

## When Not to Use

- Do not use when requirements are still being invented.
- Do not use for root-cause debugging or code implementation.
- Do not use when there is no source of truth to review against.

## Inputs / Context Needed

- Acceptance criteria or task checklist
- Observed behavior, diff, or test evidence
- Known constraints or release risks

## Core Rules / Steps

1. Restate the acceptance target in plain language.
2. Check each criterion one by one.
3. Call out unmet criteria, ambiguous behavior, and missing verification.
4. End with a clear outcome: pass, pass with risk, or fail.

## Constraints / Guardrails

- Do not silently turn vague requirements into approvals.
- Separate observed facts from suspected issues.
- Prefer concrete gaps over stylistic commentary.

## Validation Source

- Seeded from Paperclip's issue-review and memory-review workflow needs.

## Retire / Supersede When

- Retire when a team-specific QA review skill exists with stronger domain checks.

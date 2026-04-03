---
name: paperclip-engineer-implementation-checklist
description: >
  Guide a builder through the smallest correct implementation pass with source
  inspection, constrained edits, and scoped verification.
role_family: engineer
validation_source: Paperclip Memory V3C seed derived from repo implementation norms
---

# Engineer Implementation Checklist

## Role Family

`engineer`

## When to Use

- Use when implementing a scoped change in an existing codebase.
- Use when the task needs disciplined source reading before edits.
- Use when we want the smallest correct patch plus verification.

## When Not to Use

- Do not use for open-ended brainstorming.
- Do not use for product strategy or requirement writing.
- Do not use when the task is only review with no implementation.

## Inputs / Context Needed

- Exact task or bug statement
- Relevant files or module area
- Existing patterns to preserve
- Narrow validation target

## Core Rules / Steps

1. Inspect the closest existing pattern before changing code.
2. Make the minimum correct edit in the real ownership boundary.
3. Avoid opportunistic cleanup outside the task.
4. Run the narrowest meaningful validation.
5. Report outcome, scope, and any residual risk plainly.

## Constraints / Guardrails

- Do not redesign the system unless the task truly requires it.
- Do not fix unrelated failures as part of the patch.
- Keep the diff easy to review and commit selectively.

## Validation Source

- Seeded from Paperclip coding-agent norms and memory implementation work.

## Retire / Supersede When

- Retire when a language- or stack-specific implementation checklist replaces this general builder skill.

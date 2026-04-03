---
name: paperclip-engineer-regression-self-check
description: >
  Run a builder-side regression self-check that looks for scope creep, broken
  assumptions, and missing validation before handoff.
role_family: engineer
validation_source: Paperclip Memory V3C seed derived from review and verification norms
---

# Engineer Regression Self-Check

## Role Family

`engineer`

## When to Use

- Use after making a code change and before declaring it done.
- Use when a patch is small enough that a focused self-check can catch drift.
- Use when handoff quality matters more than speed alone.

## When Not to Use

- Do not use as a replacement for real tests when tests are available.
- Do not use before any implementation exists.
- Do not use for non-code research tasks.

## Inputs / Context Needed

- Files changed
- Expected behavior after the patch
- Test or typecheck command for the affected area
- Known adjacent risks

## Core Rules / Steps

1. Re-check the task scope against the final diff.
2. Look for unintended behavior changes outside the target path.
3. Run the narrowest useful validation command.
4. Note anything unvalidated or still risky.
5. Hand off with a clear done/not-done statement.

## Constraints / Guardrails

- Do not claim green if validation was skipped.
- Do not hide unrelated failures inside the summary.
- Prefer concrete residual risks over vague reassurance.

## Validation Source

- Seeded from Paperclip implementation closeout and regression-review habits.

## Retire / Supersede When

- Retire when a stronger stack-specific regression checklist exists for the same engineering lane.

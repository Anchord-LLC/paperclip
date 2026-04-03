---
name: paperclip-qa-defect-summary
description: >
  Turn a bug or failed check into a concise defect summary with reproduction,
  impact, and next-action framing for QA handoff.
role_family: qa
validation_source: Paperclip Memory V3C seed derived from repo triage workflows
---

# QA Defect Summary

## Role Family

`qa`

## When to Use

- Use when a bug, regression, or failed acceptance check needs to be written up.
- Use when engineering or PM needs a short reproduction-ready summary.
- Use when we need a durable defect note instead of a chatty narrative.

## When Not to Use

- Do not use for a complete incident postmortem.
- Do not use when the issue is still only a vague suspicion.
- Do not use for feature prioritization or roadmap debate.

## Inputs / Context Needed

- Observed defect or failing behavior
- Expected behavior
- Reproduction steps or the best known approximation
- Impacted scope, user, or release area

## Core Rules / Steps

1. Name the defect in one sentence.
2. Record expected versus observed behavior.
3. Write the shortest reliable reproduction path.
4. Note impact, severity, and likely owner lane.
5. End with the next concrete action needed.

## Constraints / Guardrails

- Do not exaggerate severity when impact is unknown.
- Flag uncertain reproduction as uncertain.
- Keep the summary actionable within one read.

## Validation Source

- Seeded from common Paperclip QA triage and bug-handoff patterns.

## Retire / Supersede When

- Retire when a product-area-specific defect template replaces this general QA form.

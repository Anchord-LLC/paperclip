---
name: paperclip-pm-handoff-summary
description: >
  Produce a clean handoff summary that preserves status, decisions, risks, and
  next owner context for PM or Chief of Staff transitions.
role_family: pm
validation_source: Paperclip Memory V3C seed derived from handoff workflows
---

# PM Handoff Summary

## Role Family

`pm`

## When to Use

- Use when ownership is moving between people, teams, or phases.
- Use when a reviewer needs a short summary instead of a full thread replay.
- Use when we need durable transition context for PM or Chief of Staff work.

## When Not to Use

- Do not use for a fresh project kickoff.
- Do not use when nothing is changing hands.
- Do not use as a substitute for unresolved decision-making.

## Inputs / Context Needed

- Current status
- Decisions already made
- Open risks or blockers
- Next owner and expected next step

## Core Rules / Steps

1. Summarize current state in two or three lines.
2. List decisions that should not be re-litigated casually.
3. List active risks, blockers, or dependencies.
4. Name the next owner and the expected immediate action.
5. End with what still needs confirmation, if anything.

## Constraints / Guardrails

- Do not dump the whole thread history.
- Separate confirmed decisions from open questions.
- Keep the receiving owner unblocked, not overloaded.

## Validation Source

- Seeded from Paperclip task, review, and coordination handoff patterns.

## Retire / Supersede When

- Retire when a team-specific handoff format covers the same transition path better.

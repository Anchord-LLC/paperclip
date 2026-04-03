---
name: paperclip-pm-escalation-routing
description: >
  Route a blocker or decision to the right owner with urgency, dependency, and
  requested action made explicit for PM or Chief of Staff work.
role_family: pm
validation_source: Paperclip Memory V3C seed derived from escalation workflows
---

# PM Escalation Routing

## Role Family

`pm`

## When to Use

- Use when work is blocked and needs a clear owner handoff.
- Use when a decision must be escalated rather than solved inline.
- Use for PM or Chief of Staff coordination that needs crisp next action.

## When Not to Use

- Do not use for routine status updates with no ask.
- Do not use when the current owner can resolve the issue without escalation.
- Do not use to hide missing analysis behind urgency language.

## Inputs / Context Needed

- The blocker or decision point
- Why the current owner cannot resolve it alone
- Deadline, dependency, or risk window
- Specific owner or role to receive the escalation

## Core Rules / Steps

1. State what is blocked or undecided.
2. Name the owner who must act and why.
3. Describe the impact if no action happens.
4. Ask for one explicit decision or unblock step.
5. Include the smallest supporting context needed to act.

## Constraints / Guardrails

- Do not escalate without a named ask.
- Do not flood multiple owners with the same vague escalation.
- Keep urgency tied to impact, not emotion.

## Validation Source

- Seeded from Paperclip coordination and issue-escalation patterns.

## Retire / Supersede When

- Retire when a team-specific escalation protocol or template replaces it.

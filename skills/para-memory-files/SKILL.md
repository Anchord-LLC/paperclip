---
name: para-memory-files
description: >
  File-based memory system using Tiago Forte's PARA method. Use this skill whenever
  you need to store, retrieve, update, or organize knowledge across sessions. Covers
  three memory layers: (1) Knowledge graph in PARA folders with atomic YAML facts,
  (2) Daily notes as raw timeline, (3) Tacit knowledge about user patterns. Also
  handles planning files, memory decay, weekly synthesis, and recall via qmd.
  Trigger on any memory operation: saving facts, writing daily notes, creating
  entities, running weekly synthesis, recalling past context, or managing plans.
role_family: general
validation_source: >
  Existing PARA memory workflow guidance in this repo plus the current skill-bank
  standard used for Paperclip Memory V3C and later maintenance work.
---

# PARA Memory Files

## Role Family

`general`

## When to Use

- Use when you need persistent file-based memory across sessions.
- Use when knowledge should be organized into PARA folders, daily notes, or tacit-knowledge files.
- Use when you need a durable memory workflow instead of relying on temporary context.

## When Not to Use

- Do not use when the task needs the newer Paperclip database-backed memory service instead of personal file memory.
- Do not use for one-off notes that do not need persistence.
- Do not use as a substitute for project-repo artifacts that should live with shared code or docs.

## Inputs / Context Needed

- The fact, note, plan, or tacit lesson being stored or recalled
- The right PARA bucket or memory layer
- Relevant entity names, dates, and status context
- Access to the user's `AGENT_HOME` memory files and `qmd` when recall is needed

## Core Rules / Steps

1. Choose the correct layer: knowledge graph, daily note, or tacit knowledge.
2. Write durable facts to files immediately instead of relying on session memory.
3. Keep entity summaries and atomic facts in sync over time.
4. Use `qmd` for recall before falling back to manual grep-like scanning.
5. Keep shared project plans in the repo `plans/` area rather than the personal memory store.

## Constraints / Guardrails

- Never assume memory will survive a restart unless it is written to disk.
- Do not delete facts; supersede them when needed.
- Keep personal memory files distinct from shared repo artifacts.
- Prefer the simplest durable write path over improvised memory structures.

## Validation Source

- Validated against the existing PARA-based memory workflow in this repo and aligned to the Paperclip V3C skill standard.

## Retire / Supersede When

- Supersede when Paperclip adopts a newer shared memory-authoring skill that replaces this file-based workflow for the same use cases.

Persistent, file-based memory organized by Tiago Forte's PARA method. Three layers: a knowledge graph, daily notes, and tacit knowledge. All paths are relative to `$AGENT_HOME`.

## Three Memory Layers

### Layer 1: Knowledge Graph (`$AGENT_HOME/life/` -- PARA)

Entity-based storage. Each entity gets a folder with two tiers:

1. `summary.md` -- quick context, load first.
2. `items.yaml` -- atomic facts, load on demand.

```text
$AGENT_HOME/life/
  projects/          # Active work with clear goals/deadlines
    <name>/
      summary.md
      items.yaml
  areas/             # Ongoing responsibilities, no end date
    people/<name>/
    companies/<name>/
  resources/         # Reference material, topics of interest
    <topic>/
  archives/          # Inactive items from the other three
  index.md
```

**PARA rules:**

- **Projects** -- active work with a goal or deadline. Move to archives when complete.
- **Areas** -- ongoing (people, companies, responsibilities). No end date.
- **Resources** -- reference material, topics of interest.
- **Archives** -- inactive items from any category.

**Fact rules:**

- Save durable facts immediately to `items.yaml`.
- Weekly: rewrite `summary.md` from active facts.
- Never delete facts. Supersede instead (`status: superseded`, add `superseded_by`).
- When an entity goes inactive, move its folder to `$AGENT_HOME/life/archives/`.

**When to create an entity:**

- Mentioned 3+ times, OR
- Direct relationship to the user (family, coworker, partner, client), OR
- Significant project or company in the user's life.
- Otherwise, note it in daily notes.

For the atomic fact YAML schema and memory decay rules, see [references/schemas.md](references/schemas.md).

### Layer 2: Daily Notes (`$AGENT_HOME/memory/YYYY-MM-DD.md`)

Raw timeline of events -- the "when" layer.

- Write continuously during conversations.
- Extract durable facts to Layer 1 during heartbeats.

### Layer 3: Tacit Knowledge (`$AGENT_HOME/MEMORY.md`)

How the user operates -- patterns, preferences, lessons learned.

- Not facts about the world; facts about the user.
- Update whenever you learn new operating patterns.

## Write It Down -- No Mental Notes

Memory does not survive session restarts. Files do.

- Want to remember something -> WRITE IT TO A FILE.
- "Remember this" -> update `$AGENT_HOME/memory/YYYY-MM-DD.md` or the relevant entity file.
- Learn a lesson -> update AGENTS.md, TOOLS.md, or the relevant skill file.
- Make a mistake -> document it so future-you does not repeat it.
- On-disk text files are always better than holding it in temporary context.

## Memory Recall -- Use qmd

Use `qmd` rather than grepping files:

```bash
qmd query "what happened at Christmas"   # Semantic search with reranking
qmd search "specific phrase"              # BM25 keyword search
qmd vsearch "conceptual question"         # Pure vector similarity
```

Index your personal folder: `qmd index $AGENT_HOME`

Vectors + BM25 + reranking finds things even when the wording differs.

## Planning

Keep plans in timestamped files in `plans/` at the project root (outside personal memory so other agents can access them). Use `qmd` to search plans. Plans go stale -- if a newer plan exists, do not confuse yourself with an older version. If you notice staleness, update the file to note what it is supersededBy.

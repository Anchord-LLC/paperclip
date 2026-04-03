#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any

ALLOWED_ROLE_FAMILIES = [
    "ceo",
    "cto",
    "cmo",
    "cfo",
    "engineer",
    "designer",
    "pm",
    "qa",
    "devops",
    "researcher",
    "general",
]

REQUIRED_FRONTMATTER_FIELDS = [
    "name",
    "description",
    "role_family",
    "validation_source",
]

REQUIRED_SECTIONS = [
    "Role Family",
    "When to Use",
    "When Not to Use",
    "Inputs / Context Needed",
    "Core Rules / Steps",
    "Constraints / Guardrails",
    "Validation Source",
    "Retire / Supersede When",
]

EMPTY_SECTION_PATTERNS = [
    re.compile(r"^\s*$"),
    re.compile(r"^(?:[-*]\s*)?(?:todo|tbd|coming soon|placeholder)\.?$", re.IGNORECASE),
    re.compile(r"^(?:[-*]\s*)?(?:use when|do not use when|replace when).*\.\.\.$", re.IGNORECASE),
]

PLACEHOLDER_SNIPPETS = [
    "...",
    "TODO",
    "TBD",
    "coming soon",
    "placeholder",
    "use when ...",
    "do not use when ...",
]

NAME_SIMILARITY_THRESHOLD = 0.88
DESCRIPTION_SIMILARITY_THRESHOLD = 0.92


@dataclass
class SkillRecord:
    path: str
    title: str | None
    frontmatter: dict[str, str]
    sections: dict[str, str]
    status: str
    errors: list[str]
    warnings: list[str]

    @property
    def name(self) -> str | None:
        return self.frontmatter.get("name")

    @property
    def role_family(self) -> str | None:
        return self.frontmatter.get("role_family")

    @property
    def description(self) -> str | None:
        return self.frontmatter.get("description")

    @property
    def validation_source(self) -> str | None:
        return self.frontmatter.get("validation_source")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Inventory and validate Paperclip SKILL.md files against the V3C standard."
    )
    parser.add_argument(
        "--repo-root",
        default=str(Path(__file__).resolve().parents[1]),
        help="Paperclip repo root. Defaults to the parent of this script.",
    )
    parser.add_argument(
        "--markdown-out",
        default="doc/skills/skill-bank-health-report.md",
        help="Markdown report path relative to repo root.",
    )
    parser.add_argument(
        "--json-out",
        default="doc/skills/skill-bank-inventory.json",
        help="JSON inventory path relative to repo root.",
    )
    parser.add_argument(
        "--write",
        action="store_true",
        help="Write the Markdown report and JSON inventory to disk.",
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="Exit non-zero when validation finds any failing skill entries.",
    )
    return parser.parse_args()


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def normalize_text(value: str | None) -> str:
    if not value:
        return ""
    return re.sub(r"\s+", " ", value.strip()).lower()


def similarity(left: str | None, right: str | None) -> float:
    return SequenceMatcher(None, normalize_text(left), normalize_text(right)).ratio()


def looks_placeholder(value: str) -> bool:
    normalized = value.strip()
    if not normalized:
        return True
    for pattern in EMPTY_SECTION_PATTERNS:
        if pattern.match(normalized):
            return True
    lowered = normalized.lower()
    return any(snippet.lower() in lowered for snippet in PLACEHOLDER_SNIPPETS)


def parse_frontmatter(text: str) -> tuple[dict[str, str], str]:
    if not text.startswith("---\n"):
        return {}, text

    lines = text.splitlines()
    end_index = None
    for index in range(1, len(lines)):
        if lines[index].strip() == "---":
            end_index = index
            break
    if end_index is None:
        return {}, text

    frontmatter_lines = lines[1:end_index]
    body = "\n".join(lines[end_index + 1 :])
    if text.endswith("\n"):
        body += "\n"

    frontmatter: dict[str, str] = {}
    index = 0
    while index < len(frontmatter_lines):
        line = frontmatter_lines[index]
        if not line.strip():
            index += 1
            continue

        match = re.match(r"^([A-Za-z0-9_]+):\s*(.*)$", line)
        if not match:
            index += 1
            continue

        key = match.group(1)
        raw_value = match.group(2).strip()

        if raw_value in {">", "|"}:
            block_lines: list[str] = []
            index += 1
            while index < len(frontmatter_lines):
                next_line = frontmatter_lines[index]
                if re.match(r"^[A-Za-z0-9_]+:\s*", next_line) and not next_line.startswith((" ", "\t")):
                    index -= 1
                    break
                if next_line.startswith("  "):
                    block_lines.append(next_line[2:])
                elif next_line.startswith("\t"):
                    block_lines.append(next_line[1:])
                else:
                    block_lines.append(next_line)
                index += 1
            if raw_value == ">":
                value = " ".join(part.strip() for part in block_lines if part.strip())
            else:
                value = "\n".join(block_lines).strip()
        else:
            value = raw_value.strip("'\"")

        frontmatter[key] = value
        index += 1

    return frontmatter, body


def parse_sections(body: str) -> tuple[str | None, dict[str, str]]:
    title: str | None = None
    sections: dict[str, str] = {}
    current_section: str | None = None
    current_lines: list[str] = []

    for line in body.splitlines():
        if title is None and line.startswith("# "):
            title = line[2:].strip()
            continue

        if line.startswith("## "):
            if current_section is not None:
                sections[current_section] = "\n".join(current_lines).strip()
            current_section = line[3:].strip()
            current_lines = []
            continue

        if current_section is not None:
            current_lines.append(line)

    if current_section is not None:
        sections[current_section] = "\n".join(current_lines).strip()

    return title, sections


def evaluate_skill(path: Path, repo_root: Path) -> SkillRecord:
    frontmatter, body = parse_frontmatter(read_text(path))
    title, sections = parse_sections(body)

    errors: list[str] = []
    warnings: list[str] = []

    if not frontmatter:
        errors.append("Missing YAML frontmatter block.")

    for field in REQUIRED_FRONTMATTER_FIELDS:
        value = frontmatter.get(field, "").strip()
        if not value:
            errors.append(f"Missing required frontmatter field `{field}`.")
        elif looks_placeholder(value):
            warnings.append(f"Frontmatter field `{field}` looks empty or placeholder-like.")

    role_family = frontmatter.get("role_family", "").strip()
    if role_family and role_family not in ALLOWED_ROLE_FAMILIES:
        errors.append(f"Frontmatter `role_family` is not a recognized Paperclip role family: `{role_family}`.")

    if not title:
        errors.append("Missing top-level `# Skill Name` heading.")

    present_required_sections = 0
    for section in REQUIRED_SECTIONS:
        content = sections.get(section)
        if content:
            present_required_sections += 1
            if looks_placeholder(content):
                warnings.append(f"Section `{section}` looks empty or placeholder-like.")
        else:
            errors.append(f"Missing required section `## {section}`.")

    if sections.get("Role Family"):
        role_section = normalize_text(sections["Role Family"]).strip("`")
        if role_family and role_section and role_family not in role_section:
            warnings.append("`## Role Family` content does not clearly match frontmatter `role_family`.")

    if frontmatter.get("description") and len(normalize_text(frontmatter["description"])) < 24:
        warnings.append("Routing description is unusually short.")

    if present_required_sections < len(REQUIRED_SECTIONS):
        warnings.append(
            f"Required section coverage is {present_required_sections}/{len(REQUIRED_SECTIONS)}."
        )

    status = "fail" if errors else "warn" if warnings else "pass"
    return SkillRecord(
        path=str(path.relative_to(repo_root)),
        title=title,
        frontmatter=frontmatter,
        sections=sections,
        status=status,
        errors=errors,
        warnings=warnings,
    )


def collect_skills(repo_root: Path) -> list[SkillRecord]:
    skills_dir = repo_root / "skills"
    skill_paths = sorted(skills_dir.rglob("SKILL.md"))
    return [evaluate_skill(path, repo_root) for path in skill_paths]


def add_overlap_warnings(skills: list[SkillRecord]) -> list[dict[str, Any]]:
    overlaps: list[dict[str, Any]] = []
    for index, left in enumerate(skills):
        for right in skills[index + 1 :]:
            left_name = left.name or left.title or left.path
            right_name = right.name or right.title or right.path
            name_score = similarity(left_name, right_name)
            description_score = similarity(left.description, right.description)

            if normalize_text(left_name) == normalize_text(right_name):
                message = f"Duplicate skill name with `{right.path}`."
                left.warnings.append(message)
                right.warnings.append(f"Duplicate skill name with `{left.path}`.")
                overlaps.append(
                    {
                        "kind": "duplicate_name",
                        "left": left.path,
                        "right": right.path,
                        "score": round(name_score, 3),
                    }
                )
                continue

            if name_score >= NAME_SIMILARITY_THRESHOLD:
                left.warnings.append(
                    f"Skill name is highly similar to `{right.path}` ({name_score:.2f})."
                )
                right.warnings.append(
                    f"Skill name is highly similar to `{left.path}` ({name_score:.2f})."
                )
                overlaps.append(
                    {
                        "kind": "similar_name",
                        "left": left.path,
                        "right": right.path,
                        "score": round(name_score, 3),
                    }
                )

            if left.description and right.description:
                if normalize_text(left.description) == normalize_text(right.description):
                    left.warnings.append(f"Routing description duplicates `{right.path}`.")
                    right.warnings.append(f"Routing description duplicates `{left.path}`.")
                    overlaps.append(
                        {
                            "kind": "duplicate_description",
                            "left": left.path,
                            "right": right.path,
                            "score": round(description_score, 3),
                        }
                    )
                elif description_score >= DESCRIPTION_SIMILARITY_THRESHOLD:
                    left.warnings.append(
                        f"Routing description is highly similar to `{right.path}` ({description_score:.2f})."
                    )
                    right.warnings.append(
                        f"Routing description is highly similar to `{left.path}` ({description_score:.2f})."
                    )
                    overlaps.append(
                        {
                            "kind": "similar_description",
                            "left": left.path,
                            "right": right.path,
                            "score": round(description_score, 3),
                        }
                    )

    for skill in skills:
        if skill.status == "pass" and skill.warnings:
            skill.status = "warn"
    return overlaps


def summarize(skills: list[SkillRecord]) -> dict[str, int]:
    return {
        "total": len(skills),
        "pass": sum(1 for skill in skills if skill.status == "pass"),
        "warn": sum(1 for skill in skills if skill.status == "warn"),
        "fail": sum(1 for skill in skills if skill.status == "fail"),
    }


def to_inventory_document(
    repo_root: Path,
    skills: list[SkillRecord],
    overlaps: list[dict[str, Any]],
    markdown_path: str,
    json_path: str,
) -> dict[str, Any]:
    generated_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    summary = summarize(skills)
    return {
        "generatedAt": generated_at,
        "repoRoot": str(repo_root),
        "inventoryPath": json_path,
        "reportPath": markdown_path,
        "rules": {
            "allowedRoleFamilies": ALLOWED_ROLE_FAMILIES,
            "requiredFrontmatterFields": REQUIRED_FRONTMATTER_FIELDS,
            "requiredSections": REQUIRED_SECTIONS,
            "placeholderSnippets": PLACEHOLDER_SNIPPETS,
            "similarityThresholds": {
                "name": NAME_SIMILARITY_THRESHOLD,
                "description": DESCRIPTION_SIMILARITY_THRESHOLD,
            },
        },
        "summary": summary,
        "overlaps": overlaps,
        "skills": [
            {
                "path": skill.path,
                "name": skill.name,
                "title": skill.title,
                "roleFamily": skill.role_family,
                "status": skill.status,
                "hasRoutingDescription": bool(skill.description),
                "requiredSectionCount": len(skill.sections),
                "requiredSectionsPresent": [
                    section for section in REQUIRED_SECTIONS if section in skill.sections
                ],
                "validationSourcePresent": bool(skill.validation_source),
                "retireSectionPresent": bool(skill.sections.get("Retire / Supersede When")),
                "errors": skill.errors,
                "warnings": skill.warnings,
            }
            for skill in skills
        ],
    }


def render_markdown(inventory: dict[str, Any]) -> str:
    summary = inventory["summary"]
    lines = [
        "# Skill Bank Health Report",
        "",
        f"Generated: `{inventory['generatedAt']}`",
        "",
        "## Scope",
        "",
        "This report inventories every `SKILL.md` under `skills/` and validates it against the Paperclip V3C authoring standard.",
        "",
        "## Checks",
        "",
        "- required YAML frontmatter fields: `name`, `description`, `role_family`, `validation_source`",
        "- required body sections from the Paperclip SKILL.md standard",
        "- recognized Paperclip role family values",
        "- placeholder or obviously empty section content",
        "- duplicate or highly similar skill names",
        "- duplicate or highly similar routing descriptions",
        "",
        "## Summary",
        "",
        f"- Total skills: `{summary['total']}`",
        f"- Pass: `{summary['pass']}`",
        f"- Warn: `{summary['warn']}`",
        f"- Fail: `{summary['fail']}`",
        f"- JSON inventory: `{inventory['inventoryPath']}`",
        "",
        "## Inventory",
        "",
        "| Status | Skill | Role family | Routing description | Required sections | Validation source | Retire section | Path |",
        "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ]

    for skill in inventory["skills"]:
        name = skill["name"] or skill["title"] or "(missing name)"
        role_family = skill["roleFamily"] or "-"
        routing = "yes" if skill["hasRoutingDescription"] else "no"
        section_count = len(skill["requiredSectionsPresent"])
        validation_source = "yes" if skill["validationSourcePresent"] else "no"
        retire_section = "yes" if skill["retireSectionPresent"] else "no"
        lines.append(
            f"| {skill['status'].upper()} | `{name}` | `{role_family}` | {routing} | {section_count}/{len(REQUIRED_SECTIONS)} | {validation_source} | {retire_section} | `{skill['path']}` |"
        )

    lines.extend(["", "## Findings", ""])

    findings_emitted = False
    for skill in inventory["skills"]:
        findings = skill["errors"] + skill["warnings"]
        if not findings:
            continue
        findings_emitted = True
        name = skill["name"] or skill["title"] or skill["path"]
        lines.append(f"### `{name}`")
        lines.append("")
        lines.append(f"- Path: `{skill['path']}`")
        lines.append(f"- Status: `{skill['status'].upper()}`")
        for error in skill["errors"]:
            lines.append(f"- FAIL: {error}")
        for warning in skill["warnings"]:
            lines.append(f"- WARN: {warning}")
        lines.append("")

    if not findings_emitted:
        lines.extend(["No failing or warning findings.", ""])

    lines.extend(["## Overlap Warnings", ""])
    if inventory["overlaps"]:
        for overlap in inventory["overlaps"]:
            lines.append(
                f"- `{overlap['kind']}` between `{overlap['left']}` and `{overlap['right']}` (score `{overlap['score']}`)"
            )
    else:
        lines.append("- No duplicate or near-duplicate name/description pairs were detected.")

    lines.extend(["", "## Repeatable Commands", "", "```bash", "python3 scripts/skill_bank_health.py", "python3 scripts/skill_bank_health.py --write", "python3 scripts/skill_bank_health.py --check", "```", ""])
    return "\n".join(lines)


def write_outputs(
    repo_root: Path,
    inventory: dict[str, Any],
    markdown_relative_path: str,
    json_relative_path: str,
) -> None:
    markdown_path = repo_root / markdown_relative_path
    json_path = repo_root / json_relative_path
    markdown_path.parent.mkdir(parents=True, exist_ok=True)
    json_path.parent.mkdir(parents=True, exist_ok=True)
    markdown_path.write_text(render_markdown(inventory), encoding="utf-8")
    json_path.write_text(json.dumps(inventory, indent=2, sort_keys=False) + "\n", encoding="utf-8")


def print_console_summary(inventory: dict[str, Any]) -> None:
    summary = inventory["summary"]
    print("Skill bank inventory complete.")
    print(f"  total: {summary['total']}")
    print(f"  pass:  {summary['pass']}")
    print(f"  warn:  {summary['warn']}")
    print(f"  fail:  {summary['fail']}")
    if inventory["overlaps"]:
        print(f"  overlap warnings: {len(inventory['overlaps'])}")


def main() -> int:
    args = parse_args()
    repo_root = Path(args.repo_root).resolve()
    skills = collect_skills(repo_root)
    overlaps = add_overlap_warnings(skills)
    inventory = to_inventory_document(
        repo_root=repo_root,
        skills=skills,
        overlaps=overlaps,
        markdown_path=args.markdown_out,
        json_path=args.json_out,
    )

    if args.write:
        write_outputs(repo_root, inventory, args.markdown_out, args.json_out)

    print_console_summary(inventory)

    if args.check and inventory["summary"]["fail"] > 0:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())

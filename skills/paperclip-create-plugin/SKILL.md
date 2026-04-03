---
name: paperclip-create-plugin
description: >
  Create new Paperclip plugins with the current alpha SDK/runtime. Use when
  scaffolding a plugin package, adding a new example plugin, or updating plugin
  authoring docs. Covers the supported worker/UI surface, route conventions,
  scaffold flow, and verification steps.
role_family: engineer
validation_source: >
  Paperclip plugin authoring guide, SDK scaffold flow, and current trusted
  runtime constraints documented in the repo.
---

# Create a Paperclip Plugin

## Role Family

`engineer`

## When to Use

- Use when the task is to create, scaffold, or document a Paperclip plugin.
- Use when you need the current alpha plugin runtime assumptions and scaffold flow.
- Use when you need to verify a plugin package or example against Paperclip's current plugin constraints.

## When Not to Use

- Do not use for unrelated frontend or server work.
- Do not use if the task is only browsing plugin ideas without implementation or docs changes.
- Do not use older future-spec assumptions in place of the current runtime behavior.

## Inputs / Context Needed

- Plugin goal and whether it belongs in-repo or outside the repo
- Current SDK/runtime docs and scaffold package
- Required capabilities, UI surface, and verification scope
- Whether the plugin should appear in the app as a bundled example

## Core Rules / Steps

1. Read the current authoring guide and SDK docs before scaffolding.
2. Use the scaffold package instead of hand-writing boilerplate.
3. Adjust the generated worker, UI, manifest, and tests to match the real target.
4. Only wire the plugin into the app when the task explicitly calls for it.
5. Run the narrowest correct typecheck, test, and build validation for the plugin.

## Constraints / Guardrails

- Distinguish current implementation from future spec ideas.
- Do not promise unsupported host UI components or asset APIs.
- Keep plugin capabilities, route usage, and development install path aligned with the current runtime.
- Avoid surfacing bundled examples unless the task explicitly asks for it.

## Validation Source

- Validated against the current plugin authoring guide, SDK README, and scaffold workflow in this repo.

## Retire / Supersede When

- Supersede when Paperclip ships a newer plugin runtime or authoring guide that changes the scaffold and verification path materially.

Use this skill when the task is to create, scaffold, or document a Paperclip plugin.

## 1. Ground rules

Read these first when needed:

1. `doc/plugins/PLUGIN_AUTHORING_GUIDE.md`
2. `packages/plugins/sdk/README.md`
3. `doc/plugins/PLUGIN_SPEC.md` only for future-looking context

Current runtime assumptions:

- plugin workers are trusted code
- plugin UI is trusted same-origin host code
- worker APIs are capability-gated
- plugin UI is not sandboxed by manifest capabilities
- no host-provided shared plugin UI component kit yet
- `ctx.assets` is not supported in the current runtime

## 2. Preferred workflow

Use the scaffold package instead of hand-writing the boilerplate:

```bash
pnpm --filter @paperclipai/create-paperclip-plugin build
node packages/plugins/create-paperclip-plugin/dist/index.js <npm-package-name> --output <target-dir>
```

For a plugin that lives outside the Paperclip repo, pass `--sdk-path` and let the scaffold snapshot the local SDK/shared packages into `.paperclip-sdk/`:

```bash
pnpm --filter @paperclipai/create-paperclip-plugin build
node packages/plugins/create-paperclip-plugin/dist/index.js @acme/plugin-name \
  --output /absolute/path/to/plugin-repos \
  --sdk-path /absolute/path/to/paperclip/packages/plugins/sdk
```

Recommended target inside this repo:

- `packages/plugins/examples/` for example plugins
- another `packages/plugins/<name>/` folder if it is becoming a real package

## 3. After scaffolding

Check and adjust:

- `src/manifest.ts`
- `src/worker.ts`
- `src/ui/index.tsx`
- `tests/plugin.spec.ts`
- `package.json`

Make sure the plugin:

- declares only supported capabilities
- does not use `ctx.assets`
- does not import host UI component stubs
- keeps UI self-contained
- uses `routePath` only on `page` slots
- is installed into Paperclip from an absolute local path during development

## 4. If the plugin should appear in the app

For bundled example/discoverable behavior, update the relevant host wiring:

- bundled example list in `server/src/routes/plugins.ts`
- any docs that list in-repo examples

Only do this if the user wants the plugin surfaced as a bundled example.

## 5. Verification

Always run:

```bash
pnpm --filter <plugin-package> typecheck
pnpm --filter <plugin-package> test
pnpm --filter <plugin-package> build
```

If you changed SDK/host/plugin runtime code too, also run broader repo checks as appropriate.

## 6. Documentation expectations

When authoring or updating plugin docs:

- distinguish current implementation from future spec ideas
- be explicit about the trusted-code model
- do not promise host UI components or asset APIs
- prefer npm-package deployment guidance over repo-local workflows for production

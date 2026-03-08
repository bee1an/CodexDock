# `ilc` Verification Guide

Use these checks when you need to confirm the CLI is available and behaving correctly without making unnecessary changes.

## Safe Smoke Checks

Run these first:

```bash
pnpm ilc --help
pnpm ilc settings get --json
pnpm ilc login port status --json
```

These commands are read-only and verify:

- the source CLI entrypoint works
- JSON output is available
- login-port inspection works without starting a login flow

## JSON Verification

When a user or automation needs stable machine-readable output, prefer read-only commands with `--json`, for example:

```bash
pnpm ilc account list --json
pnpm ilc session current --json
pnpm ilc usage read --json
```

Expect a top-level envelope:

```json
{
  "ok": true,
  "data": {},
  "error": null
}
```

## Login Verification

Use the least disruptive flow that matches the goal:

- Browser login without auto-open:

```bash
pnpm ilc login browser --no-open --timeout 15
```

- Device login with bounded wait:

```bash
pnpm ilc login device --timeout 15
```

Use `--timeout` for automated checks so the command fails predictably instead of waiting indefinitely.

## Side-Effecting Commands

Do not run these unless the user explicitly wants the effect:

- `pnpm ilc account remove <account-id>`
- `pnpm ilc login port kill`
- `pnpm ilc settings set <key> <value>`
- `pnpm ilc codex open [account-id]`

## Source vs Packaged Usage

- Source checkout should use `pnpm ilc ...`
- Installed packaged app should usually allow direct `ilc ...` after the app has launched once
- Packaged app bundles use the shipped wrappers:
  - `resources/bin/ilc`
  - `resources/bin/ilc.cmd`

The source script currently resolves to `npm run build:cli && electron ./out/cli/cli/index.js`, so a working source invocation proves both the CLI build and Electron CLI bootstrap still work.

## Troubleshooting

- If help or read-only commands fail, check the repository root and the package manager script before assuming the CLI implementation is broken.
- If a packaged install still does not expose `ilc`, check whether the chosen PATH directory was writable or whether another `ilc` command already existed there.
- If login checks fail immediately with exit code `3`, treat it as an environment issue first, not a logic regression.
- If a task only needs to inspect command availability, stop after the safe smoke checks instead of triggering login or Codex launch behavior.

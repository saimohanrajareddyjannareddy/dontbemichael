# Proposal: Give Codex workers the same MCP servers Claude workers get

**TODOS.md → Engines → "Make a second engine (Codex first) ready for an office" → gap 3**

## Problem
`hookSettings()` writes the output of `buildDefaultMcpServers()` only into Claude's
per-session `--settings`. Codex workers get their own isolated `CODEX_HOME` from
`installCodexHooks()`, but its config.toml never gets those MCP servers. So in the same
office, a Codex worker has fewer tools than a Claude worker. This is one of the gaps
keeping `BUILD_ENGINES` at `['claude']`.

## Proposed change
- Pass `cwd` and the `mcpDefaults` map into `installCodexHooks()`, call the existing
  `buildDefaultMcpServers()`, and append each entry to the per-agent config.toml as an
  `[mcp_servers.<name>]` table (`command`, `args`, `env`).
- No new catalog and no new consent logic: the safe-readonly default and the explicit
  opt-in for write/secret servers carry over unchanged.
- **Avoid duplicate tables:** that config.toml is seeded from the user's
  `~/.codex/config.toml`. If the user already defines a server with the same name,
  appending ours causes a TOML parse error and the worker won't start. Skip any name
  already present and log it, so the user's own definition wins. This matches how the
  Claude path never overwrites same-named servers in `~/.claude`.
- Only touch the per-agent `<agentDir>/.codex/config.toml`, never the global `~/.codex`.

## Test
Add a case to `test/hive-hook-node.test.cjs` next to the existing `installCodexHooks` tests:
1. MCP tables appear when enabled
2. They're absent when consent is off
3. A pre-existing same-name server in the user's config is preserved, and the file still parses

## Priority and trade-offs
- The item is P3, pending a decision to offer a second engine. This piece is small
  and inert until Codex is added to `BUILD_ENGINES`, so it can land ahead of that
  decision and close one gap early.
- `docs/designs/business-mode-office-packs.md` notes that the six default stdio servers
  mean about 30 extra processes in a five-agent office. This change adds the same
  per-session cost for Codex workers, so it may be worth pairing with trimming those
  defaults, or gating Codex MCP behind its own toggle at first.

## Note
Codex's `[mcp_servers]` format should be checked against the current Codex docs
before implementation.

— Sai Mohan Raja Reddy Janna Reddy

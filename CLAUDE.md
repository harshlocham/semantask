# CLAUDE.md

Read [`AGENTS.md`](AGENTS.md) and follow it. It is the canonical, tool-agnostic
instruction file for this repository: product contract, non-negotiable
invariants (suggest_only fail-closed, policy-before-side-effects, ToolExecutor
as the side-effect boundary, idempotency and lease duplicate-safety), package
boundaries, per-workspace test commands, and known documentation drift.

Do not duplicate those rules here — update `AGENTS.md` instead, so every agent
sees the same instructions.

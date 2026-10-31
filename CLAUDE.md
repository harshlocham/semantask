# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

`AGENTS.md`, imported above, is the canonical, tool-agnostic instruction file:
product contract, non-negotiable invariants, runtime flow, package boundaries,
commands, and known documentation drift. Do not duplicate those rules here —
update `AGENTS.md` instead, so every agent sees the same instructions.

## Claude Code notes

- The skills named in the `AGENTS.md` §1 router are plain files, not registered
  with the Skill tool. Read `.agents/skills/<name>/SKILL.md` directly before
  editing that layer.

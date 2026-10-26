# vibe

12 Agent Skills, 5 commands and 2 subagents for shipping real software with any coding agent (Claude Code, Codex, Cursor, Copilot, Gemini CLI, OpenCode...): planning and domain analysis (`vibe-plan`), task cards and progress (`vibe-tasks`), following the codebase's architecture (`vibe-architecture`), backend with multi-tenant Postgres RLS, ORMs, auth, jobs, security and personal data (`vibe-backend`), web frontend (`vibe-frontend`), mobile (`vibe-mobile`), desktop (`vibe-desktop`), AI features (`vibe-ai`), code with tests including Playwright (`vibe-build`), evidence-based review (`vibe-review`), CI/CD, rollback, monitoring, backups and performance (`vibe-ship`), bugs and incidents (`vibe-fix`).

Commands: `/vibe-start`, `/vibe-status`, `/vibe-next`, `/vibe-check`, `/vibe-help` (Codex: `$vibe-start`). Or just talk: "plan a booking app for spas", "where are we?", "500 error when creating a customer".

Install (Claude Code 2.1.275+): `/plugin install vibe --marketplace HoangThai18/vibe-code-pro`. Other agents: `npx skills add HoangThai18/vibe-code-pro`. Full guide and verification notes: the repository README.

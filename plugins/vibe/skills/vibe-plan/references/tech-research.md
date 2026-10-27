# Technical research and reading tech-stack docs

Model knowledge has a cutoff date, while libraries keep changing (Next.js, Prisma, Tailwind, zod and React all had major versions that changed APIs in recent years). Using outdated or nonexistent APIs is one of the most common vibe-coding bugs. Rule: **the docs for the installed version are the source of truth, not memory.**

## When to do it

- Using a library, framework, service or API for the first time in the project, or unsure how to use it.
- Upgrading a major version.
- Errors like "is not a function", "unknown option", mismatched types: usually an API from another version.
- Choosing between options (libraries, services, architectures).

## 1. Find the real version

- JS/TS: `package.json` and the lockfile; `npm ls <package>` or `pnpm why <package>` shows the version actually installed.
- Python: `pyproject.toml`, `uv.lock`/`poetry.lock`, `pip show <package>`. Go: `go.mod`. Ruby: `Gemfile.lock`.
- Empty project: pick the latest stable version and record it in the note.

## 2. Read official sources, in order of trust

1. **Official docs for the exact version** (fetch the page; many sites have `/llms.txt`). If Context7 is available (`ctx7` CLI or MCP), use it, naming the library and version in the query; setup in `dev-tools.md` section 3 (same folder).
2. **Migration guide and changelog** when upgrading, or when examples online are for another version.
3. **Type definitions and source in `node_modules`** (or site-packages): the truth for the installed version. Unsure whether a function exists or what it takes? Open the `.d.ts` file.
4. GitHub issues/discussions for odd errors. Blogs and Stack Overflow last, and check the post date.

## 3. Choosing a library or service

| Criterion | Question |
|---|---|
| Maintained | Latest release? Are issues answered? |
| Fits the stack | Supports the runtime, framework, TypeScript in use? |
| Popularity | Downloads, community, docs? The more popular, the fewer wrong guesses the agent makes. |
| License | MIT/Apache: fine; GPL/AGPL: check against the business model |
| Cost and lock-in | Price at scale? Easy to leave? |
| Security and data | Where does customer data go (key for third-party SaaS)? |

Default to the "boring" option the team knows. Record the comparison table and the reason in the research note.

**Install the exact name.** Take a package's name from its official docs or registry page (npmjs.com, pypi.org, crates.io), never from memory: a near-miss name can be a typosquatted malicious package. Before `npm install` or `pip install`, open the registry page and check that it exists and links to the expected repository.

## 4. Spike when still unsure

A spike is a quick, time-boxed experiment that answers **one** technical question (e.g. "Does Prisma work with RLS through PgBouncer?"):

- Work on a `spike/<topic>` branch, set a limit (e.g. 1–2 hours), minimal code, no polish.
- The result is an answer + evidence (commands, output), recorded in the research note. Spike code is never merged straight into the product.

## 5. Record it so nobody looks it up again

- `docs/research/<topic>.md` from the RESEARCH.md template: version, doc links, key excerpts, a minimal working example, traps.
- Add 1–2 lines to "Stack notes" in `AGENTS.md` (e.g. "Tailwind 4: theme configured in CSS (`@theme`), no `tailwind.config.js` by default; see docs/research/tailwind.md"). Every agent reads AGENTS.md, so this is the cheapest way to avoid repeating a mistake.

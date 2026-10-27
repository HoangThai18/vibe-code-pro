# Designing AI features

## Contents
1. Should you use AI
2. Choose the feature shape
3. Choose model and effort
4. Feeding data: full context or retrieve first (RAG)
5. User experience
6. Data sent to the provider

## 1. Should you use AI

Use it when an "approximately right, the user can fix it" result is still useful: summaries, drafts, classification, extraction from free text, suggestions. Do not use it when code or SQL can do the job exactly: billing, permission checks, counting, key lookups. Questions for the PRD (the `vibe-plan` skill):

- What does the user do when the AI is wrong? Is there a review step before the result has consequences?
- What is "good enough"? Write a few example inputs with expected outputs: they seed the eval set (`testing.md`).
- Do the cost per use and estimated uses per month (`cost.md` section 1) fit the selling price?

## 2. Choose the feature shape

| Shape | When | Example |
|---|---|---|
| Single call | Clear input and output, one step | Summarize notes, classify a ticket, extract details from an email |
| Code-driven workflow | A few fixed steps; code decides the order | Classify → if it is a complaint, draft a reply → staff approves |
| Tool-using agent | Number of steps unknown up front; the model picks tools | Assistant answering appointment questions, looking up schedules and customers itself |

Start with the simplest shape that does the job. Agents cost more, run slower, are harder to test, and every tool is another path for prompt injection to do harm (`safety.md` section 3). For an agent using your own tools, the Anthropic SDK has a Tool Runner that handles the tool-call loop; the `claude-api` skill (if your agent has it) shows correct usage for the installed SDK.

## 3. Choose model and effort

- Default to the provider's recommended default model (at time of writing: `claude-opus-5-5`), set in config (`AI_MODEL`), not scattered through the code.
- `output_config.effort` (`low` to `max`) tunes thoroughness and token use: summaries, classification and short drafts usually do fine at `low`; multi-step analysis needs more. Defaults differ by model, so set it explicitly.
- Switching to a cheaper model (e.g. `claude-haiku-5-5`) for high-volume work is a product decision based on measurement: run the same eval set on both models and compare score and cost per completed task.
- Providers retire old models on a schedule: record the model in use and a re-check date in an ADR.

## 4. Feeding data: full context or retrieve first (RAG)

- **Small data** (one customer's notes, one email, one contract): put it straight into the prompt. Current models accept a great many tokens; this is simpler and more accurate than RAG.
- **Large data** (full help docs, thousands of tickets): retrieve the relevant parts first. Start with Postgres full-text search set up for Vietnamese: the `vibe-backend` skill (`references/search.md` section 5: `'simple'` configuration on `f_unaccent` text, since Postgres has no Vietnamese dictionary). Add vector search (pgvector + an embedding provider) only when you measure full-text search missing results.
- Whatever the method, **the search query must filter by tenant** like any other query, and run under RLS if the system uses RLS (the `vibe-backend` skill, `references/multi-tenant.md`). A shared vector index without a tenant filter is the fastest way for the AI to tell customer A about customer B's data.
- Include sources (document ids) so the UI can show "according to document X" and users can check.

## 5. User experience

- Stream long answers chunk by chunk (`integration.md` section 4), with a stop button; stopping cancels the API request.
- Label AI-generated content. Drafts sent to customers always pass through a user review-and-edit step.
- Errors, exhausted budget, model refusal: a short message plus how to continue manually; never an endless spinner.
- Let users rate quickly (useful / not useful) and store the rating with the call id: a source of real cases for the eval set.
- Tenants can turn AI features off (per-tenant flag), since some customers do not want their data going through an AI service.

## 6. Data sent to the provider

- Sending user data to an AI provider is a transfer to a processor, often abroad: state it in the privacy policy and customer contracts, and meet the legal requirements for personal data (the `vibe-backend` skill, `references/privacy.md`).
- Send only what the task needs: summarizing notes needs no phone numbers or emails (`safety.md` section 5).
- Read the provider's data retention policy and its zero data retention option if customers require it; some models have their own retention requirements.
- Never write full prompts and responses to regular logs. If you must keep them for debugging, use a separate table with a deletion deadline and restricted read access.

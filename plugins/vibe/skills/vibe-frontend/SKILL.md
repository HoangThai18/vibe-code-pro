---
name: vibe-frontend
description: "Web frontend: UI from mockups (Claude Design handoff, HTML export, Figma, screenshot) with design tokens, all states, motion spec, screenshot checks; state/stores (TanStack Query, SWR, RTK Query, Zustand, Redux Toolkit, Pinia, URL state, forms), cache invalidation, clearing cache on tenant switch or logout. Use for web screens from a design, prototype animations, choosing or fixing a store, stale or wrong data, excess re-renders. Mobile/desktop apps: their own skills. Small tweaks: just do them. Also use for Vietnamese requests like 'dựng màn hình theo mockup', 'làm animation', 'đổi workspace vẫn thấy dữ liệu cũ', 'dữ liệu hiển thị sai'."
---

# Frontend: UI from design, and state management

Read only what the current task needs:

| Task | Read |
|---|---|
| Building a new screen or component from a mockup or a Claude Design handoff | `references/design-to-code.md` |
| Animations and effects from a prototype | `references/motion-spec.md` |
| Stores, API data caching, forms, syncing on tenant switch | `references/state-management.md` |
| Slow pages, Core Web Vitals (LCP, INP, CLS), performance budgets | the `vibe-ship` skill (`references/performance.md` section 5) |

Frontend libraries change APIs fast (React, Next.js, Tailwind, TanStack Query all had recent major versions). Before using an API you're unsure of, check the installed version and the docs for that version (the `vibe-plan` skill, `references/tech-research.md`).

## Always

1. **Components use design tokens** (color, spacing, type, radius, motion); no hardcoded color codes or stray px values.
2. **All states**: loading, empty, error, disabled, plus hover/focus-visible. A screen that only looks good "with data" isn't done.
3. **Accessible**: semantic HTML, labeled inputs, keyboard usable, AA contrast, respects `prefers-reduced-motion`.
4. **API data is server state**: let the query library handle the cache; never copy it into a global store and sync it by hand.
5. **Tenant goes in the query key and in the request itself** (ideally in the URL), never relying on the session cookie's "current tenant"; keep previous data while loading (`keepPreviousData`) only within the same tenant; clear the cache on logout. Then a screen never shows the old workspace's data.
6. **Never store tokens or sensitive data in localStorage** when a safer option exists (httpOnly cookie).
7. **Data follows the backend contract**; if the BE isn't ready, use the contract's mock; never invent fields.

## Before calling it done

Run the app, take screenshots at 375 / 768 / 1280, compare with the mockup, check the states and Tab navigation. Reading code is not enough; look at real screenshots. How: `references/design-to-code.md`.

Screens in main flows (login, create order, payment, workspace switch): add or update a Playwright test for that flow (the `vibe-build` skill, `references/e2e-playwright.md`).

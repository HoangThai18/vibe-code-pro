# Design to code: from a Claude Design mockup to working UI

Goal: UI in code that matches the approved mockup (right tokens, states and motion) and is consistent with the codebase's design system. Not a "looks similar" page with hex codes scattered across components.

**Right-size it**: a new screen or flow gets all 5 steps. A small tweak on an existing screen: edit directly with existing tokens, then take one screenshot at the affected breakpoint; no inventory file.

## Inputs, best to worst

1. **Claude Design handoff bundle**: Claude Design packages a finished design for handoff to Claude Code. It has structure, tokens and prototype code, so it needs the least guessing.
2. **HTML/CSS export or a working prototype**: real values (colors, spacing, transitions) are readable in the CSS.
3. **Figma** (via the Figma MCP server if available: `get_variable_defs` for tokens, `get_design_context` for structure, `get_screenshot` to compare; the code it returns is only a description, so rebuild it with the project's components and tokens. Setup and call limits: the `vibe-plan` skill, `references/dev-tools.md` section 6).
4. **Screenshot**: requires estimating. Tell the user the result will be approximate, and ask for key values (font, main colors) you can't infer.

## Step 1: Inventory before coding → `docs/design/<feature>.md`

1. **Screens and routes**; layout at each breakpoint (375 / 768 / 1280+).
2. **Tokens**: colors by role (background, surface, text, muted, primary, danger...), type scale, spacing, radius, shadow. Name by role (`--color-primary`), not by value (`--blue-500`), so a theme change doesn't touch components.
3. **Components**: which are reused from the codebase, which are new. For each, list variants and states: default, hover, focus-visible, active, disabled, loading, empty, error.
4. **Motion spec**: every motion in the prototype goes in one table (see [motion-spec.md](motion-spec.md)).
5. **Data**: which field comes from which endpoint (check the contract), which text is fixed copy or i18n.

Where design and reality don't match (missing empty state, long text breaks the layout, real data differs from sample data), write it down and propose a fix to the user. Don't silently improvise: the design approver won't know anything changed.

## Step 2: Tokens into code first

Add tokens to the project's system (CSS variables, Tailwind theme, theme object...) before building components. Components use only tokens. If the project has a design system, map the design's tokens to existing ones; add new tokens only with a reason.

## Step 3: Build components small to large

- Prefer existing components; extend with variants instead of copying.
- Semantic HTML (buttons are `button`, links are `a`), labeled inputs, clearly visible focus-visible, WCAG AA contrast.
- If the BE isn't ready, use data from contract mocks (the `vibe-backend` skill, `references/api-contract.md`).
- Every state in the inventory must be viewable: Storybook if the project has it, otherwise a temporary demo route.

## Step 4: Motion

Implement motion to spec (property, duration, easing, delay) and check it against the checklist in [motion-spec.md](motion-spec.md) (`transform`/`opacity` only, reduced motion, shared tokens). Use the project's existing tool (CSS transitions/keyframes, Motion/Framer Motion, GSAP...); don't add a library for one effect.

## Step 5: Verify visually (required for UI)

Run the app, take screenshots at 375 / 768 / 1280, put them next to the mockup, list the differences (spacing, font size, color, alignment, line breaks) and fix them. Also check empty / loading / error states, keyboard navigation (Tab reaches everything, focus clearly visible), very long text, dark mode if any.

```js
// scripts/shot.mjs: node scripts/shot.mjs http://localhost:3101/customers [output-dir]
// Use the port of the dev server you are running (other agents may run the app on other ports).
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const url = new URL(process.argv[2] ?? 'http://localhost:3000/');
const outDir = process.argv[3] ?? 'docs/design/shots';
const name = url.pathname.replace(/^\/+|\/+$/g, '').replace(/[^\w-]+/g, '_') || 'home';
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
for (const width of [375, 768, 1280]) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  await page.goto(url.href);
  await page.waitForLoadState('load');
  // Wait for a main element of the screen, e.g.: await page.getByRole('heading').first().waitFor();
  await page.screenshot({ path: `${outDir}/${name}-${width}.png`, fullPage: true, animations: 'disabled' });
  await page.close();
}
await browser.close();
```

Screenshots are named by route and breakpoint, so shooting many screens never overwrites. An agent running in a worktree saves them in the worktree; the coordinator reviews them before removing the worktree, or commits them to `docs/design/shots/` if the team wants to keep them. No Playwright in the project? Use an available screenshot tool; you still must look at real screenshots, not just read code.

## Output

- UI code + tokens.
- `docs/design/<feature>.md`: inventory, motion spec, deviations from the design and why.
- Verification screenshots attached to the task report (or committed to `docs/design/shots/` if the team wants to keep them).

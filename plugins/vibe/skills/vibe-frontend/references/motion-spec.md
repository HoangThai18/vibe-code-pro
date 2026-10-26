# Motion spec

Write the spec before coding so motion in the app matches the prototype and stays consistent across screens. It also gives the reviewer something to check: "drawer opens in 200ms ease-out" is checkable, "smooth-ish" is not.

## Spec table

| Element | Trigger | Property | From → To | Duration | Easing | Delay | Notes |
|---|---|---|---|---|---|---|---|
| Form drawer | open | opacity, transform | 0, translateX(24px) → 1, none | 200ms | cubic-bezier(.2,.8,.2,1) | 0 | close: 150ms, ease-in |
| Toast | appear | opacity, transform | 0, translateY(8px) → 1, none | 180ms | ease-out | 0 | auto-hides after 4s |
| List item | enter screen | opacity, transform | 0, translateY(4px) → 1, none | 160ms | ease-out | 30ms × index (max 8 items) | stagger |
| Button | hover | background-color | token → darker token | 120ms | ease-out | 0 | |

## Getting values from the prototype

- **HTML/CSS export, handoff bundle**: search the CSS for `transition`, `animation`, `@keyframes`, `transform`; for JS animation (Motion, GSAP), read the duration, ease, delay, stagger parameters.
- **Only video or images**: propose values from the reference table below and mark them "estimated" in the spec so the design approver knows.

## Reference values

| Kind | Duration | Easing |
|---|---|---|
| Micro-interactions (hover, toggle, checkbox) | 100–150ms | ease-out |
| Small elements in/out (tooltip, dropdown, toast) | 150–200ms | ease-out in, ease-in out |
| Panel, modal, drawer | 200–300ms | cubic-bezier(.2,.8,.2,1) |
| Page transitions, hero | 300–500ms | ease-in-out |

Exit motion is usually about 25% faster than entry. Once the user decides to close, don't make them wait.

## Suggested tokens

```css
:root {
  --duration-fast: 120ms;
  --duration-base: 200ms;
  --duration-slow: 320ms;
  --ease-out: cubic-bezier(.2, .8, .2, 1);
  --ease-in: cubic-bezier(.4, 0, 1, 1);
  --ease-in-out: cubic-bezier(.4, 0, .2, 1);
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

## Checklist

- [ ] Animates only `transform` / `opacity` (exceptions have a recorded reason)
- [ ] Handles `prefers-reduced-motion`
- [ ] Animation never blocks input: clicks and typing work immediately
- [ ] No layout shift
- [ ] Uses shared motion tokens, no stray numbers in components
- [ ] Compared with the prototype at real speed (not just still images)

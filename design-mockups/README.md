# Design mockups — "Quiet Paper, Earned Moments"

Visual exploration only. **Nothing in this folder is part of the application.**

| File | What it is |
|---|---|
| `today-a.html` | Mockup A — a normal training day (Friday, five exercises) |
| `today-b.html` | Mockup B — an open day holding one optional Dead Hang |
| `mockup.css`   | The design-system hypothesis both mockups are built from |
| `index.html`   | Review harness: both screens in a 390×844 frame, with A/B and button-colour toggles |

View at **390 × 844**. Open `index.html` to compare, or either `today-*.html` directly
for a full-bleed phone view.

## Isolation

- Not referenced by `index.html` at the repository root, `app.js`, or any production module.
- Not listed in `sw.js` ASSETS, so it is never cached or served offline.
- No production imports, no service worker, no storage, no engine, no app state.
- Deleting this folder has no effect on the application.

These files are static and self-contained apart from one Google Fonts stylesheet
(Newsreader), which is the display-serif hypothesis under test. If that font does not
load, both mockups fall back to Georgia and remain readable.

## Content

Exercise names, prescriptions, the session title and the conditional rule
("only if forearms feel good") are taken from the real content bundle, not invented.
The illustrations are **placeholders** — present to test composition and scale at 52px,
not to set the future illustration library.

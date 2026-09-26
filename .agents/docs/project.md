# Project Context

## Verified commands

- Install development dependencies: `npm ci` (Node 22+, verified locally with Node 24).
- All local checks: `npm test` (existing archive core plus extension regression tests).
- Extension checks: `npm run test:extension`.
- Whitespace: `git diff --check`.
- Chrome installation and live validation: [`browser-extension/README.md`](../../browser-extension/README.md).

The Chrome extension exports JSON v2, Markdown, and an offline HTML reader directly. Its v2 IndexedDB store is independent of the original desktop capture format. Automated tests use synthetic content, jsdom, and fake-indexeddb; no paid scraping API is part of the test suite.

## Delivery agreement

The user's development agreement requires a task branch, validation, coherent commits, a push to the configured origin, and a draft PR. This takes precedence over the generic workflow template's branch-by-explicit-request wording. Do not commit to main or merge/deploy without authorization. Preserve unrelated working copies and never publish captured posts, browser state, or credentials.

---
name: dev-agent
description: Repository-specific development workflow for git-to.dev. Use when modifying this Next.js/React/TypeScript app, implementing features or fixes, reviewing repo changes, or planning engineering work that must be test-first, match existing patterns, favor usable outcomes over perfect abstractions, and balance SRE reliability with minimal front-end implementation.
---

# Dev Agent

## Operating stance

Act as a pragmatic maintainer of `git-to.dev`: a small Next.js app that resolves short, fuzzy paths to GitHub repositories and can shorten GitHub repository URLs. Optimize for safe, understandable changes that preserve the app's fast, minimal feel.

Think in two modes at the same time:

- **SRE:** protect correctness, rate limits, cache behavior, failure modes, observability-by-readable-errors, and graceful degradation.
- **Minimal front-end dev:** keep UI changes direct, accessible, responsive, and consistent with the current component/style vocabulary. Avoid decorative complexity unless it improves comprehension or task completion.

## Required workflow

1. **Read the relevant existing code and tests first.** Identify the current pattern before proposing a new one.
2. **Write or update tests before implementation.** For every behavior change, first add a failing Vitest test that describes the desired behavior. If the change is UI-only and no practical test harness exists, state why and make the smallest manual-checkable change.
3. **Implement the smallest useful fix.** Prefer narrow edits over broad rewrites. Do not introduce new dependencies unless the existing stack cannot reasonably solve the problem.
4. **Run focused tests, then broader checks.** Start with the touched test file when possible, then run the repo's standard checks before finalizing.
5. **Commit only after validation.** Keep the commit focused and leave the working tree clean except for intentional generated artifacts.

## Repository patterns to preserve

- Use `pnpm` scripts from `package.json`: `pnpm test`, `pnpm lint`, and `pnpm build` for validation.
- Keep domain logic in `lib/` and cover it with Vitest tests in `tests/`.
- Mock external services in tests. Do not let unit tests call GitHub, Redis, or other network services.
- Preserve fuzzy matching semantics: structural match quality beats popularity; stars are only a tie-breaker among otherwise equal repository matches.
- Treat GitHub API rate limits and unavailable services as product states, not crashes.
- Keep API route behavior simple: parse input, call library logic, return clear JSON or redirect responses.
- Keep client components lean. Prefer existing `components/ui/*`, Tailwind utility classes, semantic HTML, labels, focus states, and plain React state/effects.
- Maintain TypeScript clarity with explicit exported types for shared domain results and no unnecessary abstraction layers.

## Test-first expectations

When changing behavior:

- Add the expectation in the closest existing `tests/*.test.ts` file before editing implementation.
- Use local fixture builders or mocks that match nearby tests.
- Assert user-visible/domain-visible outcomes instead of implementation details.
- Cover failure paths for invalid input, rate limiting, cache misses/failures, ambiguous fuzzy matches, or redirect behavior when those are touched.

When changing UI:

- Prefer extracting pure formatting or state helpers into testable code only if it simplifies the change.
- Otherwise validate with `pnpm lint`, `pnpm build`, and a concise manual check description.
- If the UI visibly changes in a runnable app, take a screenshot after running it.

## Usability over perfection

- Choose the path that makes the product easier to understand or more reliable for users today.
- Make error messages actionable and human-sized.
- Avoid idealized architecture, speculative extensibility, and large refactors in feature/fix changes.
- Prefer a slightly repetitive pattern already used in the app over a new generalized abstraction.
- Keep loading, empty, miss, and rate-limited states clear and non-blocking.

## SRE checklist

Before finalizing, consider:

- Will this accidentally increase GitHub API calls, Redis calls, or request fan-out?
- Does it handle missing environment variables and unauthenticated GitHub access gracefully?
- Are cache keys stable and scoped to the exact behavior being cached?
- Are user inputs normalized and validated before external calls?
- Do failures resolve to explicit miss/rate-limited states instead of unhandled exceptions?
- Is the behavior deterministic enough to test without real network access?

## Front-end checklist

Before finalizing UI changes, consider:

- Can keyboard users complete the task?
- Are labels, button text, and status messages clear without reading code?
- Does the layout stay useful on narrow screens?
- Does the new UI use existing colors, borders, spacing, radius, and typography conventions?
- Is the result simpler than the alternative?

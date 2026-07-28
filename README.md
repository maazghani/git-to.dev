# [git-to.dev](https://git-to.dev)

`git-to.dev` resolves short, fuzzy paths to GitHub repositories. A path such as
`git-to.dev/oai/cx` matches an owner and repository, then redirects to the best
matching GitHub URL. It can also find the shortest unambiguous path for a given
repository. No account or stored short-link record is required.

The application is built with Next.js, React, TypeScript, and Tailwind CSS. It
uses the GitHub REST API for owner and repository discovery.

## Local development

```bash
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000). Set `GITHUB_TOKEN` (or
`GH_TOKEN`) to increase GitHub API rate limits; unauthenticated requests are
supported.

## Checks

```bash
pnpm lint
pnpm build
```

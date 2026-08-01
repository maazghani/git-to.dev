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

## Docker

Build and run the production image:

```bash
docker build -t git-to-dev .
docker run --rm -p 3000:3000 git-to-dev
```

The image uses Next.js standalone output and runs as an unprivileged user. To use
authenticated GitHub API requests, pass a token when starting the container:

```bash
docker run --rm -p 3000:3000 -e GITHUB_TOKEN git-to-dev
```

## Development container

Open the repository in a [Development Containers](https://containers.dev/)
compatible editor and choose **Reopen in Container**. The development container
builds the `development` target from the same `Dockerfile`, installs the locked
dependencies, and forwards port 3000. Start the app from its terminal with:

```bash
pnpm dev
```

## Learn More

```bash
pnpm lint
pnpm build
```

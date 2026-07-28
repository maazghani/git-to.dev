# shr.tn-ou

This is a [Next.js](https://nextjs.org) project bootstrapped with [v0](https://v0.app).

## Built with v0

This repository is linked to a [v0](https://v0.app) project. You can continue developing by visiting the link below -- start new chats to make changes, and v0 will push commits directly to this repo. Every merge to `main` will automatically deploy.

[Continue working on v0 →](https://v0.app/chat/projects/prj_f7VfliUaYhJqAcvVZrK27QHPdbom)

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

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

To learn more, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.
- [v0 Documentation](https://v0.app/docs) - learn about v0 and how to use it.

ARG VARIANT=22-bookworm

FROM mcr.microsoft.com/devcontainers/javascript:1-${VARIANT}

ARG PNPM_VERSION=10.14.0

RUN npm install --global "pnpm@${PNPM_VERSION}"

ENV NEXT_TELEMETRY_DISABLED=1

ARG NODE_VERSION=22
ARG PNPM_VERSION=10.14.0

FROM node:${NODE_VERSION}-bookworm

ARG PNPM_VERSION

RUN apt-get update \
    && apt-get install --yes --no-install-recommends \
        ca-certificates \
        curl \
        git \
        make \
        g++ \
        python3 \
    && npm install --global "pnpm@${PNPM_VERSION}" \
    && rm -rf /var/lib/apt/lists/*

ENV NEXT_TELEMETRY_DISABLED=1

WORKDIR /workspaces

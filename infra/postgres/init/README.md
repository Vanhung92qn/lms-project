# Postgres init

This directory is mounted into the Postgres container at
`/docker-entrypoint-initdb.d/`. SQL files here run once, on first start
of a fresh data volume.

Currently empty by design. Prisma owns extension creation via the
`postgresqlExtensions` preview feature (see `apps/api-core/prisma/schema.prisma`),
so pre-creating them here would race Prisma and trigger "drift detected"
on `prisma migrate dev`.

Put init SQL here only when it genuinely must run before the first
migration — e.g. role creation for a future read-only DB user.

# PostgreSQL storage fix

## Root cause
The previous Render Free version stored meetings in local SQLite (`meetings.db`).
Render Free web services use an ephemeral filesystem. Local files are lost on
redeploy, restart, and free-service spin-down.

## Fix
This version provisions a Free Render PostgreSQL database and injects its
internal connection string as `DATABASE_URL`.

When `DATABASE_URL` exists:
- users persist in PostgreSQL
- sessions persist in PostgreSQL
- folders persist in PostgreSQL
- meetings persist in PostgreSQL
- shares persist in PostgreSQL
- translations persist in PostgreSQL

When `DATABASE_URL` is absent:
- local development automatically falls back to SQLite.

## Free Render PostgreSQL limitation
The Free Render PostgreSQL instance expires 30 days after creation.
This is suitable for the current MVP verification but not permanent production.

Before the 30-day expiration:
- upgrade/migrate the DB, or
- move to another persistent PostgreSQL provider.

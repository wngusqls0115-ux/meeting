# CURRENT MODE: RENDER FREE TEST

This package intentionally does NOT use a persistent disk.
SQLite data may be lost when the Render instance is recreated/redeployed.
Use only for public-link/authentication/functionality verification.

# Deployment checklist

## Required environment variables

APP_ADMIN_EMAIL=admin@company.com
APP_ADMIN_PASSWORD=use-a-strong-password
APP_ADMIN_NAME=관리자

PLAUD_WEBHOOK_SECRET=use-a-long-random-secret

OPENAI_API_KEY=your-openai-api-key
OPENAI_TRANSLATION_MODEL=gpt-5.6-luna

COOKIE_SECURE=true
COOKIE_SAMESITE=lax
FRONTEND_ORIGINS=https://YOUR_PUBLIC_DOMAIN

## Minimum production requirements

- HTTPS enabled
- Persistent storage for meetings.db, or migrate SQLite to PostgreSQL
- Backups enabled
- Secret values stored as environment variables, never in browser JavaScript
- No public signup
- Admin-created user accounts only
- Authentication required for all meeting content APIs

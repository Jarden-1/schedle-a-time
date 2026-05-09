# Meet Backend

Node.js/Express backend for the time scheduler mini program.

## Setup

```bash
npm install
cp .env.example .env
npm test
```

Required environment variables are listed in `.env.example`.

## Scripts

- `npm test`: run smoke and integration tests
- `npm run migrate:backfill`: backfill historical event data

## Runtime Notes

- Runtime uploads are stored in `uploads/` and are intentionally ignored by Git.
- Secrets must stay in `.env`; do not commit production credentials.

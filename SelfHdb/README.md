# SelfHdb

`SelfHdb` is the self-hosted backend for the Calendar App. It is a personal-first sync server that keeps calendar data available 24/7 while the Electron app stays local-first.

## What It Does

- Stores server-encrypted calendar content in Postgres
- Issues short-lived access tokens and rotating refresh sessions
- Registers trusted devices and pairing approvals
- Accepts signed sync envelopes from the desktop app
- Holds Google/Microsoft provider tokens for hosted account sync

## Run Locally

1. Copy `.env.example` to `.env`
2. Fill in the base64 secrets and OAuth credentials
3. Start Postgres and the API:

```bash
docker compose up --build
```

Or run without Docker:

```bash
npm install
npm run migrate
npm start
```

## HTTPS

Production deployments should run behind HTTPS via Caddy, Nginx, or another reverse proxy. Set `PUBLIC_BASE_URL` to the external HTTPS origin and keep `ALLOW_INSECURE_HTTP=false`.

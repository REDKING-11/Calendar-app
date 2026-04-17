# SelfHdb

`SelfHdb` is the optional hosted backend for the Calendar App. The desktop app stays local-first; this backend adds account auth, trusted devices, persistent hosted sync, and server-side materialized metadata on normal PHP hosting.

## Stack

- PHP 8.1+
- MySQL / MariaDB via PDO
- Apache / cPanel friendly routing
- REST + JSON

## Layout

- `public/` public web root and front controller
- `src/` PHP application code
- `config/` bootstrapping
- `database/schema.sql` database schema
- `bin/migrate.php` schema installer

## Setup

1. Copy `.env.example` to `.env`.
2. Fill in the database credentials and token secret.
3. Create the MySQL / MariaDB database.
4. Run `php -n bin/migrate.php` or import `database/schema.sql`.
5. Point the web root to `public/`.

## Production Notes

- Keep `APP_FORCE_HTTPS=true` in production.
- Store `.env` outside public web access.
- The backend now implements local `email + password` auth for hosted mode.

## Current Client Contract Note

The Electron client in `Application/` still contains an older provider-start/poll hosted auth flow. This backend implements the new local-auth contract from the current backend plan, so the client will need a follow-up integration pass for direct register/login UX.

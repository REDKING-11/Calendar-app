# SelfHdb

`SelfHdb` is the optional self-hosted backend for Calendar App. The desktop app remains local-first; this PHP backend adds hosted auth, trusted devices, persistent sync, admin-managed invite keys, and privacy-filtered calendar sharing.

## Stack

- PHP 8.1+
- MySQL / MariaDB through PDO
- Apache / cPanel friendly routing
- REST + server-rendered setup/admin/share pages

## First Install

1. Upload the `SelfHdb` folder to the PHP host.
2. Point the site or subfolder web root at `SelfHdb/public`.
3. Open the hosted URL in a browser.
4. Complete the setup page with the MySQL credentials and first admin account.
5. If the host cannot write `.env`, copy the generated `.env` content into `SelfHdb/.env` and reload.

After setup, `/setup` is no longer the normal entrypoint. The site shows login/admin pages, and new user registration requires an invite key created by an admin.

## Main Pages

- `/setup` - first-visit guided installer.
- `/login` - browser login.
- `/admin` - users, invite keys, owned shares, and audit log.
- `/shared-with-me` - authenticated organization shares for the logged-in user.
- `/share/{token}` - public browser view for token-based shares.

## API Highlights

- `GET /v1/bootstrap/status`
- `POST /v1/setup/install`
- `POST /v1/auth/register`
- `POST /v1/auth/login`
- `GET /v1/admin/users`
- `POST /v1/admin/users`
- `GET /v1/admin/invite-keys`
- `POST /v1/admin/invite-keys`
- `GET /v1/admin/audit`
- `GET /v1/shares`
- `POST /v1/shares`
- `POST /v1/shares/{id}/recipients`
- `POST /v1/shares/{id}/rotate-token`
- `GET /v1/share/{token}`

## Sharing

Share privacy levels:

- `busy_only` shows time blocks with a generic `Busy` title.
- `titles_only` keeps titles and time only.
- `full_details` includes normal display fields, excluding provider secrets and internal token data.

Private/internal events default to busy blocks. A share can explicitly hide them or include details according to the selected privacy level.

Access modes:

- `link` creates a token link.
- `org` makes the share available only to listed SelfHdb users.
- `link_org` supports both.

## Production Notes

- Keep `APP_FORCE_HTTPS=true` in production.
- Keep `.env` outside public web access; the public web root should be `public/`.
- OAuth access/refresh tokens remain local to the desktop app and are not stored in SelfHdb.

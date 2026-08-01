# Admin tools

Two small local-only tools to replace what Supabase's cloud dashboard used to give you:
a database browser (Adminer) and a deploy control panel. Both are designed to be reachable
**only through an SSH tunnel** — neither is meant to be exposed on the public internet.

You already SSH into the server manually, so tunneling adds one extra command to your normal
workflow and keeps both tools off the public internet entirely.

---

## 1. Database browser (Adminer)

Adminer is a single well-maintained container — a full table browser/editor for Postgres,
similar to what you had in Supabase Studio.

**Setup (on the server):**

```bash
cd admin-tools/adminer
# If your Postgres runs in Docker on a shared network, set DB_HOST to that
# container's service name instead of the default (host.docker.internal).
docker compose up -d
```

This binds Adminer to `127.0.0.1:8081` on the server — not reachable from outside.

**Using it (from your own machine):**

```bash
ssh -L 8081:localhost:8081 your_user@true-fitness.in
```

Then open `http://localhost:8081` in your own browser. Log in with:
- System: **PostgreSQL**
- Server: `localhost` (or whatever `DB_HOST` you set)
- Username / Password / Database: your Postgres credentials (same ones in `backend/.env`)

---

## 2. Deploy dashboard

A minimal password-protected web page with three buttons: **Deploy latest**, **Restart backend**,
**View logs**. Each button runs a fixed shell script on the server — there is no free-text
command box, so it can't be used to run arbitrary commands even if someone got the token.

**Before first use, edit the scripts to match your server:**

- [admin-tools/deploy-dashboard/scripts/deploy.sh](deploy-dashboard/scripts/deploy.sh) — set `REPO_PATH` to where the repo lives on the server, and confirm `SERVICE_NAME`.
- [admin-tools/deploy-dashboard/scripts/restart.sh](deploy-dashboard/scripts/restart.sh) and [logs.sh](deploy-dashboard/scripts/logs.sh) — set `SERVICE_NAME` to match how the backend actually runs (pm2 process name, or systemd unit). If you're not using pm2, comment out the `pm2 ...` line and uncomment the `systemctl`/`journalctl` line instead.

Test each script by running it directly over SSH first (`bash scripts/deploy.sh`) before wiring it
into the dashboard, so you're not debugging both at once.

**Setup (on the server):**

```bash
cd admin-tools/deploy-dashboard
cp .env.example .env
# generate a strong token and put it in .env as ADMIN_TOKEN:
openssl rand -hex 32
npm install
npm start
```

Run it under pm2/systemd like any other long-lived process so it survives reboots, e.g.:

```bash
pm2 start server.js --name truefitness-deploy-dashboard
```

**Using it (from your own machine):**

```bash
ssh -L 4001:localhost:4001 your_user@true-fitness.in
```

Then open `http://localhost:4001`, enter the `ADMIN_TOKEN` you generated, and use the buttons.

---

## Security notes

- Both tools bind to `127.0.0.1` on the server by default — do not change this to `0.0.0.0`
  or add a public nginx route to them. The SSH tunnel is the access control.
- `admin-tools/deploy-dashboard/.env` holds a secret token — it's covered by the repo's root
  `.gitignore` (`.env`), but double check `git status` before committing anything in this folder.
- The deploy dashboard only ever runs the three fixed scripts in `scripts/` — it never executes
  a command that comes from the browser. Keep it that way; don't add a free-text command field.
- If you ever want browser access without an SSH tunnel, that requires HTTPS + a real login
  system in front of it — worth a separate conversation rather than bolting it on ad hoc.

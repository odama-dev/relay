# Deploy ke VPS — Supabase self-hosted + Odama OS

> **Legacy.** Production Odama OS sekarang di **Supabase Cloud + Vercel**
> (`docs/SUPABASE_SETUP.md` §3). Dokumen ini disimpan sebagai alternatif kalau
> suatu saat perlu self-host; isinya tidak lagi dirawat bersama rilis.

Satu VPS menjalankan semuanya (PRD "Stack & arsitektur"):

| Komponen | Jalan sebagai | Port internal | Domain (contoh) |
| --- | --- | --- | --- |
| Supabase (Postgres, Auth, Storage, Studio) | Docker Compose | Kong `8000`, Postgres `5432` | `api.odama.io` |
| Odama OS (Next.js) | systemd | `3000` | `os.odama.io` |
| Caddy (reverse proxy + HTTPS) | systemd | `80` / `443` | — |
| Job terjadwal | cron user `odama` | — | — |

Staging = VPS yang sama polanya dengan data dummy, Xendit mode **test** dan
Slack channel/workspace uji. Production = Xendit mode **live**.

> Semua perintah untuk **Ubuntu 24.04 LTS**. Ganti `odama.io` dengan domain kamu.

## 1. Spesifikasi & DNS

Minimal 2 vCPU / 4 GB RAM / 40 GB SSD (disarankan 4 vCPU / 8 GB). Supabase makan
±2–3 GB RAM; `next build` dan Chrome (PDF invoice) butuh ±1,5 GB. Dengan 4 GB,
**wajib swap**.

DNS: `A os.odama.io → IP VPS`, `A api.odama.io → IP VPS`.

## 2. Persiapan server

```bash
ssh root@<IP>
apt update && apt upgrade -y
adduser odama && usermod -aG sudo odama
ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw enable
fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
curl -fsSL https://get.docker.com | sh && usermod -aG docker odama
curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt install -y nodejs postgresql-client rclone
npm install -g pnpm@10
```

## 3. Supabase self-hosted

```bash
su - odama
git clone --depth 1 https://github.com/supabase/supabase
mkdir -p ~/supabase-project && cp -rf supabase/docker/* ~/supabase-project
cp supabase/docker/.env.example ~/supabase-project/.env
cd ~/supabase-project && docker compose pull
```

Buat secret (JWT, anon key, service role key, password Postgres) — ikuti
panduan resmi "Self-Hosting with Docker → Generate API keys", atau script yang
sama dengan versi sebelumnya. Simpan di password manager.

Isi `~/supabase-project/.env`:

```bash
POSTGRES_PASSWORD=<hex, tanpa simbol>
JWT_SECRET=...
ANON_KEY=...
SERVICE_ROLE_KEY=...
DASHBOARD_USERNAME=odama
DASHBOARD_PASSWORD=...
SITE_URL=https://os.odama.io
ADDITIONAL_REDIRECT_URLS=https://os.odama.io/auth/callback,https://os.odama.io/auth/confirm
API_EXTERNAL_URL=https://api.odama.io
SUPABASE_PUBLIC_URL=https://api.odama.io
DISABLE_SIGNUP=true
ENABLE_EMAIL_SIGNUP=true
ENABLE_EMAIL_AUTOCONFIRM=false
ENABLE_ANONYMOUS_USERS=false
SMTP_ADMIN_EMAIL=no-reply@odama.io
SMTP_HOST=smtp.resend.com
SMTP_PORT=465
SMTP_USER=resend
SMTP_PASS=<RESEND_API_KEY>
SMTP_SENDER_NAME=Odama OS
```

Kunci semua port ke localhost: di `docker-compose.yml`, beri prefix
`127.0.0.1:` pada setiap mapping `ports:` (Kong, Postgres/Supavisor). Lalu:

```bash
docker compose up -d && docker compose ps     # tunggu semua healthy
```

Di Studio (lewat SSH tunnel `ssh -L 8000:localhost:8000 odama@<IP>` →
http://localhost:8000): **Storage → New bucket** `task-images`, `invoices` dan
`receipts`, semuanya **private**, tanpa policy.

## 4. Odama OS

```bash
cd ~ && git clone <repo> odama-os && cd odama-os
cp .env.example .env && chmod 600 .env && nano .env
```

```bash
# Database — koneksi langsung (session) ke Postgres Supabase di VPS ini
DATABASE_URL="postgresql://postgres:<POSTGRES_PASSWORD>@127.0.0.1:5432/postgres?schema=public&connection_limit=10"
DIRECT_URL="postgresql://postgres:<POSTGRES_PASSWORD>@127.0.0.1:5432/postgres?schema=public"
NEXT_PUBLIC_SUPABASE_URL="https://api.odama.io"
NEXT_PUBLIC_SUPABASE_ANON_KEY="<ANON_KEY>"
SUPABASE_SERVICE_ROLE_KEY="<SERVICE_ROLE_KEY>"
NEXT_PUBLIC_APP_URL="https://os.odama.io"
INTERNAL_APP_URL="http://127.0.0.1:3000"
ADMIN_EMAILS="hellorafi@odama.io"
RESEND_API_KEY="re_..."
MAIL_FROM="Odama OS <no-reply@odama.io>"
SLACK_BOT_TOKEN="xoxb-..."
XENDIT_SECRET_KEY="xnd_development_... (staging) / xnd_production_... (production)"
XENDIT_CALLBACK_TOKEN="<sama dengan Callback verification token di dashboard Xendit>"
CRON_SECRET="<openssl rand -hex 32>"
```

- **Jangan** set `DEV_AUTH_BYPASS` di server.
- `NEXT_PUBLIC_*` ditanam saat build — ubah → `pnpm build` ulang.

Install, migrasi, build:

```bash
pnpm install --frozen-lockfile
sudo npx puppeteer browsers install chrome --install-deps     # library Chrome untuk PDF
pnpm prisma migrate deploy        # BUKAN migrate dev / db:seed di production
pnpm build
node --env-file=.env scripts/create-admin.mjs hellorafi@odama.io "Rafi Rohmat" "<password>"
```

Ubuntu 24.04 memblokir sandbox Chrome lewat AppArmor (`No usable sandbox!` di
log). Izinkan Chrome milik puppeteer (satu baris):

```bash
sudo sh -c 'printf "%s\n" "abi <abi/4.0>," "include <tunables/global>" "profile puppeteer-chrome /home/odama/.cache/puppeteer/chrome/*/chrome-linux64/chrome flags=(unconfined) {" "  userns," "}" > /etc/apparmor.d/puppeteer-chrome' && sudo apparmor_parser -r /etc/apparmor.d/puppeteer-chrome
```

Service `/etc/systemd/system/odama-os.service`:

```ini
[Unit]
Description=Odama OS (Next.js)
After=network.target docker.service

[Service]
User=odama
WorkingDirectory=/home/odama/odama-os
Environment=NODE_ENV=production
Environment=PORT=3000
Environment=HOSTNAME=127.0.0.1
ExecStart=/usr/bin/pnpm start
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload && sudo systemctl enable --now odama-os
curl -I http://127.0.0.1:3000/login     # → 200
```

## 5. Caddy (HTTPS)

```bash
sudo apt install -y caddy
sudo tee /etc/caddy/Caddyfile >/dev/null <<'EOF'
os.odama.io {
	encode zstd gzip
	reverse_proxy 127.0.0.1:3000
}
api.odama.io {
	reverse_proxy 127.0.0.1:8000
}
EOF
sudo systemctl reload caddy
```

## 6. Integrasi

- **Slack:** buat Slack app dengan bot, scope `users:read`, `users:read.email`,
  `chat:write`, `im:write`, install ke workspace, salin Bot token ke
  `SLACK_BOT_TOKEN`. Setelah restart: **Settings → Slack → Retry all**, lalu
  **Send test DM to everyone** (DoD M0).
- **Xendit:** Dashboard → Settings → Webhooks → *Invoices paid*:
  `https://os.odama.io/api/webhooks/xendit`. Salin *Callback verification token*
  ke `XENDIT_CALLBACK_TOKEN`. Pakai key test di staging.
- **Resend:** verifikasi domain; isi sender di **Settings → Invoices**.

## 7. Job terjadwal (cron, WIB)

`crontab -e` sebagai user `odama` (VPS di UTC — jam sudah dikonversi dari WIB):

```cron
CRON_TZ=Asia/Jakarta
APP=http://127.0.0.1:3000/api/cron
AUTH="Authorization: Bearer <CRON_SECRET>"
0 9 * * *    curl -fsS -H "$AUTH" $APP/due-reminders      >/dev/null
0 17 * * 1-5 curl -fsS -H "$AUTH" $APP/time-reminders     >/dev/null
30 17 * * *  curl -fsS -H "$AUTH" $APP/oos-digest         >/dev/null
0 0 * * 1    curl -fsS -H "$AUTH" $APP/lock-timesheets    >/dev/null
5 0 1 * *    curl -fsS -H "$AUTH" $APP/retainer-rollover  >/dev/null
10 0 * * *   curl -fsS -H "$AUTH" $APP/overdue-invoices   >/dev/null
15 * * * *   curl -fsS -H "$AUTH" $APP/budget-alerts      >/dev/null
20 * * * *   curl -fsS -H "$AUTH" $APP/review-sla         >/dev/null
0 1 1 * *    curl -fsS -H "$AUTH" $APP/kpi-snapshot       >/dev/null
55 23 * * *  curl -fsS -H "$AUTH" $APP/pipeline-snapshot  >/dev/null
0 2 * * *    set -a; . /home/odama/odama-os/.env; BACKUP_REMOTE=r2:odama-backups /home/odama/odama-os/scripts/backup.sh >> /home/odama/backup.log 2>&1
```

- Jam pengingat log di Settings default 17:00; kalau diubah, sesuaikan baris
  `time-reminders`. Job memeriksa sendiri apakah hari ini hari kerja.
- Semua job aman dijalankan ulang; hasilnya terlihat di **Settings → Scheduled jobs**.
- Kalau cron tidak mendukung `CRON_TZ`, ubah jam ke UTC (WIB − 7).

## 8. Backup & uji restore

`scripts/backup.sh` membuat `pg_dump` harian dan mengunggah ke object storage di
luar VPS dengan `rclone` (retensi default 30 hari, PRD minimal 14). Setup sekali:
`rclone config` → buat remote (mis. Cloudflare R2 bernama `r2`).

**Uji restore sebelum launch** (DoD Fase 1):

```bash
rclone copy r2:odama-backups/odama-<stamp>.dump /tmp/
createdb -h 127.0.0.1 -U postgres odama_restore
pg_restore -h 127.0.0.1 -U postgres --no-owner --dbname=odama_restore /tmp/odama-<stamp>.dump
psql -h 127.0.0.1 -U postgres -d odama_restore -c "select count(*) from projects"
dropdb -h 127.0.0.1 -U postgres odama_restore
```

## 9. Update / redeploy

```bash
cd ~/odama-os && git pull
pnpm install --frozen-lockfile
pnpm prisma migrate deploy     # backup dulu kalau ada migration baru
pnpm build && sudo systemctl restart odama-os
```

## 10. Checklist setelah deploy

- [ ] `https://os.odama.io` → login, HTTPS valid; tidak ada halaman daftar.
- [ ] Admin login → **People → Invite person** → email masuk → link valid 7 hari → buat password → masuk.
- [ ] Login user yang dinonaktifkan → pesan "account has been deactivated".
- [ ] **Settings → Slack** → semua user linked → test DM diterima.
- [ ] Project + task + log time → health project bergerak.
- [ ] Invoice → **Send to client** → email + PDF + link Xendit (mode test) → bayar di Xendit test → status Paid, Finance dapat DM.
- [ ] Dari laptop: `nc -zv <IP> 5432` dan `nc -zv <IP> 8000` **gagal** (port tertutup).
- [ ] `sudo reboot` → Supabase, app, Caddy hidup lagi sendiri.
- [ ] Restore backup berhasil (bagian 8).

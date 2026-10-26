# Setup Supabase — lokal, production (Supabase Cloud + Vercel) & Auth

Odama OS memakai Supabase untuk **Postgres (dengan RLS)**, **Auth** (email +
password, hanya lewat undangan) dan **Storage** (bucket privat). Skema dan
policy dikelola **Prisma** (`prisma/migrations`), bukan migration Supabase.

Tiga lingkungan:

| | Database | Auth + Storage | App |
| --- | --- | --- | --- |
| Lokal | Supabase CLI (Docker), `127.0.0.1:54322` | Supabase CLI | `pnpm dev` |
| Production | **Supabase Cloud** (Singapore), lewat Supavisor pooler | Supabase Cloud | **Vercel** `sin1` |
| Legacy | Supabase self-hosted di VPS (`docs/VPS_DEPLOY.md`) | sama | systemd |

## 1. Lokal (development)

Butuh Docker Desktop (±4–5 GB image saat pertama kali).

```bash
pnpm install
pnpm db:up                 # = supabase start (config: supabase/config.toml)
pnpm exec supabase status -o env   # ANON_KEY, SERVICE_ROLE_KEY (JWT, sama formatnya dengan Cloud → Legacy keys)
```

Pakai `ANON_KEY` / `SERVICE_ROLE_KEY` (JWT), bukan `sb_publishable_…` / `sb_secret_…`
yang tampil di `supabase start` — app dan seed memakai key JWT; di Supabase Cloud
key yang sama ada di Settings → API Keys → **Legacy**.

Isi `.env` (salin dari `.env.example`):

```bash
DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres?schema=public"
DIRECT_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres?schema=public"
TEST_DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54322/odama_test?schema=public"
NEXT_PUBLIC_SUPABASE_URL="http://127.0.0.1:54321"
NEXT_PUBLIC_SUPABASE_ANON_KEY="<anon key>"
SUPABASE_SERVICE_ROLE_KEY="<service_role key>"
ADMIN_EMAILS="hellorafi@odama.io"
SEED_PASSWORD="odama-dev-123"
# DEV_AUTH_BYPASS harus mati (dikomentari) supaya login lewat Supabase Auth.
```

Lalu:

```bash
docker exec supabase_db_odama-os psql -U postgres -c "create database odama_test"   # sekali, untuk pnpm test:rls
pnpm exec supabase seed buckets --local   # sekali; bucket dari config.toml
pnpm db:migrate            # schema + RLS
pnpm db:seed               # user per role (auth.users ikut dibuat) dengan SEED_PASSWORD
pnpm db:seed:history       # opsional, sekali: data setahun
pnpm dev
```

- Email (undangan, reset password) masuk ke **Mailpit**: http://127.0.0.1:54324
  — atau ke log server kalau `RESEND_API_KEY` kosong.
- Studio: http://127.0.0.1:54323.
- Bucket `task-images`, `invoices`, `receipts`, `evidence` dan `payment-proofs`
  dibuat dari `supabase/config.toml` (privat, tanpa storage policy).

**Tanpa Docker:** Postgres biasa (mis. `brew install postgresql@16`) juga bisa —
migration membuat role `authenticated`/`anon` sendiri. Kosongkan variabel
Supabase dan set `DEV_AUTH_BYPASS=true`; ganti peran lewat `DEV_AUTH_EMAIL`.
File upload disimpan di `./.data/storage`.

## 2. Aturan yang sudah diatur di `supabase/config.toml`

| Setting | Nilai | Alasan |
| --- | --- | --- |
| `auth.enable_signup` | `false` | Tidak ada halaman daftar publik (M0.2). Akun dibuat app lewat admin API. |
| `auth.email.enable_signup` | `true` | **Harus `true`**: ini menyalakan provider email (login password). Kalau `false`, login ditolak `email_provider_disabled`. Signup tetap tertutup oleh baris di atas. |
| `auth.email.enable_confirmations` | `false` | Undangan sudah memverifikasi email. |
| `site_url` / `additional_redirect_urls` | `http://localhost:3000/**` | Link reset password kembali ke `/auth/callback`. |
| Bucket `task-images` | privat, 10 MB, gambar saja | M2.5 |
| Bucket `invoices` | privat, PDF | M5.3 |
| Bucket `receipts` | privat, 10 MB, PDF + gambar | Expenses |
| Bucket `evidence` | privat, 10 MB, PDF + gambar | KPI/OKR evidence |
| Bucket `payment-proofs` | privat, 10 MB, PDF + gambar | Bukti bayar invoice |
| Edge runtime, analytics, realtime | mati | Tidak dipakai (image realtime juga gagal jalan di Apple Silicon). |

## 3. Production (Supabase Cloud + Vercel)

Ini jalur production yang dipakai. Semua perintah di bawah dijalankan dari
mesin developer; Vercel hanya menjalankan app.

1. **Buat project** di supabase.com, region **Southeast Asia (Singapore)**
   (`ap-southeast-1`, terdekat ke Jakarta & ke region Vercel `sin1`). Project
   production: `ytduomlxaozuukwiguar`, pooler
   `aws-0-ap-southeast-1.pooler.supabase.com` (project percobaan pertama di
   Seoul, `dmnckyodwxjfpubrbhjo`, ditinggalkan 2026-10-26). Simpan password
   database: Dashboard hanya menampilkannya sekali, reset lewat
   Project Settings → Database → *Reset database password* (URL langsung:
   `/dashboard/project/<ref>/settings/database`), berlaku setelah 1–2 menit.
2. **`.env.cloud`** (sudah di-ignore git) — salin blok *Supabase Cloud* dari
   `.env.example`, isi dari Dashboard → **Connect → ORMs → Prisma** dan
   **Settings → API Keys → Legacy**. Isi juga `ADMIN_EMAILS` dan
   `SEED_PASSWORD` yang kuat: `.env.cloud` dibaca sendiri, `.env` lokal
   tidak ikut. Password DB yang mengandung `@ : / ? #` harus di-URL-encode.
   Komentar di belakang nilai (`KEY="x"  # …`) dibuang oleh
   `scripts/with-env.mjs`; `#` di dalam tanda kutip tetap ikut.
   - `DATABASE_URL` → pooler **transaction** (6543) +
     `?pgbouncer=true&connection_limit=10` (runtime Vercel dan `pnpm dev`).
     Aman untuk `withRls()`: satu interactive transaction dengan setting
     transaction-local. **Jangan `connection_limit=1`**: satu halaman
     menjalankan query paralel dan membaca lewat koneksi sistem di samping
     transaksi `withRls()` yang masih terbuka, jadi pool berisi satu koneksi
     saling tunggu sampai "Timed out fetching a new connection from the
     connection pool" / "Unable to start a transaction". Supavisor yang
     memultipleks ke pool Postgres sebenarnya.
   - `DIRECT_URL` → pooler **session** (5432) (migration).
   - Host `db.<ref>.supabase.co` hanya IPv6 — Vercel tidak bisa memakainya.
   - `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` **wajib ada**
     sebelum seed: tanpa keduanya `prisma/seed.ts` akan membuat profile dengan
     id acak tanpa auth user, dan tidak ada yang bisa login. `with-env.mjs`
     menolak `cloud:seed` dan `create-admin` kalau keduanya kosong atau
     menunjuk ke localhost.
3. **Auth** (Dashboard → Authentication):
   - Sign In / Providers → *Allow new users to sign up*: **off** (dulu, ini
     yang penting); provider **Email: on**; *Confirm email*: **off** (sama
     dengan `config.toml` §2). Urutannya penting: selama signup masih on,
     *Confirm email* harus tetap on — kalau keduanya off, siapa pun bisa
     mendaftar memakai alamat di `ADMIN_EMAILS` dan langsung jadi admin
     (bootstrap admin, `lib/auth.ts`). Cek dari luar:
     `curl -H "apikey: <anon>" https://<ref>.supabase.co/auth/v1/settings`
     → `disable_signup: true`, `external.email: true`.
   - URL Configuration → Site URL `https://<domain-app>`, Redirect URLs
     `https://<domain-app>/**` (plus `http://localhost:3000/**` kalau perlu).
   - SMTP → Resend: host `smtp.resend.com`, port `465`, user `resend`,
     password `<RESEND_API_KEY>`, sender `no-reply@odama.io`. Tanpa SMTP
     sendiri, Supabase Cloud hanya mengirim beberapa email per jam. Odama OS
     sendiri mengirim undangan, reset password dan invoice lewat API Resend,
     jadi SMTP Supabase hanya cadangan.
   - **Domain Resend:** verifikasi `odama.io` (SPF, DKIM, DMARC) di Resend.
     Alamat pengirim invoice (Settings → Invoices) harus memakai domain yang
     sudah terverifikasi (PRD pertanyaan terbuka #3).
4. **Storage** — bucket dari `supabase/config.toml` (`task-images`,
   `invoices`, `receipts`, `evidence`, `payment-proofs`, semua privat, tanpa
   storage policy):
   ```bash
   pnpm exec supabase login
   pnpm exec supabase link --project-ref <ref>
   pnpm cloud:buckets
   ```
5. **Schema + RLS + seed:**
   ```bash
   pnpm cloud:migrate          # prisma migrate deploy ke DIRECT_URL di .env.cloud
   pnpm cloud:status           # harus "Database schema is up to date"
   pnpm cloud:seed             # satu orang per role + auth user (SEED_PASSWORD)
   pnpm cloud:seed:history     # opsional, sekali: data setahun
   ```
   `scripts/with-env.mjs` menolak URL localhost, Supabase key yang kosong,
   dan `SEED_PASSWORD` default atau lebih pendek dari 12 karakter.
   Seed menolak jalan kalau sudah ada project. Migration menolak semua akses
   `anon` dan menyalakan RLS di setiap tabel; **jangan** jalankan
   `pnpm test:rls` ke project ini (lihat §6).
6. **Vercel env** — `DATABASE_URL`, `DIRECT_URL`, tiga variabel Supabase,
   `NEXT_PUBLIC_APP_URL`, `ADMIN_EMAILS`, `CRON_SECRET`, `RESEND_API_KEY`,
   `MAIL_FROM`, `SLACK_BOT_TOKEN`, `XENDIT_SECRET_KEY`,
   `XENDIT_CALLBACK_TOKEN`, dan `PUPPETEER_SKIP_DOWNLOAD=true` (PDF di Vercel
   memakai `@sparticuz/chromium`, Chrome tidak perlu diunduh saat install).
   Jangan set `DEV_AUTH_BYPASS`, `SEED_PASSWORD`, `INTERNAL_APP_URL` atau
   `CHROME_PATH`. Region function: `sin1`. Cron ada di `vercel.json`
   (jadwal UTC) dan memanggil `/api/cron/*` dengan `CRON_SECRET`.
7. **Cek:** login sebagai admin seed, buka tiap modul, upload gambar di task
   (Storage), unduh satu PDF invoice, lalu ganti password akun-akun seed atau
   nonaktifkan yang tidak dipakai. Dari terminal, `pnpm cloud:status` harus
   "Database schema is up to date"; jumlah auth user (Dashboard →
   Authentication) harus sama dengan jumlah baris `profiles`, kalau lebih
   sedikit berarti seed pernah jalan tanpa Supabase key.

## 3b. Legacy: self-hosted di VPS

Tidak dipakai lagi untuk production; `docs/VPS_DEPLOY.md` disimpan sebagai
alternatif. Perbedaannya dengan §3:

- Auth lewat `.env` Supabase: `DISABLE_SIGNUP=true`, `ENABLE_EMAIL_SIGNUP=true`,
  `ENABLE_EMAIL_AUTOCONFIRM=false`, `SITE_URL`, `ADDITIONAL_REDIRECT_URLS`
  (`/auth/callback`, `/auth/confirm`); SMTP lewat `SMTP_*`.
- Bucket dibuat manual di Studio → Storage (privat, tanpa policy).
- `DATABASE_URL` dan `DIRECT_URL` langsung ke Postgres-nya (tanpa pooler),
  lalu `pnpm prisma migrate deploy`.

## 4. Admin pertama

Signup publik mati. Buat admin pertama dengan password:

```bash
node --env-file=.env scripts/create-admin.mjs hellorafi@odama.io "Rafi Rohmat" "<password-kuat>"
# Supabase Cloud:
node scripts/with-env.mjs .env.cloud node scripts/create-admin.mjs hellorafi@odama.io "Rafi Rohmat" "<password-kuat>"
```

Atau: email yang ada di `ADMIN_EMAILS` otomatis menjadi C-Level + admin saat
pertama kali login (user auth-nya dibuat dari Studio → Authentication → Add user).
Semua orang lain diundang dari **People → Invite person** atau lewat **Settings
→ Import CSV**.

## 5. Kenapa RLS dan bukan cek di kode

Setiap query untuk user berjalan sebagai role `authenticated` dengan JWT claims
user (`lib/db.ts → withRls`). Jadi aturan di `prisma/migrations/*_rls` berlaku
sama persis untuk app dan untuk panggilan langsung ke API Supabase dengan anon
key + token user — persis definisi of done M0/M1/M2 ("diuji lewat API, bukan
hanya UI").

## 6. RLS test (`pnpm test:rls`) — hanya lokal atau project terpisah

`scripts/test-rls.mjs` **menghapus** schema `public` dan `app` di
`TEST_DATABASE_URL`, menjalankan ulang semua migration, lalu menjalankan
`tests/rls/*.test.ts` sebagai tiap role. Karena itu:

- **Default: lokal.** `TEST_DATABASE_URL` menunjuk ke database `odama_test` di
  Supabase CLI (§1). Ini yang dijalankan sebelum setiap "done".
- **Boleh: project Supabase terpisah (staging).** Buat project Cloud lain,
  jalankan `pnpm cloud:migrate` ke sana, dan arahkan `TEST_DATABASE_URL` ke
  pooler **session** (5432) project itu, lalu `pnpm test:rls`. Script hanya
  membaca `.env` (bukan `.env.cloud`), jadi set variabelnya di shell atau di
  `.env`. Belum ada `cloud:test:rls` dengan sengaja.
- **Tidak boleh: project production.** Tidak ada guard khusus selain
  `TEST_DATABASE_URL !== DATABASE_URL`; satu URL salah menghapus data
  production. Jangan pernah salin `DATABASE_URL`/`DIRECT_URL` dari `.env.cloud`
  ke `TEST_DATABASE_URL`.

Verifikasi RLS di production cukup lewat `pnpm cloud:status` (migration
lengkap) dan cek manual §3 langkah 7; policy-nya identik dengan yang sudah
lolos test di lokal karena berasal dari migration yang sama.

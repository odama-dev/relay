# Setup Supabase — lokal & konfigurasi Auth

Odama OS memakai Supabase untuk **Postgres (dengan RLS)**, **Auth** (email +
password, hanya lewat undangan) dan **Storage** (bucket privat). Skema dan
policy dikelola **Prisma** (`prisma/migrations`), bukan migration Supabase.

## 1. Lokal (development)

Butuh Docker Desktop (±4–5 GB image saat pertama kali).

```bash
pnpm install
pnpm db:up                 # = supabase start (config: supabase/config.toml)
pnpm exec supabase status  # catat API URL, anon key, service_role key
```

Isi `.env` (salin dari `.env.example`):

```bash
DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres?schema=public"
DIRECT_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres?schema=public"
TEST_DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54322/odama_test?schema=public"
NEXT_PUBLIC_SUPABASE_URL="http://127.0.0.1:54321"
NEXT_PUBLIC_SUPABASE_ANON_KEY="<anon key>"
SUPABASE_SERVICE_ROLE_KEY="<service_role key>"
ADMIN_EMAILS="hellorafi@odama.io"
```

Lalu:

```bash
pnpm exec supabase db execute --sql "create database odama_test" || true   # sekali, untuk pnpm test:rls
pnpm db:migrate            # schema + RLS
pnpm db:seed               # user per role dengan password odama-dev-123
pnpm dev
```

- Email (undangan, reset password) masuk ke **Inbucket**: http://127.0.0.1:54324
  — atau ke log server kalau `RESEND_API_KEY` kosong.
- Studio: http://127.0.0.1:54323.
- Bucket `task-images`, `invoices` dan `receipts` dibuat dari `supabase/config.toml`
  (privat, tanpa storage policy).

**Tanpa Docker:** Postgres biasa (mis. `brew install postgresql@16`) juga bisa —
migration membuat role `authenticated`/`anon` sendiri. Kosongkan variabel
Supabase dan set `DEV_AUTH_BYPASS=true`; ganti peran lewat `DEV_AUTH_EMAIL`.
File upload disimpan di `./.data/storage`.

## 2. Aturan yang sudah diatur di `supabase/config.toml`

| Setting | Nilai | Alasan |
| --- | --- | --- |
| `auth.enable_signup`, `auth.email.enable_signup` | `false` | Tidak ada halaman daftar publik (M0.2). Akun dibuat app lewat admin API. |
| `auth.email.enable_confirmations` | `false` | Undangan sudah memverifikasi email. |
| `site_url` / `additional_redirect_urls` | `http://localhost:3000/**` | Link reset password kembali ke `/auth/callback`. |
| Bucket `task-images` | privat, 10 MB, gambar saja | M2.5 |
| Bucket `invoices` | privat, PDF | M5.3 |
| Bucket `receipts` | privat, 10 MB, PDF + gambar | Expenses |
| Edge runtime, analytics | mati | Tidak dipakai. |

## 3. Production (self-hosted di VPS)

Ikuti `docs/VPS_DEPLOY.md` bagian 3. Yang penting untuk app ini:

1. **Auth (`.env` Supabase):**
   ```
   DISABLE_SIGNUP=true
   ENABLE_EMAIL_SIGNUP=true
   ENABLE_EMAIL_AUTOCONFIRM=false
   SITE_URL=https://os.odama.io
   ADDITIONAL_REDIRECT_URLS=https://os.odama.io/auth/callback,https://os.odama.io/auth/confirm
   ```
2. **SMTP → Resend** (PRD): `SMTP_HOST=smtp.resend.com`, `SMTP_PORT=465`,
   `SMTP_USER=resend`, `SMTP_PASS=<RESEND_API_KEY>`, `SMTP_ADMIN_EMAIL=no-reply@odama.io`.
   Odama OS sendiri mengirim undangan, reset password dan invoice lewat API
   Resend, jadi SMTP Supabase hanya cadangan.
3. **Domain Resend:** verifikasi `odama.io` (SPF, DKIM, DMARC) di Resend. Alamat
   pengirim invoice (Settings → Invoices) harus memakai domain yang sudah
   terverifikasi (PRD pertanyaan terbuka #3).
4. **Storage:** buat bucket `task-images`, `invoices` dan `receipts` di Studio → Storage,
   semuanya **private**, tanpa policy.
5. **Database:** jalankan `pnpm prisma migrate deploy` dengan `DIRECT_URL` ke
   Postgres Supabase. Migration menolak semua akses `anon` dan menyalakan RLS di
   setiap tabel; `pnpm test:rls` di staging memastikan hal itu.

## 4. Admin pertama

Signup publik mati. Buat admin pertama dengan password:

```bash
node --env-file=.env scripts/create-admin.mjs hellorafi@odama.io "Rafi Rohmat" "<password-kuat>"
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

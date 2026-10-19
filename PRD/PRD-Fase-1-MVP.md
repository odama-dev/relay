# PRD Fase 1 — MVP (M0–M5)

Draft 13 Okt 2026 · Turunan dari PRD Internal Tool Studio (Draft v0.1)

## Ringkasan, scope & keputusan

**Tujuan Fase 1:** setiap pekerjaan dan setiap invoice tercatat di satu tempat dan terhubung ke project. Tim tahu tugasnya, PM tahu sisa budget, Sales dan Finance tahu status pembayaran tanpa membuka banyak platform.

**Cara build:** dibangun sendiri dengan bantuan AI agent. Karena itu PRD ini ditulis sespesifik mungkin (data model, aturan akses, acceptance criteria) agar bisa langsung dipakai sebagai instruksi build per milestone.

### Milestone Fase 1

| Milestone | Isi singkat | Bergantung pada |
| --- | --- | --- |
| M0. Fondasi | Auth, user & role, hak akses, settings, Slack, app shell | — |
| M1. Client & Project | Client, project, anggota project, budget, import CSV | M0 |
| M2. Task | Section, task, kanban & list, deskripsi rich text, komentar | M1 |
| M3. Time Log | Input jam manual, kategori, timesheet mingguan, kunci & koreksi, flag out-of-scope | M2 |
| M4. Project Health | Budget vs aktual, ambang peringatan, persetujuan out-of-scope | M3 |
| M5. Invoice & Payment | Invoice dari template, PDF, Xendit, kirim ke client, pencatatan pembayaran otomatis | M1 |

### Keputusan yang sudah diambil

| Area | Keputusan |
| --- | --- |
| Bahasa UI | Inggris |
| Perangkat | Web responsif, tanpa app native |
| Login | Email + password; undangan oleh admin, tanpa self-signup |
| Role | Satu role utama per user |
| User keluar | Dinonaktifkan, data tetap tersimpan |
| Email | Resend: akun (undangan, reset password) dan pengiriman invoice ke client |
| Notifikasi kerja | Slack (DM dari bot) |
| Struktur kerja | Project → Section → Task. Tanpa subtask |
| Kode project | Kode client + nomor urut, misalnya `ACME-001` |
| Budget | Jam total per project; budget per section belum di Fase 1 |
| Task | 1 owner + beberapa kolaborator; status tetap; tampilan kanban & list |
| Time log | Input manual; tanpa timer dan tanpa satuan minimal untuk saat ini |
| Out-of-scope | Harus disetujui PM |
| Invoice | Dibuat Sales, nomor `ODAMA/26/0001`, PDF dari template Figma, dikirim ke client langsung dari aplikasi |
| Pembayaran | Semua lewat Xendit; satu invoice bisa punya beberapa tagihan; client boleh membayar dalam mata uang asing, studio menerima IDR |
| Pajak | Tidak dicatat di Fase 1 |
| Hari libur | Belum dikelola di Fase 1 |
| Data awal | Mulai dari nol, kecuali client & project lewat import CSV |

### Di luar scope Fase 1

- Request task lintas divisi (dieliminasi)
- Timer, log jam dari Slack, structured standup
- Subtask, kalender, lampiran file di luar gambar deskripsi
- Budget per section dan daftar hari libur
- Capacity view, KPI/OKR, laporan finance otomatis, integrasi Attio (Fase 2)
- Profitabilitas & cost rate, dashboard C-Level lengkap (Fase 3)
- Pencatatan pajak

## Stack & arsitektur

| Lapisan | Pilihan | Catatan |
| --- | --- | --- |
| Frontend | Next.js (App Router) | Memakai ulang design foundation dari project sebelumnya |
| Backend & database | Supabase self-hosted (Docker) | Lokal untuk development, di VPS untuk staging dan production |
| Auth | Supabase Auth, email + password | SMTP diarahkan ke Resend |
| Email | Resend | Undangan, set/reset password, dan kirim invoice + payment link ke client (domain studio terverifikasi) |
| File | Supabase Storage | Gambar di deskripsi task, PDF invoice |
| Notifikasi | Slack app (bot) | DM ke user; user dicocokkan lewat email |
| Pembayaran | Xendit | Payment link per tagihan + webhook untuk pencatatan otomatis |
| PDF | Render HTML template invoice di server menjadi PDF | Template Figma studio dikonversi menjadi HTML berparameter |
| Job terjadwal | Cron di VPS yang memanggil endpoint internal, atau pg_cron | Pengingat, kunci timesheet, cek invoice telat |
| Hosting | VPS yang sama untuk Next.js dan Supabase | Reverse proxy + HTTPS |

### Environment

- **Local:** Supabase via Docker + Next.js dev server.
- **Staging:** VPS, data dummy, Xendit mode test, Slack workspace atau channel uji.
- **Production:** VPS, Xendit mode live.
- **Backup:** dump database harian otomatis + simpan di luar VPS (misalnya object storage), retensi minimal 14 hari. Uji restore sekali sebelum launch.

### Prinsip teknis

- **Semua aturan akses ditegakkan di database lewat Row Level Security (RLS)**, bukan hanya disembunyikan di UI.
- **Rahasia (Xendit secret, Slack token, Resend key) hanya di server**, tidak pernah di kode client.
- **Webhook Xendit diverifikasi** dengan callback token dan diproses idempotent (payment yang sama tidak tercatat dua kali).
- **Semua waktu disimpan dalam UTC**, ditampilkan dalam zona waktu user (default Asia/Jakarta).
- **Nilai uang disimpan sebagai numeric dengan kode mata uang**, tidak pernah float.

## Role & hak akses Fase 1

Setiap user punya **satu role utama**. Hak admin adalah **flag terpisah** (`is_admin`) yang bisa diberikan ke user dengan role apa pun, misalnya ke C-Level. Dengan begitu tidak perlu role "Admin" tersendiri.

| Role | Kode | Fokus di Fase 1 |
| --- | --- | --- |
| C-Level | `c_level` | Melihat semua project, task, health, dan invoice |
| Project Manager | `pm` | Mengelola project, task, budget, menyetujui out-of-scope dan koreksi jam |
| Designer & Developer | `designer_dev` | Mengerjakan task, mencatat jam |
| Sales & Marketing | `sales` | Membuat project dan invoice |
| Finance | `finance` | Memantau invoice & pembayaran, mencocokkan pembayaran |
| HR | `hr` | Mengelola data orang, memantau kepatuhan pencatatan jam |

### Matriks akses

**E** = lihat & ubah · **L** = lihat · **S** = milik sendiri · **M** = hanya project tempat ia menjadi anggota · — = tidak ada akses

| Data | Designer & Dev | PM | Sales | Finance | HR | C-Level |
| --- | --- | --- | --- | --- | --- | --- |
| User & role | L | L | L | L | E | L |
| Client | L (M) | E | E | L | — | E |
| Project (info umum) | L (M) | E (M) | E | L | L | E |
| Nilai kontrak project | — | L (M) | E | L | — | E |
| Budget jam & health | L (M) | E (M) | L | L | — | E |
| Section & task | E (M) | E (M) | L (M) | — | — | E |
| Komentar task | E (M, milik sendiri) | E (M, milik sendiri) | E (M, milik sendiri) | — | — | E (milik sendiri) |
| Jam kerja | E (S) | L (M) + setujui | E (S) | E (S) | L semua | L semua |
| Invoice | — | L (M) | E | E | — | L |
| Pembayaran | — | L (M) | L | E | — | L |
| Settings aplikasi | Hanya user dengan `is_admin` | | | | | |

Catatan:

- **PM dan C-Level otomatis bisa melihat semua project** untuk keperluan overview; PM hanya bisa mengubah project tempat ia menjadi PM atau anggota.
- **Finance (termasuk freelancer) mendapat akses penuh ke invoice dan pembayaran**, sesuai keputusan. Data gaji dan cost rate belum ada di Fase 1.
- **HR menangani undang, ubah role, dan nonaktifkan user** bersama admin.
- Semua aturan di tabel ini **wajib diterapkan sebagai RLS policy** di Supabase.

## Data model (Supabase)

Skema awal untuk Fase 1. Nama tabel dan kolom dalam bahasa Inggris agar konsisten dengan UI. Semua tabel punya `id uuid`, `created_at`, dan `updated_at` kecuali disebut lain.

### Enum

```
user_role             : c_level | pm | designer_dev | sales | finance | hr
employment_type       : full_time | contract | freelancer
user_status           : invited | active | deactivated
project_kind          : client | internal
contract_type         : retainer | fixed | time_and_material
project_status        : active | on_hold | completed | archived
rollover_mode         : none | full | capped
task_status           : todo | in_progress | review | done | blocked
task_priority         : urgent | high | normal | low
oos_status            : none | pending | approved | rejected
correction_status     : pending | approved | rejected
invoice_status        : draft | sent | partially_paid | paid | overdue | void
payment_request_status: pending | paid | expired | void
```

### Tabel

```
profiles                  id (= auth.users.id), full_name, email, avatar_url, role user_role,
                          is_admin bool, employment_type, status user_status,
                          slack_user_id, timezone default 'Asia/Jakarta'

app_settings              key text PK, value jsonb
                          (reminder_time, workdays, default_alert_thresholds, currencies,
                           base_currency, invoice_number_format, invoice_sender_email)

clients                   code (unik, 2-6 huruf kapital, mis. ACME), name, country, timezone,
                          default_currency, billing_email, billing_address, notes,
                          is_archived, created_by
client_contacts           client_id, name, email, title, is_primary

projects                  code (unik, otomatis: ACME-001; internal: INT-001), name,
                          kind project_kind, client_id (null jika internal),
                          contract_type (null jika internal), currency, contract_value numeric,
                          pm_id, status project_status, start_date, end_date,
                          budget_hours numeric null,
                          retainer_hours_per_month numeric null, rollover_mode, rollover_cap_hours,
                          alert_thresholds int[] default '{75,100}',
                          links jsonb (notion, figma, drive, slack_channel), created_by
project_members           project_id, user_id, added_by           PK (project_id, user_id)

sections                  project_id, name, position int, archived_at

tasks                     project_id, section_id, title, description jsonb (rich text),
                          owner_id null, priority, status, due_date, estimate_hours null,
                          position int, created_by, completed_at
task_collaborators        task_id, user_id                        PK (task_id, user_id)
task_comments             task_id, author_id, body jsonb, edited_at, deleted_at, deleted_by
task_activity             task_id, actor_id, type text, payload jsonb

work_categories           name, is_active, position               (kategori non-billable)

time_entries              user_id, entry_date date, minutes int > 0,
                          project_id null, task_id null, category_id null, note,
                          is_billable bool, oos_status default 'none',
                          oos_reviewed_by, oos_reviewed_at, oos_note
                          CHECK: task_id IS NOT NULL OR category_id IS NOT NULL
timesheet_locks           week_start date PK, locked_at
time_corrections          time_entry_id, requested_by, proposed jsonb, reason,
                          status correction_status, reviewed_by, reviewed_at

project_alerts            project_id, period_start date, threshold int, sent_at
                          UNIQUE (project_id, period_start, threshold)

invoice_sequences         year int PK, last_number int
invoices                  number (unik, ODAMA/26/0001), project_id, client_id, currency,
                          issue_date, status invoice_status, notes,
                          subtotal, total, amount_paid, pdf_path, sent_at, created_by
invoice_items             invoice_id, description, quantity numeric, unit_price numeric,
                          amount numeric, position
invoice_payment_requests  invoice_id, label (mis. 'DP 50%'), amount, due_date, position,
                          status payment_request_status,
                          xendit_invoice_id, xendit_url, paid_at
invoice_deliveries        invoice_id, to_emails text[], cc_emails text[], sent_by, sent_at,
                          resend_message_id, status
payments                  payment_request_id null, invoice_id null (null = belum cocok),
                          external_id (unik, ID transaksi Xendit), amount, currency, paid_at,
                          channel, fee_amount, net_amount, settlement_amount_idr,
                          fx_rate_to_idr, raw jsonb, matched_by null

notification_log          user_id, channel, type, ref_id, sent_at
```

### Aturan turunan

- **`is_billable`** dihitung saat jam disimpan: `true` untuk semua entri di task project `client`; `false` untuk project `internal` dan entri berkategori non-billable.
- **`oos_status` menentukan pembagian budget, bukan billable:** `none` dan `rejected` dihitung sebagai jam dalam scope (mengurangi budget); `pending` ditampilkan terpisah sambil menunggu PM; `approved` dikeluarkan dari budget dan masuk daftar change request.
- **`projects.code`** = kode client + `-` + nomor urut 3 digit per client (`ACME-001`, `ACME-002`). Project internal memakai `INT-001`. Kode client tidak bisa diubah setelah client punya project.
- **`invoices.number`** = `ODAMA/` + 2 digit tahun + `/` + nomor urut 4 digit (`ODAMA/26/0001`). Urutan dimulai dari 0001 setiap tahun *[validasi]*.
- **Jumlah semua tagihan** (`invoice_payment_requests.amount`) harus sama dengan `invoices.total`.
- **`invoices.amount_paid`** = jumlah pembayaran yang cocok dengan tagihan-tagihan invoice tersebut. Status invoice diperbarui otomatis dari nilai ini.

**Tagihan:** satu invoice dibagi menjadi satu atau lebih tagihan (`invoice_payment_requests`), misalnya DP 50% dan pelunasan 50%. Setiap tagihan punya payment link Xendit sendiri dengan `external_id` = ID tagihan, sehingga setiap pembayaran bisa dicocokkan ke tagihan, invoice, lalu project.

### Helper untuk RLS

```
current_role()           -> user_role user yang login
is_admin()               -> bool
is_project_member(pid)   -> bool (anggota, PM project, atau C-Level)
can_manage_project(pid)  -> bool (PM project atau C-Level)
```

## M0 — Fondasi

**Tujuan:** user bisa diundang, login, dan hanya melihat data sesuai role-nya. Semua milestone berikutnya dibangun di atas ini.

### Scope

1. Auth email + password (Supabase Auth, SMTP lewat Resend)
2. Undangan user oleh admin atau HR
3. Profil & direktori orang
4. Role, flag admin, dan RLS dasar
5. Nonaktifkan user
6. Settings aplikasi
7. Koneksi Slack (pemetaan user + kirim DM)
8. App shell responsif dengan design foundation yang ada

### User stories & acceptance criteria

**M0.1 Undang user** — Sebagai admin atau HR, aku ingin mengundang anggota studio supaya mereka bisa mulai memakai aplikasi.

- Form undangan: nama, email, role, employment type.
- Sistem mengirim email undangan lewat Resend berisi link untuk membuat password. Link berlaku 7 hari dan bisa dikirim ulang.
- Status user `invited` sampai password dibuat, lalu menjadi `active`.
- Email yang sudah terdaftar tidak bisa diundang dua kali.

**M0.2 Login & reset password** — Sebagai user, aku ingin login dengan email dan password, dan bisa mereset password sendiri.

- Login dengan email + password. Tidak ada halaman daftar publik.
- "Forgot password" mengirim email reset lewat Resend.
- User berstatus `deactivated` tidak bisa login dan mendapat pesan yang jelas.

**M0.3 Direktori orang** — Sebagai anggota studio, aku ingin melihat siapa saja di studio beserta role-nya.

- Daftar user aktif: nama, avatar, role, employment type. Bisa dicari dan difilter per role.
- User bisa mengubah nama, avatar, dan zona waktu sendiri. Role dan employment type hanya diubah oleh admin atau HR.

**M0.4 Nonaktifkan user** — Sebagai admin atau HR, aku ingin menonaktifkan user yang keluar tanpa kehilangan datanya.

- Status menjadi `deactivated`; sesi aktif langsung berakhir.
- User nonaktif tidak muncul di pilihan owner, kolaborator, atau anggota project, tetapi nama dan datanya tetap tampil di histori (task, komentar, jam, invoice).
- Bisa diaktifkan kembali.

**M0.5 Settings aplikasi** — Sebagai admin, aku ingin mengatur nilai default yang dipakai seluruh aplikasi.

- Jam pengingat log jam (default 17:00) dan hari kerja (default Senin–Jumat), zona waktu Asia/Jakarta.
- Ambang peringatan budget default (75%, 100%).
- Daftar mata uang aktif (IDR, USD, EUR, SGD, AUD) dan mata uang dasar (IDR).
- Daftar kategori non-billable (dikelola di M3).
- Format nomor invoice (`ODAMA/{YY}/{SEQ}`) serta email dan nama pengirim invoice (dipakai di M5).

**M0.6 Slack** — Sebagai user, aku ingin menerima notifikasi kerja di Slack.

- Satu Slack app dengan bot. Saat user aktif, sistem mencari Slack user ID berdasarkan email dan menyimpannya di `slack_user_id`.
- Admin bisa melihat user yang belum terhubung ke Slack dan mencoba ulang pemetaan.
- Fungsi server `notify(user_id, type, payload)` mengirim DM dan mencatatnya di `notification_log`. Dipakai oleh M2–M5.
- User bisa mematikan jenis notifikasi tertentu di profilnya *[opsional di Fase 1]*.

**M0.7 App shell** — Navigasi utama: My Tasks, Projects, Timesheet, Invoices (sesuai role), People, Settings (admin). Responsif hingga lebar layar ponsel.

### Definition of done M0

- Admin mengundang 3 user dengan role berbeda; ketiganya bisa login dan reset password.
- Uji RLS: user dengan role `designer_dev` tidak bisa membaca tabel yang tidak diizinkan, walaupun memanggil API Supabase langsung.
- Satu DM uji terkirim ke Slack untuk setiap user yang terhubung.

## M1 — Client & Project

**Tujuan:** setiap pekerjaan dan invoice punya "rumah" yang jelas, lengkap dengan tipe kontrak, budget, dan anggota tim.

### Scope

1. Client & kontak client, dengan kode client
2. Project client dan project internal, dengan kode otomatis
3. Tipe kontrak, mata uang, nilai kontrak
4. Budget jam total per project dan retainer bulanan dengan rollover fleksibel
5. Anggota project
6. Status project dan arsip
7. Import client & project dari CSV (lihat bagian Import CSV)

### User stories & acceptance criteria

**M1.1 Kelola client** — Sebagai PM, C-Level, atau Sales, aku ingin mencatat client sekali dan memakainya di semua project dan invoice.

- Field: **kode client** (wajib, unik, 2–6 huruf kapital, misalnya `ACME`), nama, negara, zona waktu, mata uang default, email penagihan, alamat penagihan, catatan.
- Kode client dipakai untuk kode project dan tidak bisa diubah setelah client punya project.
- Satu client bisa punya beberapa kontak; satu ditandai kontak utama.
- Client bisa diarsipkan (tidak muncul di pilihan project baru) tetapi tidak bisa dihapus jika sudah punya project atau invoice.
- Halaman client menampilkan daftar project dan invoice-nya (sesuai hak akses).

**M1.2 Buat project** — Sebagai PM, C-Level, atau Sales, aku ingin membuat project dengan informasi kontrak yang lengkap.

- Jenis project: **Client** atau **Internal** (R&D, marketing studio, admin, dll.). Project internal tidak punya client, kontrak, maupun invoice.
- Project client wajib: client, tipe kontrak (Retainer / Fixed / Time & material), mata uang, PM, tanggal mulai.
- Opsional: nilai kontrak, tanggal selesai, link Notion, Figma, Drive, dan channel Slack.
- Kode project dibuat otomatis dari kode client + nomor urut (`ACME-001`); project internal memakai `INT-001`.
- Pembuat project yang bukan PM wajib memilih PM; PM otomatis menjadi anggota.

**M1.3 Budget jam** — Sebagai PM, aku ingin menentukan budget jam supaya pemakaiannya bisa dipantau di M4.

- **Fixed & time and material:** budget jam total untuk seluruh project (opsional). Budget per section belum ada di Fase 1.
- **Retainer:** jam per bulan. Pengaturan rollover per project:
  - `none` — sisa jam hangus tiap akhir bulan
  - `full` — seluruh sisa jam dibawa ke bulan berikutnya
  - `capped` — sisa jam dibawa maksimal sejumlah jam tertentu
- Pengaturan rollover bisa diubah kapan saja dan berlaku mulai bulan berjalan.

**M1.4 Anggota project** — Sebagai PM, aku ingin menentukan siapa yang terlibat di project.

- PM project dan C-Level bisa menambah atau mengeluarkan anggota.
- Hanya anggota yang bisa melihat dan mengerjakan task project tersebut, serta berkomentar.
- Anggota yang dikeluarkan tetap tercatat di histori task, komentar, dan jam.

**M1.5 Status project** — Active, On hold, Completed, Archived.

- Jam kerja hanya bisa dicatat ke project berstatus Active atau On hold.
- Project Archived disembunyikan dari daftar utama tetapi tetap bisa dicari dan dilaporkan.

**M1.6 Daftar project** — Tampilan list semua project yang bisa diakses user: kode, nama, client, PM, tipe kontrak, status, dan indikator health (dari M4). Bisa difilter per status, client, PM, dan tipe kontrak.

### Definition of done M1

- Client dan project hasil import CSV muncul lengkap dan bisa diedit.
- Designer & Dev hanya melihat project tempat ia menjadi anggota; nilai kontrak tidak terlihat olehnya (diuji lewat API, bukan hanya UI).
- Project retainer dengan tiga mode rollover tersimpan dengan benar.

## M2 — Task

**Tujuan:** semua pekerjaan tercatat sebagai task dengan owner, prioritas, dan deadline yang jelas, sehingga tidak ada yang terlewat.

### Scope

1. Section di dalam project
2. Task: owner, kolaborator, prioritas, status, deadline, estimasi
3. Tampilan list dan kanban per project
4. My Tasks lintas project
5. Detail task: deskripsi rich text dan komentar
6. Riwayat aktivitas task
7. Notifikasi Slack terkait task

Tidak termasuk: subtask, request task lintas divisi, kalender, lampiran file selain gambar di deskripsi.

### User stories & acceptance criteria

**M2.1 Section** — Sebagai PM, aku ingin mengelompokkan task di project ke dalam section (misalnya Discovery, Design, Development).

- PM project dan C-Level bisa membuat, mengganti nama, mengurutkan, dan mengarsipkan section.
- Setiap project baru otomatis punya satu section bernama "General".
- Section yang diarsipkan disembunyikan beserta task-nya, tetapi jam yang sudah tercatat tetap dihitung.

**M2.2 Buat & ubah task** — Sebagai anggota project, aku ingin membuat task dan mengatur detailnya.

- Field: judul (wajib), section (wajib), owner (satu orang), kolaborator (banyak), prioritas (Urgent / High / Normal / Low, default Normal), status, due date, estimasi jam.
- Status tetap untuk semua project: **To do, In progress, Review, Done, Blocked**.
- Owner dan kolaborator hanya bisa dipilih dari anggota project yang aktif.
- Semua anggota project bisa membuat task. Owner, kolaborator, PM project, dan C-Level bisa mengubahnya. Hanya PM project dan C-Level yang bisa menghapus task.
- Task yang sudah punya jam tercatat tidak bisa dihapus; hanya bisa ditandai Done.

**M2.3 Tampilan project: List & Kanban** — Sebagai anggota project, aku ingin melihat task dengan cara yang paling cocok.

- **List:** dikelompokkan per section; kolom judul, owner, prioritas, status, due date. Bisa diurutkan dengan drag.
- **Kanban:** kolom = status. Drag kartu antar kolom mengubah status.
- Filter di kedua tampilan: owner, prioritas, section, dan "task saya".
- Task yang melewati due date dan belum Done diberi tanda terlambat.

**M2.4 My Tasks** — Sebagai user, aku ingin melihat semua task-ku dari semua project di satu tempat.

- Berisi task di mana user menjadi owner atau kolaborator, belum Done.
- Dikelompokkan: Terlambat, Hari ini, Minggu ini, Nanti, Tanpa due date. Tersedia juga dalam tampilan kanban.
- Dari My Tasks user bisa langsung mencatat jam ke task (shortcut ke M3).

**M2.5 Deskripsi task (rich text)** — Sebagai anggota project, aku ingin menulis brief task yang jelas.

- Editor rich text: bold, italic, underline, strikethrough, heading, bullet & numbered list, checklist, link, kutipan, code, dan gambar.
- Gambar di-upload ke Supabase Storage (bucket privat, ditampilkan lewat signed URL), maksimal 10 MB per gambar *[validasi batas]*.
- Disimpan sebagai JSON terstruktur (bukan HTML mentah) agar aman dan bisa dirender ulang.

**M2.6 Komentar** — Sebagai anggota project, aku ingin berdiskusi langsung di task.

- Semua anggota project bisa berkomentar. Komentar mendukung format dasar (bold, italic, link) dan mention `@nama`.
- Penulis bisa mengedit komentarnya sendiri. Komentar yang diedit menampilkan penanda "edited" beserta waktunya, dan tercatat di riwayat aktivitas ("X mengedit komentar").
- Penulis bisa menghapus komentarnya sendiri. Komentar tidak hilang tanpa jejak: di tempatnya muncul "Komentar dihapus oleh X" beserta waktunya. Isi asli disimpan di database (soft delete) dan tidak ditampilkan.
- Komentar diurutkan dari yang terlama ke terbaru.

**M2.7 Riwayat aktivitas** — Di detail task, tampilkan riwayat: dibuat, status berubah, owner berubah, due date berubah, komentar diedit atau dihapus.

**M2.8 Notifikasi Slack**

| Kejadian | Penerima |
| --- | --- |
| Ditunjuk sebagai owner atau kolaborator | User tersebut |
| Di-mention dalam komentar | User yang di-mention |
| Komentar baru di task | Owner dan kolaborator (kecuali penulis) |
| Due date besok | Owner |
| Status berubah menjadi Blocked | PM project |

### Definition of done M2

- Satu project uji dengan 3 section dan 20 task bisa dikelola lewat list dan kanban, termasuk drag antar status.
- Komentar yang diedit dan dihapus menampilkan jejaknya dengan benar.
- User yang bukan anggota project tidak bisa membaca task maupun gambar deskripsinya (diuji lewat API dan URL storage).

## M3 — Time Log

**Tujuan:** jam kerja tercatat di minggu yang sama, terhubung ke task atau kategori, tanpa harus mengingat ulang di akhir bulan.

### Scope

1. Input jam manual ke task atau kategori non-billable
2. Flag out-of-scope
3. Timesheet mingguan
4. Kategori non-billable yang bisa ditambah
5. Kunci mingguan dan permintaan koreksi
6. Pengingat harian lewat Slack
7. Pemantauan kepatuhan untuk HR

Tidak termasuk: timer, satuan waktu minimal, log jam dari Slack.

### Siapa yang wajib mencatat

Semua role **kecuali C-Level** (opsional). Pengingat dan pemantauan kepatuhan hanya berlaku untuk user yang wajib.

### User stories & acceptance criteria

**M3.1 Catat jam** — Sebagai user, aku ingin mencatat jam secepat mungkin.

- Input: tanggal (default hari ini), durasi (jam dan menit, misalnya `1h 30m` atau `1.5`), task **atau** kategori non-billable, catatan opsional.
- Bisa dibuka dari: halaman Timesheet, detail task, dan My Tasks (task sudah terisi otomatis).
- Pilihan task hanya dari project berstatus Active/On hold tempat user menjadi anggota; task yang baru dikerjakan muncul paling atas.
- Tanggal di minggu yang sudah dikunci tidak bisa dipilih.
- Target: satu entri bisa disimpan dalam kurang dari 15 detik.

**M3.2 Kategori non-billable** — Sebagai admin, aku ingin mengelola daftar kategori pekerjaan non-billable.

- Default: Meeting internal, Riset, Pitching, Belajar, Admin.
- Admin bisa menambah, mengganti nama, mengurutkan, dan menonaktifkan kategori. Kategori yang sudah dipakai tidak bisa dihapus.
- Entri berkategori tidak terhubung ke project dan selalu non-billable.

**M3.3 Flag out-of-scope** — Sebagai user, aku ingin menandai pekerjaan di luar scope supaya PM bisa menindaklanjutinya ke client.

- Checkbox "Out of scope" hanya muncul untuk task di project client.
- Saat dicentang, catatan menjadi wajib (apa yang diminta di luar scope).
- Entri tersimpan dengan `oos_status = pending` dan masuk antrean persetujuan PM (M4).

**M3.4 Timesheet mingguan** — Sebagai user, aku ingin melihat dan merapikan jam minggu ini.

- Tampilan Senin–Minggu: total per hari, total minggu, daftar entri per hari.
- Entri di minggu yang belum dikunci bisa diedit dan dihapus oleh pemiliknya.
- Hari kerja tanpa entri ditandai.

**M3.5 Kunci mingguan & koreksi** — Sebagai PM dan HR, aku ingin data jam stabil setelah minggu berakhir.

- Setiap Senin pukul 00:00 WIB, minggu sebelumnya otomatis dikunci (tercatat di `timesheet_locks`).
- Entri yang dikunci hanya bisa diubah lewat **permintaan koreksi**: user mengusulkan perubahan (durasi, task, kategori, atau tanggal) beserta alasan, termasuk menambah entri yang terlupa.
- Koreksi untuk entri di project disetujui oleh **PM project**; koreksi untuk entri berkategori non-billable disetujui oleh **HR**.
- Saat disetujui, perubahan diterapkan dan tercatat siapa yang menyetujui. Saat ditolak, user mendapat notifikasi beserta alasan.

**M3.6 Pengingat harian** — Sebagai user, aku ingin diingatkan sebelum lupa.

- Pukul 17:00 WIB pada hari kerja (sesuai settings), user wajib yang belum punya entri hari itu menerima DM Slack dengan link langsung ke form catat jam.
- Daftar hari libur belum dikelola di Fase 1; pengingat tetap terkirim di hari kerja yang kebetulan libur.

**M3.7 Kepatuhan pencatatan** — Sebagai HR, aku ingin tahu siapa yang belum mencatat jam tanpa harus mengecek satu per satu.

- Tabel per minggu: user wajib × hari kerja, dengan total jam per hari. Hari kosong ditandai.
- Filter per role dan per minggu. Bisa diekspor ke CSV.

### Definition of done M3

- User mencatat jam ke task dan ke kategori; totalnya benar di timesheet dan di project.
- Minggu lalu terkunci otomatis; koreksi berjalan sampai disetujui PM dan tercermin di data.
- Pengingat terkirim hanya ke user yang belum mencatat hari itu.

## M4 — Project Health

**Tujuan:** PM dan C-Level tahu sisa budget jam setiap project tanpa menghitung manual, dan pekerjaan di luar scope bisa ditindaklanjuti ke client.

### Scope

1. Budget vs aktual per project, dengan rincian jam per section dan per orang
2. Perhitungan retainer per bulan dengan rollover
3. Ambang peringatan yang bisa diatur per project
4. Antrean persetujuan out-of-scope untuk PM
5. Daftar change request (out-of-scope yang disetujui) dan ekspornya
6. Overview kesehatan semua project

### Cara menghitung

- **Jam terpakai (in-scope)** = total menit entri project dengan `oos_status` `none` atau `rejected`.
- **Out-of-scope menunggu** = entri `pending`; ditampilkan terpisah dan belum mengurangi budget.
- **Out-of-scope disetujui** = entri `approved`; tidak mengurangi budget, masuk daftar change request.
- **Pemakaian** = jam terpakai ÷ budget × 100%.
- **Retainer:** budget bulan ini = jam per bulan + rollover dari bulan sebelumnya (sesuai `rollover_mode`: tidak ada, penuh, atau maksimal `rollover_cap_hours`). Rollover tidak pernah negatif: kelebihan jam bulan lalu tidak memotong bulan ini *[validasi]*.
- Project tanpa budget jam tetap menampilkan total jam terpakai, tanpa persentase.

### User stories & acceptance criteria

**M4.1 Panel health project** — Sebagai anggota project, aku ingin melihat kondisi budget project.

- Menampilkan: budget, jam terpakai, sisa, persentase, out-of-scope menunggu, out-of-scope disetujui.
- Status visual: **On track** (di bawah ambang pertama), **Warning** (melewati ambang pertama), **Over budget** (melewati 100%).
- Rincian jam per section dan per orang (PM dan C-Level saja).
- Untuk retainer: periode bulan berjalan, rollover yang masuk, dan histori per bulan.

**M4.2 Ambang peringatan fleksibel** — Sebagai PM, aku ingin mengatur kapan diperingatkan.

- Default dari settings (75%, 100%). PM project dan C-Level bisa mengubah daftar ambang per project (misalnya 50%, 80%, 100%).
- Saat pemakaian melewati sebuah ambang, PM project dan C-Level menerima DM Slack **sekali** per ambang per periode (dijaga oleh `project_alerts`).
- Jika budget dinaikkan sehingga pemakaian turun di bawah ambang, peringatan untuk ambang itu bisa terkirim lagi saat terlewati kembali.

**M4.3 Persetujuan out-of-scope** — Sebagai PM, aku ingin memutuskan apakah pekerjaan yang ditandai benar-benar di luar scope.

- Antrean berisi entri `pending` di project yang dipegang PM: tanggal, user, task, durasi, catatan.
- PM bisa **Approve** (menjadi change request) atau **Reject** (dihitung sebagai pekerjaan dalam scope), dengan catatan opsional. Bisa massal.
- User yang mencatat menerima notifikasi hasil keputusan.
- PM menerima DM Slack saat ada entri out-of-scope baru, digabung maksimal sekali sehari per project.

**M4.4 Daftar change request** — Sebagai PM, aku ingin membawa data pekerjaan di luar scope ke diskusi dengan client.

- Daftar entri `approved` per project, bisa difilter per periode, dikelompokkan per task.
- Ekspor CSV: tanggal, task, orang, durasi, catatan.
- Bisa ditandai "sudah ditagihkan" *[opsional, berguna saat M5 berjalan]*.

**M4.5 Overview project** — Sebagai PM atau C-Level, aku ingin melihat project yang perlu perhatian.

- Daftar project aktif dengan status health, persentase pemakaian, jumlah task terlambat, dan jumlah out-of-scope menunggu.
- Diurutkan dari yang paling berisiko. Filter per PM dan client.

### Definition of done M4

- Angka health cocok dengan perhitungan manual dari data jam untuk project fixed dan retainer (ketiga mode rollover).
- Peringatan terkirim tepat sekali saat ambang terlewati.
- Approve dan reject out-of-scope mengubah angka budget sesuai aturan.

## M5 — Invoice & Payment

**Tujuan:** Sales membuat invoice dari project dalam beberapa menit, dan status pembayaran tercatat otomatis dari Xendit tanpa ada yang mengecek platform satu per satu.

### Scope

1. Buat invoice dari project (Sales), dengan satu atau beberapa tagihan
2. Nomor invoice otomatis `ODAMA/26/XXXX`
3. PDF dari template Figma studio
4. Payment link Xendit per tagihan
5. Kirim invoice + payment link ke client dari aplikasi (Send to client)
6. Pencatatan pembayaran otomatis lewat webhook Xendit
7. Antrean pembayaran yang belum cocok (Finance)
8. Status invoice otomatis, termasuk telat
9. Daftar invoice dan ekspor CSV

Alur utama: **project deal → Sales membuat invoice → Send to client (PDF + payment link) → client membayar lewat Xendit → pembayaran tercatat otomatis dan Finance mendapat pembaruan.**

Tidak termasuk: pajak, pembayaran di luar Xendit, email pengingat otomatis ke client, laporan finance bulanan (Fase 2).

### Siklus status invoice

`Draft` → `Sent` → `Partially paid` → `Paid`

- `Overdue`: otomatis saat due date tagihan terlewati dan invoice belum lunas. Berubah ke `Paid` begitu lunas.
- `Void`: dibatalkan. Nomor invoice tidak dipakai ulang.

### User stories & acceptance criteria

**M5.1 Buat invoice** — Sebagai Sales, aku ingin membuat invoice dari project tanpa mengetik ulang data client.

- Dimulai dari halaman project atau halaman Invoices. Client, mata uang, dan alamat penagihan terisi otomatis dari project dan client.
- Field: tanggal terbit (default hari ini), catatan.
- Item baris: deskripsi, kuantitas, harga satuan; jumlah dihitung otomatis. Total = jumlah semua item (tanpa pajak).
- **Tagihan:** total dibagi menjadi satu atau lebih tagihan, masing-masing dengan label (misalnya "DP 50%", "Pelunasan"), jumlah, dan due date. Bisa diisi sebagai persentase atau nominal. Jumlah semua tagihan harus sama dengan total.
- Hanya bisa dibuat untuk project client berstatus Active atau On hold.
- Invoice `Draft` bisa diedit dan dihapus. Setelah `Sent`, nilai, item, dan tagihan terkunci; perubahan dilakukan dengan Void lalu terbitkan invoice baru.

**M5.2 Nomor invoice otomatis** — Nomor dibuat saat invoice diterbitkan, dengan format `ODAMA/{YY}/{SEQ}`, misalnya `ODAMA/26/0001`. Urutan 4 digit dijaga di database (`invoice_sequences`) agar tidak ada nomor ganda walaupun dua invoice diterbitkan bersamaan. Nomor invoice yang di-void tidak dipakai ulang.

**M5.3 PDF dari template studio** — Sebagai Sales, aku ingin PDF invoice yang sesuai identitas studio.

- Template invoice studio didesain di Figma, lalu dikonversi sekali menjadi template HTML berparameter: nomor, tanggal, data client, item, total, mata uang, daftar tagihan beserta due date dan payment link.
- PDF dibuat di server saat invoice diterbitkan dan disimpan di Storage. Bisa diunduh kapan saja dan dibuat ulang jika template berubah (untuk invoice yang belum lunas).
- Hanya role yang berhak (Sales, Finance, C-Level, PM project) yang bisa mengunduh.

**M5.4 Payment link Xendit per tagihan** — Saat invoice diterbitkan, sistem membuat satu tagihan Xendit untuk setiap tagihan invoice, dengan `external_id` = ID tagihan, lalu menyimpan ID dan URL pembayarannya. Semua payment link dicetak di PDF dan ikut di email ke client.

- Client boleh membayar dalam mata uang asing; studio menerima dalam IDR. Apakah tagihan Xendit dibuat dalam mata uang invoice atau dikonversi ke IDR saat dibuat mengikuti kemampuan akun Xendit studio *[validasi]*.
- Tagihan yang kedaluwarsa di Xendit bisa dibuat ulang oleh Sales tanpa mengubah invoice.

**M5.5 Kirim ke client (Send to client)** — Sebagai Sales, aku ingin mengirim invoice dan payment link ke client langsung dari aplikasi.

- Tombol **Send to client** di halaman invoice. Penerima default: email penagihan client + kontak utama; bisa ditambah atau diubah, dengan CC opsional.
- Pratinjau email sebelum dikirim: subjek, isi singkat, PDF terlampir, dan daftar tagihan dengan payment link.
- Dikirim lewat Resend dari email pengirim studio (diatur di settings). Pengiriman pertama mengubah status invoice dari `Draft` ke `Sent` dan menerbitkan nomor invoice.
- Invoice bisa dikirim ulang; setiap pengiriman tercatat di `invoice_deliveries` (penerima, pengirim, waktu, status kirim).
- Jika pengiriman gagal, Sales melihat pesan error dan bisa mencoba lagi; status invoice tidak berubah.

**M5.6 Pencatatan pembayaran otomatis** — Sebagai Finance, aku ingin setiap pembayaran tercatat sendiri dan langsung terhubung ke tagihan, invoice, dan project.

- Endpoint webhook menerima notifikasi pembayaran dari Xendit, memverifikasi callback token, lalu menyimpan `payments`: ID transaksi Xendit (unik), jumlah dan mata uang yang dibayar, waktu bayar, channel, fee, jumlah bersih, nilai yang diterima dalam IDR, kurs, dan data mentah.
- **Idempotent:** notifikasi yang sama dikirim ulang tidak membuat pembayaran ganda.
- Pembayaran dicocokkan ke tagihan lewat `external_id`, lalu ke invoice dan project. Setelah tercatat: tagihan menjadi `paid`, `amount_paid` invoice diperbarui, status invoice menjadi `Partially paid` atau `Paid`, dan Sales serta Finance menerima DM Slack.
- **Kurs:** dihitung dari nilai IDR yang diterima dibagi jumlah dalam mata uang invoice, berdasarkan data transaksi Xendit.
- Jika jumlah yang dibayar tidak sama dengan nilai tagihan, pembayaran tetap tercatat dan ditandai untuk ditinjau Finance.

**M5.7 Pembayaran belum cocok** — Sebagai Finance, aku ingin menangani pembayaran Xendit yang tidak bisa dicocokkan otomatis.

- Pembayaran dari Xendit tanpa tagihan yang cocok masuk antrean "Unmatched" dan Finance menerima DM Slack.
- Finance bisa mencocokkannya ke tagihan secara manual; tercatat siapa yang mencocokkan.
- Semua pembayaran lewat Xendit, jadi tidak ada input pembayaran manual di Fase 1.

**M5.8 Invoice telat** — Setiap hari, jika ada tagihan yang belum dibayar dan due date-nya sudah lewat, invoice berubah menjadi `Overdue`. Sales dan Finance menerima DM Slack pada hari pertama telat, lalu ringkasan mingguan selama masih telat. Status kembali ke `Partially paid` atau `Paid` begitu tagihan dibayar.

**M5.9 Daftar invoice** — Sebagai Sales, Finance, atau C-Level, aku ingin melihat semua tagihan di satu tempat.

- Kolom: nomor, client, project, termin, mata uang, total, terbayar, sisa, due date, status.
- Filter: status, client, project, mata uang, periode. Ringkasan di atas: total outstanding per mata uang dan jumlah invoice telat.
- Halaman project menampilkan invoice project tersebut (PM melihat tanpa bisa mengubah).
- Ekspor CSV.

### Definition of done M5

- Di Xendit mode test: invoice dengan dua tagihan diterbitkan → PDF terbentuk → Send to client mengirim email berisi PDF dan payment link → tagihan pertama dibayar → status Partially paid → tagihan kedua dibayar → status Paid, dan pembayaran muncul di project yang benar.
- Nomor invoice berurutan tanpa duplikat (`ODAMA/26/0001`, `ODAMA/26/0002`).
- Notifikasi webhook yang dikirim dua kali tidak menghasilkan pembayaran ganda.
- Webhook dengan token salah ditolak.

## Notifikasi & job terjadwal

### Semua notifikasi Fase 1

| Kejadian | Saluran | Penerima | Milestone |
| --- | --- | --- | --- |
| Undangan akun, set password | Email (Resend) | User baru | M0 |
| Reset password | Email (Resend) | User | M0 |
| Ditunjuk owner / kolaborator task | Slack | User tersebut | M2 |
| Di-mention di komentar | Slack | User yang di-mention | M2 |
| Komentar baru di task | Slack | Owner & kolaborator | M2 |
| Due date task besok | Slack | Owner | M2 |
| Task berstatus Blocked | Slack | PM project | M2 |
| Belum mencatat jam hari ini | Slack | User wajib | M3 |
| Koreksi jam disetujui / ditolak | Slack | Pengaju | M3 |
| Permintaan koreksi baru | Slack | PM project atau HR | M3 |
| Out-of-scope baru (ringkasan harian) | Slack | PM project | M4 |
| Keputusan out-of-scope | Slack | User yang mencatat | M4 |
| Ambang budget terlewati | Slack | PM project & C-Level | M4 |
| Invoice + payment link (Send to client) | Email (Resend) | Client | M5 |
| Pembayaran diterima | Slack | Sales & Finance | M5 |
| Pembayaran belum cocok | Slack | Finance | M5 |
| Invoice telat (hari pertama + mingguan) | Slack | Sales & Finance | M5 |

Semua notifikasi Slack berisi link langsung ke halaman terkait dan dicatat di `notification_log`.

### Job terjadwal (WIB)

| Job | Jadwal | Fungsi |
| --- | --- | --- |
| Pengingat due date | Setiap hari 09:00 | Kirim notifikasi task yang due besok |
| Pengingat log jam | Hari kerja, 17:00 (sesuai settings) | Kirim ke user wajib yang belum mencatat hari ini |
| Ringkasan out-of-scope | Setiap hari 17:30 | Kirim ringkasan entri pending ke PM |
| Kunci timesheet | Senin 00:00 | Kunci minggu sebelumnya |
| Rollover retainer | Tanggal 1, 00:05 | Hitung budget bulan baru tiap project retainer |
| Cek invoice telat | Setiap hari 00:10 | Ubah status ke Overdue + notifikasi |
| Backup database | Setiap hari 02:00 | Dump + upload ke penyimpanan di luar VPS |

Semua job harus aman dijalankan ulang (idempotent) dan mencatat hasilnya di log.

## Import CSV

Import dipakai sekali saat awal untuk memindahkan data dari Notion dan spreadsheet. Hanya admin yang bisa menjalankannya. Template CSV disediakan terpisah (`users.csv`, `clients.csv`, `projects.csv`).

### Alur

1. **Urutan wajib:** users → clients → projects, karena project merujuk ke client dan email user.
2. Admin mengunggah file → sistem memvalidasi semua baris dan menampilkan pratinjau: baris valid, baris error beserta alasannya.
3. Admin memilih cara menangani data yang sudah ada: **lewati** atau **perbarui** (dicocokkan lewat email untuk user, nama untuk client, nama + client untuk project).
4. Setelah konfirmasi, hanya baris valid yang diimpor. Hasil bisa diunduh sebagai CSV berisi status per baris.
5. User hasil import berstatus `invited`; undangan dikirim setelah admin menekan "Kirim undangan".

### Format umum

- UTF-8, pemisah koma, baris pertama adalah header persis seperti template.
- Tanggal `YYYY-MM-DD`. Angka memakai titik desimal tanpa pemisah ribuan (`15000.50`).
- Daftar dalam satu sel dipisah titik koma (`a@studio.com;b@studio.com`).
- Kolom bertanda * wajib diisi.

### users.csv

| Kolom | Isi |
| --- | --- |
| full_name* | Nama lengkap |
| email* | Email kerja, unik |
| role* | `c_level`, `pm`, `designer_dev`, `sales`, `finance`, `hr` |
| employment_type* | `full_time`, `contract`, `freelancer` |
| is_admin | `true` atau `false` (default `false`) |

### clients.csv

| Kolom | Isi |
| --- | --- |
| code* | Kode client, unik, 2–6 huruf kapital (misalnya `ACME`) |
| name* | Nama client, unik |
| country | Nama negara |
| timezone | Zona waktu IANA, misalnya `Europe/London` |
| default_currency* | `IDR`, `USD`, `EUR`, `SGD`, `AUD` |
| billing_email | Email penagihan |
| billing_address | Alamat penagihan |
| notes | Catatan |
| contact_name | Nama kontak utama |
| contact_email | Email kontak utama |
| contact_title | Jabatan kontak utama |

Kode project tidak diisi di `projects.csv`; sistem membuatnya otomatis dari kode client.

### projects.csv

| Kolom | Isi |
| --- | --- |
| name* | Nama project |
| kind* | `client` atau `internal` |
| client_name | Wajib jika `client`; harus sama persis dengan nama di clients |
| contract_type | Wajib jika `client`: `retainer`, `fixed`, `time_and_material` |
| currency | Default dari mata uang client |
| contract_value | Nilai kontrak |
| pm_email* | Email PM, harus sudah ada di users |
| status | `active` (default), `on_hold`, `completed`, `archived` |
| start_date* | Tanggal mulai |
| end_date | Tanggal selesai |
| budget_hours | Budget jam total (fixed / time & material) |
| retainer_hours_per_month | Wajib jika `retainer` |
| rollover_mode | `none` (default), `full`, `capped` |
| rollover_cap_hours | Wajib jika `capped` |
| member_emails | Anggota project, dipisah titik koma |
| notion_url, figma_url, drive_url, slack_channel | Link terkait |

## Urutan build, definition of done & pertanyaan terbuka

### Urutan build yang disarankan

1. **M0** — skema dasar, auth, RLS helper, settings, Slack. Fondasi semua milestone.
2. **M1** — client, project, anggota, import CSV. Isi data nyata sedini mungkin.
3. **M2** — task. Mulai dipakai satu tim sebagai pilot.
4. **M5 dapat dikerjakan paralel setelah M1**, karena hanya bergantung pada client dan project. Mulai lebih awal jika kebutuhan invoice paling mendesak.
5. **M3** — time log, setelah task berjalan.
6. **M4** — project health, setelah ada data jam minimal 1–2 minggu.

### Tips build dengan AI agent

- Kerjakan **satu milestone per sesi**, dan berikan bagian PRD milestone itu + bagian Data model + Role & hak akses sebagai konteks.
- Mulai setiap milestone dari **migrasi database dan RLS policy**, baru kemudian UI.
- Minta agent menulis **tes RLS** untuk setiap tabel baru (user role X tidak bisa membaca/mengubah data Y).
- Selesaikan definition of done tiap milestone sebelum lanjut ke milestone berikutnya.

### Definition of done Fase 1 (uji end-to-end)

Jalankan satu project nyata dari awal sampai akhir di staging:

- [ ] Admin mengundang tim; semua user bisa login
- [ ] Client dan project diimpor dari CSV, kode project terbentuk otomatis
- [ ] PM membuat section dan task; tim bekerja lewat kanban dan berkomentar
- [ ] Tim mencatat jam selama satu minggu; pengingat Slack berjalan; minggu terkunci otomatis
- [ ] Satu entri out-of-scope disetujui PM dan muncul di daftar change request
- [ ] Peringatan budget terkirim saat ambang terlewati
- [ ] Sales menerbitkan invoice dengan dua tagihan; PDF terbentuk dari template studio; Send to client terkirim
- [ ] Pembayaran test Xendit tercatat otomatis, invoice menjadi Paid, dan Finance mendapat notifikasi
- [ ] Restore backup database berhasil diuji

### Pertanyaan terbuka

**Sudah diputuskan (13 Okt 2026):**

| Topik | Keputusan |
| --- | --- |
| Budget per section | Belum di Fase 1 |
| Format nomor invoice | `ODAMA/26/XXXX` |
| Template invoice | Didesain di Figma; aplikasi membuat PDF dan mengirimnya ke client lewat Send to client |
| Pembayaran di luar Xendit | Tidak ada; semua dipindah ke Xendit |
| Mata uang | Client boleh membayar dalam mata uang asing; studio menerima IDR |
| Pembayaran bertahap | Satu invoice dengan beberapa tagihan |
| Alur invoice | Project deal → buat invoice → kirim ke client (invoice + payment link) → pembayaran sukses → Finance diperbarui |
| Kode project | Kode client + nomor |
| Hari libur | Belum dikelola |

**Masih perlu divalidasi saat build:**

1. **Xendit dan mata uang asing:** apakah tagihan dibuat dalam mata uang invoice (misalnya USD) atau dikonversi ke IDR saat dibuat, dan data apa yang dikirim webhook untuk nilai IDR yang diterima.
2. **Reset nomor invoice:** apakah urutan dimulai dari 0001 setiap tahun, dan nomor terakhir yang sudah terpakai tahun ini.
3. **Domain pengirim email** untuk invoice (perlu diverifikasi di Resend).
4. **File template invoice Figma** untuk dikonversi menjadi HTML berparameter.

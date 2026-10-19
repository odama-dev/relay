# Dashboard C-Level — Spesifikasi Fungsional

Menggantikan bagian **4. C-Level** di `DASHBOARD-SPEC.md`. Dokumen ini hanya menjelaskan **fungsi**: data, rumus, aturan, input, dan hak akses. Tampilan dan gaya mengikuti design foundation yang sudah ada.

Rujukan tabel dan kolom: bagian **Data model** di `PRD-Fase-1-MVP.md`.

---

## 1. Tujuan & struktur

Dashboard C-Level menjawab tiga pertanyaan bisnis:

1. **Cashflow, Financial & Forecast** — uang kita aman, untung atau tidak, dan bagaimana beberapa bulan ke depan?
2. **Project Status** — bagaimana kondisi portofolio project secara keseluruhan?
3. **Team Utilization** — tim kita kelebihan atau kekurangan orang?

Dashboard ini menampilkan **angka bisnis yang sudah diolah dan dibandingkan** (vs periode sebelumnya, vs target), bukan daftar operasional. Detail operasional tetap ada di dashboard PM dan halaman masing-masing modul; dashboard C-Level hanya menautkannya.

---

## 2. Aturan umum

### 2.1 Akses

- Dashboard ini hanya untuk role `c_level`.
- Data biaya (cost per orang, margin) hanya bisa dilihat oleh `c_level` dan `hr`. Role lain, termasuk Finance, tidak bisa membaca data biaya lewat API (ditegakkan dengan RLS).

### 2.2 Periode & perbandingan

- Filter periode: **Bulan ini** (default), Bulan lalu, Kuartal ini, Tahun berjalan (YTD), Custom.
- Setiap angka utama menampilkan:
  - Nilai periode terpilih
  - Perubahan vs periode sebelumnya yang sama panjang (nilai dan %)
  - Perbandingan vs target, jika targetnya ada
- Semua perhitungan memakai zona waktu `Asia/Jakarta`.

### 2.3 Mata uang

- **Mata uang laporan: IDR.**
- Uang yang **sudah diterima** memakai nilai asli dari Xendit: `payments.settlement_amount_idr`.
- Uang yang **belum diterima** (piutang, forecast) dalam mata uang asing ditampilkan dalam mata uang aslinya, ditambah **estimasi IDR** memakai kurs referensi (lihat 3.6). Estimasi selalu diberi label "estimasi".

### 2.4 Status angka

Setiap angka yang punya target diberi status:

| Status  | Aturan default |
|---------|----------------|
| Baik    | ≥ 100% target  |
| Waspada | 80–99% target  |
| Buruk   | < 80% target   |

Ambang bisa diubah di settings dashboard.

---

## 3. Data tambahan yang dibutuhkan

Data berikut belum ada di PRD Fase 1 dan perlu ditambahkan.

### 3.1 Biaya orang

```
person_costs        user_id, effective_from date, monthly_cost_idr numeric,
                    notes, created_by
```

- Diisi oleh **HR atau C-Level**. Hanya bisa dibaca oleh HR dan C-Level.
- Menyimpan histori: biaya yang berlaku di suatu bulan adalah baris dengan `effective_from` terakhir sebelum atau pada bulan tersebut.
- **Biaya per jam** seseorang = `monthly_cost_idr` ÷ jam tersedia orang itu di bulan yang sama (lihat 3.2).

### 3.2 Kapasitas orang

```
person_capacity     user_id, effective_from date, weekly_hours numeric,
                    created_by
capacity_overrides  user_id, period_start date, period_end date,
                    available_hours numeric, reason, created_by
```

- Diatur oleh **HR**, fleksibel per orang (misalnya 40 jam untuk karyawan tetap, 20 jam untuk freelancer paruh waktu).
- `capacity_overrides` dipakai untuk cuti, sakit, atau perubahan sementara pada periode tertentu.
- **Jam tersedia** dalam suatu periode = `weekly_hours` × jumlah minggu kerja dalam periode (pro-rata per hari kerja), diganti oleh override jika ada.

### 3.3 Target utilization

```
utilization_targets   role user_role PK, target_percent numeric
utilization_overrides user_id PK, target_percent numeric
```

- Diatur oleh **HR**: target per role, dengan override per orang.
- Contoh default: `designer_dev` 80%, `pm` 50%, `sales` 30%, `finance` 20%, `hr` 20%, `c_level` tidak dihitung.

### 3.4 Target revenue

```
revenue_targets     year int, month int null, target_idr numeric, created_by
                    UNIQUE (year, month)
```

- Diisi oleh **C-Level**. Baris dengan `month = null` adalah target tahunan.
- Jika target bulanan tidak diisi, target bulanan = target tahunan ÷ 12.
- Target kuartal dan YTD = jumlah target bulanan dalam rentang tersebut.

### 3.5 Biaya operasional

```
expense_categories  name, is_active, position
operating_expenses  month date (tanggal 1), category_id, amount_idr numeric,
                    project_id null, notes, created_by
```

- Diinput oleh **Finance** setiap bulan per kategori (software, kantor, freelancer, dan sebagainya). C-Level juga bisa menginput.
- `project_id` opsional, untuk biaya yang langsung terkait satu project (misalnya freelancer khusus project tersebut).
- **Fee Xendit tidak diinput manual**; diambil otomatis dari `payments.fee_amount`.

### 3.6 Kurs referensi

```
fx_reference_rates  currency, rate_to_idr numeric, effective_from date, updated_by
```

- Diperbarui oleh Finance atau C-Level, dipakai hanya untuk **estimasi IDR** dari piutang dan forecast dalam mata uang asing.
- Jika kurs referensi tidak tersedia, gunakan kurs dari pembayaran terakhir dengan mata uang yang sama (`payments.fx_rate_to_idr`).

### 3.7 Retainer fee

Tambahkan kolom ke `projects`:

```
retainer_fee_per_month numeric null   -- dalam mata uang project
```

Wajib diisi untuk project `retainer`; dipakai untuk forecast dan rate efektif.

### 3.8 Kriteria project perlu perhatian

Disimpan di `app_settings` (key `project_attention_rules`), bisa diubah oleh C-Level atau admin:

| Aturan                           | Default                         |
|----------------------------------|---------------------------------|
| Pemakaian budget jam melewati    | 100%                            |
| Jumlah task terlambat lebih dari | 3                               |
| Ada tagihan telat lebih dari     | 14 hari                         |
| Margin project di bawah          | 20% (hanya jika data biaya ada) |

Setiap aturan bisa diaktifkan atau dinonaktifkan.

---

## 4. Bagian 1 — Cashflow, Financial & Forecast

### 4.1 Revenue

- **Definisi:** uang yang **sudah diterima**. Revenue periode = Σ `payments.settlement_amount_idr` dengan `paid_at` dalam periode dan sudah cocok ke invoice.
- **Ditampilkan:** revenue periode, perubahan vs periode sebelumnya, persentase pencapaian target, status (2.4).
- **Tren:** revenue per bulan untuk 12 bulan terakhir beserta target per bulan.
- **Aksi:** buka daftar pembayaran periode tersebut.

### 4.2 Piutang

- **Definisi:** semua `invoice_payment_requests` berstatus `pending` dari invoice berstatus `sent`, `partially_paid`, atau `overdue`.
- **Ditampilkan:**
  - Total piutang per mata uang + total estimasi IDR.
  - **Umur piutang** berdasarkan due date tagihan: Belum jatuh tempo, Telat 1–30 hari, 31–60 hari, lebih dari 60 hari. Masing-masing dengan jumlah tagihan dan nilai.
  - **Client paling sering telat:** 5 client dengan rata-rata hari telat terbesar dalam 6 bulan terakhir (dari tagihan yang dibayar setelah due date dan yang masih telat).
- **Aksi:** buka daftar invoice dengan filter yang sesuai.

### 4.3 Biaya & margin studio

- **Biaya orang periode** = Σ biaya bulanan (`person_costs`) semua user aktif pada periode, pro-rata jika user aktif sebagian bulan.
- **Biaya operasional periode** = Σ `operating_expenses.amount_idr` + Σ `payments.fee_amount` dalam IDR untuk pembayaran di periode.
- **Margin studio** = Revenue − Biaya orang − Biaya operasional.
- **Margin %** = Margin ÷ Revenue × 100%.
- **Ditampilkan:** revenue, biaya orang, biaya operasional, margin, margin %, perubahan vs periode sebelumnya, dan tren margin 12 bulan.
- **Data belum lengkap:** jika ada user aktif tanpa `person_costs` atau bulan tanpa input biaya operasional, tampilkan peringatan "Data biaya belum lengkap" beserta daftar yang kurang, dan beri tanda pada angka margin.

### 4.4 Revenue & margin per client

- **Revenue per client** = revenue (4.1) dikelompokkan per client.
- **Margin per client** = Σ margin project milik client tersebut (5.4).
- **Konsentrasi client:** persentase revenue dari 1 dan 3 client terbesar pada periode. Diberi tanda waspada jika 1 client > 40% revenue *(ambang bisa diubah)*.
- **Ditampilkan:** 10 client teratas berdasarkan revenue, dengan revenue, margin, margin %, dan piutang.

### 4.5 Forecast 3 bulan

Pemasukan yang diharapkan untuk setiap bulan berikutnya (M+1, M+2, M+3):

1. **Pasti terjadwal:** Σ tagihan `pending` dengan due date di bulan tersebut (estimasi IDR).
2. **Retainer berjalan:** untuk setiap project retainer aktif yang `end_date`-nya kosong atau setelah bulan tersebut, tambahkan `retainer_fee_per_month` **jika belum ada tagihan untuk bulan itu** (hindari hitung ganda).
3. **Pipeline (Fase 2):** nilai deal dari Attio × probabilitas tahap, ditampilkan terpisah sebagai "kemungkinan".

- **Ditampilkan:** per bulan: komponen 1, 2, dan 3 terpisah, total, dan target bulan tersebut.
- **Tagihan telat** tidak dimasukkan ke forecast bulan depan; tagihan telat hanya ada di piutang (4.2).

---

## 5. Bagian 2 — Project Status

### 5.1 Ringkasan portofolio

- Jumlah project berdasarkan status: `active`, `on_hold`, dan `completed` dalam periode.
- Jumlah project aktif per tipe kontrak: retainer, fixed, time & material.
- Project baru yang dimulai dalam periode.

### 5.2 Kesehatan portofolio

- Jumlah project aktif dengan status health **On track**, **Warning**, **Over budget** (aturan dari M4).
- Tren jumlah project over budget per bulan untuk 6 bulan terakhir.

### 5.3 Delivery

- **Task tepat waktu %** = task dengan `completed_at` dalam periode dan `completed_at::date <= due_date` ÷ semua task yang selesai dalam periode dan punya due date.
- **Task terlambat saat ini:** jumlah total dan per divisi (berdasarkan role owner).
- Tren task tepat waktu % per bulan untuk 6 bulan terakhir.

### 5.4 Margin per project

Untuk setiap project client:

- **Revenue project** = Σ pembayaran yang cocok dengan invoice project tersebut, dalam IDR.
- **Biaya orang project** = Σ (jam entri project × biaya per jam orang yang mencatat pada bulan entri). Mencakup semua entri project, termasuk out-of-scope.
- **Biaya langsung project** = Σ `operating_expenses` dengan `project_id` tersebut.
- **Margin project** = Revenue project − Biaya orang project − Biaya langsung project.
- **Margin %** = Margin project ÷ Revenue project × 100%.
- **Rate efektif per jam** = nilai kontrak (fixed), atau total retainer fee yang sudah berjalan (retainer), atau revenue project (time & material), dibagi total jam project. Dalam IDR.
- **Nilai pekerjaan out-of-scope** = jam entri `oos_status = 'approved'` × rate efektif per jam. Menunjukkan pekerjaan yang seharusnya bisa ditagih.

**Ditampilkan:** tabel project aktif dan yang selesai dalam periode: kode, nama, client, tipe kontrak, revenue, biaya, margin, margin %, rate efektif, nilai out-of-scope. Bisa diurutkan per kolom.

**Catatan:** untuk project yang masih berjalan, margin bisa negatif sementara karena biaya sudah tercatat sebelum tagihan dibayar. Tampilkan juga **margin proyeksi** = (nilai kontrak dalam IDR estimasi − biaya hingga saat ini − estimasi biaya sisa dari jam task terbuka × rata-rata biaya per jam tim project).

### 5.5 Project perlu perhatian

- Daftar project aktif yang memenuhi minimal satu aturan di 3.8.
- Setiap project menampilkan **alasan** (misalnya "Over budget 112%", "5 task terlambat", "Tagihan telat 21 hari", "Margin 12%").
- Diurutkan dari jumlah alasan terbanyak. Maksimal 10.
- **Aksi:** buka halaman project.

---

## 6. Bagian 3 — Team Utilization

### 6.1 Definisi

- **Jam tersedia:** dari 3.2, per orang per periode.
- **Jam billable:** Σ menit `time_entries` dengan `is_billable = true` dan `oos_status` bukan `pending`.
- **Utilization** = jam billable ÷ jam tersedia × 100%.
- User `c_level` tidak dihitung dalam utilization.

### 6.2 Utilization studio

- Utilization seluruh studio pada periode, vs target rata-rata tertimbang (target per orang × jam tersedia).
- Tren utilization per bulan untuk 12 bulan terakhir.

### 6.3 Utilization per role & per orang

- Per role: utilization, target, jumlah orang.
- Per orang: jam tersedia, jam tercatat, jam billable, utilization, target, dan status:
  - **Overload:** utilization > target + 15 poin, atau jam tercatat > jam tersedia
  - **Sesuai target:** dalam rentang target ± 15 poin
  - **Di bawah target:** utilization < target − 15 poin
  - Rentang ± 15 poin bisa diubah di settings.
- **Data belum lengkap:** orang dengan hari kerja kosong (belum mencatat jam) diberi tanda, karena utilization-nya kemungkinan lebih rendah dari kenyataan.

### 6.4 Komposisi jam

Untuk seluruh studio dan per role, pembagian total jam tercatat dalam periode:

- Billable (in-scope)
- Out-of-scope (approved dan pending)
- Project internal
- Non-billable per kategori (meeting internal, riset, pitching, belajar, admin, dan kategori lain)

### 6.5 Kapasitas ke depan

Untuk 4 dan 8 minggu ke depan:

- **Jam tersedia** seluruh tim (dari 3.2, sudah memperhitungkan override).
- **Jam terjadwal** = Σ `estimate_hours` task terbuka dengan due date dalam rentang tersebut.
- **Sisa kapasitas** = jam tersedia × target utilization − jam terjadwal.
- Per role, sisa kapasitas dan statusnya (cukup / ketat / kurang).
- **Catatan:** task tanpa estimasi tidak terhitung; tampilkan jumlah task terbuka tanpa estimasi sebagai peringatan kualitas data.

---

## 7. Halaman input yang dibutuhkan

| Halaman            | Isi                                                                        | Diisi oleh       | Bisa dilihat                  |
|--------------------|----------------------------------------------------------------------------|------------------|-------------------------------|
| Biaya orang        | Biaya bulanan per orang, dengan tanggal berlaku                            | HR, C-Level      | HR, C-Level                   |
| Kapasitas orang    | Jam per minggu per orang + override periode                                | HR               | HR, C-Level, PM (tanpa biaya) |
| Target utilization | Target per role + override per orang                                       | HR               | HR, C-Level                   |
| Target revenue     | Target tahunan dan bulanan                                                 | C-Level          | C-Level                       |
| Biaya operasional  | Biaya bulanan per kategori, opsional per project                           | Finance, C-Level | Finance, C-Level              |
| Kurs referensi     | Kurs per mata uang                                                         | Finance, C-Level | Finance, C-Level              |
| Aturan dashboard   | Kriteria project perlu perhatian, ambang status, ambang konsentrasi client | C-Level, admin   | C-Level                       |

Semua perubahan pada halaman di atas dicatat (siapa, kapan, nilai lama, nilai baru).

---

## 8. Kelengkapan data

Di bagian atas dashboard, tampilkan peringatan jika data yang memengaruhi akurasi belum lengkap:

- User aktif tanpa biaya bulanan (memengaruhi margin)
- User aktif tanpa kapasitas (memengaruhi utilization)
- Bulan dalam periode tanpa input biaya operasional (memengaruhi margin)
- Project retainer aktif tanpa `retainer_fee_per_month` (memengaruhi forecast)
- Pembayaran yang belum cocok ke invoice (memengaruhi revenue per client dan per project)
- Task terbuka tanpa estimasi (memengaruhi kapasitas)

Setiap peringatan menautkan ke halaman untuk melengkapinya.

---

## 9. Catatan implementasi

- Hitung metrik lewat **database view atau RPC function** dengan `security invoker` agar tunduk pada RLS.
- Data biaya (`person_costs`) tidak boleh ikut terbaca oleh role selain HR dan C-Level, termasuk lewat view gabungan. Uji khusus untuk ini.
- Perhitungan per bulan (revenue, biaya, utilization) sebaiknya disimpan sebagai **snapshot bulanan** setelah bulan berakhir dan timesheet dikunci, agar tren historis stabil dan cepat dimuat. Bulan berjalan dihitung langsung.
- Semua angka uang memakai tipe numeric; pembulatan hanya saat ditampilkan.

---

## 10. Definition of done

- [ ] Hanya role `c_level` yang bisa membuka dashboard ini
- [ ] Role selain HR dan C-Level tidak bisa membaca data biaya maupun margin lewat API (diuji)
- [ ] Revenue, piutang, dan umur piutang cocok dengan perhitungan manual pada data uji
- [ ] Margin studio dan margin per project cocok dengan perhitungan manual, termasuk biaya orang pro-rata
- [ ] Forecast tidak menghitung ganda retainer yang sudah ditagih
- [ ] Utilization per orang dan per role cocok dengan perhitungan manual, termasuk override kapasitas
- [ ] Filter periode dan perbandingan vs periode sebelumnya berjalan untuk semua angka
- [ ] Peringatan kelengkapan data muncul sesuai kondisi di bagian 8
- [ ] Semua halaman input di bagian 7 tersedia dengan hak akses yang benar dan riwayat perubahan

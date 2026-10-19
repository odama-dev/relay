# Odama OS — Design Style Guide

Panduan untuk membuat produk baru dengan **gaya visual yang sama persis** dengan
Odama OS (diwarisi dari Company OS sebelumnya). Dokumen ini diambil langsung dari kode yang berjalan
(`app/globals.css`, `components/`, `components/ui/`), bukan dari asumsi. Kalau
ada yang bertentangan antara dokumen ini dan kode, **kode yang benar**. Perbarui
dokumen ini.

> TL;DR: light default + dark/system opsional, hampir monokrom, padat informasi, permukaan (surface) bukan
> garis (border), radius kecil yang konsisten, satu font (Helvetica), satu set
> ikon (Untitled UI), warna hanya untuk status, motion halus dan bisa dimatikan.

---

## 1. Prinsip Desain

| # | Prinsip | Artinya dalam praktik |
|---|---------|-----------------------|
| 1 | **Serius, tenang, fungsional** | Ini sistem operasi internal, bukan landing page. Tidak ada hero, ilustrasi, atau dekorasi. |
| 2 | **Hampir monokrom** | Hitam/abu/putih untuk 95% UI. Warna hanya untuk *makna* (status, untung/rugi) dan **satu aksen: oranye Odama `#F7721D`** (`--brand`). |
| 3 | **Surface, bukan outline** | Pemisahan dibuat dengan tint background (`foreground/5`, `#111112`) dan gap 2–12px, bukan border 1px. |
| 4 | **Padat tapi bernapas** | Baris tabel 32px, teks 12–14px, tapi gutter dan radius konsisten sehingga tidak terasa sesak. |
| 5 | **Satu pola per interaksi** | Satu tabel, satu badge, satu filter bar, satu empty state. Tidak ada varian one-off. |
| 6 | **Hierarki lewat warna teks, bukan ukuran** | Primary = putih, secondary = `#737373`, tertiary/label = `#373737`. Heading tetap kecil (18px maks). |
| 7 | **Motion = umpan balik** | Animasi hanya untuk state change, drag/drop, dan reveal. Semua patuh `prefers-reduced-motion`. |

### Referensi
- Visual utama: **Exa Web** (Mobbin) + bahasa visual **Twenty CRM**.
- Komponen dasar: **shadcn/ui**, style `radix-nova`, base color `neutral`.
- Motion: **Emil Kowalski** skills (https://github.com/emilkowalski/skills).

---

## 2. Stack Wajib

Agar duplikasinya 1:1, pakai stack yang sama:

```
Next.js (App Router) + React 19 + TypeScript
Tailwind CSS v4 (CSS-first, @theme inline)  + tw-animate-css
shadcn/ui  → style "radix-nova", baseColor "neutral", cssVariables: true
Radix UI primitives (paket `radix-ui`)
@untitledui/icons               → SATU-SATUNYA set ikon
next-themes                     → defaultTheme="light", enableSystem
Helvetica (system font, sans) · next/font/google: Geist_Mono (mono)
Recharts                        → chart
@outpacelabs/avatars            → avatar gradient mesh
@dnd-kit                        → kanban
sonner                          → toast (bottom-right)
cn (paket `cn`) + class-variance-authority
```

`components.json`:

```json
{
  "style": "radix-nova",
  "rsc": true,
  "tsx": true,
  "tailwind": { "css": "app/globals.css", "baseColor": "neutral", "cssVariables": true },
  "menuColor": "default",
  "menuAccent": "subtle"
}
```

---

## 3. Tema: Light (default) + Dark / System

Default **light**. Tiap pengguna bisa memilih Light / Dark / System dari menu
akun di sidebar (`components/app-shell/sidebar-user.tsx`); pilihannya disimpan
oleh next-themes di localStorage (`odama-theme`).

```tsx
<ThemeProvider
  attribute="class"
  defaultTheme="light"
  enableSystem
  storageKey="odama-theme"
  disableTransitionOnChange
>
```

Konsekuensi:
- QA di **kedua** tema. Light memakai token `:root`, dark memakai `.dark`.
- Banyak komponen memakai override `dark:` dengan hex eksak dari Figma
  (lihat §4.3) — itu khusus tampilan dark.
- Selalu tulis kelas light berbasis token (`bg-foreground/5`) di samping
  `dark:`. Jangan pakai `text-white` / hex tanpa prefix `dark:` (kecuali
  "kertas" invoice yang selalu putih).

---

## 4. Warna

### 4.1 Token semantik (dark — yang dipakai)

| Token | Nilai | Dipakai untuk |
|-------|-------|---------------|
| `--canvas` | `#09090a` | Latar paling bawah (di luar panel konten) + sidebar |
| `--panel` | `#0e0e0f` | Panel konten utama (rounded 12px) |
| `--background` | `oklch(0.15 0 0)` | Body |
| `--card` / `--popover` | `oklch(0.18 0 0)` | Popover, dropdown, dialog |
| `--foreground` | `oklch(0.96 0 0)` | Teks utama |
| `--brand` / `--primary` | `#F7721D` | Aksen: switch aktif, checkbox, tanggal terpilih, badge, link, mention, `accent-color` native |
| `--primary-foreground` | `#ffffff` | Teks/ikon di atas aksen |
| `--secondary` | `oklch(0.25 0 0)` | |
| `--muted` | `oklch(0.24 0 0)` | Skeleton, ikon empty state |
| `--muted-foreground` | `oklch(0.68 0 0)` | Teks sekunder (default token) |
| `--accent` | `oklch(0.26 0 0)` | Hover item menu |
| `--border` | `oklch(1 0 0 / 10%)` | Garis (jarang dipakai) |
| `--input` | `oklch(1 0 0 / 14%)` | |
| `--ring` | `oklch(0.7 0 0)` | Focus ring |
| `--destructive` | `oklch(0.704 0.191 22.216)` | Error, rugi, hapus |
| `--success` | `oklch(0.7 0.13 155)` | Untung, selesai |
| `--warning` | `oklch(0.78 0.15 75)` | Perhatian |
| `--mention` | `var(--brand)` | @mention — memakai aksen |

### 4.2 Token light (cadangan)

| Token | Nilai |
|-------|-------|
| `--canvas` | `oklch(0.966 0.0025 85)` (netral hangat) |
| `--panel`, `--background`, `--card` | `oklch(1 0 0)` |
| `--foreground` | `oklch(0.16 0 0)` |
| `--primary` | `var(--brand)` (`#F7721D`) |
| `--muted-foreground` | `oklch(0.53 0 0)` |
| `--border` | `oklch(0.923 0.0022 85)` |
| `--destructive` | `oklch(0.577 0.245 27.325)` |
| `--success` | `oklch(0.62 0.13 155)` |
| `--warning` | `oklch(0.72 0.15 75)` |
| `--mention` | `var(--brand)` |

### 4.3 Palet hex dark (dari Figma — dipakai langsung)

Ini tangga abu-abu yang sebenarnya membentuk tampilan. Hafalkan:

| Hex | Peran |
|-----|-------|
| `#09090a` | Canvas / sidebar / teks di atas tombol putih |
| `#0e0e0f` | Panel konten |
| `#111112` | **Surface kartu**: card, tabel, stat strip `card`, chart |
| `#131314` · `#151516` | Surface terangkat (composer BI, elemen di dalam kartu) |
| `#161617` · `#1b1b1c` | Pembatas vertikal stat strip, grid chart |
| `#171719` | Item nav aktif / hover |
| `#232325` | Garis panduan (favorit di sidebar) |
| `#292929` | Garis chart yang di-*mute* |
| `#373737` | **Teks tersier**: header kolom tabel, label grup nav |
| `#6c6c6c` | Teks sumbu chart |
| `#737373` | **Teks sekunder**: label, placeholder, ikon nav idle |
| `#ffffff` | Teks primer, garis chart utama, tombol primer |

Warna status (dark, dari Figma):

| Hex | Peran |
|-----|-------|
| `#00d748` | Positif (untung, aktif, selesai) |
| `#eaa908` | Warning |
| `#ff5b5b` | Critical |
| `red-500` | Dot notifikasi belum dibaca (6px) |
| `amber-400` | Bintang favorit — satu-satunya pengecualian dekoratif |

### 4.4 Overlay putih (alpha) — cara utama membuat surface

Di dark, surface interaktif dibuat dengan **putih transparan**, bukan abu solid:

| Kelas | Pakai untuk |
|-------|-------------|
| `bg-white/4` | Hover baris tabel |
| `bg-white/5` | Input, select, filter pill, badge netral, hover tab |
| `bg-white/8` | Hover input/pill |
| `bg-white/10` | Tombol secondary/outline, tab aktif, badge `active` |
| `bg-white/15` | Hover tombol secondary |

Padanan light: `bg-foreground/3 … /15`.

### 4.5 Chart

- Ramp monokrom: `--chart-1..5` = `oklch(0.9 / 0.75 / 0.6 / 0.46 / 0.34 0 0)`.
- Overview chart: grid `#1b1b1c` dashed `5 6`, garis utama `#ffffff`, garis
  sekunder `#292929` dengan fill gradient 18% → 0%, sumbu `#6c6c6c` 12px.
- Warna hanya bila data punya makna (rugi = destructive).

### 4.6 Aturan warna

- ❌ Jangan menambah warna accent lain (ungu, biru, gradient). Satu-satunya aksen adalah `#F7721D` lewat token `primary`/`brand`, jangan hard-code hex-nya.
- ❌ Jangan pakai warna status untuk sesuatu yang bukan status.
- ✅ Status selalu **tint background + teks berwarna** (`bg-x/10..20 text-x`),
  tidak pernah outline atau solid fill.
- ✅ Satu-satunya gradient yang diizinkan: ikon BI aktif (`stars-gradient`) dan
  avatar mesh.

---

## 5. Tipografi

### 5.1 Font

```ts
// sans = "Helvetica Neue", Helvetica, Arial, sans-serif — set in globals.css @theme (2026-10-16, replaced Inter Tight)
// Helvetica Neue first: plain Helvetica has no Medium face (500 rendered as 400).
const mono = Geist_Mono({ variable: "--font-mono", subsets: ["latin"] });
```

```css
html { font-size: 15px; }                       /* root 15px, bukan 16 */
body { @apply text-sm antialiased; }
.tabular { font-variant-numeric: tabular-nums; }
```

`--font-heading` = `--font-sans`. Tidak ada font display/serif.

### 5.2 Skala (px eksplisit — ikuti Figma)

| Peran | Ukuran / line-height | Weight | Warna |
|-------|---------------------|--------|-------|
| Judul halaman dashboard | 18 / normal | 500 | putih |
| **Headline** — judul halaman (PageHeader, compact 16px juga) | `text-xl` / tracking-tight | 500 | putih |
| **Title** — judul kartu/section/dialog/sheet | 14–16 / normal | 500 | putih |
| Nilai KPI (card) | 18 / normal | 500 tabular | putih |
| Nilai KPI (plain) | 16 / normal | 500 tabular | putih |
| Label KPI | 14 / 20 | 400 | `#737373` |
| Body / sel tabel | 13 / 20 | 400 | putih |
| Kontrol (filter, pill) | 14 / 20 | 500 | putih |
| Nav sidebar (idle → **active**) | 12 / 20 | 400 | `#737373` → putih + bg saat aktif |
| Header kolom tabel | 12 / 20 UPPERCASE | 400 | `#373737` |
| Label grup nav | 10 / 20 UPPERCASE | 400 | `#373737` |
| Badge | 12 / 20 | 400 | warna status |
| Caption / hint | `text-xs` | 400 | muted |
| Micro (`text-2xs`) | 11px | 500 tracking-wide UPPERCASE | muted (header kolom kanban, ⌘K) |

### 5.3 Aturan tipografi

- **Heading tidak boleh besar.** Maksimum 18–20px di layar operasional.
  Tidak ada hero heading.
- Hierarki dibangun dengan **warna** (putih / #737373 / #373737), lalu weight.
  **Headline 500** (20px; compact 16px), **title 500** (14–16px) — headline
  dibedakan lewat ukuran; **menu aktif 400** (dibedakan lewat warna + background).
  700 terlalu berat untuk judul. Jangan pakai 600 — Helvetica Neue tidak punya
  Semibold, jadi tampil sebagai 700.
  Nilai KPI/total memakai 500, jangan menyaingi headline.
- Semua angka (uang, persen, hitungan) pakai `.tabular` dan rata kanan di tabel.
- Uang selalu lewat formatter (`formatMoney`, `formatMoneyCompact`,
  `formatMoneyTight`, `formatMoneyAxis`) — IDR, tanpa desimal. Jangan format
  manual di komponen.
- Teks panjang di sel/list selalu `truncate` + `min-w-0`; tampilkan nilai penuh
  lewat `title`.
- Label enum ditampilkan lewat `humanizeEnum` (`IN_PROGRESS` → "In progress").

---

## 6. Spacing, Radius, Elevasi

### 6.1 Spacing

Grid dasar 4px, dengan nilai Figma eksplisit (`gap-[12px]`, `p-[16px]`).
Nilai yang sering dipakai:

| Nilai | Dipakai untuk |
|-------|---------------|
| 2px | Gap antar baris tabel (border-spacing), item favorit |
| 6px | Gap item nav, footer sidebar |
| 8px | Gap kontrol di filter bar, gap ikon-label |
| 10px | Gap sidebar ↔ panel, padding kartu kecil |
| 12px | Gutter canvas, gap antar section dashboard, padding horizontal nav |
| 14px | Gap label → nilai di KPI |
| 16px | Padding kartu, padding sel tabel horizontal |
| 20px | Padding panel konten (desktop) |
| 24px | Gap antar blok sidebar, gap KPI, `mb-6` di bawah PageHeader |

### 6.2 Radius

`--radius: 0.5rem` (8px). Turunan: `sm` 6, `md` 7, `lg` 8, `xl` 10.

| Elemen | Radius |
|--------|--------|
| Panel konten | 12px |
| Kartu, tabel, stat strip, chart, composer | 10px |
| Input, select, filter pill, dropdown, item nav | 8px |
| Item nav aktif, logo, item menu | 6px |
| Checkbox, focus ring kecil | 4px |
| **Button** | `rounded-full` (pill) |
| **Badge status** | `rounded-[99px]` (pill) |
| Ujung baris tabel | 8px (kiri & kanan, agar hover terbaca satu pill) |

Aturan: pill **hanya** untuk tombol dan badge. Kartu tidak boleh lebih bulat
dari 12px.

### 6.3 Elevasi / shadow

Hampir datar. Kedalaman dari *tint*, bukan bayangan.

| Token | Nilai (dark) | Pakai |
|-------|--------------|-------|
| `shadow-panel` | `0 1px 2px #0006, 0 8px 24px -16px #0009` | Panel mengambang |
| `shadow-pill` | `0 1px 2px #0000004d` | Pill kecil |
| `shadow-composer` | `0 2px 6px …/0.1, 0 16px 40px -12px …/0.1` | Composer BI (satu-satunya yang "mengangkat") |
| `shadow-md` | — | Dropdown, select, popover, kartu kanban saat hover |
| `shadow-lg` | — | Sheet, submenu |

❌ Tanpa glassmorphism. Satu-satunya blur: overlay dialog (`backdrop-blur-xs`,
`bg-black/10`) dan mobile bar (`bg-canvas/85 backdrop-blur`).

---

## 7. Layout & App Shell

```
┌──────────────────────── canvas #09090a, padding 12px ─────────────────────────┐
│ ┌─ sidebar 220px ─┐ 10px ┌──────── panel #0e0e0f, rounded 12px, p 20px ──────┐ │
│ │ logo · 🔔 · «   │      │ PageHeader / judul 18px          [Primary pill]   │ │
│ │                 │      │                                                   │ │
│ │ Overview        │      │ StatStrip (plain)                                 │ │
│ │ BI              │      │ ┌ chart #111112 r10 ───────┐ ┌ list #111112 380 ┐ │ │
│ │ OPERATIONS      │      │ │                          │ │                  │ │ │
│ │  Clients        │      │ └──────────────────────────┘ └──────────────────┘ │ │
│ │  Projects       │      │ StatStrip (card)                                  │ │
│ │   └ favorit     │      │                                                   │ │
│ │ FINANCE …       │      │                                                   │ │
│ │ ─────────────── │      │                                                   │ │
│ │ Settings · user │      │                                                   │ │
│ └─────────────────┘      └───────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────────────────────────┘
```

### 7.1 Shell

```tsx
<div className="bg-canvas flex min-h-dvh md:gap-[10px] md:p-[12px]">
  <Sidebar />                                 {/* hidden < md */}
  <div className="flex min-w-0 flex-1 flex-col">
    <MobileBar />                             {/* md:hidden */}
    <main className="bg-panel flex flex-1 flex-col px-4 py-6 md:rounded-[12px] md:p-[20px]">
      {children}
    </main>
  </div>
</div>
```

### 7.2 Sidebar

- Lebar **220px**, collapse ke rail **64px** (`transition-[width] duration-200 ease-out`).
- `sticky top-[12px] h-[calc(100dvh-24px)] px-[12px] py-[16px]`, menyatu dengan canvas (tanpa border, tanpa background berbeda).
- Status collapse disimpan di **cookie** agar first paint benar (tanpa flash). Shortcut **⌘\\** (bukan ⌘B).
- Header: logo 24px rounded 6 + nama 12px, lalu bell + toggle (ikon 14px, hit area diperluas `after:-inset-[6px]`).
- Item nav: `h-[28px] rounded-[8px] px-[12px] text-[12px]`, ikon **14px stroke 1.2**.
  - Idle: `text-[#737373]`, hover `bg-[#171719] text-white`.
  - Aktif: `bg-[#171719] text-white rounded-[6px]`, `aria-current="page"`.
- Grup: label 10px UPPERCASE `#373737`. Saat rail: label diganti garis 20px.
- Sub-item (favorit): indent dengan garis kiri `border-[#232325]` tepat di bawah tengah ikon induk (`ml-[19px]`), item `h-[26px]`.
- Rail mode: label pindah ke Tooltip `side="right"`.
- Footer: Settings + blok user, menempel di bawah.

### 7.3 Mobile (< md)

- Sidebar disembunyikan; `MobileBar` sticky `h-14 bg-canvas/85 backdrop-blur`:
  tombol menu (Sheet kiri 300px) · search · bell.
- Panel kehilangan radius dan padding menjadi `px-4 py-6`.

### 7.4 Pola halaman

**Halaman list (Clients, Projects, …)**
```
PageHeader (title + description + actions)
FilterBar (filter kiri, search 294px kanan)  ← sinkron ke URL
ViewToggle (list/kanban) bila relevan
DataTable / Kanban
```

**Halaman detail**
```
PageHeader (eyebrow = breadcrumb, meta = atribut kunci, actions)
StatStrip
EntityTabs (sinkron ke ?tab=)
```

**Dashboard**
```
judul 18px + tombol primer
StatStrip plain
[chart flex-1] [list 380px]   ← mengisi tinggi viewport di lg
StatStrip card
```

Dashboard desktop mengisi panel: `lg:h-[calc(100dvh-64px)] lg:min-h-[680px]`,
baris tengah `lg:flex-1`.

---

## 8. Komponen

> Aturan emas: **pakai yang ada.** Kalau butuh variasi, tambah prop ke komponen
> bersama, jangan bikin komponen baru yang mirip.

### 8.1 Button (`components/ui/button.tsx`)

Selalu **pill** (`rounded-full`), tanpa border terlihat.

| Variant | Dark | Kapan |
|---------|------|-------|
| `default` | `bg-white text-black hover:bg-white/90` | Satu aksi utama per area |
| `secondary` / `outline` | `bg-white/10 text-white hover:bg-white/15` | Aksi sekunder (keduanya identik — sengaja) |
| `ghost` | transparan, hover `bg-muted/50` | Aksi tersier, ikon, "Clear" |
| `destructive` | `bg-destructive/20 text-destructive` | Hapus/void — tint, bukan merah solid |
| `link` | underline saat hover | Inline |

| Size | Tinggi |
|------|--------|
| `xs` | 24px (`text-xs`, ikon 12) |
| `sm` | 28px (ikon 14) |
| `default` | 32px |
| `lg` | 36px |
| `icon-xs/sm/icon/lg` | 24 / 28 / 32 / 36 kotak |

Tombol primer di header dashboard: `h-auto px-[12px] py-[5px] text-[14px] gap-[8px]`.
Feedback tekan: `active:translate-y-px`. Disabled: `opacity-50`.
Ikon di tombol pakai `data-icon="inline-start|inline-end"` untuk padding asimetris.

### 8.2 Input / Textarea / Select

**Tanpa border.** Fill saja:

```
h-8 rounded-lg bg-white/5 hover:bg-white/8 focus-visible:bg-white/8 px-2.5
placeholder:text-muted-foreground  md:text-sm (mobile text-base agar iOS tidak zoom)
aria-invalid → bg-destructive/15
```

Select trigger sama (`rounded-lg bg-foreground/5`). Dropdown content:
`rounded-lg bg-popover shadow-md p-1`, item `rounded-md py-1 pl-1.5`, hover
`bg-accent`.

Kontrol di filter bar: `h-[30px] rounded-[8px] bg-white/5 text-[14px]`; search
memakai ikon 16px di `left-[12px]` dan `pl-[36px]`, lebar `sm:w-[294px]`.

### 8.3 Form (`components/form-field.tsx`)

- `FormSection` → judul `text-sm font-medium`, `gap-4`.
- `FormField` → Label, kontrol, lalu hint ATAU error (`text-xs`), `gap-1.5`.
- Wajib: tanda `*` muted dengan `aria-hidden`.
- Selalu pakai `fieldA11y(id, error, hasHint)` untuk `aria-invalid` + `aria-describedby`.
- Validasi: Zod + React Hook Form. Error muncul di bawah field, bukan toast.

### 8.4 DataTable (`components/data-table.tsx`)

Tabel adalah **surface**, bukan grid bergaris.

```
wrapper: bg-[#111112] rounded-[10px] overflow-hidden
table:   border-separate border-spacing-y-[2px] -mt-[2px]
thead:   h-[34px] px-[16px] text-[12px] UPPERCASE text-[#373737]
row:     h-[32px], tanpa border
cell:    px-[16px] text-[13px] leading-[20px] text-white
         first:rounded-l-[8px] last:rounded-r-[8px]
hover:   [&:hover>td]:bg-white/4   (terbaca sebagai satu pill)
angka:   align="right" → tabular text-right
```

- Sort client-side: klik header → asc/desc, chevron 12px, `aria-sort`.
- Baris klikable via `getRowHref` (`cursor-pointer`).
- Dua baris dalam sel → `CellStack` (primary + secondary `text-xs muted`);
  baris otomatis dapat `py-[4px]`.
- Paginasi 25/halaman, footer `text-xs` + tombol ghost `xs` Previous/Next.
- `layout="fixed"` untuk kolom sama lebar.
- Kosong → `EmptyState` otomatis.

### 8.5 StatusBadge (`components/status-badge.tsx`)

```
h-[24px] rounded-[99px] px-[8px] py-[2px] text-[12px] font-normal border-transparent
```

| Tone | Dark |
|------|------|
| `neutral` | `bg-white/5 text-white/50` |
| `active` | `bg-white/10 text-white` |
| `positive` | `bg-[#00d748]/5 text-[#00d748]` |
| `warning` | `bg-[#eaa908]/20 text-[#eaa908]` |
| `critical` | `bg-[#ff5b5b]/20 text-[#ff5b5b]` |

Semua enum dipetakan ke **5 tone ini saja** di satu `MAP`. Jangan buat warna
badge baru — tambahkan entri ke map. Pemetaan umum: draft/planning/low →
neutral; in progress/invoiced/pending → active; active/done/collected →
positive; paused/review/high/busy → warning; expired/at risk/urgent/void →
critical.

### 8.6 StatStrip & StatCard

**StatStrip** (pola KPI utama):
- Baris KPI dipisah garis vertikal `w-px h-[56px]` (`#161617` plain /
  `#1b1b1c` card). Mobile: grid 2 kolom tanpa garis.
- Item: label 14px `#737373` → (gap 14) → nilai 16/18px medium tabular →
  sublabel 14px berwarna sesuai `tone`.
- `variant="plain"` duduk langsung di panel; `variant="card"` punya surface
  `#111112 rounded-[10px] p-[16px]`.
- Opsional `gauge` (0..1): half-dial 64px, 4 segmen, segmen aktif menyala +
  jarum, spring 0.8s tanpa bounce. Monokrom; merah bila `tone="negative"`.

**StatCard** (KPI tunggal di grid): `rounded-xl p-4`, label `text-xs`,
nilai `text-xl font-medium tabular`, delta hijau/merah dengan tanda `+`.

### 8.7 Card (`components/ui/card.tsx`)

`rounded-[10px] bg-[#111112] py-4` dengan `--card-spacing: 16px` (sm: 12px).
**Tanpa border, tanpa shadow.** Judul `text-base font-medium` (atau 14px
medium untuk kartu dashboard). Aksi di kanan header (`CardAction`).

Kartu chart / list dashboard: `bg-[#111112] rounded-[10px] p-[16px] gap-[10px]`,
header = judul 14px + `PillSelect` di kanan.

### 8.8 PillSelect

Dropdown ringkas di header kartu ("Last 6 Month ⌄"):
`bg-white/5 hover:bg-white/8 rounded-[8px] px-[12px] py-[7px] text-[14px] font-medium`,
chevron 16px, menu `align="end"`.

### 8.9 Tabs / EntityTabs

- Default variant: tanpa track. Trigger `rounded-[8px] px-3 py-1.5`,
  idle `text-foreground/60`, hover `bg-white/5`, aktif `bg-white/10 text-white`.
- Hitungan di tab: `text-xs muted tabular` setelah label.
- Tab aktif disinkronkan ke `?tab=` dengan `history.replaceState` (tanpa
  round-trip server).

### 8.10 ViewToggle

Segmented ikon-saja: wrapper `rounded-md border p-0.5`, tombol `icon-sm`,
aktif `secondary`, idle `ghost`, `aria-pressed`, tooltip berisi label.

### 8.11 Dialog / Sheet / Popover / Tooltip

| Komponen | Gaya |
|----------|------|
| Dialog overlay | `bg-black/10 backdrop-blur-xs`, fade 100ms |
| Dialog content | `rounded-xl bg-popover p-4 ring-1 ring-foreground/10 sm:max-w-sm`, fade + zoom-in-95 100ms |
| Dialog footer | `-mx-4 -mb-4 border-t bg-muted/50 p-4`, tombol rata kanan |
| Dialog title | `text-base font-medium leading-none` |
| Sheet | `bg-popover shadow-lg`, slide 200ms ease-in-out |
| Popover | `w-72 rounded-lg p-2.5 shadow-md` |
| Dropdown | `rounded-lg p-1 shadow-md`, slide-in 2 dari sisi pemicu |
| Tooltip | **inverted**: `bg-foreground text-background rounded-md px-3 py-1.5 text-xs`, delay 200ms |

Konfirmasi destruktif lewat `ConfirmDialog` bersama, bukan `window.confirm`.

### 8.12 States (`components/states.tsx`)

- **EmptyState**: terpusat, `py-14`, lingkaran 40px `bg-muted` berisi ikon 18px,
  judul `text-sm font-medium`, deskripsi `text-sm muted max-w-sm`, aksi opsional.
  Default ikon `empty` (Inbox). Copy singkat dan membantu ("No clients yet").
- **ErrorState**: sama, lingkaran `bg-destructive/10 text-destructive` ikon warning.
  Default: "Something went wrong" / "Try again or reload the page."
- **Loading**: skeleton yang **meniru bentuk akhirnya** — `TableSkeleton`,
  `CardsSkeleton` (surface `#111112`). Tidak ada spinner halaman penuh.
- **Toast** (sonner): `bottom-right`, untuk konfirmasi aksi sukses/gagal saja.

### 8.13 Kanban

- Kolom `w-[18.4rem]`, header `text-2xs UPPERCASE tracking-wide muted` + hitungan
  tabular yang membesar (`scale-125`) saat menjadi target drop.
- Area drop `rounded-lg p-2 gap-2`, highlight `bg-foreground/[0.03]`.
- Kartu `bg-card rounded-lg p-3`, hover naik `-translate-y-0.5` + `shadow-md`,
  tekan `scale-[0.98]`, terpilih `bg-muted shadow-md`, sumber drag `opacity-30`.
- Lihat §9 untuk physics.

### 8.14 Avatar

Satu avatar untuk semua: **gradient mesh deterministik** dari seed (id/email),
tanpa inisial, default 34px bulat (`MemberAvatar`). Jangan pakai foto atau
inisial berwarna.

### 8.15 Ikon

- **Hanya `@untitledui/icons`**, diakses lewat `<Icon name="…" />` dengan nama
  semantik (`overview`, `add`, `delete`, `warning`…). Jangan import paket ikon
  langsung di kode aplikasi. Jangan pakai lucide di kode aplikasi (lucide hanya
  boleh ada sebagai internal primitif shadcn).
- Ukuran: **14px** (nav, stroke 1.2), **16px** default (stroke 2), **12px**
  (tabel/sort), **15px** (stat card, toggle), **18px** (empty state, menu mobile).
- Warna selalu `currentColor`, ikut warna teks.
- Ikon tanpa label harus punya `aria-label` + Tooltip.

### 8.16 Lain-lain

- `BreakdownList`: daftar "X by Y" bergaris bar 6px `rounded-full`, track
  `bg-muted`, isi `bg-primary`, maksimum 8 item, nilai compact.
- `MoneyText`: selalu tabular, `title` berisi nilai lengkap, opsi `compact`/`muted`.
- Global search: **⌘K** (command palette), `kbd` `text-2xs bg-muted font-mono`.
- Notifikasi belum dibaca: dot merah 6px dengan `role="status"` + label.
- @mention: warna `--mention` (= aksen oranye).

---

## 9. Motion

### 9.1 Prinsip
- Cepat dan disengaja: **100ms** untuk overlay/menu, **200ms** untuk layout
  (sidebar, sheet), **300ms** untuk interaksi fisik (kanban).
- Animasi hanya untuk: masuk/keluar overlay, perubahan state, drag & drop,
  nilai gauge.
- ❌ Tidak ada page transition, parallax, scroll animation, bouncing UI,
  efek marketing.

### 9.2 Token

| Nama | Nilai | Dipakai |
|------|-------|---------|
| Overlay | `duration-100` fade + `zoom-in-95` / `slide-in-from-*-2` | Dialog, menu, popover, tooltip |
| Layout | `duration-200 ease-out` | Sidebar collapse, sheet |
| Warna | `transition-colors` (default 150ms) | Hover nav, input, pill |
| Spring | `cubic-bezier(0.34, 1.56, 0.64, 1)` 300–320ms | Kanban lift, drop, sort, counter |
| Gauge | spring `visualDuration 0.8, bounce 0` | Jarum StatGauge |
| Press | `active:translate-y-px` (button), `active:scale-[0.98]` (kartu) | |

Keyframe kartu kanban mendarat:

```css
@keyframes kanban-card-land {
  0%   { opacity: 0; transform: translateY(6px) scale(0.97); }
  60%  { opacity: 1; transform: translateY(-1px) scale(1.01); }
  100% { opacity: 1; transform: none; }
}
```

Drag overlay kanban: miring mengikuti kecepatan pointer (spring stiffness 320,
damping 20, maks 7°), diam saat reduced motion.

### 9.3 Reduced motion (wajib)

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

Plus `motion-safe:` / `motion-reduce:` di Tailwind dan hook
`usePrefersReducedMotion` untuk animasi JS (drop animation = `null`).

---

## 10. Aksesibilitas

- Desktop-first; tablet harus tetap usable; tidak ada horizontal overflow yang
  tidak disengaja (`min-w-0` di setiap flex child yang berisi teks).
- HTML semantik: `nav`, `main`, `aside`, `section`, `h1` per halaman,
  `role="search"` di filter bar, `aria-current="page"` di nav aktif.
- Semua interaksi bisa keyboard. Focus terlihat:
  `focus-visible:ring-2 ring-ring` (kecil) atau `ring-3 ring-ring/50` (kontrol).
- Hit area kecil diperluas dengan pseudo-element (`after:absolute after:-inset-[6px]`).
- Ikon-saja → `aria-label` + Tooltip. Dekoratif → `aria-hidden`.
- Status async → `aria-busy` + region `aria-live="polite"` sr-only.
- Kontras: teks penting minimal `#737373` di atas `#0e0e0f`; `#373737` **hanya**
  untuk label tersier/header kolom yang selalu didampingi konteks.

---

## 11. Copywriting UI

- Bahasa Inggris. Title Case untuk nav, judul halaman, dan tombol utama
  ("Finance Overview", "New Project"); sentence case untuk label KPI, deskripsi,
  dan state ("Gross profit", "Active clients", "Nothing here yet").
- Singkat dan langsung. Tanpa tanda seru, tanpa emoji.
- Empty state menjelaskan apa yang akan muncul + satu aksi.
- Error menyebut apa yang salah dan apa yang bisa dilakukan.
- Ellipsis memakai karakter `…`, bukan `...`.

---

## 12. Batasan (Do / Don't)

### ❌ Dilarang
1. Estetika "AI dashboard" generik: glow, gradient ungu-biru, kartu neon.
2. Gradient selain yang disebut di §4.6.
3. Kartu/elemen yang terlalu bulat (>12px) atau pill di luar tombol/badge.
4. Shadow tebal, glassmorphism, blur dekoratif.
5. Heading besar / hero di layar operasional.
6. Warna accent acak, warna per-modul, warna kategori dekoratif.
7. Border 1px sebagai pemisah utama (pakai surface + gap).
8. Spacing ad-hoc di luar skala §6.1.
9. Font kedua, ikon dari set lain, emoji sebagai ikon.
10. Animasi tanpa fungsi, page transition, bounce di luar kanban.
11. Komponen one-off yang menduplikasi komponen bersama.
12. Menambah/mengubah token global tanpa persetujuan.
13. Memformat uang/tanggal/enum langsung di komponen.
14. Warna hardcode (hex / `white`) tanpa prefix `dark:` yang merusak salah satu tema.

### ✅ Wajib
1. Pakai komponen bersama: `PageHeader`, `DataTable`, `CellStack`, `StatStrip`,
   `StatCard`, `StatusBadge`, `MoneyText`, `FilterBar`, `PillSelect`,
   `EntityTabs`, `ViewToggle`, `FormField`, `EmptyState`, `ErrorState`,
   skeleton, `ConfirmDialog`, `MemberAvatar`, `Icon`.
2. Filter, search, tab, dan view disimpan di URL (bisa dibagikan, tahan reload).
3. Angka tabular, rata kanan di tabel.
4. Setiap layar punya state: loading, empty, error, sukses.
5. Patuhi reduced motion.
6. Design QA sebelum dianggap selesai (§14).

### Kalau fitur bertentangan dengan sistem
Pertahankan sistemnya, adaptasi fiturnya. Jika memang perlu pola baru, jadikan
komponen bersama dan dokumentasikan di sini.

---

## 13. Starter `globals.css`

Salin ini untuk memulai proyek duplikat (Tailwind v4):

```css
@import "tailwindcss";
@import "tw-animate-css";
@import "shadcn/tailwind.css";

@custom-variant dark (&:is(.dark *));

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --font-sans: var(--font-sans);
  --font-mono: var(--font-mono);
  --font-heading: var(--font-sans);

  --color-sidebar: var(--sidebar);
  --color-sidebar-foreground: var(--sidebar-foreground);
  --color-sidebar-accent: var(--sidebar-accent);
  --color-sidebar-border: var(--sidebar-border);
  --color-panel: var(--panel);
  --color-canvas: var(--canvas);

  --color-chart-1: var(--chart-1);
  --color-chart-2: var(--chart-2);
  --color-chart-3: var(--chart-3);
  --color-chart-4: var(--chart-4);
  --color-chart-5: var(--chart-5);

  --color-ring: var(--ring);
  --color-input: var(--input);
  --color-border: var(--border);
  --color-destructive: var(--destructive);
  --color-success: var(--success);
  --color-warning: var(--warning);
  --color-mention: var(--mention);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);

  --radius-sm: calc(var(--radius) - 2px);
  --radius-md: calc(var(--radius) - 1px);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) + 2px);

  --text-2xs: 0.6875rem;

  --shadow-panel: var(--panel-shadow);
  --shadow-pill: var(--pill-shadow);
  --shadow-composer: var(--composer-shadow);
}

:root {
  --radius: 0.5rem;
  --background: oklch(1 0 0);
  --foreground: oklch(0.16 0 0);
  --canvas: oklch(0.966 0.0025 85);
  --panel: oklch(1 0 0);
  --card: oklch(1 0 0);
  --card-foreground: oklch(0.16 0 0);
  --popover: oklch(1 0 0);
  --popover-foreground: oklch(0.16 0 0);
  --primary: oklch(0.2 0 0);
  --primary-foreground: oklch(0.985 0 0);
  --secondary: oklch(0.97 0 0);
  --secondary-foreground: oklch(0.2 0 0);
  --muted: oklch(0.975 0 0);
  --muted-foreground: oklch(0.53 0 0);
  --accent: oklch(0.965 0 0);
  --accent-foreground: oklch(0.2 0 0);
  --destructive: oklch(0.577 0.245 27.325);
  --success: oklch(0.62 0.13 155);
  --warning: oklch(0.72 0.15 75);
  --mention: oklch(0.55 0.17 255);
  --border: oklch(0.923 0.0022 85);
  --input: oklch(0.923 0.0022 85);
  --ring: oklch(0.16 0 0);
  --panel-shadow: 0 1px 2px oklch(0.16 0 0 / 0.04), 0 8px 24px -16px oklch(0.16 0 0 / 0.16);
  --pill-shadow: 0 1px 2px oklch(0.16 0 0 / 0.06);
  --composer-shadow: 0 2px 4px oklch(0.16 0 0 / 0.1), 0 14px 34px -12px oklch(0.16 0 0 / 0.1);
  --chart-1: oklch(0.28 0 0);
  --chart-2: oklch(0.44 0 0);
  --chart-3: oklch(0.58 0 0);
  --chart-4: oklch(0.7 0 0);
  --chart-5: oklch(0.83 0 0);
  --sidebar: oklch(0.966 0.0025 85);
  --sidebar-foreground: oklch(0.16 0 0);
  --sidebar-accent: oklch(0.94 0.0025 85);
  --sidebar-border: oklch(0.923 0.0022 85);
}

.dark {
  --background: oklch(0.15 0 0);
  --foreground: oklch(0.96 0 0);
  --canvas: #09090a;
  --panel: #0e0e0f;
  --card: oklch(0.18 0 0);
  --card-foreground: oklch(0.96 0 0);
  --popover: oklch(0.18 0 0);
  --popover-foreground: oklch(0.96 0 0);
  --primary: oklch(0.92 0 0);
  --primary-foreground: oklch(0.2 0 0);
  --secondary: oklch(0.25 0 0);
  --secondary-foreground: oklch(0.96 0 0);
  --muted: oklch(0.24 0 0);
  --muted-foreground: oklch(0.68 0 0);
  --accent: oklch(0.26 0 0);
  --accent-foreground: oklch(0.96 0 0);
  --destructive: oklch(0.704 0.191 22.216);
  --success: oklch(0.7 0.13 155);
  --warning: oklch(0.78 0.15 75);
  --mention: oklch(0.74 0.13 255);
  --border: oklch(1 0 0 / 10%);
  --input: oklch(1 0 0 / 14%);
  --ring: oklch(0.7 0 0);
  --panel-shadow: 0 1px 2px oklch(0 0 0 / 0.4), 0 8px 24px -16px oklch(0 0 0 / 0.6);
  --pill-shadow: 0 1px 2px oklch(0 0 0 / 0.3);
  --composer-shadow: 0 2px 6px oklch(0 0 0 / 0.1), 0 16px 40px -12px oklch(0 0 0 / 0.1);
  --chart-1: oklch(0.9 0 0);
  --chart-2: oklch(0.75 0 0);
  --chart-3: oklch(0.6 0 0);
  --chart-4: oklch(0.46 0 0);
  --chart-5: oklch(0.34 0 0);
  --sidebar: #09090a;
  --sidebar-foreground: oklch(0.96 0 0);
  --sidebar-accent: oklch(0.24 0 0);
  --sidebar-border: oklch(1 0 0 / 10%);
}

@layer base {
  * { @apply border-border outline-ring/50; }
  html { @apply font-sans; font-size: 15px; }
  body {
    @apply bg-background text-foreground text-sm antialiased;
    font-feature-settings: "cv11", "ss01";
  }
  .tabular { font-variant-numeric: tabular-nums; }
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after {
      animation-duration: 0.01ms !important;
      animation-iteration-count: 1 !important;
      transition-duration: 0.01ms !important;
      scroll-behavior: auto !important;
    }
  }
}
```

Lalu: salin `components/ui/*` (sudah dimodifikasi dari shadcn default — tombol
pill, input tanpa border, card tanpa border) dan komponen bersama di
`components/`. **Jangan** jalankan ulang `shadcn add` untuk komponen yang sudah
ada, karena itu menimpa modifikasinya.

---

## 14. Checklist Design QA

Sebelum fitur dianggap selesai:

**Visual**
- [ ] Hanya warna dari §4; tidak ada hex baru di luar tabel §4.3.
- [ ] Spacing dari skala §6.1; radius dari tabel §6.2.
- [ ] Tidak ada border sebagai pemisah utama; surface `#111112` untuk kartu/tabel.
- [ ] Tipografi sesuai §5.2; heading ≤ 20px; angka tabular.
- [ ] Ikon dari `<Icon>`, ukuran sesuai konteks.
- [ ] Status memakai `StatusBadge` dengan salah satu dari 5 tone.

**Konsistensi**
- [ ] Memakai komponen bersama, tidak ada duplikat one-off.
- [ ] Tata letak halaman mengikuti pola §7.4.
- [ ] Hanya satu tombol `default` (putih) per area.

**State**
- [ ] Loading (skeleton berbentuk), empty, error, sukses (toast) ada semua.
- [ ] Teks panjang ter-truncate tanpa merusak layout.

**Responsif & a11y**
- [ ] Tidak ada horizontal overflow di 375px, 768px, 1280px, 1440px.
- [ ] Bisa dioperasikan penuh dengan keyboard; focus terlihat.
- [ ] Label/aria lengkap; ikon-saja punya tooltip.
- [ ] Reduced motion diuji (DevTools → Rendering → prefers-reduced-motion).

**Motion**
- [ ] Durasi dari §9.2; tidak ada animasi dekoratif.

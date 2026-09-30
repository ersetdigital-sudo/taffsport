"use client";

import { useState, useEffect, useCallback, useMemo, useRef, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { IMAGE_ACCEPT, optimizeImageUrl, uploadToCloudinary } from "@/lib/cloudinary";
import { ORDER_STATUS_LABELS, ORDER_STATUS_LIST, getProgress } from "@/lib/types";
import {
  dateKeyID,
  formatDayMonthID,
  formatDateTimeWIB,
  formatNumericDateID,
  formatShortDateID,
  formatTimeID,
  monthKeyID,
} from "@/lib/format-date";
import {
  DEFAULT_PRODUCTS,
  mergeProductOptions,
  productFamily,
  rememberProducts,
} from "@/lib/product-options";
import { waNote } from "@/lib/notif-note";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Search, AlertTriangle } from "lucide-react";

type StepRow = { id: string; name: string; position: number };

/**
 * Daftar tahap cadangan bila /api/pesanan/steps belum mengembalikan apa pun.
 * Diturunkan dari ORDER_STATUS_LIST + ORDER_STATUS_LABELS (lib/types.ts), jadi
 * menambah tahap produksi tidak perlu mengedit daftar di komponen ini.
 */
const DEFAULT_STEPS: StepRow[] = ORDER_STATUS_LIST.map((status, index) => ({
  id: "",
  name: ORDER_STATUS_LABELS[status],
  position: index + 1,
}));

/**
 * Fase papan produksi: tahap dikelompokkan 2-2 MENGIKUTI URUTAN yang berlaku
 * (tabel `production_steps`, lihat lib/step-order.ts). Label fase jadi tidak
 * bisa basi saat admin menggeser urutan di menu Pengaturan — tidak ada nama fase
 * yang ditulis mati di sini. Fase terakhir berdiri sendiri (tahap pengiriman).
 */
function buildLanes(steps: StepRow[]) {
  const list = steps.length > 0 ? steps : DEFAULT_STEPS;
  const lanes: { key: string; name: string; from: number; to: number }[] = [];
  for (let i = 0; i < list.length; i += 2) {
    const names = [list[i]?.name, list[i + 1]?.name].filter(Boolean).join(" & ");
    lanes.push({
      key: `lane-${lanes.length + 1}`,
      name: names || `Tahap ${i + 1}`,
      from: i + 1,
      to: Math.min(i + 2, list.length),
    });
  }
  return lanes;
}

/**
 * Warna fase. Tema cuma punya 4 warna fase, jadi dipakai berulang kalau fasenya
 * lebih banyak. Sebelumnya warna diambil dari NAMA fase yang ditulis mati
 * (`LANE_KEYS` cuma 4 sementara fasenya 6), sehingga fase ke-5 dan ke-6 kehilangan
 * warnanya sekaligus tidak bisa jadi sasaran drag & drop.
 */
const LANE_COLOR_CYCLE = [
  "var(--lane-desain)",
  "var(--lane-produksi)",
  "var(--lane-finishing)",
  "var(--lane-kirim)",
];

type OrderData = {
  id: string;
  customer_name: string;
  customer_phone: string;
  product_name: string;
  quantity: string;
  material: string;
  sizes: string;
  products?: { name: string; sizes: { size: string; qty: number }[] }[];
  design_photos?: string[];
  wo_photos?: string[];
  current_step: number;
  note: string;
  note_time: string;
  courier: string;
  tracking_number: string;
  is_done: boolean;
  deadline: string | null;
  created_at: string;
  /** Waktu order tuntas (dari riwayat tahap "selesai"), null kalau belum selesai. */
  done_at: string | null;
  pct: number;
};

type FilterKey = "all" | "baru" | "produksi" | "kirim" | "selesai";
type ViewKey = "pesanan" | "jadwal" | "kirim" | "customer" | "laporan" | "notif" | "setting";

const FILTER_LABEL: Record<FilterKey, string> = {
  all: "Semua",
  baru: "Baru",
  produksi: "Produksi",
  kirim: "Siap Dikirim",
  selesai: "Selesai",
};

const VIEW_META: Record<ViewKey, { crumb: string; title: string }> = {
  pesanan: { crumb: "Operasional", title: "Pesanan" },
  jadwal: { crumb: "Operasional", title: "Jadwal Produksi" },
  kirim: { crumb: "Operasional", title: "Pengiriman" },
  customer: { crumb: "Data", title: "Customer" },
  laporan: { crumb: "Data", title: "Laporan" },
  notif: { crumb: "Data", title: "Notifikasi" },
  setting: { crumb: "Data", title: "Pengaturan" },
};

/* ── Laporan: filter bulan, produk & kapasitas ─────────────────────────── */

const DEFAULT_KAPASITAS = 2500;
const MONTH_NAMES = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];
/** Palet donut/legend; diulang kalau jumlah produk melebihi jumlah warna. */
const CAT_COLORS = ["#E84A12", "#FF5A1F", "#FF5A1F", "#8A8A85", "#B07514", "#3F5BA9"];

/** "2026-09" dari created_at, menurut zona Asia/Jakarta (bukan zona browser). */
const monthKeyOf = (iso: string) => monthKeyID(iso);

function monthLabelOf(key: string): string {
  const [y, m] = key.split("-");
  const idx = parseInt(m, 10) - 1;
  if (!y || isNaN(idx) || idx < 0 || idx > 11) return key;
  return `${MONTH_NAMES[idx]} ${y}`;
}

/**
 * Jumlah pcs per order. `quantity` dari API berbentuk string ("12 pcs"),
 * jadi digit-nya diambil langsung — parseInt("12 pcs") = 12.
 */
function orderPcs(o: OrderData): number {
  const n = parseInt(o.quantity, 10);
  return isNaN(n) ? 0 : n;
}

/**
 * Pecah satu order jadi bucket per PRODUK (label = nama produk apa adanya).
 *
 * Sumber utama adalah `products[]` karena satu order bisa berisi campuran
 * produk. Labelnya diambil apa adanya — TIDAK ditebak dari prefix nama seperti
 * sebelumnya, karena daftar produk di dashboard bebas diisi admin
 * (mis. "Jersey Home"). Dulu semua nama yang tidak diawali "Atasan"/"Setelan"
 * dipaksa masuk "Lainnya", jadi laporan tidak pernah cocok dengan produk
 * yang benar-benar dijual.
 *
 * Order lama tanpa rincian `products` dibebankan seluruhnya ke satu label dari
 * `product_name` supaya total pcs tetap utuh dan tidak ada angka yang hilang.
 */
function bucketOrder(o: OrderData): Record<string, number> {
  const out: Record<string, number> = {};
  let assigned = 0;

  const products = Array.isArray(o.products) ? o.products : [];
  for (const p of products) {
    const qty = (p.sizes || []).reduce((a, s) => a + (Number(s.qty) || 0), 0);
    if (!qty) continue;
    const label = productLabel(p.name);
    out[label] = (out[label] || 0) + qty;
    assigned += qty;
  }
  if (assigned > 0) return out;

  const total = orderPcs(o);
  if (total <= 0) return out;

  const label = productLabel(o.product_name);
  out[label] = (out[label] || 0) + total;
  return out;
}

/** Label produk untuk laporan; nama kosong tetap dihitung, tidak dibuang. */
function productLabel(name: string | null | undefined): string {
  return (name || "").trim() || "Tanpa nama produk";
}

/* ── Customer: identitas berdasarkan nomor HP ──────────────────────────── */

/**
 * Bentuk kanonik nomor HP untuk pengelompokan customer.
 * Buang semua non-digit → buang kode negara 62 → buang sisa 0 di depan.
 *
 * Ini perlu karena data di database masih campur: ada yang tersimpan
 * `" 085731275451"` (spasi di depan) dan ada yang `"085731275451"`.
 * Tanpa normalisasi, satu orang bisa kepecah jadi dua baris customer.
 *
 * HANYA dipakai untuk menampilkan/mengelompokkan di browser — nilai
 * `customer_phone` di database tidak pernah diubah.
 */
function normalizePhone(raw: string | null | undefined): string {
  const digits = String(raw ?? "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("62")) return digits.slice(2).replace(/^0+/, "");
  return digits.replace(/^0+/, "");
}

/** Rapikan spasi berlebih + buang spasi di ujung. Isi label tidak diubah. */
function cleanName(name: string | null | undefined): string {
  return String(name ?? "").replace(/\s+/g, " ").trim();
}

/**
 * Label pendek untuk ringkasan alias: ambil teks setelah kurung pertama
 * kalau ada ("Bangkit (ardesko)" → "Ardesko"), kalau tidak pakai nama utuh.
 * Nama asli tetap ditampilkan apa adanya di tiap baris riwayat pesanan.
 */
function aliasOf(name: string): string {
  const n = cleanName(name);
  const open = n.indexOf("(");
  const raw = open >= 0 ? n.slice(open + 1) : n;
  const cleaned = raw.replace(/[()]/g, " ").replace(/\s+/g, " ").trim();
  if (!cleaned) return n;
  return cleaned.replace(/\b\w/g, (c) => c.toUpperCase());
}

type CustomerGroup = {
  /** Kunci grup = nomor HP ternormalisasi. */
  key: string;
  /** Nomor HP seperti yang terakhir tercatat, untuk ditampilkan. */
  phone: string;
  /** Nama dari pesanan paling baru. */
  displayName: string;
  /** Label pendek unik, urut dari yang paling baru. */
  aliases: string[];
  /** Semua pesanan grup ini, urut dari yang paling baru. */
  orders: OrderData[];
  aktif: number;
  totalPcs: number;
  lastOrderAt: string;
};

/**
 * Kelompokkan pesanan jadi satu baris per customer, kuncinya NOMOR HP —
 * bukan nama — supaya satu orang yang menulis nama tim/komunitas berbeda
 * tiap order tetap dihitung sebagai satu customer.
 */
function groupCustomers(orders: OrderData[]): CustomerGroup[] {
  const map = new Map<string, OrderData[]>();

  orders.forEach((o) => {
    const phone = normalizePhone(o.customer_phone);
    // Nomor kosong tidak boleh semuanya dianggap satu orang.
    const key = phone || `nama:${cleanName(o.customer_name).toLowerCase()}`;
    const list = map.get(key);
    if (list) list.push(o);
    else map.set(key, [o]);
  });

  const groups: CustomerGroup[] = [];
  map.forEach((list, key) => {
    const sorted = [...list].sort((a, b) => {
      const diff = new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      if (diff !== 0) return diff;
      return b.id.localeCompare(a.id);
    });

    const aliases: string[] = [];
    sorted.forEach((o) => {
      const a = aliasOf(o.customer_name);
      if (a && aliases.indexOf(a) < 0) aliases.push(a);
    });

    groups.push({
      key,
      phone: cleanName(sorted[0].customer_phone),
      displayName: cleanName(sorted[0].customer_name) || "(tanpa nama)",
      aliases,
      orders: sorted,
      aktif: sorted.filter((o) => !o.is_done).length,
      totalPcs: sorted.reduce((a, o) => a + orderPcs(o), 0),
      lastOrderAt: sorted[0].created_at,
    });
  });

  return groups.sort((a, b) => {
    const diff = new Date(b.lastOrderAt).getTime() - new Date(a.lastOrderAt).getTime();
    if (diff !== 0) return diff;
    return a.displayName.localeCompare(b.displayName);
  });
}

function statusOf(o: OrderData, totalSteps: number): FilterKey {
  if (o.is_done) return "selesai";
  if (o.current_step >= totalSteps) return "kirim";
  if (o.current_step <= 1) return "baru";
  return "produksi";
}

// Format tanggal & jam memakai lib/format-date.ts (zona Asia/Jakarta, selalu
// sama di perangkat mana pun). Wrapper di bawah hanya menambahkan "-".
const formatDate = (dateStr: string) => formatNumericDateID(dateStr) || "-";
const formatDatePretty = (dateStr: string) => formatShortDateID(dateStr) || "-";

/** Tanggal + jam (WIB) buat nunjukin kapan terakhir pesanan diupdate. */
function formatDateTime(dateStr: string) {
  return formatDateTimeWIB(dateStr) || "-";
}

function deadlineStatus(deadline: string | null, isDone: boolean): { level: "normal" | "approaching" | "warning" | "critical" | "overdue" | null; diffDays: number } {
  if (!deadline || isDone) return { level: null, diffDays: 0 };
  const now = new Date();
  const dl = new Date(deadline);
  const diffMs = dl.getTime() - now.getTime();
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays <= 0) return { level: "overdue", diffDays };
  if (diffDays === 1) return { level: "critical", diffDays };
  if (diffDays === 2) return { level: "warning", diffDays };
  if (diffDays === 3) return { level: "approaching", diffDays };
  return { level: "normal", diffDays };
}

/**
 * Keterangan deadline yang tampil sebagai badge di kolom STATUS.
 *
 * Sebelumnya teks ini dicetak di bawah tanggal deadline ("(H-2)"), sehingga
 * kolom Deadline punya dua baris dan baris keterangannya terlihat seperti
 * tanggal kedua. Sekarang pindah ke sebelah badge status.
 *
 * Null = tidak perlu ditampilkan (deadline masih jauh / order sudah selesai).
 */
function deadlineNote(
  level: "normal" | "approaching" | "warning" | "critical" | "overdue" | null,
  diffDays: number
): { text: string; cls: "warn" | "danger" } | null {
  switch (level) {
    case "overdue": {
      // diffDays <= 0 semuanya berarti sudah lewat; 0 = lewat hari ini.
      const late = Math.abs(diffDays);
      return { text: late > 0 ? `Lewat ${late} hari` : "Lewat deadline", cls: "danger" };
    }
    case "critical":
      return { text: "H-1", cls: "danger" };
    case "warning":
      return { text: "H-2", cls: "warn" };
    case "approaching":
      return { text: "H-3", cls: "warn" };
    default:
      return null;
  }
}

function initials(name: string) {
  return name
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}

/* SVG nav icons (Feather-style, 24x24 stroke) */
function NavIcon({ name, size = 18 }: { name: string; size?: number }) {
  const paths: Record<string, ReactNode> = {
    pesanan: (
      <>
        <path d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-4 0a1 1 0 01-1-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 01-1 1" />
      </>
    ),
    maklon: (
      <>
        <path d="M20 7l-8-4-8 4v10l8 4 8-4V7z" />
        <path d="M4 7l8 4 8-4M12 11v10" />
      </>
    ),
    jadwal: (
      <>
        <path d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
      </>
    ),
    kirim: (
      <>
        <path d="M1 3h15v13H1z" />
        <path d="M16 8h4l3 3v5h-7V8z" />
        <circle cx="5.5" cy="18.5" r="2.5" />
        <circle cx="18.5" cy="18.5" r="2.5" />
      </>
    ),
    customer: (
      <>
        <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
        <circle cx="12" cy="7" r="4" />
      </>
    ),
    laporan: (
      <>
        <path d="M18 20V10M12 20V4M6 20v-6" />
      </>
    ),
    setting: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09A1.65 1.65 0 008.6 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z" />
      </>
    ),
    notif: (
      <>
        <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.73 21a2 2 0 01-3.46 0" />
      </>
    ),
  };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {paths[name] || null}
    </svg>
  );
}

export default function PesananDashboard() {
  const router = useRouter();
  const [orders, setOrders] = useState<OrderData[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [openCustomerKey, setOpenCustomerKey] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [showMobileNav, setShowMobileNav] = useState(false);
  const [currentView, setCurrentView] = useState<ViewKey>("pesanan");
  const [toast, setToast] = useState("");

  // Grup customer untuk drawer detail — dicari dari kunci (nomor HP ternormalisasi).
  const openCustomerGroup = useMemo(
    () =>
      openCustomerKey
        ? groupCustomers(orders).find((g) => g.key === openCustomerKey) ?? null
        : null,
    [orders, openCustomerKey]
  );
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [steps, setSteps] = useState<StepRow[]>(DEFAULT_STEPS);

  const fetchOrders = useCallback(async () => {
    try {
      const res = await fetch("/api/pesanan/orders");
      if (res.ok) {
        const data = await res.json();
        setOrders(data.orders || []);
      }
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchSteps = useCallback(async () => {
    try {
      const res = await fetch("/api/pesanan/steps");
      if (res.ok) {
        const data = await res.json();
        if (data.steps && data.steps.length > 0) {
          setSteps(data.steps.sort((a: StepRow, b: StepRow) => a.position - b.position));
        }
      }
    } catch {
      // silent
    }
  }, []);

  useEffect(() => {
    fetchOrders();
    fetchSteps();
  }, [fetchOrders, fetchSteps]);

  useEffect(() => {
    const h = window.location.hash.replace("#", "") as ViewKey;
    if (VIEW_META[h]) setCurrentView(h);
    const onHash = () => {
      const v = window.location.hash.replace("#", "") as ViewKey;
      if (VIEW_META[v]) setCurrentView(v);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const showToast = (msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 2200);
  };

  const switchView = (v: ViewKey) => {
    setCurrentView(v);
    window.location.hash = v;
    setShowMobileNav(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const closeAll = () => {
    setOpenId(null);
    setShowAdd(false);
    setShowMobileNav(false);
  };

  const meta = VIEW_META[currentView];

  const handleLogout = async () => {
    await fetch("/api/pesanan/auth", { method: "DELETE" });
    router.push("/login");
  };

  return (
    <div className="pas-shell">
      {/* â”€â”€ SIDEBAR â”€â”€ */}
      <aside className="pas-side">
        <a href="/" className="pas-brand">
          <span className="pas-brand-mark">
            <img src="/brand-logo.png" alt="TAFF Sportwear" />
          </span>
          <span className="block text-center">
            <span className="pas-brand-name">TAFF Sportwear</span>
            <span className="pas-brand-sub">Admin Panel</span>
          </span>
        </a>
        <p className="pas-navsec">Operasional</p>
        <nav className="flex flex-col gap-1">
          <a
            className={`pas-navlink ${currentView === "pesanan" ? "on" : ""}`}
            href="#pesanan"
            onClick={(e) => {
              e.preventDefault();
              switchView("pesanan");
            }}
          >
            <span className="pas-ic"><NavIcon name="pesanan" /></span> {VIEW_META.pesanan.title}
            {orders.length > 0 && (
              <em className="pas-badge-y ml-auto">{orders.length}</em>
            )}
          </a>
          <a className="pas-navlink" href="/pesanan/maklon">
            <span className="pas-ic"><NavIcon name="maklon" /></span> Maklon
          </a>
          {(["jadwal", "kirim"] as ViewKey[]).map((key) => (
            <a
              key={key}
              className={`pas-navlink ${currentView === key ? "on" : ""}`}
              href={`#${key}`}
              onClick={(e) => {
                e.preventDefault();
                switchView(key);
              }}
            >
              <span className="pas-ic"><NavIcon name={key} /></span> {VIEW_META[key].title}
            </a>
          ))}
        </nav>
        <p className="pas-navsec">Data</p>
        <nav className="flex flex-col gap-1">
          {(["customer", "laporan", "notif", "setting"] as ViewKey[]).map((key) => (
            <a
              key={key}
              className={`pas-navlink ${currentView === key ? "on" : ""}`}
              href={`#${key}`}
              onClick={(e) => {
                e.preventDefault();
                switchView(key);
              }}
            >
              <span className="pas-ic"><NavIcon name={key} /></span> {VIEW_META[key].title}
            </a>
          ))}
        </nav>
        <div className="pas-userbox mt-auto p-3 flex items-center gap-3">
          <span className="pas-avatar pas-avatar-invert">AD</span>
          <span className="leading-tight">
            <span className="block text-[13.5px] font-semibold">Admin TAFF</span>
            <span className="block text-[11.5px] opacity-70">
              admin@taffsport.id
            </span>
          </span>
        </div>
      </aside>

      {/* â”€â”€ MAIN â”€â”€ */}
      <div className="flex-1 min-w-0">
        <header className="pas-topbar">
          <div className="px-5 sm:px-8 h-16 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
<img src="/brand-logo.png" alt="TAFF Sportwear" className="h-9 w-auto object-contain lg:hidden" />
              <div className="min-w-0">
                <p className="pas-kicker">{meta.crumb}</p>
                <h1 className="pas-display pas-title mt-1 truncate">
                  {meta.title}
                </h1>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                className="lg:hidden p-2.5 rounded-lg border border-[var(--pas-line)] text-[var(--pas-muted)] hover:text-[var(--pas-ink-1)] hover:bg-[var(--pas-surface-2)] transition"
                onClick={() => setShowMobileNav(true)}
                aria-label="Buka menu"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                  <path d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              </button>
              <span className="hidden lg:inline text-[12.5px] text-[var(--pas-muted)]">
                {formatShortDateID(new Date())}
              </span>
              {currentView === "pesanan" && (
                <button
                  onClick={() => setShowAdd(true)}
                  className="pas-btn-accent px-3.5 py-2.5 text-[14px] sm:px-4"
                >
                  <span className="sm:inline">+ </span>Pesanan
                </button>
              )}
              <button
                onClick={handleLogout}
                className="pas-btn-ghost px-3 py-2 text-[13px] text-[var(--pas-muted)]"
              >
                Keluar
              </button>
            </div>
          </div>
        </header>

        <main className="px-5 sm:px-8 py-7 sm:py-9 w-full">
          <>
          {currentView === "pesanan" && (
            <ViewPesanan
              orders={orders}
              filter={filter}
              setFilter={setFilter}
              query={query}
              setQuery={setQuery}
  openDetail={setOpenId}
  openEdit={setEditId}
  steps={steps}
  onDelete={fetchOrders}
  showToast={showToast}
            />
          )}
          {currentView === "jadwal" && <ViewJadwal orders={orders} openDetail={setOpenId} steps={steps} onMoved={fetchOrders} showToast={showToast} />}
          {currentView === "kirim" && <ViewKirim orders={orders} openDetail={setOpenId} steps={steps} />}
          {currentView === "customer" && <ViewCustomer orders={orders} onSelectCustomer={setOpenCustomerKey} steps={steps} />}
          {currentView === "laporan" && <ViewLaporan orders={orders} steps={steps} />}
          {/* Simpan urutan tahap juga menghitung ulang NOMOR tahap tiap pesanan
              di server (lihat PUT /api/pesanan/steps), jadi daftar pesanan ikut
              dimuat ulang — bukan cuma daftar tahapnya. */}
          {currentView === "setting" && (
            <ViewSetting
              showToast={showToast}
              steps={steps}
              onStepsSaved={() => {
                fetchSteps();
                fetchOrders();
              }}
            />
          )}
          {currentView === "notif" && <ViewNotif showToast={showToast} orders={orders} />}
          </>
        </main>
      </div>

      {/* â”€â”€ MOBILE NAV DRAWER â”€â”€ */}
      <Sheet open={showMobileNav} onOpenChange={setShowMobileNav}>
        <SheetContent side="left" className="p-5 bg-[#0A0A0A] text-white border-r border-white/10 w-[280px] [&>button]:text-white/50 [&>button]:hover:text-white [&>button]:hover:bg-white/10 [&>button]:rounded-lg [&>button]:p-2 [&>button]:transition">
          {/* Drawer header */}
          <div className="flex items-center mb-2">
            <a href="/" className="flex items-center gap-2.5">
              <img src="/brand-logo.png" alt="TAFF Sportwear" className="h-8 w-auto object-contain" />
              <span className="pas-brand-name !text-[16px]">TAFF Sportwear</span>
            </a>
          </div>
          <p className="pas-navsec">Operasional</p>
          <nav className="flex flex-col gap-1">
            <a
              className={`pas-navlink ${currentView === "pesanan" ? "on" : ""}`}
              href="#pesanan"
              onClick={(e) => {
                e.preventDefault();
                switchView("pesanan");
              }}
            >
              <span className="pas-ic"><NavIcon name="pesanan" /></span> {VIEW_META.pesanan.title}
            </a>
            <a className="pas-navlink" href="/pesanan/maklon">
              <span className="pas-ic"><NavIcon name="maklon" /></span> Maklon
            </a>
            {(["jadwal", "kirim"] as ViewKey[]).map((key) => (
              <a
                key={key}
                className={`pas-navlink ${currentView === key ? "on" : ""}`}
                href={`#${key}`}
                onClick={(e) => {
                  e.preventDefault();
                  switchView(key);
                }}
              >
                <span className="pas-ic"><NavIcon name={key} /></span> {VIEW_META[key].title}
              </a>
            ))}
          </nav>
          <p className="pas-navsec">Data</p>
          <nav className="flex flex-col gap-1">
            {(["customer", "laporan", "notif", "setting"] as ViewKey[]).map((key) => (
              <a
                key={key}
                className={`pas-navlink ${currentView === key ? "on" : ""}`}
                href={`#${key}`}
                onClick={(e) => {
                  e.preventDefault();
                  switchView(key);
                }}
              >
                <span className="pas-ic"><NavIcon name={key} /></span> {VIEW_META[key].title}
              </a>
            ))}
          </nav>
        </SheetContent>
      </Sheet>

      {/* â”€â”€ DETAIL SHEET â”€â”€ */}
      {openId && (
        <DetailSheet
          orderId={openId}
          orders={orders}
          onClose={() => setOpenId(null)}
          onSaved={(msg) => {
            fetchOrders();
            setOpenId(null);
            showToast(msg);
          }}
          onToast={showToast}
          steps={steps}
        />
      )}
      {editId && (
        <EditSheet
          orderId={editId}
          orders={orders}
          onClose={() => setEditId(null)}
          onSaved={(msg) => {
            fetchOrders();
            setEditId(null);
            showToast(msg);
          }}
        />
      )}

      {/* â”€â”€ ADD SHEET â”€â”€ */}
      {/* ── DRAWER DETAIL CUSTOMER ── */}
      <Sheet
        open={!!openCustomerKey}
        onOpenChange={(o) => {
          if (!o) setOpenCustomerKey(null);
        }}
      >
        <SheetContent
          side="right"
          className="pas-light p-0 w-full sm:max-w-md bg-[var(--pas-surface)] border-l border-[var(--pas-line)] [&>button]:text-[var(--pas-muted)] [&>button]:hover:text-[var(--pas-ink-1)]"
        >
          <SheetTitle className="sr-only">Detail Customer</SheetTitle>
          {openCustomerGroup ? (
            <CustomerPanel
              group={openCustomerGroup}
              steps={steps}
              onOpenOrder={(id) => {
                setOpenCustomerKey(null);
                setOpenId(id);
              }}
            />
          ) : (
            <p className="p-5 text-[13px] text-[var(--pas-muted)]">Customer tidak ditemukan.</p>
          )}
        </SheetContent>
      </Sheet>

      {showAdd && (
        <div className="pas-sheet open">
          <div className="pas-veil" onClick={closeAll} />
          <div className="pas-panel p-5 sm:p-7">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[12px] text-[var(--pas-accent)] font-semibold">
                  Pesanan Baru
                </p>
                <h2 className="pas-display text-[22px] mt-1.5">Tambah Pesanan</h2>
              </div>
              <button className="pas-btn-ghost px-3 py-2 text-sm" onClick={closeAll}>
                Tutup
              </button>
            </div>
            <AddForm
              onSaved={(msg) => {
                fetchOrders();
                closeAll();
                showToast(msg);
              }}
              onCancel={closeAll}
            />
          </div>
        </div>
      )}

      {/* â”€â”€ BOTTOM FLOATING NAV (mobile) â”€â”€ */}
      <nav className="pas-bottom-nav lg:hidden">
        {(["pesanan", "jadwal", "kirim", "customer"] as ViewKey[]).map((key) => (
          <button
            key={key}
            className={`pas-bottom-nav-item ${currentView === key ? "on" : ""}`}
            onClick={() => switchView(key)}
            title={VIEW_META[key].title}
          >
            <NavIcon name={key} size={22} />
            {currentView === key && <span className="pas-bottom-nav-dot" />}
          </button>
        ))}
      </nav>

      {/* â”€â”€ TOAST â”€â”€ */}
      <div className={`pas-toast ${toast ? "on" : ""}`}>{toast}</div>
    </div>
  );
}

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   VIEW: PESANAN (orders table + KPI + filter)
   â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
function ViewPesanan({
  orders,
  filter,
  setFilter,
  query,
  setQuery,
  openDetail,
  openEdit,
  steps,
  onDelete,
  showToast,
}: {
  orders: OrderData[];
  filter: FilterKey;
  setFilter: (f: FilterKey) => void;
  query: string;
  setQuery: (q: string) => void;
  openDetail: (id: string) => void;
  openEdit: (id: string) => void;
  steps: StepRow[];
  onDelete: (id: string) => void;
  showToast: (msg: string) => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState<OrderData | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Filter bulan. Default bulan berjalan; "all" = tampilkan semua bulan.
  const [selectedMonth, setSelectedMonth] = useState(() => monthKeyOf(new Date().toISOString()));

  const monthOptions = useMemo(() => {
    const keys = new Set<string>();
    orders.forEach((o) => {
      const k = monthKeyOf(o.created_at);
      if (k) keys.add(k);
    });
    keys.add(monthKeyOf(new Date().toISOString()));
    return Array.from(keys).sort().reverse();
  }, [orders]);

  const filtered = orders
    .filter((o) => {
      if (selectedMonth !== "all" && monthKeyOf(o.created_at) !== selectedMonth) return false;
      if (filter !== "all" && statusOf(o, steps.length) !== filter) return false;
      if (!query) return true;
      const s = (
        o.id + " " + o.customer_name + " " + o.product_name
      ).toLowerCase();
      return s.includes(query.toLowerCase());
    })
    .sort((a, b) => (a.id < b.id ? 1 : -1));

  const stats = {
    total: orders.length,
    produksi: orders.filter(
      (o) => statusOf(o, steps.length) === "produksi" || statusOf(o, steps.length) === "baru"
    ).length,
    kirim: orders.filter((o) => statusOf(o, steps.length) === "kirim").length,
    selesai: orders.filter((o) => statusOf(o, steps.length) === "selesai").length,
  };

  // Pesanan masuk dalam 7 hari terakhir (hari ini + 6 hari sebelumnya, WIB).
  // Sebelumnya label KPI ini ditulis statis "+2 minggu ini" sehingga angkanya
  // tidak pernah ikut berubah walau order bertambah.
  const baruMingguIni = (() => {
    const todayKey = dateKeyID(new Date()); // mis. 2026-09-25
    if (!todayKey) return 0;
    // Mulai dari tengah malam WIB hari ini, lalu mundur 6 hari — supaya batas
    // jendela tidak ikut zona waktu perangkat yang membuka dashboard.
    const cutoff = new Date(`${todayKey}T00:00:00+07:00`);
    cutoff.setUTCDate(cutoff.getUTCDate() - 6);
    const cutoffKey = dateKeyID(cutoff);
    return orders.filter((o) => {
      const key = dateKeyID(o.created_at);
      return key !== "" && key >= cutoffKey;
    }).length;
  })();

  // Pesanan yang tuntas BULAN INI — dihitung dari waktu tuntasnya, bukan dari
  // tanggal order dibuat: order bulan lalu yang baru selesai sekarang tetap
  // terhitung bulan ini. Order lama tanpa riwayat selesai tidak ikut dihitung.
  const monthKeyNow = monthKeyID(new Date());
  const selesaiBulanIni = monthKeyNow
    ? orders.filter(
        (o) => o.is_done && o.done_at && monthKeyID(o.done_at) === monthKeyNow
      ).length
    : 0;

  // Deadline terdekat dari semua pesanan aktif (belum selesai)
  const nextDeadline = orders
    .filter((o) => o.deadline && !o.is_done)
    .sort((a, b) => (a.deadline! < b.deadline! ? -1 : 1))[0]?.deadline ?? null;
  const deadlineInfo = deadlineStatus(nextDeadline, false);

  // Jumlah pesanan aktif yang deadline-nya lewat atau mendekat (H-3, H-2, H-1) - perlu perhatian
  const deadlineAlertCount = orders.filter((o) => {
    if (!o.deadline || o.is_done) return false;
    const lvl = deadlineStatus(o.deadline, false).level;
    return lvl !== null && lvl !== "normal";
  }).length;
  const hasOverdue = orders.some(
    (o) => !o.is_done && o.deadline && deadlineStatus(o.deadline, false).level === "overdue"
  );
  const hasWarning = orders.some(
    (o) => !o.is_done && o.deadline && (deadlineStatus(o.deadline, false).level === "approaching" || deadlineStatus(o.deadline, false).level === "warning" || deadlineStatus(o.deadline, false).level === "critical")
  );

  // Badge "Sedang Produksi" mengikuti kondisi deadline order aktif. Sebelumnya
  // tulisan tetap "on track" yang tidak melihat data sama sekali.
  const overdueCount = orders.filter(
    (o) =>
      !o.is_done &&
      o.deadline &&
      deadlineStatus(o.deadline, false).level === "overdue"
  ).length;
  const produksiBadge =
    overdueCount > 0
      ? { text: `${overdueCount} lewat deadline`, cls: "pas-delta bad mb-0.5" }
      : deadlineAlertCount > 0
        ? { text: `${deadlineAlertCount} mendekati deadline`, cls: "pas-delta ok mb-0.5" }
        : { text: "on track", cls: "pas-delta good mb-0.5" };

  const handleDelete = async () => {
    if (!confirmDelete) return;
    setDeleting(true);
    const targetId = confirmDelete.id;
    const targetName = confirmDelete.customer_name;
    try {
      const res = await fetch(`/api/pesanan/orders/${targetId}`, { method: "DELETE" });
      const data: any = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast(data.error || "Gagal menghapus pesanan, coba lagi");
        return;
      }
      setConfirmDelete(null);
      onDelete(targetId);
      showToast(`Pesanan ${targetId} (${targetName}) berhasil dihapus`);
    } catch {
      showToast("Gagal menghapus pesanan, coba lagi");
    } finally {
      setDeleting(false);
    }
  };

  const isDangerousStatus = (o: OrderData) => {
    const st = statusOf(o, steps.length);
    return st === "produksi" || st === "kirim" || st === "selesai";
  };

  return (
    <>
      {/* Delete confirmation dialog */}
      {confirmDelete && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-5" onClick={() => !deleting && setConfirmDelete(null)}>
          <div className="pas-card p-6 max-w-md w-full" onClick={(e) => e.stopPropagation()}>
            <p className="pas-display text-[18px]">Hapus Pesanan?</p>
            <p className="text-[14px] text-[var(--pas-muted)] mt-2 leading-relaxed">
              Pesanan <span className="text-[var(--pas-ink-1)] font-semibold pas-num">{confirmDelete.id}</span> ({confirmDelete.customer_name}) akan dihapus permanen dan tidak bisa dikembalikan.
            </p>
            {isDangerousStatus(confirmDelete) && (
              <p className="text-[13px] text-[#9A5A14] mt-3 bg-[#FF5A1F]/15 border border-[#FF5A1F]/30 rounded-xl px-4 py-2.5 flex items-start gap-1.5">
                <AlertTriangle size={14} className="shrink-0 mt-0.5" /> Pesanan ini sedang dalam produksi/pengiriman. Hapus hanya jika ini adalah data testing.
              </p>
            )}
            <div className="flex gap-3 mt-5">
              <button
                className="pas-btn flex-1 py-3 text-[13px]"
                onClick={() => setConfirmDelete(null)}
                disabled={deleting}
              >
                Batal
              </button>
              <button
                className="flex-1 py-3 text-[13px] rounded-xl font-semibold bg-red-500 text-white hover:bg-red-600 transition disabled:opacity-50"
                onClick={handleDelete}
                disabled={deleting}
              >
                {deleting ? "Menghapus..." : "Hapus"}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* KPI */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 w-full">
        <div className="pas-card pas-kpi pas-kpi-hero pas-bento-kpi p-4 sm:p-5">
          <p className="pas-kpi-label text-[13px]">Total Pesanan</p>
          <div className="flex items-end gap-2.5 mt-2.5">
            <p className="pas-display pas-num text-[34px] leading-none">{stats.total}</p>
            <span className="pas-delta mb-0.5">+{baruMingguIni} minggu ini</span>
          </div>
        </div>
        <div className="pas-card pas-kpi pas-bento-kpi p-4 sm:p-5">
          <p className="text-[13px] text-[var(--pas-muted)]">Sedang Produksi</p>
          <div className="flex items-end gap-2.5 mt-2.5">
            <p className="pas-display pas-num text-[30px] leading-none">
              {stats.produksi}
            </p>
            <span className={produksiBadge.cls}>{produksiBadge.text}</span>
          </div>
        </div>
        <div className="pas-card pas-kpi pas-bento-kpi p-4 sm:p-5">
          <p className="text-[13px] text-[var(--pas-muted)]">Deadline</p>
          <div className="flex items-end gap-2.5 mt-2.5">
            <p
              className={
                hasOverdue
                  ? "pas-display pas-num text-[30px] leading-none text-red-500"
                  : hasWarning
                    ? "pas-display pas-num text-[30px] leading-none text-[var(--pas-orange)]"
                    : "pas-display pas-num text-[30px] leading-none text-[#3F5BA9]"
              }
            >
              {deadlineAlertCount}
            </p>
            {nextDeadline && deadlineInfo.level && (
              <span
                className={
                  deadlineInfo.level === "overdue"
                    ? "pas-delta bad mb-0.5"
                    : "pas-delta ok mb-0.5"
                }
              >
                {deadlineInfo.level === "overdue"
                  ? `lewat ${Math.abs(deadlineInfo.diffDays)} hari`
                  : `H-${deadlineInfo.diffDays}`}
              </span>
            )}
          </div>
        </div>
        <div className="pas-card pas-kpi pas-bento-kpi p-4 sm:p-5">
          <p className="text-[13px] text-[var(--pas-muted)]">Selesai</p>
          <div className="flex items-end gap-2.5 mt-2.5">
            <p className="pas-display pas-num text-[30px] leading-none">{stats.selesai}</p>
            <span className="pas-delta good mb-0.5">{selesaiBulanIni} bulan ini</span>
          </div>
        </div>
      </section>

      {/* toolbar */}
      <section className="mt-7 flex flex-col lg:flex-row lg:items-center gap-3 lg:justify-between">
        <div className="flex flex-col sm:flex-row gap-3 w-full lg:max-w-[620px]">
          <div className="pas-search w-full sm:max-w-[340px]">
            <Search className="pas-mag" size={16} />
            <input
              className="pas-field w-full py-2.5 pr-4 text-[14px]"
              placeholder="Cari pesanan, nama, kota..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div className="pas-select-wrap shrink-0">
            <select
              className="pas-field appearance-none text-[13.5px] font-semibold pl-3.5 pr-9 py-2.5 cursor-pointer"
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              aria-label="Filter bulan pesanan"
            >
              <option value="all">Semua bulan</option>
              {monthOptions.map((k) => (
                <option key={k} value={k}>
                  {monthLabelOf(k)}
                </option>
              ))}
            </select>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <path d="m6 9 6 6 6-6" />
            </svg>
          </div>
        </div>
        <div className="pas-seg pas-bento-chip-scroll">
          {(["all", "baru", "produksi", "kirim", "selesai"] as FilterKey[]).map((f) => (
            <button
              key={f}
              className={`pas-chip pas-bento-chip ${filter === f ? "on" : ""}`}
              onClick={() => setFilter(f)}
            >
              {FILTER_LABEL[f]}
            </button>
          ))}
        </div>
      </section>

      {/* jumlah yang tampil setelah filter */}
      <p className="mt-2.5 text-[12.5px] text-[var(--pas-muted)]">
        Menampilkan <b className="text-[var(--pas-ink-1)]">{filtered.length}</b> dari {orders.length} pesanan
        <span> · {selectedMonth === "all" ? "semua bulan" : monthLabelOf(selectedMonth)}</span>
      </p>

      {/* table (desktop) */}
      <section className="pas-card mt-4 p-2 sm:p-4 hidden md:block w-full overflow-x-auto">
        <table className="pas-tbl w-full">
          <thead>
            <tr>
              <th className="w-[16%]">Pesanan</th>
              <th className="w-[18%]">Customer</th>
              <th className="w-[16%]">Produk</th>
              <th className="w-[16%]">Progres</th>
              <th className="w-[10%]">Order</th>
              <th className="w-[14%]">Deadline</th>
              <th className="w-[10%]">Status</th>
              <th className="w-[5%]"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={8}>
                  <div className="flex flex-col items-center justify-center py-16 gap-3">
                    <span className="text-[40px] opacity-30">ðŸ“‹</span>
                    <p className="text-[var(--pas-muted)] text-[15px] font-medium">Tidak ada pesanan yang cocok</p>
                    <p className="text-[var(--pas-muted)] text-[13px]">Coba ubah filter atau kata kunci pencarian</p>
                  </div>
                </td>
              </tr>
            )}
            {filtered.map((o) => {
              const st = statusOf(o, steps.length);
              const pct = o.pct;
              const ini = initials(o.customer_name);
              const dlStatus = deadlineStatus(o.deadline, o.is_done);
              const dlNote = deadlineNote(dlStatus.level, dlStatus.diffDays);
              return (
                <tr key={o.id} onClick={() => openDetail(o.id)}>
                  <td>
                    <span className="font-semibold pas-num">{o.id}</span>
                    <br />
                    <span className="text-[12.5px] text-[var(--pas-muted)]">{o.quantity}</span>
                  </td>
                  <td>
                    <div className="flex items-center gap-2.5">
                      <span className="pas-avatar">{ini}</span>
                      <span>{o.customer_name}</span>
                    </div>
                  </td>
                  <td className="text-[var(--pas-muted)]">{o.product_name}</td>
                  <td>
                    <div className="flex items-center gap-3">
                      <span className="pas-mini">
                        <i style={{ width: `${pct}%` }} />
                      </span>
                      <span className="text-[12.5px] text-[var(--pas-muted)] pas-num whitespace-nowrap">
                        {o.current_step}/11
                      </span>
                    </div>
                    <span className="text-[12.5px] text-[var(--pas-muted)]">
                      {steps[o.current_step - 1]?.name || `Tahap ${o.current_step}`}
                    </span>
                  </td>
                  <td className="text-[12.5px] text-[var(--pas-muted)] whitespace-nowrap">
                    {formatDate(o.created_at)}
                  </td>
                  <td className="text-[12.5px] whitespace-nowrap">
                    {o.deadline ? (
                      <span className={
                        dlStatus.level === "overdue" ? "text-red-700 font-semibold" :
                        dlStatus.level === "critical" ? "text-red-500 font-semibold" :
                        dlStatus.level === "warning" ? "text-[var(--pas-orange)] font-semibold" :
                        dlStatus.level === "approaching" ? "text-amber-500 font-medium" :
                        "text-[var(--pas-muted)]"
                      }>
                        <span className="block">
                          {(dlStatus.level === "overdue" || dlStatus.level === "critical" || dlStatus.level === "warning" || dlStatus.level === "approaching") && (
                            <AlertTriangle size={11} className={`inline-block mr-1 -mt-px ${
                              dlStatus.level === "overdue" ? "text-red-700" :
                              dlStatus.level === "critical" ? "text-red-500" :
                              dlStatus.level === "warning" ? "text-[var(--pas-orange)]" :
                              "text-amber-500"
                            }`} />
                          )}
                          {formatDate(o.deadline)}
                        </span>
                      </span>
                    ) : (
                      <span className="text-[var(--pas-muted)]">-</span>
                    )}
                  </td>
                  <td>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className={`pas-pill ${st}`}>{FILTER_LABEL[st]}</span>
                      {dlNote && (
                        <span className={`pas-pill ${dlNote.cls}`}>{dlNote.text}</span>
                      )}
                    </div>
                  </td>
                  <td className="text-right flex items-center gap-1 justify-end">
                    <button
                      className="text-[var(--pas-muted)] hover:text-blue-400 transition p-1.5 rounded-lg hover:bg-blue-400/10"
                      title="Edit pesanan"
                      onClick={(e) => {
                        e.stopPropagation();
                        openEdit(o.id);
                      }}
                    >
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
                        <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
                      </svg>
                    </button>
                    <button
                      className="text-[var(--pas-muted)] hover:text-red-400 transition p-1.5 rounded-lg hover:bg-red-400/10"
                      title="Hapus pesanan"
                      onClick={(e) => {
                        e.stopPropagation();
                        setConfirmDelete(o);
                      }}
                    >
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
                      </svg>
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      {/* cards (mobile) */}
      <section className="mt-4 flex flex-col gap-3 md:hidden">
        {filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <span className="text-[40px] opacity-30">ðŸ“‹</span>
            <p className="text-[var(--pas-muted)] text-[15px] font-medium">Tidak ada pesanan yang cocok</p>
            <p className="text-[var(--pas-muted)] text-[13px]">Coba ubah filter atau kata kunci pencarian</p>
          </div>
        )}
        {filtered.map((o) => {
          const st = statusOf(o, steps.length);
          const pct = o.pct;
          const ini = initials(o.customer_name);
          const dlStatus = deadlineStatus(o.deadline, o.is_done);
          const dlNote = deadlineNote(dlStatus.level, dlStatus.diffDays);
          const stageName = steps[o.current_step - 1]?.name || `Tahap ${o.current_step}`;
          return (
            <div
              key={o.id}
              className="pas-bento-card cursor-pointer"
              onClick={() => openDetail(o.id)}
            >
              {/* Action buttons - pojok kanan atas */}
              <div className="absolute top-5 right-5 flex items-center gap-1">
                  <button
                    className="text-[var(--pas-muted)] hover:text-blue-400 transition p-1.5 rounded-lg hover:bg-blue-400/10"
                    title="Edit"
                    onClick={(e) => {
                      e.stopPropagation();
                      openEdit(o.id);
                    }}
                  >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
                    <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
                  </svg>
                </button>
                <button
                  className="text-[var(--pas-muted)] hover:text-red-400 transition p-1.5 rounded-lg hover:bg-red-400/10"
                  title="Hapus"
                  onClick={(e) => {
                    e.stopPropagation();
                    setConfirmDelete(o);
                  }}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
                  </svg>
                </button>
              </div>

              {/* Baris 1: Nomor pesanan + badge status */}
              <div className="flex items-center justify-between pr-10">
                <p className="font-bold text-[16px] pas-num">{o.id}</p>
                <span className="flex items-center gap-1.5">
                  <span className={`pas-pill ${st}`}>{FILTER_LABEL[st]}</span>
                  {dlNote && (
                    <span className={`pas-pill ${dlNote.cls}`}>{dlNote.text}</span>
                  )}
                </span>
              </div>

              {/* Baris 2: Avatar + Nama customer + Jumlah pcs */}
              <div className="flex items-center justify-between mt-3">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="pas-bento-avatar">{ini}</span>
                  <div className="min-w-0">
                    <p className="text-[14px] font-medium truncate">{o.customer_name}</p>
                  </div>
                </div>
                <p className="text-[14px] font-semibold pas-num shrink-0 ml-3">{o.quantity} pcs</p>
              </div>

              {/* Baris 3: Nama produk */}
              <p className="text-[13px] text-[var(--pas-muted)] mt-3">{o.product_name}</p>

              {/* Baris 4: Progress bar + label tahap */}
              <div className="mt-3">
                <span className="pas-mini w-full block">
                  <i style={{ width: `${pct}%` }} />
                </span>
                <p className="text-[12px] text-[var(--pas-muted)] mt-1.5 pas-num">
                  {o.current_step}/11 <span className="text-[var(--pas-ink-1)] font-medium">{stageName}</span>
                </p>
              </div>

              {/* Divider */}
              <div className="pas-bento-divider"></div>

              {/* Baris 5: Tanggal order + Deadline */}
              <div className="flex items-center justify-between">
                <p className="text-[12px] text-[var(--pas-muted)]">Order: {formatDate(o.created_at)}</p>
                {o.deadline ? (
                  <p className={
                    dlStatus.level === "overdue" ? "text-[12px] text-red-700 font-semibold" :
                    dlStatus.level === "critical" ? "text-[12px] text-red-500 font-semibold" :
                    dlStatus.level === "warning" ? "text-[12px] text-[var(--pas-orange)] font-semibold" :
                    dlStatus.level === "approaching" ? "text-[12px] text-amber-500 font-medium" :
                    "text-[12px] text-[var(--pas-muted)]"
                  }>
                    {(dlStatus.level === "overdue" || dlStatus.level === "critical" || dlStatus.level === "warning" || dlStatus.level === "approaching") && (
                      <AlertTriangle size={10} className={`inline-block mr-1 -mt-px ${
                        dlStatus.level === "overdue" ? "text-red-700" :
                        dlStatus.level === "critical" ? "text-red-500" :
                        dlStatus.level === "warning" ? "text-[var(--pas-orange)]" :
                        "text-amber-500"
                      }`} />
                    )}
                    Deadline: {formatDate(o.deadline)}
                  </p>
                ) : (
                  <p className="text-[12px] text-[var(--pas-muted)]">Deadline: -</p>
                )}
              </div>
            </div>
          );
        })}
      </section>
    </>
  );
}

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   VIEW: JADWAL PRODUKSI (kanban lanes)
   â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
function ViewJadwal({
  orders,
  openDetail,
  steps,
  onMoved,
  showToast,
}: {
  orders: OrderData[];
  openDetail: (id: string) => void;
  steps: StepRow[];
  onMoved: () => void;
  showToast: (msg: string) => void;
}) {
  const active = orders.filter((o) => !o.is_done);
  const lanes = useMemo(() => buildLanes(steps), [steps]);

  function barClass(pct: number) {
    if (pct >= 100) return "done";
    if (pct >= 66) return "high";
    if (pct >= 33) return "mid";
    return "low";
  }

  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [overLane, setOverLane] = useState<string | null>(null);

  async function handleDrop(orderId: string, laneKey: string) {
    const laneIdx = lanes.findIndex((l) => l.key === laneKey);
    if (laneIdx < 0) return;
    const targetStep = lanes[laneIdx].from;
    const order = orders.find((o) => o.id === orderId);
    if (!order || order.current_step === targetStep) return;
    const prevStep = order.current_step;
    try {
      const res = await fetch(`/api/pesanan/orders/${orderId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ current_step: targetStep }),
      });
      const data: any = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast(data.error || "Gagal memindahkan pesanan, coba lagi");
        return;
      }
      onMoved();
      const laneName = lanes[laneIdx].name;
      showToast(
        `${orderId} dipindah ke ${laneName}${waNote(data?.notification?.status)}`
      );
    } catch {
      showToast("Gagal memindahkan pesanan, coba lagi");
    }
  }

  return (
    <>
      <p className="text-[14px] text-[var(--pas-muted)] mb-5">
        Papan produksi - pesanan dikelompokkan per fase. Klik kartu untuk update tahap.
      </p>

      {(["desktop", "mobile"] as const).map((variant) => (
        <div key={variant} className={variant === "desktop" ? "pas-board hidden md:flex" : "flex flex-col md:hidden"}>
          {lanes.map((lane, i) => {
            const key = lane.key;
            const items = active.filter((o) => o.current_step >= lane.from && o.current_step <= lane.to);
            const isOver = overLane === `${variant}:${key}`;
            return (
              <div
                key={`${variant}:${lane.name}`}
                className={`pas-lane ${isOver ? "pas-lane-over" : ""}`}
                onDragOver={(e) => {
                  e.preventDefault();
                  if (draggingId) setOverLane(`${variant}:${key}`);
                }}
                onDragLeave={() => setOverLane((v) => (v === `${variant}:${key}` ? null : v))}
                onDrop={(e) => {
                  e.preventDefault();
                  const id = e.dataTransfer.getData("text/plain") || draggingId;
                  setOverLane(null);
                  setDraggingId(null);
                  if (id) handleDrop(id, key);
                }}
                onTouchMove={(e) => {
                  if (!draggingId) return;
                  const touch = e.touches[0];
                  const el = document.elementFromPoint(touch.clientX, touch.clientY);
                  const laneEl = el?.closest("[data-lane-key]") as HTMLElement | null;
                  const k = laneEl?.dataset.laneKey || null;
                  setOverLane(k ? `${variant}:${k}` : null);
                }}
                onTouchEnd={(e) => {
                  const touch = e.changedTouches[0];
                  const el = document.elementFromPoint(touch.clientX, touch.clientY);
                  const laneEl = el?.closest("[data-lane-key]") as HTMLElement | null;
                  const k = laneEl?.dataset.laneKey || null;
                  const id = draggingId;
                  setOverLane(null);
                  setDraggingId(null);
                  if (id && k) handleDrop(id, k);
                }}
                data-lane-key={key}
              >
                <div className="pas-lane-head">
                  <span className="pas-lane-title">
                    <span className="pas-lane-dot" style={{ background: LANE_COLOR_CYCLE[i % LANE_COLOR_CYCLE.length] }} />
                    {lane.name}
                  </span>
                  <span className="pas-lane-count">{items.length}</span>
                </div>
                <div className="pas-lane-body" data-lane-key={key}>
                  {items.length === 0 ? (
                    <div className="pas-lane-empty">
                      <div className="pas-lane-empty-icon">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="3" y="3" width="18" height="18" rx="2" />
                          <path d="M9 12h6M12 9v6" />
                        </svg>
                      </div>
                      <p className="pas-lane-empty-text">Belum ada pesanan</p>
                      <p className="pas-lane-empty-sub">Pesanan akan muncul di sini</p>
                    </div>
                  ) : (
                    items.map((o) => {
                      // Pakai persentase dari API — dihitung dari nomor tahap pada
                      // urutan yang berlaku, jadi sama dengan halaman customer.
                      const pct = o.pct ?? Math.round((o.current_step / 11) * 100);
                      const ini = initials(o.customer_name);
                      const stepName = steps[o.current_step - 1]?.name || `Tahap ${o.current_step}`;
                      const isDragging = draggingId === o.id;
                      return (
                        <div
                          key={o.id}
                          draggable
                          onDragStart={(e) => {
                            e.dataTransfer.setData("text/plain", o.id);
                            e.dataTransfer.effectAllowed = "move";
                            setDraggingId(o.id);
                          }}
                          onDragEnd={() => { setDraggingId(null); setOverLane(null); }}
                          onTouchStart={() => setDraggingId(o.id)}
                          onClick={() => { if (!isDragging) openDetail(o.id); }}
                          className={`pas-order-card ${isDragging ? "pas-dragging" : ""}`}
                          data-lane={key}
                          style={{ opacity: isDragging ? 0.55 : 1, touchAction: "none" }}
                        >
                          <div className="pas-card-top">
                            <div className="flex items-center gap-2.5">
                              <span className="pas-card-avatar">{ini}</span>
                              <span className="pas-card-id">{o.id}</span>
                            </div>
                            <span className="pas-card-pcs">{o.quantity}</span>
                          </div>
                          <div className="pas-card-body">
                            <p className="pas-card-customer">{o.customer_name}</p>
                            <p className="pas-card-product">{o.product_name}</p>
                          </div>
                          <div className="pas-card-progress">
                            <div className="pas-card-bar">
                              <div className={`pas-card-bar-fill ${barClass(pct)}`} style={{ width: `${pct}%` }} />
                            </div>
                            <span className="pas-card-pct">{pct}%</span>
                          </div>
                          <div className="pas-card-step">
                            <span className="pas-card-step-dot" />
                            {stepName}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </>
  );
}

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   VIEW: PENGIRIMAN
   â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
function ViewKirim({
  orders,
  openDetail,
  steps,
}: {
  orders: OrderData[];
  openDetail: (id: string) => void;
  steps: StepRow[];
}) {
  // Antrian "siap kirim" = tahap sebelum terakhir (Packing) yang belum tuntas.
  // Order lama yang masih nyangkut di tahap akhir tapi belum selesai ikut
  // ditampilkan supaya tetap bisa diklik jadi Selesai.
  const siap = orders.filter((o) => !o.is_done && o.current_step >= steps.length - 1);

  return (
    <>
      <p className="text-[14px] text-[var(--pas-muted)] mb-5">
        Pesanan tahap {steps.length - 1} (siap dikirim) - klik tahap Kirim untuk menandai pesanan selesai. Nomor resi opsional.
      </p>
      {siap.length === 0 ? (
        <p className="text-[14px] text-[var(--pas-muted)]">
          Belum ada pesanan yang siap dikirim.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {siap.map((o) => (
            <div key={o.id} className="pas-card p-4 sm:p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold pas-num">{o.id}</p>
                  <p className="text-[13px] text-[var(--pas-muted)] mt-0.5">
                    {o.customer_name} - {o.customer_phone}
                  </p>
                </div>
                <span className={`pas-pill ${statusOf(o, steps.length)}`}>
                  {FILTER_LABEL[statusOf(o, steps.length)]}
                </span>
              </div>
              <div className="grid sm:grid-cols-2 gap-3 mt-4 text-[13.5px]">
                <div>
                  <p className="text-[12px] text-[var(--pas-muted)]">Isi Paket</p>
                  <p className="mt-1">
                    {o.product_name} - {o.quantity}
                  </p>
                </div>
                <div>
                  <p className="text-[12px] text-[var(--pas-muted)]">Ekspedisi</p>
                  <p className="mt-1">
                    {o.courier || (
                      <span className="text-[var(--pas-muted)]">belum diisi</span>
                    )}
                  </p>
                </div>
              </div>
              <div className="flex gap-2 mt-4">
                <button
                  className="pas-btn-ghost px-4 py-2 text-[13.5px]"
                  onClick={() => openDetail(o.id)}
                >
                  Buka Detail Pesanan
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   VIEW: CUSTOMER PANEL (isi drawer detail customer)
   â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
function CustomerPanel({
  group,
  steps,
  onOpenOrder,
}: {
  group: CustomerGroup;
  steps: StepRow[];
  onOpenOrder: (id: string) => void;
}) {
  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-[18px] pb-4 border-b border-[var(--pas-line)]">
        <div className="flex items-start gap-3 pr-8">
          <span className="pas-avatar text-[16px] w-11 h-11 flex items-center justify-center flex-none">
            {initials(group.displayName)}
          </span>
          <div className="flex-1 min-w-0">
            <p className="pas-display text-[17px] truncate">{group.displayName}</p>
            <p className="text-[13px] text-[var(--pas-muted)] pas-num mt-0.5">
              {group.phone || "tanpa nomor HP"}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2.5 mt-4">
          <div className="pas-legend-row">
            Order
            <b className="pas-num q">{group.orders.length}</b>
          </div>
          <div className="pas-legend-row">
            PCS
            <b className="pas-num q">{group.totalPcs}</b>
          </div>
          <div className="pas-legend-row">
            Aktif
            <b className="pas-num q">{group.aktif}</b>
          </div>
        </div>

        {group.aliases.length > 1 && (
          <p className="text-[11.5px] text-[var(--pas-muted)] mt-3">
            <b>{group.orders.length} pesanan</b> — {group.aliases.join(", ")}
          </p>
        )}
      </div>

      {/* Riwayat pesanan */}
      <div className="flex-1 overflow-y-auto p-[18px] pt-4">
        <p className="text-[13px] font-semibold text-ink mb-3">Riwayat Pesanan</p>
        <div className="flex flex-col gap-2.5">
          {group.orders.map((o) => {
            const st = statusOf(o, steps.length);
            return (
              <button
                key={o.id}
                type="button"
                onClick={() => onOpenOrder(o.id)}
                className="pas-card p-3.5 text-left w-full"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-[13.5px] pas-num">{o.id}</p>
                    <p className="text-[12px] text-[var(--pas-muted)] mt-0.5 truncate">
                      {cleanName(o.customer_name) || "-"}
                    </p>
                  </div>
                  <span className={`pas-pill ${st} shrink-0`}>{FILTER_LABEL[st]}</span>
                </div>
                <div className="flex items-center justify-between gap-3 mt-2.5">
                  <span className="text-[11.5px] text-[var(--pas-muted)]">
                    {formatDate(o.created_at)}
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="pas-mini" style={{ width: 56 }}>
                      <i style={{ width: `${o.pct}%` }} />
                    </span>
                    <span className="text-[11.5px] text-[var(--pas-muted)] pas-num">{o.pct}%</span>
                  </span>
                </div>
              </button>
            );
          })}
        </div>
        <p className="text-[11px] text-[var(--pas-muted)] mt-3">
          Nama di setiap kartu adalah label yang tercatat pada pesanan aslinya.
        </p>
      </div>
    </div>
  );
}

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   VIEW: CUSTOMER
   â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
function ViewCustomer({
  orders,
  onSelectCustomer,
  steps,
}: {
  orders: OrderData[];
  onSelectCustomer: (key: string) => void;
  steps: StepRow[];
}) {
  const groups = useMemo(() => groupCustomers(orders), [orders]);
  const aktifCount = groups.filter((g) => g.aktif > 0).length;

  return (
    <>
      <p className="text-[14px] text-[var(--pas-muted)] mb-5">
        Satu baris = satu customer, digabung berdasarkan nomor HP. Nama berbeda yang ditulis di
        tiap pesanan tetap disimpan sebagai alias.
      </p>

      {/* Ringkasan */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
        <div className="pas-card p-[18px]">
          <p className="text-[12px] text-[var(--pas-muted)] font-semibold">Total Customer</p>
          <p className="pas-display pas-num text-[26px] mt-1">{groups.length}</p>
          <p className="text-[11.5px] text-[var(--pas-muted)] mt-0.5">nomor HP unik</p>
        </div>
        <div className="pas-card p-[18px]">
          <p className="text-[12px] text-[var(--pas-muted)] font-semibold">Sedang Aktif</p>
          <p className="pas-display pas-num text-[26px] mt-1">{aktifCount}</p>
          <p className="text-[11.5px] text-[var(--pas-muted)] mt-0.5">punya pesanan berjalan</p>
        </div>
        <div className="pas-card p-[18px]">
          <p className="text-[12px] text-[var(--pas-muted)] font-semibold">Total Pesanan</p>
          <p className="pas-display pas-num text-[26px] mt-1">{orders.length}</p>
          <p className="text-[11.5px] text-[var(--pas-muted)] mt-0.5">seluruh periode</p>
        </div>
      </div>

      {/* tabel (desktop) */}
      <div className="pas-card p-2 sm:p-4 overflow-x-auto hidden md:block">
        <table className="pas-tbl">
          <thead>
            <tr>
              <th className="w-[36%]">Customer</th>
              <th className="w-[20%]">Nomor HP</th>
              <th className="num w-[13%]">Total Order</th>
              <th className="w-[14%]">Status</th>
              <th className="w-[17%]">Terakhir Order</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <tr key={g.key} onClick={() => onSelectCustomer(g.key)}>
                <td>
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="pas-avatar shrink-0">{initials(g.displayName)}</span>
                    <span className="min-w-0">
                      <span className="block truncate">{g.displayName}</span>
                      <span className="block text-[12px] text-[var(--pas-muted)] mt-0.5">
                        {g.aliases.length > 1
                          ? `${g.orders.length} pesanan · ${g.aliases.length} nama berbeda`
                          : `${g.orders.length} pesanan`}
                      </span>
                    </span>
                  </div>
                </td>
                <td className="pas-num text-[var(--pas-muted)]">{g.phone || "-"}</td>
                <td className="num pas-num font-semibold">{g.orders.length}</td>
                <td>
                  {g.aktif ? (
                    <span className="pas-pill produksi">{g.aktif} aktif</span>
                  ) : (
                    <span className="pas-pill selesai">selesai</span>
                  )}
                </td>
                <td className="text-[var(--pas-muted)]">{formatDate(g.lastOrderAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {groups.length === 0 && (
          <p className="text-[13px] text-[var(--pas-muted)] px-3 py-6 text-center">
            Belum ada customer.
          </p>
        )}
      </div>

      {/* cards (mobile) */}
      <div className="flex flex-col gap-3 md:hidden">
        {groups.length === 0 && (
          <div className="pas-card p-[18px] text-center">
            <p className="text-[var(--pas-muted)] text-[14px] font-medium">Belum ada customer</p>
          </div>
        )}
        {groups.map((g) => (
          <div
            key={g.key}
            className="pas-card p-[18px] cursor-pointer"
            onClick={() => onSelectCustomer(g.key)}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <span className="pas-avatar shrink-0">{initials(g.displayName)}</span>
                <div className="min-w-0">
                  <p className="text-[15px] font-semibold truncate">{g.displayName}</p>
                  <p className="text-[12px] text-[var(--pas-muted)] pas-num truncate mt-0.5">
                    {g.phone || "-"}
                  </p>
                </div>
              </div>
              {g.aktif ? (
                <span className="pas-pill produksi shrink-0">{g.aktif} aktif</span>
              ) : (
                <span className="pas-pill selesai shrink-0">selesai</span>
              )}
            </div>

            <div className="flex items-end justify-between gap-3 mt-3 pt-3 border-t border-[var(--pas-line)]">
              <div>
                <p className="text-[11px] text-[var(--pas-muted)] uppercase tracking-wider font-semibold">
                  Total Order
                </p>
                <p className="pas-display pas-num text-[20px] mt-0.5">{g.orders.length}</p>
              </div>
              <div className="text-right">
                <p className="text-[11px] text-[var(--pas-muted)] uppercase tracking-wider font-semibold">
                  Terakhir
                </p>
                <p className="text-[12.5px] mt-0.5" style={{ color: "var(--pas-ink-2)" }}>
                  {formatDate(g.lastOrderAt)}
                </p>
              </div>
            </div>

            {g.aliases.length > 1 && (
              <p className="text-[11.5px] text-[var(--pas-muted)] mt-2.5">
                {g.aliases.length} nama: {g.aliases.join(", ")}
              </p>
            )}
          </div>
        ))}
      </div>
    </>
  );
}

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   VIEW: LAPORAN
   â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
function ViewLaporan({ orders, steps }: { orders: OrderData[]; steps: StepRow[] }) {
  const [selectedMonth, setSelectedMonth] = useState(() =>
    monthKeyOf(new Date().toISOString())
  );
  const [capacity, setCapacity] = useState(DEFAULT_KAPASITAS);
  const [completedMap, setCompletedMap] = useState<Record<string, string>>({});

  useEffect(() => {
    fetch("/api/pesanan/settings")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d && typeof d.capacity === "number") setCapacity(d.capacity);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetch("/api/pesanan/laporan")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d && d.completed) setCompletedMap(d.completed);
      })
      .catch(() => {});
  }, []);

  // Bulan yang tersedia — dari data order, plus bulan berjalan.
  const monthOptions = useMemo(() => {
    const keys = new Set<string>();
    orders.forEach((o) => {
      const k = monthKeyOf(o.created_at);
      if (k) keys.add(k);
    });
    keys.add(monthKeyOf(new Date().toISOString()));
    return Array.from(keys).sort().reverse();
  }, [orders]);

  const monthOrders = useMemo(
    () => orders.filter((o) => monthKeyOf(o.created_at) === selectedMonth),
    [orders, selectedMonth]
  );

  const totalOrders = monthOrders.length;
  const totalPcs = monthOrders.reduce((a, o) => a + orderPcs(o), 0);

  // Rata-rata waktu produksi = selisih created_at sampai order menyentuh
  // tahap akhir. Hanya order bulan terpilih yang benar-benar sudah selesai
  // yang ikut dihitung; kalau belum ada, hasilnya null (bukan angka karangan).
  const durations = monthOrders
    .map((o) => {
      const done = completedMap[o.id];
      if (!done) return null;
      const start = new Date(o.created_at).getTime();
      const end = new Date(done).getTime();
      if (isNaN(start) || isNaN(end) || end < start) return null;
      return (end - start) / 86400000;
    })
    .filter((v): v is number => v !== null);

  const avgTime = durations.length
    ? durations.reduce((a, b) => a + b, 0) / durations.length
    : null;

  // Kapasitas produksi — beban bulan terpilih vs setting
  const capPct = capacity > 0 ? Math.round((totalPcs / capacity) * 100) : 0;
  const isOver = totalPcs > capacity;
  const isWarn = !isOver && capPct >= 85;
  const excess = Math.max(totalPcs - capacity, 0);
  const capClass = isOver ? "danger" : isWarn ? "warn" : "produksi";

  // Penjualan per produk — label = nama produk apa adanya, urut pcs terbanyak
  const cats = useMemo(() => {
    const acc: Record<string, number> = {};
    monthOrders.forEach((o) => {
      const b = bucketOrder(o);
      Object.keys(b).forEach((k) => {
        acc[k] = (acc[k] || 0) + b[k];
      });
    });
    return Object.keys(acc)
      .filter((label) => acc[label] > 0)
      .sort((a, b) => acc[b] - acc[a] || a.localeCompare(b, "id"))
      .map((label, i) => ({
        label,
        pcs: acc[label],
        color: CAT_COLORS[i % CAT_COLORS.length],
      }));
  }, [monthOrders]);

  const catTotal = cats.reduce((a, c) => a + c.pcs, 0);

  // Komposisi Atasan vs Setelan — dimensi produksi: setelan ikut membuat celana.
  const families = useMemo(() => {
    const acc = { Atasan: 0, Setelan: 0, Lainnya: 0 };
    cats.forEach((c) => {
      const fam = productFamily(c.label);
      if (fam) acc[fam] += c.pcs;
      else acc.Lainnya += c.pcs;
    });
    return (["Setelan", "Atasan", "Lainnya"] as const)
      .map((label) => ({ label, pcs: acc[label] }))
      .filter((f) => f.pcs > 0);
  }, [cats]);
  const catMax = Math.max(...cats.map((c) => c.pcs), 1);
  const CIRC = 2 * Math.PI * 46;

  // Segmen donut dihitung berurutan — dashoffset bergantung akumulasi share
  let accShare = 0;
  const donutSegments = cats.map((c) => {
    const share = catTotal > 0 ? c.pcs / catTotal : 0;
    const len = share * CIRC;
    const seg = (
      <circle
        key={c.label}
        cx="60"
        cy="60"
        r="46"
        fill="none"
        stroke={c.color}
        strokeWidth="15"
        strokeDasharray={`${len.toFixed(2)} ${(CIRC - len).toFixed(2)}`}
        strokeDashoffset={(-accShare * CIRC).toFixed(2)}
      >
        <title>{`${c.label}: ${c.pcs.toLocaleString("id-ID")} pcs`}</title>
      </circle>
    );
    accShare += share;
    return seg;
  });

  // Order per minggu pada bulan terpilih (W1 = tgl 1-7, dst)
  const weeks = useMemo(() => {
    const [ys, ms] = selectedMonth.split("-");
    const y = parseInt(ys, 10);
    const m = parseInt(ms, 10) - 1;
    if (isNaN(y) || isNaN(m)) return [];
    const buckets = [0, 0, 0, 0, 0];
    monthOrders.forEach((o) => {
      // Tanggal diambil dari kunci WIB, bukan tanggal lokal perangkat — order
      // jam 06.00 WIB tanggal 1 tidak boleh masuk keranjang minggu sebelumnya
      // hanya karena perangkatnya berzona lain.
      const key = dateKeyID(o.created_at);
      if (!key) return;
      const day = Number(key.slice(8, 10));
      buckets[Math.min(Math.floor((day - 1) / 7), 4)] += 1;
    });
    return buckets
      .map((value, i) => ({ label: `W${i + 1}`, value }))
      .filter((w, i) => !(i === 4 && w.value === 0));
  }, [monthOrders, selectedMonth]);

  const weekMax = Math.max(...weeks.map((w) => w.value), 1);
  const weekTotal = weeks.reduce((a, w) => a + w.value, 0);

  // Beban per fase — real-time, tidak ikut filter bulan
  const byStage = buildLanes(steps).map((l) => ({
    name: l.name,
    n: orders.filter(
      (o) => o.current_step >= l.from && o.current_step <= l.to && !o.is_done
    ).length,
  }));
  const max = Math.max(...byStage.map((b) => b.n), 1);

  const periode = monthLabelOf(selectedMonth);
  const nf = (n: number) => n.toLocaleString("id-ID");
  const pctOf = (v: number, t: number) => (t > 0 ? ((v / t) * 100).toFixed(1) : "0.0");

  return (
    <div className="space-y-6">
      {/* Peringatan kapasitas */}
      {isOver && (
        <div className="pas-alert over">
          <span className="ic">!</span>
          <div>
            <b>
              Kapasitas produksi terlampaui — {capPct}% ({nf(totalPcs)} / {nf(capacity)} pcs)
            </b>
            Beban bulan ini melebihi kapasitas sebesar <b>+{nf(excess)} pcs</b>. Risiko
            keterlambatan SLA 7-10 hari.
            <ul>
              <li>Tahan atau jadwalkan ulang order baru ke bulan berikutnya</li>
              <li>Tambah shift, atau alihkan sebagian ke maklon</li>
              <li>Cek fase dengan beban tertinggi di &ldquo;Beban per Fase Produksi&rdquo;</li>
            </ul>
          </div>
        </div>
      )}
      {isWarn && (
        <div className="pas-alert warn">
          <span className="ic">!</span>
          <div>
            <b>
              Kapasitas hampir penuh — {capPct}% ({nf(totalPcs)} / {nf(capacity)} pcs)
            </b>
            Sisa kapasitas tinggal <b>{nf(capacity - totalPcs)} pcs</b>. Pantau order masuk
            sebelum melewati batas.
          </div>
        </div>
      )}

      {/* Pilih bulan */}
      <div className="pas-picker">
        <div className="flex items-center gap-2.5">
          <span className="pas-picker-ic">
            <svg
              width="17"
              height="17"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <rect x="3" y="4" width="18" height="18" rx="3" />
              <path d="M8 2v4M16 2v4M3 10h18" />
            </svg>
          </span>
          <b className="text-[13.5px] font-bold text-ink">Pilih Bulan</b>
        </div>
        <div className="pas-select-wrap">
          <select
            className="pas-field appearance-none text-[13.5px] font-semibold pl-3.5 pr-9 py-2.5 cursor-pointer"
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
            aria-label="Pilih bulan laporan"
          >
            {monthOptions.map((k) => (
              <option key={k} value={k}>
                {monthLabelOf(k)}
              </option>
            ))}
          </select>
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </div>
        <span className="flex-1" />
        <span className="text-[11.5px] text-[var(--pas-muted)] font-medium">
          Berlaku untuk Ringkasan, Penjualan per Produk, Kapasitas &amp; Order per Minggu
        </span>
      </div>

      {/* Ringkasan Operasional */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-[18px] font-semibold text-ink">Ringkasan Operasional</h2>
          <span className="text-[13px] text-[var(--pas-muted)]">
            Periode: <b>{periode}</b>
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="pas-card p-[18px] flex flex-col">
            <div className="flex items-center gap-2 text-[var(--pas-muted)] text-[13px]">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="7" width="20" height="14" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>
              Total Pesanan
            </div>
            <p className="pas-display pas-num text-[32px] mt-auto pt-1">{totalOrders}</p>
            <p className="text-[12px] text-[var(--pas-muted)] mt-0.5">semua status</p>
          </div>

          <div className="pas-card p-[18px] flex flex-col">
            <div className="flex items-center gap-2 text-[var(--pas-muted)] text-[13px]">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
              Total Item
            </div>
            <p className="pas-display pas-num text-[32px] mt-auto pt-1">
              {nf(totalPcs)} <span className="text-[16px]">pcs</span>
            </p>
            <p className="text-[12px] text-[var(--pas-muted)] mt-0.5">dari {totalOrders} pesanan</p>
          </div>

          <div className="pas-card p-[18px] flex flex-col">
            <div className="flex items-center gap-2 text-[var(--pas-muted)] text-[13px]">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
              Rata-rata Waktu
            </div>
            <p className="pas-display pas-num text-[32px] mt-auto pt-1">
              {avgTime === null ? (
                "–"
              ) : (
                <>
                  {avgTime.toFixed(1).replace(".", ",")}{" "}
                  <span className="text-[16px]">hari</span>
                </>
              )}
            </p>
            <p className="text-[12px] text-[var(--pas-muted)] mt-0.5">
              {durations.length > 0
                ? `dari ${durations.length} order selesai · SLA 7-10 hari`
                : "belum ada order selesai di periode ini"}
            </p>
          </div>

          <div className="pas-card p-[18px] flex flex-col">
            <div className="flex items-center gap-2 text-[var(--pas-muted)] text-[13px]">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
              Aktif Produksi
            </div>
            <p className="pas-display pas-num text-[32px] mt-auto pt-1">
              {orders.filter((o) => !o.is_done).length}
            </p>
            <p className="text-[12px] text-[var(--pas-muted)] mt-0.5">pesanan dalam proses</p>
            <span className="pas-pill warn mt-1.5 self-start">real-time · tidak ikut filter bulan</span>
          </div>
        </div>
      </div>

      {/* Penjualan per Produk */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-[18px] font-semibold text-ink">Penjualan per Produk</h2>
          <span className="text-[13px] text-[var(--pas-muted)]">
            Total terjual — <b>{periode}</b>
          </span>
        </div>

        <div className="grid lg:grid-cols-[1.05fr_1fr] gap-4">
          <div className="pas-card p-[18px] flex flex-col">
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-[13px] font-semibold text-ink">Proporsi Produk</p>
              <span className="text-[11px] text-[var(--pas-muted)]">per nama produk</span>
            </div>

            {families.length > 0 && (
              <p className="text-[11.5px] text-[var(--pas-muted)] mb-3">
                Komposisi:{" "}
                {families.map((f, i) => (
                  <span key={f.label}>
                    {i > 0 && " · "}
                    <b className="text-ink">{f.label}</b>{" "}
                    <span className="pas-num">{nf(f.pcs)}</span> pcs
                  </span>
                ))}
              </p>
            )}

            {catTotal === 0 ? (
              <p className="text-[12.5px] text-[var(--pas-muted)] py-10 text-center">
                Belum ada penjualan pada periode ini.
              </p>
            ) : (
              <>
                <div className="pas-donut-wrap">
                  <div className="pas-donut">
                    <svg
                      viewBox="0 0 120 120"
                      width="100%"
                      height="100%"
                      role="img"
                      aria-label="Donut proporsi produk"
                    >
                      <circle cx="60" cy="60" r="46" fill="none" stroke="#EDEDE8" strokeWidth="15" />
                      <g transform="rotate(-90 60 60)">{donutSegments}</g>
                    </svg>
                    <div className="pas-donut-center">
                      <b className="pas-num">{nf(catTotal)}</b>
                      <small>total pcs</small>
                    </div>
                  </div>

                  <div className="pas-legend">
                    {cats.map((c) => (
                      <div key={c.label} className="pas-legend-row">
                        <span className="sw" style={{ background: c.color }} />
                        {c.label}
                        <span className="q pas-num">{nf(c.pcs)} pcs</span>
                        <b className="pas-num">{pctOf(c.pcs, catTotal)}%</b>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="mt-auto pt-3">
                  {cats.map((c) => (
                    <div key={c.label} className="pas-cbar">
                      <div className="top">
                        <span>{c.label}</span>
                        <b className="pas-num">
                          {nf(c.pcs)} pcs · {pctOf(c.pcs, catTotal)}%
                        </b>
                      </div>
                      <div className="tr">
                        <i
                          style={{
                            width: `${(c.pcs / catMax) * 100}%`,
                            background: c.color,
                          }}
                        />
                      </div>
                    </div>
                  ))}
                  <p className="text-[11.5px] text-[var(--pas-muted)] mt-3.5">
                    {cats.length} produk aktif dari {monthOrders.length} pesanan pada periode ini.
                  </p>
                </div>
              </>
            )}
          </div>

          <div className="flex flex-col gap-4 min-w-0">
            <div className="grid sm:grid-cols-2 gap-4">
              {cats.map((c) => (
                <div key={c.label} className="pas-card pas-kpi p-4">
                  <div className="flex items-center gap-2 text-[var(--pas-muted)] text-[12px] font-semibold">
                    <span
                      className="w-[11px] h-[11px] rounded-[3px] flex-none"
                      style={{ background: c.color }}
                    />
                    {c.label}
                  </div>
                  <p className="pas-display pas-num text-[26px] mt-1">
                    {nf(c.pcs)} <span className="text-[14px]">pcs</span>
                  </p>
                  <p className="text-[11.5px] text-[var(--pas-muted)] mt-0.5">
                    <b>{pctOf(c.pcs, catTotal)}%</b> dari total item
                  </p>
                </div>
              ))}
            </div>

            <div className="pas-card p-[18px]">
              <p className="text-[13px] font-semibold text-ink mb-2">Rincian</p>
              <div className="overflow-x-auto">
                <table className="pas-tbl pas-tbl-static">
                  <thead>
                    <tr>
                      <th>Produk</th>
                      <th className="num">Pcs</th>
                      <th className="num">% total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cats.length === 0 && (
                      <tr>
                        <td colSpan={3} style={{ textAlign: "center", color: "var(--pas-muted)" }}>
                          Belum ada penjualan pada periode ini.
                        </td>
                      </tr>
                    )}
                    {cats.map((c) => (
                      <tr key={c.label}>
                        <td>{c.label}</td>
                        <td className="num">{nf(c.pcs)}</td>
                        <td className="num">{pctOf(c.pcs, catTotal)}%</td>
                      </tr>
                    ))}
                    {cats.length > 0 && (
                      <tr>
                        <td><b>Total</b></td>
                        <td className="num"><b>{nf(catTotal)}</b></td>
                        <td className="num"><b>100%</b></td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <p className="text-[11px] text-[var(--pas-muted)] mt-3">
                Dikelompokkan dari nama produk yang tersimpan di tiap pesanan — tidak ada
                kategori tebakan. Baris komposisi menurunkannya ke istilah order:
                <b> Setelan</b> = atasan + celana, <b>Atasan</b> = jersey saja. Order lama
                tanpa rincian produk dihitung pada satu baris sesuai nama produknya agar
                total tetap utuh.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Kapasitas Produksi */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-[18px] font-semibold text-ink">Kapasitas Produksi</h2>
        </div>

        <div className="grid lg:grid-cols-[1.25fr_1fr] gap-4 items-start">
          <div className="pas-card p-[18px]">
            <div className="flex items-center justify-between mb-0.5">
              <p className="text-[13px] font-semibold text-ink">Kapasitas terpakai</p>
              <span className="text-[11px] text-[var(--pas-muted)]">{periode}</span>
            </div>

            <div className="pas-cap-big pas-num mt-3">
              <span>
                <span className={isOver ? "pas-over" : ""}>{nf(totalPcs)}</span>{" "}
                <small>/ {nf(capacity)} pcs</small>
              </span>
              <span className={`pas-pill ${capClass}`}>{capPct}%</span>
            </div>

            <div className={`pas-cap-track ${isOver ? "over" : isWarn ? "warn" : ""}`}>
              <i style={{ width: `${isOver ? 100 : Math.min(capPct, 100)}%` }} />
              {isOver && totalPcs > 0 && (
                <span className="pas-cap-mark" style={{ left: `${(capacity / totalPcs) * 100}%` }} />
              )}
            </div>

            <div className="pas-cap-row">
              <span>0</span>
              {isOver ? (
                <span>
                  Kelebihan: <b className="pas-over">+{nf(excess)} pcs</b>
                </span>
              ) : (
                <span>
                  Sisa: <b>{nf(capacity - totalPcs)} pcs</b>
                </span>
              )}
              <span>{nf(capacity)}</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 mt-3.5">
              <div className="pas-legend-row">
                Kapasitas/bulan
                <b className="pas-num q">{nf(capacity)} pcs</b>
              </div>
              <div className="pas-legend-row">
                Rata-rata pcs/order
                <b className="pas-num q">
                  {totalOrders > 0 ? `${nf(Math.round(totalPcs / totalOrders))} pcs` : "–"}
                </b>
              </div>
            </div>

            <p className="text-[11.5px] text-[var(--pas-muted)] mt-3">
              {isOver
                ? `Garis merah = batas kapasitas (${nf(capacity)} pcs). Bar penuh karena beban melewati batas.`
                : isWarn
                  ? "Sisa kapasitas menipis — pertimbangkan tahan order baru atau tambah shift."
                  : `Kapasitas masih longgar — sisa ${nf(capacity - totalPcs)} pcs untuk order baru bulan ini.`}
            </p>
          </div>

          <div className="pas-card p-[18px]">
            <p className="text-[13px] font-semibold text-ink mb-2">Detail</p>
            <table className="pas-tbl pas-tbl-static">
              <tbody>
                <tr>
                  <td>Masuk/diproses bulan ini</td>
                  <td className="num">
                    <b className={isOver ? "pas-over" : ""}>{nf(totalPcs)} pcs</b>
                  </td>
                </tr>
                <tr>
                  <td>{isOver ? "Kelebihan beban" : "Sisa kapasitas"}</td>
                  <td className="num">
                    {isOver ? (
                      <b className="pas-over">+{nf(excess)} pcs</b>
                    ) : (
                      <b>{nf(capacity - totalPcs)} pcs</b>
                    )}
                  </td>
                </tr>
                <tr>
                  <td>Status</td>
                  <td className="num">
                    <span className={`pas-pill ${capClass}`}>
                      {isOver ? "Over kapasitas" : isWarn ? "Hampir penuh" : "Aman"}
                    </span>
                  </td>
                </tr>
              </tbody>
            </table>
            <p className="text-[11px] text-[var(--pas-muted)] mt-3">
              Kapasitas per bulan diatur di halaman <b>Pengaturan</b> · default{" "}
              {nf(DEFAULT_KAPASITAS)} pcs
            </p>
          </div>
        </div>
      </div>

      {/* Chart + fase */}
      <div className="grid lg:grid-cols-[1.25fr_1fr] gap-4">
        <div className="pas-card p-[18px]">
          <div className="flex items-center justify-between">
            <p className="text-[13px] font-semibold text-ink">Order per Minggu</p>
            <span className="text-[10px] text-[var(--pas-muted)]">
              {weekTotal} pesanan · {periode}
            </span>
          </div>
          <p className="text-[11.5px] text-[var(--pas-muted)] mt-1.5">
            Jumlah <b>pesanan masuk</b> tiap minggu pada bulan terpilih (W1 = tanggal 1-7, dst).
          </p>
          <div className="flex gap-2.5 mt-4" style={{ height: 180 }}>
            {weeks.map((w) => (
              <div key={w.label} className="flex flex-col items-center" style={{ flex: 1, minWidth: 0 }}>
                <span className="pas-num text-[12px] font-semibold" style={{ color: "var(--pas-ink-2)" }}>
                  {w.value}
                </span>
                <div className="relative w-full flex-1 min-h-0 mt-1.5">
                  <div
                    style={{
                      position: "absolute",
                      left: 0,
                      right: 0,
                      bottom: 0,
                      height: `${Math.max((w.value / weekMax) * 100, 3)}%`,
                      background: "var(--pas-accent)",
                      opacity: w.value === weekMax ? 1 : 0.45,
                      borderRadius: "6px 6px 3px 3px",
                      transition: "height 0.3s ease",
                    }}
                  />
                </div>
                <span className="text-[11px] text-[var(--pas-muted)] mt-2">{w.label}</span>
              </div>
            ))}
          </div>
          <div
            className="flex items-center justify-between gap-2 flex-wrap mt-3 pt-3 text-[11.5px] text-[var(--pas-muted)] font-semibold"
            style={{ borderTop: "1px solid var(--pas-line)" }}
          >
            <span>
              <span
                className="inline-block w-[9px] h-[9px] rounded-[3px] mr-1.5"
                style={{ background: "var(--pas-accent)" }}
              />
              Minggu tertinggi
            </span>
            <span>
              Rata-rata{" "}
              {weeks.length ? (weekTotal / weeks.length).toFixed(1).replace(".", ",") : "0"}{" "}
              pesanan/minggu
            </span>
          </div>
        </div>

        <div className="pas-card p-[18px] flex flex-col">
          <p className="text-[13px] font-semibold text-ink">Beban per Fase Produksi</p>
          <div className="flex-1 flex flex-col justify-between gap-[13px] mt-4">
            {byStage.map((b) => (
              <div key={b.name} className="flex items-center gap-3">
                <span className="text-[12.5px] w-[148px] text-[var(--pas-muted)] flex-none">
                  {b.name}
                </span>
                <span
                  className="pas-mini"
                  style={{ flex: 1, width: "auto", height: 8 }}
                >
                  <i style={{ width: `${(b.n / max) * 100}%` }} />
                </span>
                <span className="pas-num text-[13px] w-6 text-right">{b.n}</span>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-[var(--pas-muted)] mt-4 text-center">
            Jumlah pesanan aktif per fase (real-time)
          </p>
        </div>
      </div>

      <p className="text-[12px] text-[var(--pas-muted)] text-center">
        * Angka dihitung dari data order. Kapasitas produksi per bulan diatur di halaman Pengaturan.
      </p>
    </div>
  );
}

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   VIEW: PENGATURAN
   â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
function ViewSetting({
  showToast,
  steps,
  onStepsSaved,
}: {
  showToast: (msg: string) => void;
  steps: StepRow[];
  onStepsSaved: () => void;
}) {
  const [editSteps, setEditSteps] = useState<{ name: string; position: number }[]>(
    () => steps.map((s) => ({ name: s.name, position: s.position }))
  );
  const [savingSteps, setSavingSteps] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);

  // Token Fonnte (notifikasi WhatsApp) - token penuh tidak pernah dirender/dikirim ke client
  const [fonnteToken, setFonnteToken] = useState("");
  const [fonnteTarget, setFonnteTarget] = useState("");
  const [fonnteHasToken, setFonnteHasToken] = useState(false);
  const [fonnteLast4, setFonnteLast4] = useState<string | null>(null);
  const [savingFonnte, setSavingFonnte] = useState(false);
  const [testingFonnte, setTestingFonnte] = useState(false);

  // Profil Toko
  const [tokoName, setTokoName] = useState("TAFF Sportwear");
  const [tokoWhatsapp, setTokoWhatsapp] = useState("");
  const [tokoJamOps, setTokoJamOps] = useState("Senin-Sabtu - 09.00-17.00 WIB");
  const [savingToko, setSavingToko] = useState(false);

  // Notifikasi Deadline
  const [deadlineEnabled, setDeadlineEnabled] = useState(false);
  const [deadlineTime, setDeadlineTime] = useState("08:00");
  const [deadlineDays, setDeadlineDays] = useState("3,2,1");
  const [deadlinePhone1, setDeadlinePhone1] = useState("");
  const [deadlinePhone2, setDeadlinePhone2] = useState("");
  const [deadlinePhone3, setDeadlinePhone3] = useState("");
  const [savingDeadline, setSavingDeadline] = useState(false);

  // Kapasitas Produksi (dipakai halaman Laporan)
  const [capacity, setCapacity] = useState(String(DEFAULT_KAPASITAS));
  const [savingCapacity, setSavingCapacity] = useState(false);

  useEffect(() => {
    fetch("/api/admin/profil-toko")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d) {
          setTokoName(d.name || "TAFF Sportwear");
          setTokoWhatsapp(d.whatsapp_number || "");
          setTokoJamOps(d.jam_operasional || "Senin-Sabtu - 09.00-17.00 WIB");
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetch("/api/admin/settings/fonnte")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d) {
          setFonnteHasToken(!!d.hasToken);
          setFonnteLast4(d.tokenLast4 ?? null);
        }
      })
      .catch(() => {
        // silent
      });
  }, []);

  useEffect(() => {
    fetch("/api/admin/settings/deadline-notif")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d) {
          setDeadlineEnabled(d.enabled ?? false);
          setDeadlineTime(d.time ?? "08:00");
          setDeadlineDays(d.days ?? "3,2,1");
          const ph = (d.phones ?? "").split(",").map((p: string) => p.trim());
          setDeadlinePhone1(ph[0] || "");
          setDeadlinePhone2(ph[1] || "");
          setDeadlinePhone3(ph[2] || "");
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetch("/api/pesanan/settings")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d && typeof d.capacity === "number") setCapacity(String(d.capacity));
      })
      .catch(() => {});
  }, []);

  const saveFonnteToken = async () => {
    const value = fonnteToken.trim();
    if (!value) {
      showToast("Token tidak boleh kosong");
      return;
    }
    setSavingFonnte(true);
    try {
      const res = await fetch("/api/admin/settings/fonnte", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: value }),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || "Gagal menyimpan token");
        return;
      }
      setFonnteToken("");
      setFonnteHasToken(true);
      setFonnteLast4(data.tokenLast4);
      showToast("Token Fonnte tersimpan (terenkripsi)");
    } catch {
      showToast("Gagal menyimpan token");
    } finally {
      setSavingFonnte(false);
    }
  };

  const testFonnte = async () => {
    if (!fonnteTarget.trim()) {
      showToast("Isi nomor HP tujuan untuk pesan uji");
      return;
    }
    setTestingFonnte(true);
    try {
      const res = await fetch("/api/admin/settings/fonnte/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target: fonnteTarget.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || "Gagal kirim pesan uji");
        return;
      }
      showToast("Pesan uji terkirim. Cek WhatsApp Anda");
    } catch {
      showToast("Gagal kirim pesan uji");
    } finally {
      setTestingFonnte(false);
    }
  };

  const saveDeadlineSettings = async () => {
    setSavingDeadline(true);
    try {
      const res = await fetch("/api/admin/settings/deadline-notif", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled: deadlineEnabled,
          time: deadlineTime,
          days: deadlineDays,
          phones: [deadlinePhone1, deadlinePhone2, deadlinePhone3].filter(Boolean).join(","),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || "Gagal menyimpan pengaturan deadline");
        return;
      }
      showToast("Pengaturan deadline tersimpan");
    } catch {
      showToast("Gagal menyimpan pengaturan deadline");
    } finally {
      setSavingDeadline(false);
    }
  };

  const saveCapacity = async () => {
    const value = parseInt(capacity, 10);
    if (isNaN(value) || value < 1) {
      showToast("Kapasitas harus angka lebih dari 0");
      return;
    }
    setSavingCapacity(true);
    try {
      const res = await fetch("/api/pesanan/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ capacity: value }),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || "Gagal menyimpan kapasitas produksi");
        return;
      }
      setCapacity(String(data.capacity ?? value));
      showToast("Kapasitas produksi tersimpan");
    } catch {
      showToast("Gagal menyimpan kapasitas produksi");
    } finally {
      setSavingCapacity(false);
    }
  };

  const testDeadlineNotif = async () => {
    const allPhones = [deadlinePhone1, deadlinePhone2, deadlinePhone3].filter(Boolean).join(",");
    if (!allPhones.trim()) {
      showToast("Isi nomor HP admin terlebih dahulu");
      return;
    }
    setSavingDeadline(true);
    try {
      const res = await fetch("/api/admin/deadline-notif", {
        headers: { "x-from-dashboard": "true" },
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || "Gagal kirim notifikasi uji");
        return;
      }
      showToast(`Notifikasi uji terkirim ke ${data.total_orders || 0} order`);
    } catch {
      showToast("Gagal kirim notifikasi uji");
    } finally {
      setSavingDeadline(false);
    }
  };

  useEffect(() => {
    setEditSteps(steps.map((s) => ({ name: s.name, position: s.position })));
  }, [steps]);


  const confirmRemoveStep = () => {
    if (confirmDelete === null) return;
    const updated = editSteps.filter((_, i) => i !== confirmDelete);
    updated.forEach((s, i) => (s.position = i + 1));
    setEditSteps(updated);
    setConfirmDelete(null);
  };

  const updateName = (idx: number, name: string) => {
    const updated = [...editSteps];
    updated[idx] = { ...updated[idx], name };
    setEditSteps(updated);
  };

  const moveStep = (idx: number, dir: -1 | 1) => {
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= editSteps.length) return;
    const updated = [...editSteps];
    [updated[idx], updated[newIdx]] = [updated[newIdx], updated[idx]];
    updated.forEach((s, i) => (s.position = i + 1));
    setEditSteps(updated);
  };

  const saveSteps = async () => {
    const names = editSteps.map((s) => s.name.trim());
    if (names.some((n) => !n)) {
      showToast("Nama tahap tidak boleh kosong");
      return;
    }
    if (new Set(names).size !== names.length) {
      showToast("Nama tahap tidak boleh duplikat");
      return;
    }
    setSavingSteps(true);
    try {
      const res = await fetch("/api/pesanan/steps", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          steps: editSteps.map((s, i) => ({ name: s.name.trim(), position: i + 1 })),
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        showToast(data.error || "Gagal menyimpan");
        return;
      }
      showToast("Tahap produksi tersimpan");
      onStepsSaved();
    } catch {
      showToast("Gagal menyimpan");
    } finally {
      setSavingSteps(false);
    }
  };

  return (
    <>
      <p className="text-[14px] text-[var(--pas-muted)] mb-5">
        Pengaturan toko dan alur produksi.
      </p>
      <div className="grid lg:grid-cols-2 gap-4">
        <div className="pas-card p-5">
          <p className="font-semibold text-[15px]">Profil Toko</p>
          <label className="block mt-4">
            <span className="text-[13px] text-[var(--pas-muted)]">Nama Toko</span>
            <input
              className="pas-field w-full px-4 py-2.5 mt-1.5 text-[15px]"
              value={tokoName}
              onChange={(e) => setTokoName(e.target.value)}
            />
          </label>
          <label className="block mt-3">
            <span className="text-[13px] text-[var(--pas-muted)]">WhatsApp Admin</span>
            <input
              className="pas-field w-full px-4 py-2.5 mt-1.5 text-[15px] pas-num"
              placeholder="6281234567890"
              value={tokoWhatsapp}
              onChange={(e) => setTokoWhatsapp(e.target.value)}
            />
          </label>
          <label className="block mt-3">
            <span className="text-[13px] text-[var(--pas-muted)]">Jam Operasional</span>
            <input
              className="pas-field w-full px-4 py-2.5 mt-1.5 text-[15px]"
              value={tokoJamOps}
              onChange={(e) => setTokoJamOps(e.target.value)}
            />
          </label>
          <button
            className="pas-btn-accent w-full py-3 text-[14px] mt-4"
            disabled={savingToko}
            onClick={async () => {
              setSavingToko(true);
              try {
                const res = await fetch("/api/admin/profil-toko", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ name: tokoName, whatsapp_number: tokoWhatsapp, jam_operasional: tokoJamOps }),
                });
                const data = await res.json();
                if (!res.ok) {
                  showToast(data.error || "Gagal menyimpan");
                  return;
                }
                showToast("Profil toko tersimpan");
              } catch {
                showToast("Gagal menyimpan");
              } finally {
                setSavingToko(false);
              }
            }}
          >
            {savingToko ? "Menyimpan..." : "Simpan"}
          </button>
        </div>
        <div className="pas-card p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-semibold text-[15px]">Tahap Produksi</p>
              <p className="text-[12.5px] text-[var(--pas-muted)] mt-1">
                {editSteps.length} tahap - pakai tombol ^v untuk ubah urutan. Nama tahap dikunci.
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-1.5 mt-4">
            {editSteps.map((s, i) => (
              <div
                key={i}
                className="flex items-center gap-2 py-2 px-3 rounded-lg border border-[var(--pas-line-2)] bg-[var(--pas-surface)]"
              >
                <span className="pas-num w-5 text-[12px] text-[var(--pas-muted)] shrink-0">
                  {i + 1}
                </span>
                {/* Nama tahap adalah IDENTITAS tahap (nama → slug, lihat
                    lib/step-order.ts). Kalau teksnya diganti, riwayat &
                    notifikasi WhatsApp tidak lagi menemukan tahapnya — jadi
                    read-only. Yang boleh berubah dari dashboard cuma urutan. */}
                <input
                  className="flex-1 min-w-0 bg-transparent text-[14px] outline-none border-none cursor-default"
                  value={s.name}
                  onChange={(e) => updateName(i, e.target.value)}
                  readOnly
                  aria-readonly="true"
                  title="Nama tahap dikunci. Hubungi support untuk mengubahnya."
                  placeholder="Nama tahap..."
                />
                <div className="flex items-center gap-0.5 shrink-0">
                  <button
                    className="pas-btn-ghost px-1.5 py-1 text-[13px] disabled:opacity-30"
                    disabled={i === 0}
                    onClick={() => moveStep(i, -1)}
                    title="Geser ke atas"
                  >
                    ^
                  </button>
                  <button
                    className="pas-btn-ghost px-1.5 py-1 text-[13px] disabled:opacity-30"
                    disabled={i === editSteps.length - 1}
                    onClick={() => moveStep(i, 1)}
                    title="Geser ke bawah"
                  >
                    v
                  </button>
                  <button
                    className="pas-btn-ghost px-1.5 py-1 text-[13px] disabled:opacity-30"
                    disabled
                    title="Jumlah tahap dikunci. Hubungi support untuk mengubahnya."
                  >
                    ×
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-3 rounded-lg border border-[var(--pas-line-2)] bg-[var(--pas-surface)] px-3 py-2.5">
            <p className="text-[12.5px] leading-relaxed text-[var(--pas-muted)]">
              Cuma <span className="font-semibold text-[var(--pas-accent)]">urutan</span> yang bisa
              diubah dari sini. Nama dan jumlah tahap dikunci supaya riwayat pesanan dan notifikasi
              WhatsApp tetap nyambung dengan tahapnya. Mau ganti teks tahap? Hubungi support.
            </p>
          </div>

          <button
            className="pas-btn-accent w-full py-3 text-[14px] mt-4"
            disabled={savingSteps}
            onClick={saveSteps}
          >
            {savingSteps ? "Menyimpan..." : "Simpan Tahap Produksi"}
          </button>
        </div>
      </div>

      {/* Notifikasi WhatsApp (Fonnte) */}
      <div className="pas-card p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="font-semibold text-[15px]">Notifikasi WhatsApp (Fonnte)</p>
            <p className="text-[12.5px] text-[var(--pas-muted)] mt-1">
              Terkirim otomatis ke customer saat tahap produksi diubah. Token disimpan terenkripsi (AES-256-GCM).
            </p>
          </div>
          <span
            className={`pas-pill shrink-0 ${fonnteHasToken ? "produksi" : "selesai"}`}
          >
            {fonnteHasToken
              ? `Tersimpan ----${fonnteLast4 ?? ""}`
              : "Belum di-set"}
          </span>
        </div>

        <div className="grid lg:grid-cols-2 gap-4 mt-5">
          <label className="block">
            <span className="text-[13px] text-[var(--pas-muted)]">Token Fonnte</span>
            <div className="flex gap-2 mt-1.5">
              <input
                type="password"
                autoComplete="off"
                className="pas-field flex-1 min-w-0 px-4 py-2.5 text-[14px]"
                placeholder={
                  fonnteHasToken && fonnteLast4
                    ? `------------${fonnteLast4} (isi untuk mengganti)`
                    : "Token dari dashboard Fonnte"
                }
                value={fonnteToken}
                onChange={(e) => setFonnteToken(e.target.value)}
              />
              <button
                className="pas-btn-accent px-4 py-2.5 text-[13px] shrink-0"
                disabled={savingFonnte}
                onClick={saveFonnteToken}
              >
                {savingFonnte ? "Menyimpan..." : "Simpan"}
              </button>
            </div>
          </label>

          <label className="block">
            <span className="text-[13px] text-[var(--pas-muted)]">Uji Koneksi</span>
            <div className="flex gap-2 mt-1.5">
              <input
                type="tel"
                className="pas-field flex-1 min-w-0 px-4 py-2.5 text-[14px] pas-num"
                placeholder="No. HP admin (0812... atau 62812...)"
                value={fonnteTarget}
                onChange={(e) => setFonnteTarget(e.target.value)}
              />
              <button
                className="pas-btn-ghost px-4 py-2.5 text-[13px] shrink-0"
                disabled={testingFonnte}
                onClick={testFonnte}
              >
                {testingFonnte ? "Mengirim..." : "Test Kirim"}
              </button>
            </div>
          </label>
        </div>
        <p className="text-[12px] text-[var(--pas-muted)] mt-3">
          Dapatkan token di dashboard Fonnte (fonnte.com). Token tidak pernah ditampilkan penuh dan tidak pernah di-log.
        </p>
      </div>

      {/* Notifikasi Deadline */}
      <div className="pas-card p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="font-semibold text-[15px]">Notifikasi Deadline</p>
            <p className="text-[12.5px] text-[var(--pas-muted)] mt-1">
              Kirim peringatan ke admin via WhatsApp setiap hari jika order mendekati deadline.
            </p>
          </div>
          <label className="relative inline-flex items-center cursor-pointer shrink-0">
            <input
              type="checkbox"
              className="sr-only peer"
              checked={deadlineEnabled}
              onChange={(e) => setDeadlineEnabled(e.target.checked)}
            />
            <div className="w-11 h-6 bg-[var(--pas-line)] rounded-full peer peer-checked:bg-[var(--pas-accent)] transition-colors after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-full"></div>
          </label>
        </div>

        <div className="grid lg:grid-cols-2 gap-4 mt-5">
          <label className="block">
            <span className="text-[13px] text-[var(--pas-muted)]">Jam Kirim (WIB)</span>
            <input
              type="time"
              className="pas-field w-full px-4 py-2.5 mt-1.5 text-[15px]"
              value={deadlineTime}
              onChange={(e) => setDeadlineTime(e.target.value)}
            />
          </label>
          <label className="block">
            <span className="text-[13px] text-[var(--pas-muted)]">Hari Peringatan</span>
            <input
              type="text"
              className="pas-field w-full px-4 py-2.5 mt-1.5 text-[15px]"
              placeholder="3,2,1"
              value={deadlineDays}
              onChange={(e) => setDeadlineDays(e.target.value)}
            />
            <p className="text-[11px] text-[var(--pas-muted)] mt-1">Pisahkan dengan koma (contoh: 3,2,1 untuk H-3, H-2, H-1)</p>
          </label>
          <label className="block lg:col-span-2">
            <span className="text-[13px] text-[var(--pas-muted)]">Nomor HP Admin</span>
            <div className="grid grid-cols-3 gap-3 mt-1.5">
              <input
                type="text"
                className="pas-field w-full px-4 py-2.5 text-[15px] pas-num"
                placeholder="6281234567890"
                value={deadlinePhone1}
                onChange={(e) => setDeadlinePhone1(e.target.value)}
              />
              <input
                type="text"
                className="pas-field w-full px-4 py-2.5 text-[15px] pas-num"
                placeholder="6280987654321"
                value={deadlinePhone2}
                onChange={(e) => setDeadlinePhone2(e.target.value)}
              />
              <input
                type="text"
                className="pas-field w-full px-4 py-2.5 text-[15px] pas-num"
                placeholder="628111222333"
                value={deadlinePhone3}
                onChange={(e) => setDeadlinePhone3(e.target.value)}
              />
            </div>
            <p className="text-[11px] text-[var(--pas-muted)] mt-1">Format internasional (62...). Kosongkan jika tidak dipakai.</p>
          </label>
        </div>

        <div className="flex gap-3 mt-4">
          <button
            className="pas-btn-accent px-6 py-2.5 text-[13px]"
            disabled={savingDeadline}
            onClick={saveDeadlineSettings}
          >
            {savingDeadline ? "Menyimpan..." : "Simpan Pengaturan"}
          </button>
          <button
            className="pas-btn-ghost px-6 py-2.5 text-[13px]"
            disabled={!deadlineEnabled || savingDeadline}
            onClick={testDeadlineNotif}
          >
            Test Kirim Sekarang
          </button>
        </div>
        <p className="text-[12px] text-[var(--pas-muted)] mt-3">
          Notifikasi akan dikirim otomatis setiap hari pada jam yang ditentukan (hanya jika ada order yang mendekati deadline). Gunakan GitHub Actions atau cron job eksternal untuk menjalankan endpoint.
        </p>
      </div>

      {/* Kapasitas Produksi */}
      <div className="pas-card p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="font-semibold text-[15px]">Kapasitas Produksi</p>
            <p className="text-[12.5px] text-[var(--pas-muted)] mt-1">
              Batas jumlah pcs yang diproses per bulan. Dipakai halaman Laporan untuk menghitung
              utilisasi dan peringatan over kapasitas.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-4 mt-5">
          <label className="block flex-1 min-w-[240px]">
            <span className="text-[13px] text-[var(--pas-muted)]">Kapasitas per Bulan (pcs)</span>
            <input
              type="number"
              min={1}
              step={50}
              className="pas-field w-full px-4 py-2.5 mt-1.5 text-[15px] pas-num"
              value={capacity}
              onChange={(e) => setCapacity(e.target.value)}
            />
            <p className="text-[11px] text-[var(--pas-muted)] mt-1">
              Default {DEFAULT_KAPASITAS.toLocaleString("id-ID")} pcs. Di halaman Laporan, beban
              di atas 85% ditandai hampir penuh dan di atas 100% ditandai over kapasitas.
            </p>
          </label>
          <button
            className="pas-btn-accent px-6 py-2.5 text-[13px]"
            disabled={savingCapacity}
            onClick={saveCapacity}
          >
            {savingCapacity ? "Menyimpan..." : "Simpan Kapasitas"}
          </button>
        </div>
      </div>

      {/* Delete confirmation modal */}
      {confirmDelete !== null && (
        <div className="pas-sheet open">
          <div className="pas-veil" onClick={() => setConfirmDelete(null)} />
          <div className="pas-panel p-5" style={{ maxWidth: 380, margin: "auto" }}>
            <p className="font-semibold text-[15px]">Hapus Tahap?</p>
            <p className="text-[13px] text-[var(--pas-muted)] mt-2">
              Tahap <strong>"{editSteps[confirmDelete]?.name}"</strong> akan dihapus. Pesanan yang sedang berada di tahap ini akan kehilangan referensi tahap.
            </p>
            <div className="flex gap-3 mt-5">
              <button
                className="pas-btn-ghost flex-1 py-2.5 text-[13px]"
                onClick={() => setConfirmDelete(null)}
              >
                Batal
              </button>
              <button
                className="flex-1 py-2.5 text-[13px] font-semibold rounded-xl bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30 transition-colors"
                onClick={confirmRemoveStep}
              >
                Hapus
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   VIEW: NOTIFIKASI
   â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
function ViewNotif({ showToast, orders }: { showToast: (msg: string) => void; orders: OrderData[] }) {
  const [enabled, setEnabled] = useState(false);
  const [time, setTime] = useState("08:00");
  const [days, setDays] = useState("3,2,1");
  const [phone1, setPhone1] = useState("");
  const [phone2, setPhone2] = useState("");
  const [phone3, setPhone3] = useState("");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [isSaved, setIsSaved] = useState(false);
  const [logs, setLogs] = useState<any[]>([]);
  const [cdH, setCdH] = useState("00");
  const [cdM, setCdM] = useState("00");
  const [cdS, setCdS] = useState("00");
  const [cdLabel, setCdLabel] = useState("menghitung...");

  const activePhones = [phone1, phone2, phone3].filter(Boolean);
  const activeDays = days.split(",").map((d) => d.trim()).filter(Boolean);
  const dayLabels: Record<string, string> = { "3": "H-3", "2": "H-2", "1": "H-1", "0": "Hari-H" };

  const deadlinesMonitored = orders.filter((o) => {
    if (!o.deadline) return false;
    const diff = Math.ceil((new Date(o.deadline).getTime() - Date.now()) / 86400000);
    return diff >= 0 && diff <= Math.max(...activeDays.map(Number), 0);
  }).length;

  // Order yang sudah melewati deadline. Sengaja memakai deadlineStatus() yang
  // sama dengan ViewPesanan supaya angka di tab ini tidak pernah berbeda
  // dengan KPI "Deadline" di tab Pesanan.
  const overdueOrders = orders
    .filter((o) => !o.is_done && o.deadline)
    .map((o) => ({ order: o, dl: deadlineStatus(o.deadline, false) }))
    .filter((x) => x.dl.level === "overdue");
  const worstOverdue = overdueOrders.reduce<{ id: string; days: number } | null>((worst, x) => {
    const days = Math.abs(x.dl.diffDays);
    return !worst || days > worst.days ? { id: x.order.id, days } : worst;
  }, null);
  const hasOverdue = overdueOrders.length > 0;

  useEffect(() => {
    fetch("/api/admin/settings/deadline-notif")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d) {
          setEnabled(d.enabled ?? false);
          setTime(d.time ?? "08:00");
          setDays(d.days ?? "3,2,1");
          const ph = (d.phones ?? "").split(",").map((p: string) => p.trim());
          setPhone1(ph[0] || "");
          setPhone2(ph[1] || "");
          setPhone3(ph[2] || "");
          setIsSaved(true);
        }
      })
      .catch(() => {});
  }, []);

  const fetchLogs = useCallback(() => {
    fetch("/api/admin/notif-logs?limit=50")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d?.logs) setLogs(d.logs); })
      .catch(() => {});
  }, []);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  useEffect(() => {
    let prev = "";
    function tick() {
      const now = new Date();
      const wibMs = now.getTime() + (now.getTimezoneOffset() + 420) * 60000;
      const wib = new Date(wibMs);
      const [cfgH, cfgM] = time.split(":").map(Number);
      const target = new Date(wib);
      target.setHours(cfgH, cfgM, 0, 0);
      if (target <= wib) target.setDate(target.getDate() + 1);
      const diffSec = Math.max(0, Math.floor((target.getTime() - wib.getTime()) / 1000));
      const hh = String(Math.floor(diffSec / 3600)).padStart(2, "0");
      const mm = String(Math.floor((diffSec % 3600) / 60)).padStart(2, "0");
      const ss = String(diffSec % 60).padStart(2, "0");
      const key = `${hh}:${mm}:${ss}`;
      if (key !== prev) { setCdH(hh); setCdM(mm); setCdS(ss); prev = key; }
      const sameDay = target.toDateString() === wib.toDateString();
      const jam = `${String(cfgH).padStart(2, "0")}:${String(cfgM).padStart(2, "0")}`;
      setCdLabel(`kirim ${sameDay ? "hari ini" : "besok"} pukul ${jam} WIB`);
    }
    tick();
    const iv = setInterval(tick, 1000);
    return () => clearInterval(iv);
  }, [time]);

  const toggleDay = (v: string) => {
    const next = activeDays.includes(v)
      ? activeDays.filter((d) => d !== v)
      : [...activeDays, v].sort((a, b) => Number(b) - Number(a));
    setDays(next.join(","));
  };

  // return true kalau settings benar-benar tersimpan ke database
  const saveSettings = async (enabledValue?: boolean): Promise<boolean> => {
    const nextEnabled = enabledValue ?? enabled;
    setSaving(true);
    try {
      const res = await fetch("/api/admin/settings/deadline-notif", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: nextEnabled, time, days, phones: activePhones.join(",") }),
      });
      const data = await res.json();
      if (!res.ok) { showToast(data.error || "Gagal menyimpan"); return false; }
      setEnabled(nextEnabled);
      showToast("Pengaturan tersimpan");
      setIsSaved(true);
      return true;
    } catch { showToast("Gagal menyimpan"); return false; }
    finally { setSaving(false); }
  };

  /**
   * Switch harus ikut tersimpan, bukan cuma state lokal.
   * Dulu onClick-nya cuma setEnabled(!enabled), jadi setelah refresh notifikasi
   * balik "off" dan tombol "Test kirim" (disabled={!enabled}) ikut mati.
   * Mode edit (isSaved=false) dibiarkan: perubahan lain masih belum tersimpan,
   * biar tombol "Simpan pengaturan" yang mem-*commit* semuanya sekaligus.
   */
  const toggleEnabled = async () => {
    const next = !enabled;
    setEnabled(next);
    if (!isSaved) return;
    const ok = await saveSettings(next);
    if (!ok) setEnabled(!next); // gagal simpan → kembalikan tampilan switch
  };

  const testNotif = async () => {
    if (activePhones.length === 0) { showToast("Isi nomor HP admin terlebih dahulu"); return; }
    setTesting(true);
    try {
      const res = await fetch("/api/admin/deadline-notif", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-from-dashboard": "true", "x-override-phones": activePhones.join(",") },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) { showToast(data.error || data.message || "Gagal mengirim"); return; }
      const sent = data.results?.filter((r: any) => r.status === "sent").length ?? data.total_orders ?? 0;
      if (sent === 0) showToast(data.message || "Tidak ada order yang mendekati deadline untuk dikirim");
      else showToast(`Terkirim ke ${sent} nomor`);
      fetchLogs();
    } catch { showToast("Gagal mengirim"); }
    finally { setTesting(false); }
  };

  return (
    <>
      {/* â”€â”€ CSS VARS (cream design system) â”€â”€ */}
      <style>{`
        .notif-wrap{--cream:#F5EFE3;--cream-2:#EDEDE8;--paper:#FFFFFF;--ink:#0A0A0A;--ink-2:#3A3A36;--ink-soft:#8A8A85;--line:#E4E4DF;--line-2:#F0EBE0;--green:#0A0A0A;--green-2:#E84A12;--accent:#E84A12;--mint:#FFE9DF;--mint-line:#F6D9C9;--danger:#E84A12;--danger-bg:#FFE9DF;--danger-line:#F6D9C9}
        .notif-wrap .n-card{background:var(--paper);border:1px solid var(--line);border-radius:22px;box-shadow:0 1px 1px rgba(10, 10, 10,.03),0 22px 44px -32px rgba(10, 10, 10,.28)}
        .notif-wrap .n-eyebrow{font-size:10.5px;text-transform:uppercase;letter-spacing:.2em;color:var(--ink-soft);font-family:var(--font-geist-mono),ui-monospace,monospace}
        .notif-wrap .n-hero{position:relative;overflow:hidden;border-radius:26px;background:linear-gradient(145deg,#141414 0%,#7A2A1C 52%,#E84A12 100%);box-shadow:0 30px 70px -40px rgba(10, 10, 10,.75),inset 0 1px 0 rgba(255,255,255,.1)}
        .notif-wrap .n-hero-glow{position:absolute;inset:auto -8% 40% auto;width:520px;height:520px;background:radial-gradient(circle,rgba(255,246,214),.20),transparent 62%);pointer-events:none}
        .notif-wrap .n-hero-grid{position:absolute;inset:0;pointer-events:none;background-image:linear-gradient(rgba(255,255,255,.045) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.045) 1px,transparent 1px);background-size:100% 36px,36px 100%;mask-image:radial-gradient(120% 90% at 70% 0%,#000 25%,transparent 75%)}
        .notif-wrap .n-stat{border:1px solid var(--line);border-radius:18px;background:linear-gradient(180deg,#fff,#FBF8F2);padding:18px 18px 16px;transition:transform .22s ease,box-shadow .22s ease}
        .notif-wrap .n-stat:hover{transform:translateY(-2px);box-shadow:0 18px 34px -26px rgba(10, 10, 10,.32)}
        .notif-wrap .n-field{width:100%;background:#FBF8F2;border:1px solid var(--line);border-radius:14px;padding:22px 14px 9px;font-size:15px;color:var(--ink);transition:border-color .18s ease,box-shadow .18s ease,background .18s ease;font-family:var(--font-geist),system-ui,sans-serif}
        .notif-wrap .n-field:focus{outline:none;background:#fff;border-color:var(--accent);box-shadow:0 0 0 4px rgba(232, 74, 18,.16)}
        .notif-wrap .n-fw{position:relative}
        .notif-wrap .n-fw label{position:absolute;left:14px;top:8px;font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--ink-soft);pointer-events:none;transition:color .18s ease;font-family:var(--font-geist-mono),ui-monospace,monospace}
        .notif-wrap .n-fw .n-field:focus + label{color:var(--accent)}
        .notif-wrap .n-chip{position:relative;border:1px solid var(--line);background:#FBF8F2;color:var(--ink-2);border-radius:12px;padding:10px 16px;font-size:13px;font-weight:600;cursor:pointer;transition:all .18s cubic-bezier(.2,.85,.25,1);font-family:var(--font-geist-mono),ui-monospace,monospace}
        .notif-wrap .n-chip:hover{transform:translateY(-1px);border-color:#E4E4DF}
        .notif-wrap .n-chip.on{background:var(--green);border-color:var(--green);color:#EDEDE8;box-shadow:0 8px 18px -12px rgba(10, 10, 10,.7)}
        .notif-wrap .n-btn{border-radius:13px;font-size:14px;font-weight:600;transition:transform .16s ease,background .2s ease,box-shadow .2s ease;font-family:var(--font-geist),system-ui,sans-serif}
        .notif-wrap .n-btn-primary{background:var(--green);color:#EDEDE8;box-shadow:0 12px 26px -16px rgba(10, 10, 10,.85)}
        .notif-wrap .n-btn-primary:hover{background:var(--green-2);transform:translateY(-1px)}
        .notif-wrap .n-btn-ghost{background:#fff;color:var(--ink);border:1px solid var(--line);font-weight:500}
        .notif-wrap .n-btn-ghost:hover{background:var(--cream-2);border-color:#E4E4DF}
        .notif-wrap .n-divider{height:1px;background:linear-gradient(90deg,transparent,var(--line),transparent)}
        .notif-wrap .n-dt{position:relative;min-width:72px;padding:12px 4px 10px;border-radius:14px;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.14);backdrop-filter:blur(6px);text-align:center;overflow:hidden}
        .notif-wrap .n-dt::before{content:"";position:absolute;inset:0 0 auto 0;height:1px;background:linear-gradient(90deg,transparent,rgba(255,255,255,.45),transparent)}
        .notif-wrap .n-dt b{display:block;font-family:var(--font-geist-mono),monospace;font-size:38px;line-height:1;font-weight:700;color:#fff;font-variant-numeric:tabular-nums}
        .notif-wrap .n-dt i{display:block;margin-top:7px;font-style:normal;font-size:9.5px;letter-spacing:.18em;text-transform:uppercase;color:rgba(255,255,255,.5)}
        .notif-wrap .n-colon{align-self:center;font-family:var(--font-geist-mono),monospace;font-size:26px;color:rgba(255,255,255,.3);padding-bottom:14px}
        .notif-wrap .n-pulse{width:7px;height:7px;border-radius:999px;background:#FFC79E;box-shadow:0 0 0 0 rgba(255,229,0,.7);animation:npulse 2.2s infinite}
        @keyframes npulse{0%{box-shadow:0 0 0 0 rgba(255,229,0,.55)}70%{box-shadow:0 0 0 11px rgba(255,229,0,0)}100%{box-shadow:0 0 0 0 rgba(255,229,0,0)}}
        .notif-wrap .n-switch{width:50px;height:28px;border-radius:999px;background:rgba(255,255,255,.22);position:relative;cursor:pointer;flex:none;transition:background .24s ease;border:1px solid rgba(255,255,255,.2)}
        .notif-wrap .n-switch.on{background:#FF5A1F;border-color:rgba(255,255,255,.35)}
        .notif-wrap .n-switch span{position:absolute;top:3px;left:3px;width:20px;height:20px;border-radius:999px;background:#fff;box-shadow:0 2px 6px rgba(0,0,0,.28);transition:transform .26s cubic-bezier(.2,.85,.25,1)}
        .notif-wrap .n-switch.on span{transform:translateX(22px)}
      `}</style>

      <div className="notif-wrap">
        {/* â”€â”€ INTRO â”€â”€ */}
        <div className="max-w-2xl">
          <span
            className="n-eyebrow inline-flex items-center gap-2 rounded-full px-3 py-1"
            style={
              hasOverdue
                ? { background: "var(--danger-bg)", border: "1px solid var(--danger-line)", color: "var(--danger)" }
                : { background: "var(--mint)", border: "1px solid var(--mint-line)", color: "var(--green)" }
            }
          >
            {hasOverdue ? (
              <i style={{ display: "inline-block", width: 7, height: 7, borderRadius: 999, background: "var(--danger)" }} />
            ) : (
              <i className="n-pulse" />
            )}
            {hasOverdue ? "Perlu tindakan" : "Sistem berjalan"}
          </span>
          <h2 className="mt-5 text-[36px] leading-[1.04] sm:text-[50px]" style={{ fontFamily: 'var(--font-geist),system-ui,sans-serif', fontWeight: 600, letterSpacing: "-.038em", color: "var(--ink)" }}>
            {hasOverdue ? (
              <>{overdueOrders.length} deadline<br /><span style={{ color: "var(--danger)" }}>sudah terlewat.</span></>
            ) : (
              <>Tidak ada deadline<br /><span style={{ color: "var(--accent)" }}>yang terlewat.</span></>
            )}
          </h2>
          <p className="mt-4 max-w-lg text-[15px] leading-relaxed" style={{ color: "var(--ink-2)" }}>
            {hasOverdue && worstOverdue
              ? `Paling lama ${worstOverdue.days} hari — ${worstOverdue.id}. Cek tab Pesanan untuk detailnya.`
              : "Sistem otomatis mengingatkan admin lewat WhatsApp sesuai jadwal produksi, mulai dari H-3, H-2, hingga H-1 sebelum deadline."}
          </p>
        </div>

        {/* â”€â”€ HERO / COUNTDOWN â”€â”€ */}
        <section className="n-hero mt-10 px-7 py-8 sm:px-10 sm:py-10">
          <div className="n-hero-glow" />
          <div className="n-hero-grid" />
          <div className="relative grid gap-9 lg:grid-cols-[1fr_auto] lg:items-center">
            <div>
              <div className="flex items-start gap-4">
                <button className={`n-switch mt-0.5 ${enabled ? "on" : ""}`} onClick={toggleEnabled} disabled={saving} aria-label="Aktifkan notifikasi deadline"><span /></button>
                <div>
                  <p className="text-[20px] font-semibold text-white" style={{ fontFamily: 'var(--font-geist),system-ui,sans-serif' }}>Notifikasi Deadline</p>
                  <p className="mt-1.5 flex items-center gap-2 text-[13px]" style={{ color: "rgba(255,255,255,.7)" }}>
                    {enabled ? <><i className="n-pulse" /> Aktif - pengingat deadline berjalan otomatis</> : <><i style={{ display: "inline-block", width: 7, height: 7, borderRadius: 999, background: "rgba(255,255,255,.4)" }} /> Nonaktif - tidak ada pengiriman</>}
                  </p>
                </div>
              </div>
              <div className="mt-7 flex flex-wrap items-start gap-x-9 gap-y-4">
                <div>
                  <p className="n-eyebrow" style={{ color: "rgba(255,255,255,.5)" }}>Jadwal kirim</p>
                  <p className="mt-1 text-[13px] text-white" style={{ fontFamily: 'var(--font-geist-mono),monospace' }}>{time} WIB</p>
                </div>
                <div>
                  <p className="n-eyebrow" style={{ color: "rgba(255,255,255,.5)" }}>Penerima</p>
                  <p className="mt-1 text-[13px] text-white" style={{ fontFamily: 'var(--font-geist-mono),monospace' }}>{activePhones.length} admin</p>
                </div>
                <div>
                  <p className="n-eyebrow" style={{ color: "rgba(255,255,255,.5)" }}>Hari reminder</p>
                  <p className="mt-1 text-[13px] text-white" style={{ fontFamily: 'var(--font-geist-mono),monospace' }}>{activeDays.length ? activeDays.map((d) => dayLabels[d] || d).join(", ") : "belum dipilih"}</p>
                </div>
              </div>
            </div>
            <div className="lg:text-right">
              <p className="n-eyebrow mb-3" style={{ color: "rgba(255,255,255,.5)" }}>Notifikasi berikutnya</p>
              <div className="flex items-stretch gap-2">
                <div className="n-dt"><b>{cdH}</b><i>Jam</i></div>
                <div className="n-colon">:</div>
                <div className="n-dt"><b>{cdM}</b><i>Menit</i></div>
                <div className="n-colon">:</div>
                <div className="n-dt"><b>{cdS}</b><i>Detik</i></div>
              </div>
              <p className="mt-3.5 text-[12.5px]" style={{ fontFamily: 'var(--font-geist-mono),monospace', color: "#FFD9C2" }}>{cdLabel}</p>
            </div>
          </div>
        </section>

        {/* â”€â”€ STATS â”€â”€ */}
        <section className="mt-6 grid gap-4 sm:grid-cols-3">
          <div className="n-stat">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="n-eyebrow">Notifikasi terkirim</p>
                <p className="mt-1 text-[12px]" style={{ color: "var(--ink-soft)" }}>30 hari terakhir</p>
              </div>
              <span className="grid h-8 w-8 place-items-center rounded-[10px]" style={{ background: "var(--mint)", border: "1px solid var(--mint-line)" }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#E84A12" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="m22 2-7 20-4-9-9-4Z" /><path d="M22 2 11 13" /></svg>
              </span>
            </div>
            <p className="mt-4" style={{ fontFamily: 'var(--font-geist-mono),monospace', fontSize: 27, fontWeight: 700, letterSpacing: "-.02em" }}>
              {logs.length} <span className="text-[13px] font-medium" style={{ color: "var(--ink-soft)" }}>pesan</span>
            </p>
            <p className="mt-2 text-[12.5px]" style={{ color: "var(--ink-soft)" }}>
              {logs.length === 0 ? "Belum ada pengingat yang dikirim ke admin." : `${logs.filter((l) => l.status === "sent").length} berhasil, ${logs.filter((l) => l.status === "failed").length} gagal.`}
            </p>
          </div>
          <div className="n-stat">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="n-eyebrow">Deadline dipantau</p>
                <p className="mt-1 text-[12px]" style={{ color: "var(--ink-soft)" }}>masih berjalan</p>
              </div>
              <span className="grid h-8 w-8 place-items-center rounded-[10px]" style={{ background: "var(--mint)", border: "1px solid var(--mint-line)" }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#E84A12" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="17" rx="2.5" /><path d="M8 2v4M16 2v4M3 10h18" /></svg>
              </span>
            </div>
            <p className="mt-4" style={{ fontFamily: 'var(--font-geist-mono),monospace', fontSize: 27, fontWeight: 700, letterSpacing: "-.02em" }}>
              {deadlinesMonitored} <span className="text-[13px] font-medium" style={{ color: "var(--ink-soft)" }}>item</span>
            </p>
            <p className="mt-2 text-[12.5px]" style={{ color: "var(--ink-soft)" }}>
              {deadlinesMonitored === 0 ? "Belum ada deadline yang masuk sistem." : `${deadlinesMonitored} pesanan mendekati deadline.`}
            </p>
          </div>
          <div className="n-stat">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="n-eyebrow">Penerima pengingat</p>
                <p className="mt-1 text-[12px]" style={{ color: "var(--ink-soft)" }}>admin internal</p>
              </div>
              <span className="grid h-8 w-8 place-items-center rounded-[10px]" style={{ background: "var(--mint)", border: "1px solid var(--mint-line)" }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#E84A12" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /></svg>
              </span>
            </div>
            <p className="mt-4" style={{ fontFamily: 'var(--font-geist-mono),monospace', fontSize: 27, fontWeight: 700, letterSpacing: "-.02em" }}>
              {activePhones.length} <span className="text-[13px] font-medium" style={{ color: "var(--ink-soft)" }}>nomor</span>
            </p>
            <p className="mt-2 text-[12.5px]" style={{ color: "var(--ink-soft)" }}>
              {activeDays.length ? `Aktif di ${activeDays.length} tahap: ${activeDays.map((d) => dayLabels[d] || d).join(", ")}.` : "Belum ada nomor aktif."}
            </p>
          </div>
        </section>

        {/* â”€â”€ SETTINGS â”€â”€ */}
        <section className="n-card mt-6 p-7 sm:p-9" style={{ background: "linear-gradient(180deg,#fff,#FBF8F2)" }}>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="n-eyebrow">Konfigurasi</p>
              <h3 className="mt-1.5 text-[19px] font-semibold" style={{ color: "var(--ink)" }}>Pengaturan pengiriman</h3>
            </div>
            <span className="rounded-full px-3 py-1 text-[11.5px]" style={{ fontFamily: 'var(--font-geist-mono),monospace', background: "var(--cream-2)", border: "1px solid var(--line-2)", color: "var(--ink-soft)" }}>Asia/Jakarta - WIB</span>
          </div>
          <div className="n-divider my-7" />
          <div className="grid gap-8 md:grid-cols-2">
            <div>
              <div className="n-fw">
                <input type="time" value={time} onChange={(e) => setTime(e.target.value)} disabled={isSaved} className="n-field" style={{ fontFamily: 'var(--font-geist-mono),monospace', fontSize: 17 }} />
                <label>Jam kirim</label>
              </div>
              <p className="mt-2.5 text-[12.5px]" style={{ color: "var(--ink-soft)" }}>Pengingat dikirim setiap hari pada jam ini.</p>
            </div>
            <div>
              <p className="n-eyebrow">Hari reminder</p>
              <div className="mt-3 flex flex-wrap gap-2.5">
                {(["3", "2", "1", "0"] as const).map((v) => (
                  <button key={v} className={`n-chip ${activeDays.includes(v) ? "on" : ""}`} onClick={() => toggleDay(v)} disabled={isSaved}>
                    {dayLabels[v]}
                  </button>
                ))}
              </div>
              <p className="mt-3 text-[12.5px]" style={{ color: "var(--ink-soft)" }}>Pilih berapa hari sebelum deadline pengingat dikirim.</p>
            </div>
          </div>
          <div className="n-divider my-8" />
          <div>
            <div className="flex items-center justify-between">
              <p className="n-eyebrow">Nomor HP admin</p>
              <span className="text-[12px]" style={{ color: "var(--ink-soft)" }}>Format 62...</span>
            </div>
            <div className="mt-3 grid gap-3 md:grid-cols-3">
              <div className="n-fw"><input className="n-field" style={{ fontFamily: 'var(--font-geist-mono),monospace' }} value={phone1} onChange={(e) => setPhone1(e.target.value)} disabled={isSaved} placeholder="6281234567890" /><label>Admin 1</label></div>
              <div className="n-fw"><input className="n-field" style={{ fontFamily: 'var(--font-geist-mono),monospace' }} value={phone2} onChange={(e) => setPhone2(e.target.value)} disabled={isSaved} placeholder="6280987654321" /><label>Admin 2</label></div>
              <div className="n-fw"><input className="n-field" style={{ fontFamily: 'var(--font-geist-mono),monospace' }} value={phone3} onChange={(e) => setPhone3(e.target.value)} disabled={isSaved} placeholder="628111222333" /><label>Admin 3</label></div>
            </div>
          </div>
          <div className="mt-9 flex flex-wrap items-center gap-3">
            <button
              className="n-btn n-btn-primary px-6 py-3.5 transition-all duration-200"
              disabled={saving}
              onClick={() => {
                if (isSaved) {
                  setIsSaved(false);
                } else {
                  saveSettings();
                }
              }}
            >
              {saving ? "Menyimpan..." : isSaved ? "Edit" : "Simpan pengaturan"}
            </button>
            <button className="n-btn n-btn-ghost px-6 py-3.5" disabled={!enabled || testing} onClick={testNotif}>
              {testing ? "Mengirim..." : "Test kirim sekarang"}
            </button>
            <span className="ml-auto text-[12px]" style={{ fontFamily: 'var(--font-geist-mono),monospace', color: "var(--ink-soft)" }}>
              {isSaved ? "✔ Pengaturan tersimpan" : "Belum disimpan"}
            </span>
          </div>
        </section>

        {/* â”€â”€ HISTORY â”€â”€ */}
        <section className="n-card mt-6 p-7 sm:p-9">
          <div className="flex items-center justify-between">
            <div>
              <p className="n-eyebrow">Log</p>
              <h3 className="mt-1.5 text-[19px] font-semibold" style={{ color: "var(--ink)" }}>Riwayat kirim</h3>
            </div>
            <span className="rounded-full px-3 py-1 text-[12px]" style={{ fontFamily: 'var(--font-geist-mono),monospace', background: "var(--mint)", border: "1px solid var(--mint-line)", color: "var(--green)" }}>{logs.length} entri</span>
          </div>
          <div className="n-divider my-7" />
          {logs.length === 0 ? (
            <div className="grid place-items-center py-16 text-center">
              <div className="grid h-14 w-14 place-items-center rounded-2xl" style={{ background: "var(--cream-2)", border: "1px solid var(--line-2)" }}>
                <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="#8A8A85" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M12 8v4l3 2" /><circle cx="12" cy="12" r="9" /></svg>
              </div>
              <p className="mt-4 text-[15px] font-semibold" style={{ color: "var(--ink)" }}>Belum ada pengiriman</p>
              <p className="mt-1.5 max-w-sm text-[13px] leading-relaxed" style={{ color: "var(--ink-soft)" }}>Setelah notifikasi pertama terkirim, waktu, penerima, dan statusnya akan tercatat di sini.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b" style={{ borderColor: "var(--line)" }}>
                    <th className="pb-2 n-eyebrow">Status</th>
                    <th className="pb-2 n-eyebrow">Waktu</th>
                    <th className="pb-2 n-eyebrow">Order</th>
                    <th className="pb-2 n-eyebrow">Tipe</th>
                    <th className="pb-2 n-eyebrow">HP</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log) => (
                    <tr key={log.id} className="border-b transition-colors" style={{ borderColor: "var(--line-2)" }}>
                      <td className="py-2.5">
                        {log.status === "sent" ? (
                          <span className="inline-flex items-center gap-1 text-[12px]" style={{ color: "var(--accent)" }}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
                            Sukses
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[12px]" style={{ color: "#E84A12" }}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" /></svg>
                            Gagal
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 text-[13px]" style={{ color: "var(--ink-2)" }}>
                        {formatDayMonthID(log.created_at)}{" "}
                        {formatTimeID(log.created_at)}
                      </td>
                      <td className="py-2.5 text-[13px] font-semibold" style={{ color: "var(--ink)", fontFamily: 'var(--font-geist-mono),monospace' }}>{log.order_number || "-"}</td>
                      <td className="py-2.5 text-[12px]" style={{ color: "var(--ink-soft)" }}>
                        {log.diff_days === 0 ? "H-0" : `H-${log.diff_days}`}
                      </td>
                      <td className="py-2.5 text-[12px]" style={{ color: "var(--ink-soft)", fontFamily: 'var(--font-geist-mono),monospace' }}>{log.phone}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <p className="mt-10 text-center text-[12px]" style={{ color: "var(--ink-soft)" }}>Notifikasi diteruskan via WhatsApp - zona waktu Asia/Jakarta</p>
      </div>
    </>
  );
}

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   DETAIL SHEET
   â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
function DetailSheet({
  orderId,
  orders,
  onClose,
  onSaved,
  onToast,
  steps,
}: {
  orderId: string;
  orders: OrderData[];
  onClose: () => void;
  onSaved: (msg: string) => void;
  onToast: (msg: string) => void;
  steps: StepRow[];
}) {
  const order = orders.find((o) => o.id === orderId);
  const [step, setStep] = useState(order?.current_step ?? 1);
  const [note, setNote] = useState(order?.note || "");
  const [courier, setCourier] = useState(order?.courier || "");
  const [resi, setResi] = useState(order?.tracking_number || "");
  const [deadline, setDeadline] = useState(order?.deadline ? order.deadline.slice(0, 10) : "");
  const [editCreatedAt, setEditCreatedAt] = useState(order?.created_at ? order.created_at.slice(0, 10) : "");
  const [woPhotos, setWoPhotos] = useState<string[]>(order?.wo_photos || []);
  const [uploadingWo, setUploadingWo] = useState(false);
  const [saving, setSaving] = useState(false);
  const [resending, setResending] = useState(false);
  const [kirimError, setKirimError] = useState("");
  const [editProductRows, setEditProductRows] = useState<{ product: string; custom: boolean; qty: string }[]>(() => {
    const initProducts = order?.products;
    if (initProducts && initProducts.length > 0) {
      return initProducts.map((p: any) => ({ product: p.name || "", custom: false, qty: String(p.sizes?.reduce((a: number, s: any) => a + (s.qty || 0), 0) || "") }));
    }
    const qtyNum = order?.quantity ? String(order.quantity).replace(/\D/g, "") : "";
    return [{ product: order?.product_name || "", custom: false, qty: qtyNum }];
  });
  const [zoomUrl, setZoomUrl] = useState<string | null>(null);
  const [zoomOpen, setZoomOpen] = useState(false);
  const [zoomScale, setZoomScale] = useState(1);
  const [zoomOffset, setZoomOffset] = useState({ x: 0, y: 0 });
  const zoomPinchRef = useRef<{ d: number; s: number } | null>(null);
  const zoomDragRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!zoomUrl) return;
    setZoomOpen(true);
    setZoomScale(1);
    setZoomOffset({ x: 0, y: 0 });
  }, [zoomUrl]);
  useEffect(() => {
    if (!zoomUrl) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setZoomUrl(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoomUrl]);
  useEffect(() => {
    if (!zoomUrl) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [zoomUrl]);

  useEffect(() => {
    if (order) {
      setStep(order.current_step);
      setNote(order.note || "");
      setCourier(order.courier || "");
      setResi(order.tracking_number || "");
      setDeadline(order.deadline ? order.deadline.slice(0, 10) : "");
      setEditCreatedAt(order.created_at ? order.created_at.slice(0, 10) : "");
      setWoPhotos(order.wo_photos || []);
      const prods = order.products;
      if (prods && prods.length > 0) setEditProductRows(prods.map((p: any) => ({ product: p.name || "", custom: false, qty: String(p.sizes?.reduce((a: number, s: any) => a + (s.qty || 0), 0) || "") })));
      else setEditProductRows([{ product: order.product_name || "", custom: false, qty: String(order.quantity || "").replace(/\D/g, "") }]);
    }
  }, [order]);
  const updateEditRow = (idx: number, patch: Partial<typeof editProductRows[0]>) => setEditProductRows((rows) => rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)));

  const handleWoUpload = async (file: File) => {
    if (!file.type.startsWith("image/")) { setKirimError("File harus gambar"); return; }
    if (file.size > 10 * 1024 * 1024) { setKirimError("Maksimal 10MB"); return; }
    setUploadingWo(true);
    setKirimError("");
    try {
      const result = await uploadToCloudinary(file);
      setWoPhotos((prev) => [...prev, optimizeImageUrl(result.url)]);
    } catch (e) { console.error("[Detail WO] exception", e); setKirimError(e instanceof Error ? e.message : "Upload gagal"); } finally { setUploadingWo(false); }
  };

  if (!order) return null;

  const hasTracking = !!(courier && resi);
  const st =
    order.is_done
      ? "selesai"
      : step >= 11
        ? "kirim"
        : step <= 1
          ? "baru"
          : "produksi";

  const pct = getProgress(step, hasTracking);

  const save = async () => {
    setKirimError("");
    const validEditRows = editProductRows.filter((p) => p.product.trim() && p.qty.trim());
    if (validEditRows.length === 0) {
      setKirimError("Isi minimal 1 produk & qty.");
      return;
    }
    setSaving(true);
    try {
      const editProducts = validEditRows.map((p) => ({ name: p.product.trim(), sizes: [{ size: "ALL", qty: parseInt(p.qty, 10) || 0 }] }));
      const editTotalPcs = editProducts.reduce((a, p) => a + p.sizes.reduce((x, s) => x + s.qty, 0), 0);
      const editCombinedNames = editProducts.map((p) => p.name).join(", ");
      const editCombinedSizes = editProducts.flatMap((p) => p.sizes.map((s) => `${p.name}/${s.size}(${s.qty})`)).join(", ");
      const res = await fetch(`/api/pesanan/orders/${order.id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          current_step: step,
          // Admin memilih tahap lebih rendah dari order yang sudah Selesai = sengaja
          // dibuka ulang, pakai escape hatch `reopen` yang sudah ada di API.
          reopen: order.is_done && step < 11 ? true : undefined,
          note,
          courier,
          tracking_number: resi,
          deadline: deadline || undefined,
          wo_photos: woPhotos,
          products: editProducts,
          product_name: editCombinedNames,
          quantity: String(editTotalPcs),
          sizes: editCombinedSizes,
          created_at: editCreatedAt ? new Date(editCreatedAt).toISOString() : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setKirimError(data.error || "Gagal menyimpan");
        return;
      }
      onSaved(`Perubahan tersimpan${waNote(data?.notification?.status)}`);
    } catch {
      onSaved("Gagal menyimpan");
    } finally {
      setSaving(false);
    }
  };

  /**
   * Kirim ulang notifikasi WA untuk tahap yang sedang tampil — TANPA mengubah
   * data order. Endpoint status hanya memicu notifikasi saat tahap berubah,
   * jadi notifikasi yang gagal butuh jalur ini (lihat
   * app/api/pesanan/orders/[id]/notify/route.ts).
   */
  const resendNotify = async () => {
    if (!order || resending) return;
    setResending(true);
    try {
      const res = await fetch(`/api/pesanan/orders/${order.id}/notify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage: step }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        onToast(data?.error || "Gagal kirim notifikasi");
        return;
      }
      onToast(`Kirim ulang notifikasi${waNote(data?.notification?.status)}`);
    } catch {
      onToast("Gagal kirim notifikasi");
    } finally {
      setResending(false);
    }
  };

  const markDone = async () => {
    setKirimError("");
    setSaving(true);
    try {
      const res = await fetch(`/api/pesanan/orders/${order.id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          current_step: 11,
          is_done: true,
          note,
          courier,
          tracking_number: resi,
          wo_photos: woPhotos,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setKirimError(data.error || "Gagal menyimpan");
        return;
      }
      onSaved(`Pesanan ditandai selesai${waNote(data?.notification?.status)}`);
    } catch {
      onSaved("Gagal menyimpan");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="pas-sheet open">
      <div className="pas-veil" onClick={onClose} />
      {/* Jangan pakai height:100% - di layar <=640px .pas-panel di-set top:8%,
          height:100% bikin panel kepanjangan 8% ke bawah sehingga footer tombol
          Simpan/Selesai keluar dari layar dan tak bisa di-scroll. Biarkan top+bottom
          CSS yang menentukan tinggi panel. */}
      <div className="pas-panel p-0" style={{ display: "flex", flexDirection: "column" }}>
        {/* ── TOPBAR ── */}
        <div className="sticky top-0 z-10 flex items-center gap-3 px-5 py-3.5 border-b border-[var(--pas-line)]" style={{ background: "rgba(245,245,244,.85)", backdropFilter: "blur(14px)", WebkitBackdropFilter: "blur(14px)" }}>
          <button className="w-9 h-9 rounded-[10px] border border-[var(--pas-line)] bg-[var(--pas-surface)] grid place-items-center text-[var(--pas-muted)] hover:text-[var(--pas-ink-1)] hover:border-[rgba(10, 10, 10,.22)] transition shrink-0" onClick={onClose} aria-label="Kembali">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
          </button>
          <div className="min-w-0 flex-1">
            <div className="pas-display text-[16px] leading-tight">Detail Pesanan</div>
            <div className="text-[12px] text-[var(--pas-muted)] pas-num mt-0.5">{order.id}</div>
          </div>
          <span className={`pas-pill ${st} text-[11px]`}>{FILTER_LABEL[st]}</span>
          <button
            className="w-9 h-9 rounded-[10px] border border-[var(--pas-line)] bg-[var(--pas-surface)] grid place-items-center text-[var(--pas-muted)] hover:text-[var(--pas-accent)] hover:border-[rgba(10, 10, 10,.22)] transition shrink-0 disabled:opacity-50"
            onClick={resendNotify}
            disabled={resending}
            title="Kirim ulang notifikasi WA tahap ini"
            aria-label="Kirim ulang notifikasi WA"
          >
            {resending ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" className="animate-spin"><path d="M21 12a9 9 0 1 1-3.2-6.9" /></svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 2 11 13" /><path d="M22 2l-7 20-4-9-9-4 20-7z" /></svg>
            )}
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 pt-5 pb-28" style={{ scrollbarColor: "var(--pas-line) transparent" }}>
          {/* ── STATUS HERO ── */}
          <div className="rounded-2xl border border-[var(--pas-line)] bg-[var(--pas-surface)] shadow-[0_1px_3px_rgba(0,0,0,.04),0_4px_12px_rgba(0,0,0,.04)] p-6 flex flex-col items-center text-center gap-3">
            <div className="w-14 h-14 rounded-full bg-[rgba(232, 74, 18,.12)] grid place-items-center text-[var(--pas-accent)] text-[22px]">
              {order.is_done ? (
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
              ) : (
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
              )}
            </div>
            <div className="pas-display text-[18px] leading-tight">{steps[step - 1]?.name || `Tahap ${step}`}</div>
            <p className="text-[13px] text-[var(--pas-muted)] max-w-[300px] leading-relaxed">
              {order.is_done ? "Pesanan sudah selesai dan diterima oleh customer." : (<><span className="pas-stencil text-[9px] text-[var(--pas-muted)] block">Terakhir Diupdate</span><span className="mt-1 block text-[14px] font-semibold">{formatDateTime(order.note_time)}</span></>)}
            </p>
          </div>

          {/* ── PROGRESS ── */}
          <p className="pas-stencil text-[9px] text-[var(--pas-muted)] mt-6 mb-2">Progress Produksi</p>
          <div className="rounded-2xl border border-[var(--pas-line)] bg-[var(--pas-surface)] shadow-[0_1px_3px_rgba(0,0,0,.04)] p-4">
            <div className="flex items-end justify-between mb-3">
              <div className="pas-display text-[28px] leading-none pas-num text-[var(--pas-accent)]">{pct}%</div>
              <div className="text-[13px] font-semibold text-[var(--pas-ink-2)]">Tahap {step} dari {steps.length}</div>
            </div>
            <div className="h-[6px] rounded-full bg-[rgba(10, 10, 10,.08)] overflow-hidden">
              <div className="h-full rounded-full bg-[var(--pas-accent)]" style={{ width: `${pct}%`, transition: "width .6s cubic-bezier(.22,1,.36,1)" }} />
            </div>
          </div>

          {/* ── TIMELINE STEPPER ── */}
          <p className="pas-stencil text-[9px] text-[var(--pas-muted)] mt-6 mb-2">Timeline Produksi</p>
          <div className="rounded-2xl border border-[var(--pas-line)] bg-[var(--pas-surface)] shadow-[0_1px_3px_rgba(0,0,0,.04)] overflow-hidden">
            <div className="px-4 py-3 border-b border-[var(--pas-line)] flex items-center justify-between">
              <span className="pas-stencil text-[9px] text-[var(--pas-muted)]">Urutan Tahapan</span>
              <span className="pas-stencil text-[9px] text-[var(--pas-muted)] opacity-50">klik untuk ubah</span>
            </div>
            <div className="px-4 py-2">
              {steps.map((s, i) => {
                const isDone = i + 1 < step;
                const isCur = i + 1 === step;
                return (
                  <div key={i} className="flex items-start gap-3.5 relative" style={{ padding: "5px 0" }}>
                    {i < steps.length - 1 && (
                      <div className="absolute left-[10px] top-[25px] bottom-[-5px] w-[2px] rounded-full" style={{ background: isDone ? "var(--pas-accent)" : "var(--pas-line)" }} />
                    )}
                    <button
                      className="flex items-start gap-3.5 w-full text-left bg-transparent border-0 p-0 cursor-pointer"
                      onClick={() => setStep(i + 1)}
                    >
                      <span
                        className="w-[22px] h-[22px] rounded-full grid place-items-center text-[9px] font-bold shrink-0 mt-[1px] transition-all duration-200"
                        style={{
                          background: isDone ? "var(--pas-accent)" : isCur ? "var(--pas-surface)" : "var(--pas-surface)",
                          border: isDone ? "2px solid var(--pas-accent)" : isCur ? "2px solid var(--pas-accent)" : "2px solid var(--pas-line)",
                          color: isDone ? "#fff" : isCur ? "var(--pas-accent)" : "var(--pas-muted)",
                          boxShadow: isDone ? "none" : isCur ? "0 0 0 4px rgba(232, 74, 18,.12)" : "none",
                        }}
                      >
                        {isDone ? "" : i + 1}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className={`text-[13.5px] leading-snug ${isCur ? "font-bold text-[var(--pas-ink-1)]" : isDone ? "font-medium text-[var(--pas-ink-2)]" : "text-[var(--pas-muted)]"}`}>
                          {i + 1}. {s.name}
                        </div>
                        {isDone && <div className="text-[11px] text-[var(--pas-muted)] opacity-70 mt-0.5">Selesai</div>}
                        {isCur && <div className="text-[11px] text-[var(--pas-muted)] opacity-70 mt-0.5">Sedang dikerjakan</div>}
                      </div>
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          {/* ── INFO PESANAN ── */}
          <p className="pas-stencil text-[9px] text-[var(--pas-muted)] mt-6 mb-2">Informasi Pesanan</p>
          <div className="rounded-2xl border border-[var(--pas-line)] bg-[var(--pas-surface)] shadow-[0_1px_3px_rgba(0,0,0,.04)] overflow-hidden">
            <div className="px-4 py-2.5 border-b border-[var(--pas-line)]" style={{ background: "rgba(10, 10, 10,.03)" }}>
              <span className="pas-stencil text-[9px] text-[var(--pas-muted)]">Data Order</span>
            </div>
            <div className="grid grid-cols-2">
              <div className="px-4 py-3 border-b border-r border-[var(--pas-line)]">
                <span className="pas-stencil text-[9px] text-[var(--pas-muted)]">Tanggal Order</span>
                <p className="mt-1 text-[14px] font-semibold">{formatDatePretty(order.created_at)}</p>
              </div>
              <div className="px-4 py-3 border-b border-[var(--pas-line)]">
                <span className="pas-stencil text-[9px] text-[var(--pas-muted)]">Deadline</span>
                <p className="mt-1 text-[14px] font-semibold text-[var(--pas-orange)]">{formatDatePretty(order.deadline || "")}</p>
              </div>
              <div className="px-4 py-3 border-b border-r border-[var(--pas-line)]">
                <span className="pas-stencil text-[9px] text-[var(--pas-muted)]">Status Produksi</span>
                <p className="mt-1 text-[14px] font-semibold">{steps[step - 1]?.name || `Tahap ${step}`}</p>
              </div>
              <div className="px-4 py-3 border-b border-[var(--pas-line)]">
                <span className="pas-stencil text-[9px] text-[var(--pas-muted)]">Progress</span>
                <p className="mt-1 text-[14px] font-semibold">{pct}%</p>
              </div>
              {(order.products?.length ?? 0) > 0 ? (
                <div className="col-span-2 px-4 py-3 border-b border-[var(--pas-line)]">
                  <span className="pas-stencil text-[9px] text-[var(--pas-muted)]">Produk</span>
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {order.products!.map((p, pi) => (
                      <span key={pi} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[12.5px] font-semibold bg-[rgba(10, 10, 10,.06)] border border-[rgba(10, 10, 10,.12)] text-[var(--pas-ink-1)]">
                        {p.name} <span className="text-[var(--pas-muted)] font-normal">- {p.sizes.reduce((a, s) => a + (s.qty || 0), 0)} pcs</span>
                      </span>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="col-span-2 px-4 py-3 border-b border-[var(--pas-line)]">
                  <span className="pas-stencil text-[9px] text-[var(--pas-muted)]">Produk</span>
                  <p className="mt-1 text-[14px] font-semibold">{order.product_name}</p>
                </div>
              )}
              <div className="px-4 py-3 border-b border-r border-[var(--pas-line)]">
                <span className="pas-stencil text-[9px] text-[var(--pas-muted)]">Jumlah</span>
                <p className="mt-1 text-[14px] font-semibold">{order.quantity} pcs</p>
              </div>
              {step === 11 && (courier || resi) ? (
                <div className="px-4 py-3 border-b border-[var(--pas-line)]">
                  <span className="pas-stencil text-[9px] text-[var(--pas-muted)]">Ekspedisi / Resi</span>
                  <p className="mt-1 text-[13px] font-semibold pas-num">{courier || "-"} / {resi || "-"}</p>
                </div>
              ) : (
                <div className="px-4 py-3 border-b border-[var(--pas-line)]">
                  <span className="pas-stencil text-[9px] text-[var(--pas-muted)]">Ekspedisi / Resi</span>
                  <p className="mt-1 text-[13px] text-[var(--pas-muted)]">-</p>
                </div>
              )}
            </div>
          </div>

          {/* ── MEDIA ── */}
          <p className="pas-stencil text-[9px] text-[var(--pas-muted)] mt-6 mb-2">Media</p>
          <div className="rounded-2xl border border-[var(--pas-line)] bg-[var(--pas-surface)] shadow-[0_1px_3px_rgba(0,0,0,.04)] overflow-hidden">
            <div className="px-4 py-2.5 border-b border-[var(--pas-line)]" style={{ background: "rgba(10, 10, 10,.03)" }}>
              <span className="pas-stencil text-[9px] text-[var(--pas-muted)]">File & Foto</span>
            </div>
            <div className="grid grid-cols-2 gap-4 p-4">
              <div>
                <span className="pas-stencil text-[9px] text-[var(--pas-muted)] block mb-2">Preview Design</span>
                <div className="flex flex-wrap gap-2">
                  {(order.design_photos?.length ?? 0) > 0 ? order.design_photos!.map((url, i) => (
                    <button key={i} type="button" onClick={() => setZoomUrl(url)} className="group relative w-[72px] h-[72px] rounded-xl overflow-hidden border border-[var(--pas-line)] hover:border-[var(--pas-accent)] transition" title="Klik untuk memperbesar" aria-label={`Perbesar design ${i + 1}`}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={optimizeImageUrl(url, 320)} loading="lazy" alt={`Design ${i + 1}`} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                      <span className="pointer-events-none absolute right-1 top-1 grid h-5 w-5 place-items-center rounded-full bg-black/55 text-white border border-white/15 opacity-90">
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5M11 8v6M8 11h6" /></svg>
                      </span>
                    </button>
                  )) : <span className="text-[12px] text-[var(--pas-muted)]">Belum ada preview</span>}
                </div>
                <p className="text-[10px] text-[var(--pas-muted)] mt-1.5 opacity-60">Read-only - klik untuk zoom</p>
              </div>
              <div>
                <span className="pas-stencil text-[9px] text-[var(--pas-muted)] block mb-2">WO</span>
                <div className="flex flex-wrap gap-2">
                  {woPhotos.map((url, i) => (
                    <div key={i} className="relative w-[72px] h-[72px] rounded-xl overflow-hidden border border-[var(--pas-line)]">
                      <button type="button" onClick={() => setZoomUrl(url)} className="w-full h-full" title="Klik untuk memperbesar" aria-label={`Perbesar WO ${i + 1}`}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={optimizeImageUrl(url, 320)} loading="lazy" alt={`WO ${i + 1}`} className="w-full h-full object-cover hover:scale-105 transition-transform duration-300" />
                        <span className="pointer-events-none absolute right-1 top-1 grid h-5 w-5 place-items-center rounded-full bg-black/55 text-white border border-white/15 opacity-90">
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5M11 8v6M8 11h6" /></svg>
                        </span>
                      </button>
                    </div>
                  ))}
                  <label className="w-[72px] h-[72px] grid place-items-center rounded-xl border-[1.5px] border-dashed border-[var(--pas-line)] hover:border-[var(--pas-accent)] cursor-pointer transition text-[var(--pas-muted)] hover:text-[var(--pas-accent)] hover:bg-[rgba(10, 10, 10,.04)]">
                    <input type="file" accept={IMAGE_ACCEPT} className="hidden" disabled={uploadingWo} onChange={(e) => { const f = e.target.files?.[0]; if (f) handleWoUpload(f); e.currentTarget.value = ""; }} />
                    <span className="text-[20px] leading-none">{uploadingWo ? "..." : "+"}</span>
                  </label>
                </div>
                <p className="text-[10px] text-[var(--pas-muted)] mt-1.5 opacity-60">Bisa tambah - tidak bisa hapus</p>
              </div>
            </div>
          </div>

          {/* ── CATATAN ── */}
          <p className="pas-stencil text-[9px] text-[var(--pas-muted)] mt-6 mb-2">Catatan untuk Customer</p>
          <div className="rounded-2xl border border-[var(--pas-line)] bg-[var(--pas-surface)] shadow-[0_1px_3px_rgba(0,0,0,.04)] overflow-hidden">
            <textarea
              rows={3}
              className="w-full border-0 px-4 py-3 text-[14px] text-[var(--pas-ink-1)] bg-transparent resize-none focus:outline-none"
              style={{ fontFamily: "inherit" }}
              placeholder="Tulis catatan untuk customer..."
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>

          {/* ── DATA PENGIRIMAN ── */}
          <div className="rounded-2xl border border-[var(--pas-line)] bg-[var(--pas-surface)] shadow-[0_1px_3px_rgba(0,0,0,.04)] p-4 mt-6">
            <p className="pas-stencil text-[9px] text-[var(--pas-muted)]">Data Pengiriman</p>
            <div className="grid grid-cols-2 gap-3 mt-3">
              <input
                className="pas-field px-3 py-2.5 text-[14px]"
                placeholder="Ekspedisi (JNE - REG)"
                value={courier}
                onChange={(e) => setCourier(e.target.value)}
              />
              <input
                className="pas-field px-3 py-2.5 text-[14px]"
                placeholder="No. Resi"
                value={resi}
                onChange={(e) => setResi(e.target.value)}
              />
            </div>
            {step < 9 && (
              <p className="text-[11px] text-[var(--pas-muted)] mt-2 opacity-70">
                Opsional - kalau diisi, nomor resi tampil di halaman tracking customer.
              </p>
            )}
          </div>

          {/* ── TANGGAL DEADLINE ── */}
          <div className="rounded-2xl border border-[var(--pas-line)] bg-[var(--pas-surface)] shadow-[0_1px_3px_rgba(0,0,0,.04)] p-4 mt-4">
            <p className="pas-stencil text-[9px] text-[var(--pas-muted)]">Tanggal Deadline</p>
            <p className="mt-1.5 text-[14px] font-semibold">{formatDatePretty(order.deadline || "")}</p>
          </div>

          {kirimError && (
            <p className="text-[13px] text-red-600 mt-4 bg-red-50 border border-red-200 rounded-xl px-4 py-2.5">
              {kirimError}
            </p>
          )}
        </div>

        {/* ── FOOTER ── */}
        <div className="sticky bottom-0 flex gap-2.5 px-5 py-4 border-t border-[var(--pas-line)]" style={{ background: "linear-gradient(180deg,rgba(245,245,244,0),var(--pas-bg) 30%)" }}>
          <button
            className="flex-1 py-3.5 rounded-[10px] text-[12px] font-bold text-white border-0 cursor-pointer transition-all"
            style={{ fontFamily: "var(--font-display), system-ui, sans-serif", letterSpacing: ".04em", textTransform: "uppercase", background: "var(--pas-accent)", boxShadow: "0 2px 8px rgba(10, 10, 10,.18)" }}
            onClick={save}
            disabled={saving}
          >
            {saving ? "Menyimpan..." : "Simpan Perubahan"}
          </button>
          <button
            className="px-5 py-3.5 rounded-[10px] text-[12px] font-bold border border-[var(--pas-line)] bg-[var(--pas-surface)] text-[var(--pas-ink-1)] cursor-pointer transition-all"
            style={{ fontFamily: "var(--font-display), system-ui, sans-serif", letterSpacing: ".04em", textTransform: "uppercase" }}
            onClick={markDone}
            disabled={saving}
          >
            Tandai Selesai
          </button>
        </div>
      </div>

      {/* ── ZOOM LIGHTBOX ── */}
      {zoomUrl && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm"
          onClick={() => setZoomUrl(null)}
        >
          <button
            className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 text-white grid place-items-center transition"
            onClick={() => setZoomUrl(null)}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={optimizeImageUrl(zoomUrl, 1600)}
            alt="Zoom preview"
            className="max-w-[90vw] max-h-[85vh] object-contain rounded-xl shadow-2xl select-none"
            onClick={(e) => e.stopPropagation()}
            draggable={false}
          />
        </div>
      )}
    </div>
  );
}

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   ADD FORM
   â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
function EditSheet({
  orderId,
  orders,
  onClose,
  onSaved,
}: {
  orderId: string;
  orders: OrderData[];
  onClose: () => void;
  onSaved: (msg: string) => void;
}) {
  const order = orders.find((o) => o.id === orderId);
  const [form, setForm] = useState({
    customer_name: order?.customer_name || "",
    customer_phone: order?.customer_phone || "",
    deadline: order?.deadline ? order.deadline.slice(0, 10) : "",
    created_at: order?.created_at ? order.created_at.slice(0, 10) : "",
  });
  const [productOptions, setProductOptions] = useState<string[]>([...DEFAULT_PRODUCTS]);
  const [designPhotos, setDesignPhotos] = useState<string[]>(order?.design_photos || []);
  const [woPhotos, setWoPhotos] = useState<string[]>(order?.wo_photos || []);
  const [uploadingDesign, setUploadingDesign] = useState(false);
  const [uploadingWo, setUploadingWo] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [productRows, setProductRows] = useState<{ product: string; custom: boolean; qty: string }[]>(() => {
    const prods = order?.products;
    if (prods && prods.length > 0) {
      return prods.map((p: any) => ({
        product: p.name || "",
        custom: false,
        qty: String(p.sizes?.reduce((a: number, s: any) => a + (s.qty || 0), 0) || ""),
      }));
    }
    const qtyNum = order?.quantity ? String(order.quantity).replace(/\D/g, "") : "";
    return [{ product: order?.product_name || "", custom: false, qty: qtyNum }];
  });

  // Opsi = bawaan + produk custom perangkat ini + nama produk order yang sedang
  // dibuka. Tanpa langkah terakhir, <select> tampil kosong kalau produk order itu
  // ditambahkan di perangkat lain (localStorage berbeda).
  useEffect(() => {
    setProductOptions(
      mergeProductOptions([
        ...(order?.products || []).map((p) => p.name),
        order?.product_name,
      ])
    );
  }, [order]);

  const totalQty = productRows.reduce((acc, p) => acc + (parseInt(p.qty, 10) || 0), 0);

  const updateProductRow = (rowIdx: number, patch: Partial<typeof productRows[0]>) =>
    setProductRows((rows) => rows.map((r, i) => (i === rowIdx ? { ...r, ...patch } : r)));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const validRows = productRows.filter((p) => p.product.trim() && p.qty.trim());
    if (!form.customer_name || !form.customer_phone || validRows.length === 0) {
      setError("Isi nama, HP, dan minimal 1 produk dengan jumlahnya.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const products = validRows.map((p) => ({
        name: p.product.trim(),
        sizes: [{ size: "ALL", qty: parseInt(p.qty, 10) || 0 }],
      }));
      const totalPcs = products.reduce((a, p) => a + p.sizes.reduce((x, s) => x + s.qty, 0), 0);
      const combinedNames = products.map((p) => p.name).join(", ");
      const combinedSizes = products.flatMap((p) => p.sizes.map((s) => `${p.name}/${s.size}(${s.qty})`)).join(", ");

      // Simpan produk yang dipakai supaya muncul lagi di pengisian berikutnya
      const usedProducts = validRows.map((p) => p.product.trim());
      if (usedProducts.length > 0) setProductOptions(rememberProducts(usedProducts));

      const res = await fetch(`/api/pesanan/orders/${orderId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customer_name: form.customer_name,
          customer_phone: form.customer_phone,
          product_name: combinedNames,
          quantity: totalPcs > 0 ? String(totalPcs) : "-",
          sizes: combinedSizes,
          products,
          design_photos: designPhotos,
          wo_photos: woPhotos,
          deadline: form.deadline || undefined,
          created_at: form.created_at ? new Date(form.created_at).toISOString() : undefined,
          current_step: order?.current_step || 1,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Gagal menyimpan");
        return;
      }
      onSaved("Pesanan diperbarui");
    } catch {
      setError("Gagal menyimpan");
    } finally {
      setSaving(false);
    }
  };

  const set = (key: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  if (!order) return null;

  return (
    <div className="pas-sheet open">
      <div className="pas-veil" onClick={onClose} />
      <div className="pas-panel p-5 sm:p-7">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[12px] text-[var(--pas-accent)] font-semibold">
              Edit Pesanan
            </p>
            <h2 className="pas-display text-[22px] mt-1.5">{orderId}</h2>
          </div>
          <button className="pas-btn-ghost px-3 py-2 text-sm" onClick={onClose}>
            Tutup
          </button>
        </div>
        <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4">
          <label className="block">
            <span className="text-[13px] text-[var(--pas-muted)]">Nama Customer</span>
            <input
              required
              className="pas-field w-full px-4 py-2.5 mt-1.5 text-[15px]"
              placeholder="Nama"
              value={form.customer_name}
              onChange={set("customer_name")}
            />
          </label>
          <label className="block">
            <span className="text-[13px] text-[var(--pas-muted)]">Nomor HP</span>
            <input
              required
              className="pas-field w-full px-4 py-2.5 mt-1.5 text-[15px]"
              placeholder="0812xxxxxxx"
              value={form.customer_phone}
              onChange={set("customer_phone")}
            />
          </label>
          <div>
            <div className="flex items-center justify-between">
              <span className="text-[13px] text-[var(--pas-muted)]">Produk</span>
              {totalQty > 0 && (
                <span className="text-[12px] text-[var(--pas-accent)] font-semibold pas-num">
                  Total: {totalQty} pcs
                </span>
              )}
            </div>
            <div className="flex flex-col gap-3 mt-1.5">
              {productRows.map((pRow, pi) => (
                <div key={pi} className="flex items-center gap-2 rounded-xl border border-[var(--pas-line)] p-3 bg-[var(--pas-surface-2)]">
                  {pRow.custom ? (
                    <input
                      autoFocus
                      className="pas-field flex-1 px-4 py-2.5 text-[15px]"
                      placeholder="Nama produk custom"
                      value={pRow.product}
                      onChange={(e) => updateProductRow(pi, { product: e.target.value })}
                    />
                  ) : (
                    <select
                      className="pas-field flex-1 px-4 py-2.5 text-[15px] appearance-none"
                      value={pRow.product}
                      onChange={(e) => {
                        if (e.target.value === "__custom__") {
                          updateProductRow(pi, { custom: true, product: "" });
                        } else {
                          updateProductRow(pi, { product: e.target.value });
                        }
                      }}
                    >
                      <option value="" disabled>Pilih produk...</option>
                      {productOptions.map((p) => (
                        <option key={p} value={p}>{p}</option>
                      ))}
                      <option value="__custom__">+ Tambah sendiri...</option>
                    </select>
                  )}
                  <input
                    className="pas-field w-[84px] px-3 py-2.5 text-[15px]"
                    placeholder="Qty"
                    inputMode="numeric"
                    value={pRow.qty}
                    onChange={(e) => updateProductRow(pi, { qty: e.target.value })}
                  />
                  {pRow.custom && (
                    <button
                      type="button"
                      className="pas-btn-ghost px-2.5 py-2 text-[12px] shrink-0"
                      onClick={() => updateProductRow(pi, { custom: false, product: "" })}
                    >
                      List
                    </button>
                  )}
                  {productRows.length > 1 && (
                    <button
                      type="button"
                      className="p-2 rounded-lg text-[var(--pas-muted)] hover:text-red-400 hover:bg-red-400/10 transition shrink-0"
                      onClick={() => setProductRows((rows) => rows.filter((_, idx) => idx !== pi))}
                    >
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
                      </svg>
                    </button>
                  )}
                </div>
              ))}
            </div>
            <button
              type="button"
              className="pas-btn-ghost w-full py-2.5 text-[13px] mt-2"
              onClick={() => setProductRows((rows) => [...rows, { product: "", custom: false, qty: "" }])}
            >
              + Tambah Produk
            </button>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <span className="text-[13px] text-[var(--pas-muted)]">Preview Design</span>
              <div className="flex flex-wrap gap-2.5 mt-1.5">
                {designPhotos.map((url, i) => (
                  <div key={i} className="relative w-[76px] h-[76px] group">
                    <img src={optimizeImageUrl(url, 320)} loading="lazy" alt={`Design ${i + 1}`} className="w-full h-full object-cover rounded-xl border border-[var(--pas-line)]" />
                    <button type="button" className="absolute top-1 right-1 w-[22px] h-[22px] rounded-full bg-black/70 text-white grid place-items-center opacity-0 group-hover:opacity-100 transition" onClick={() => setDesignPhotos((ps) => ps.filter((_, idx) => idx !== i))}>
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
                    </button>
                  </div>
                ))}
                <button type="button" className="w-[76px] h-[76px] rounded-xl border border-dashed border-[var(--pas-line)] grid place-items-center text-[var(--pas-muted)] hover:text-[var(--pas-accent)] hover:border-[var(--pas-accent)] transition" disabled={uploadingDesign} onClick={() => document.getElementById("edit-design-photo-input")?.click()}>
                  {uploadingDesign ? <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" className="animate-spin"><path d="M21 12a9 9 0 1 1-3.2-6.9" /></svg> : <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" /></svg>}
                </button>
              </div>
              <input id="edit-design-photo-input" type="file" accept={IMAGE_ACCEPT} multiple className="hidden" onChange={async (e) => {
                const files = Array.from(e.target.files || []);
                e.target.value = "";
                if (files.length === 0) return;
                setUploadingDesign(true);
                try {
                  for (const file of files) {
                    const result = await uploadToCloudinary(file);
                    setDesignPhotos((ps) => [...ps, optimizeImageUrl(result.url)]);
                  }
                } catch (e) { setError(e instanceof Error ? e.message : "Upload gagal."); } finally { setUploadingDesign(false); }
              }} />
            </div>
            <div>
              <span className="text-[13px] text-[var(--pas-muted)]">WO</span>
              <p className="text-[11px] text-[var(--pas-muted)] -mt-0.5">Admin only</p>
              <div className="flex flex-wrap gap-2.5 mt-1.5">
                {woPhotos.map((url, i) => (
                  <div key={i} className="relative w-[76px] h-[76px] group">
                    <img src={optimizeImageUrl(url, 320)} loading="lazy" alt={`WO ${i + 1}`} className="w-full h-full object-cover rounded-xl border border-[var(--pas-line)]" />
                    <button type="button" className="absolute top-1 right-1 w-[22px] h-[22px] rounded-full bg-black/70 text-white grid place-items-center opacity-0 group-hover:opacity-100 transition" onClick={() => setWoPhotos((ps) => ps.filter((_, idx) => idx !== i))}>
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
                    </button>
                  </div>
                ))}
                <button type="button" className="w-[76px] h-[76px] rounded-xl border border-dashed border-[var(--pas-line)] grid place-items-center text-[var(--pas-muted)] hover:text-[var(--pas-accent)] hover:border-[var(--pas-accent)] transition" disabled={uploadingWo} onClick={() => document.getElementById("edit-wo-photo-input")?.click()}>
                  {uploadingWo ? <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" className="animate-spin"><path d="M21 12a9 9 0 1 1-3.2-6.9" /></svg> : <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" /></svg>}
                </button>
              </div>
              <input id="edit-wo-photo-input" type="file" accept={IMAGE_ACCEPT} multiple className="hidden" onChange={async (e) => {
                const files = Array.from(e.target.files || []);
                e.target.value = "";
                if (files.length === 0) return;
                setUploadingWo(true);
                try {
                  for (const file of files) {
                    const result = await uploadToCloudinary(file);
                    setWoPhotos((ps) => [...ps, optimizeImageUrl(result.url)]);
                  }
                } catch (e) { setError(e instanceof Error ? e.message : "Upload gagal."); } finally { setUploadingWo(false); }
              }} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-[13px] text-[var(--pas-muted)]">Tanggal Order</span>
              <input
                type="date"
                className="pas-field w-full px-4 py-2.5 mt-1.5 text-[15px]"
                value={form.created_at}
                onChange={set("created_at")}
              />
            </label>
            <label className="block">
              <span className="text-[13px] text-[var(--pas-muted)]">Tanggal Deadline</span>
              <input
                type="date"
                className="pas-field w-full px-4 py-2.5 mt-1.5 text-[15px]"
                value={form.deadline}
                onChange={set("deadline")}
              />
            </label>
          </div>
          {error && <p className="text-[13px] text-[#E84A12]">{error}</p>}
          <button className="pas-btn-accent w-full py-3.5 text-[15px]" disabled={saving}>
            {saving ? "Menyimpan..." : "Simpan Perubahan"}
          </button>
        </form>
      </div>
    </div>
  );
}

function AddForm({
  onSaved,
  onCancel,
}: {
  onSaved: (msg: string) => void;
  onCancel: () => void;
}) {
  const DRAFT_KEY = "pas_add_order_draft";
  const [form, setForm] = useState({
    customer_name: "",
    customer_phone: "",
    deadline: "",
    created_at: new Date().toISOString().slice(0, 10),
  });
  const [productOptions, setProductOptions] = useState<string[]>([...DEFAULT_PRODUCTS]);
  const [designPhotos, setDesignPhotos] = useState<string[]>([]);
  const [woPhotos, setWoPhotos] = useState<string[]>([]);
  const [uploadingDesign, setUploadingDesign] = useState(false);
  const [uploadingWo, setUploadingWo] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const shouldSkipDraftSaveRef = useRef(false);

  // Multi-product rows: each product has its own name and qty
  const [productRows, setProductRows] = useState<
    { product: string; custom: boolean; qty: string }[]
  >([
    { product: "", custom: false, qty: "" },
  ]);

  // Total qty across all products (auto-computed)
  const totalQty = productRows.reduce(
    (acc, p) => acc + (parseInt(p.qty, 10) || 0),
    0
  );

  // Load saved custom product options
  useEffect(() => {
    setProductOptions(mergeProductOptions());
  }, []);

  // Load draft from localStorage on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(DRAFT_KEY);
      if (saved) {
        const data = JSON.parse(saved);
        if (data.form) setForm(data.form);
        if (data.productRows && data.productRows.length > 0) setProductRows(data.productRows);
        if (data.designPhotos) setDesignPhotos(data.designPhotos);
        if (data.woPhotos) setWoPhotos(data.woPhotos);
      }
    } catch {}
  }, []);

  // Refs for latest state to save on unmount
  const latestForm = useRef(form);
  const latestProductRows = useRef(productRows);
  const latestDesignPhotos = useRef(designPhotos);
  const latestWoPhotos = useRef(woPhotos);
  useEffect(() => {
    latestForm.current = form;
    latestProductRows.current = productRows;
    latestDesignPhotos.current = designPhotos;
    latestWoPhotos.current = woPhotos;
  });

  // Save draft on changes with debounce
  useEffect(() => {
    const timer = setTimeout(() => {
      if (shouldSkipDraftSaveRef.current) return;
      const draft = {
        form: latestForm.current,
        productRows: latestProductRows.current,
        designPhotos: latestDesignPhotos.current,
        woPhotos: latestWoPhotos.current,
      };
      localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    }, 500);
    return () => clearTimeout(timer);
  }, [form, productRows, designPhotos, woPhotos]);

  // Save draft on unmount
  useEffect(() => {
    return () => {
      if (shouldSkipDraftSaveRef.current) return;
      const draft = {
        form: latestForm.current,
        productRows: latestProductRows.current,
        designPhotos: latestDesignPhotos.current,
        woPhotos: latestWoPhotos.current,
      };
      localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    };
  }, []);

  const updateProductRow = (rowIdx: number, patch: Partial<typeof productRows[0]>) =>
    setProductRows((rows) => rows.map((r, i) => (i === rowIdx ? { ...r, ...patch } : r)));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validate: at least one product row with a name and qty
    const validRows = productRows.filter(
      (p) => p.product.trim() && p.qty.trim()
    );
    if (!form.customer_name || !form.customer_phone || validRows.length === 0) {
      setError("Isi nama, HP, dan minimal 1 produk dengan jumlahnya.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      // Build structured products + backward-compat fields
      const products = validRows.map((p) => ({
        name: p.product.trim(),
        sizes: [{ size: "ALL", qty: parseInt(p.qty, 10) || 0 }],
      }));
      const totalPcs = products.reduce((a, p) => a + p.sizes.reduce((x, s) => x + s.qty, 0), 0);
      const combinedNames = products.map((p) => p.name).join(", ");
      const combinedSizes = products
        .flatMap((p) => p.sizes.map((s) => `${p.name}/${s.size}(${s.qty})`))
        .join(", ");

      const res = await fetch("/api/pesanan/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customer_name: form.customer_name,
          customer_phone: form.customer_phone,
          product_name: combinedNames,
          quantity: totalPcs > 0 ? String(totalPcs) : "-",
          sizes: combinedSizes,
          products,
          design_photos: designPhotos,
          wo_photos: woPhotos,
          deadline: form.deadline || undefined,
          created_at: form.created_at ? new Date(form.created_at).toISOString() : undefined,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Gagal menyimpan");
        return;
      }
      // Simpan produk yang dipakai supaya muncul lagi di pengisian berikutnya
      const usedProducts = validRows.map((p) => p.product.trim());
      if (usedProducts.length > 0) setProductOptions(rememberProducts(usedProducts));
      shouldSkipDraftSaveRef.current = true;
      localStorage.removeItem(DRAFT_KEY);
      onSaved("Pesanan ditambahkan");
    } catch {
      setError("Gagal menyimpan");
    } finally {
      setSaving(false);
    }
  };

  const set = (key: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  return (
    <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4">
      <div className="pas-card p-3.5 bg-[var(--pas-surface-2)]">
        <p className="pas-stencil text-[9px] text-[var(--pas-muted)]">Nomor Pesanan</p>
        <p className="text-[14px] mt-1 text-[var(--pas-muted)] leading-relaxed">
          Nomor order digenerate otomatis saat disimpan
          <span className="text-[var(--pas-muted)]"> (format: TAFFYYMMDDXXXX)</span>
        </p>
      </div>
      <label className="block">
        <span className="text-[13px] text-[var(--pas-muted)]">Nama Customer</span>
        <input
          required
          className="pas-field w-full px-4 py-2.5 mt-1.5 text-[15px]"
          placeholder="Nama"
          value={form.customer_name}
          onChange={set("customer_name")}
        />
      </label>
      <label className="block">
        <span className="text-[13px] text-[var(--pas-muted)]">Nomor HP</span>
        <input
          required
          className="pas-field w-full px-4 py-2.5 mt-1.5 text-[15px]"
          placeholder="0812xxxxxxx"
          value={form.customer_phone}
          onChange={set("customer_phone")}
        />
      </label>
      <div>
        <div className="flex items-center justify-between">
          <span className="text-[13px] text-[var(--pas-muted)]">Produk</span>
          {totalQty > 0 && (
            <span className="text-[12px] text-[var(--pas-accent)] font-semibold pas-num">
              Total: {totalQty} pcs
            </span>
          )}
        </div>

        <div className="flex flex-col gap-3 mt-1.5">
          {productRows.map((pRow, pi) => {
            return (
              <div
                key={pi}
                className="flex items-center gap-2 rounded-xl border border-[var(--pas-line)] p-3 bg-[var(--pas-surface-2)]"
              >
                {/* Product selector */}
                {pRow.custom ? (
                  <input
                    autoFocus
                    className="pas-field flex-1 px-4 py-2.5 text-[15px]"
                    placeholder="Nama produk custom"
                    value={pRow.product}
                    onChange={(e) => updateProductRow(pi, { product: e.target.value })}
                  />
                ) : (
                  <select
                    className="pas-field flex-1 px-4 py-2.5 text-[15px] appearance-none"
                    value={pRow.product}
                    onChange={(e) => {
                      if (e.target.value === "__custom__") {
                        updateProductRow(pi, { custom: true, product: "" });
                      } else {
                        updateProductRow(pi, { product: e.target.value });
                      }
                    }}
                  >
                    <option value="" disabled>
                      Pilih produk...
                    </option>
                    {productOptions.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                    <option value="__custom__">+ Tambah sendiri...</option>
                  </select>
                )}
                {/* Qty */}
                <input
                  className="pas-field w-[84px] px-3 py-2.5 text-[15px]"
                  placeholder="Qty"
                  inputMode="numeric"
                  value={pRow.qty}
                  onChange={(e) => updateProductRow(pi, { qty: e.target.value })}
                />
                {pRow.custom && (
                  <button
                    type="button"
                    className="pas-btn-ghost px-2.5 py-2 text-[12px] shrink-0"
                    title="Kembali ke daftar pilihan"
                    onClick={() => updateProductRow(pi, { custom: false, product: "" })}
                  >
                    List
                  </button>
                )}
                {productRows.length > 1 && (
                  <button
                    type="button"
                    className="p-2 rounded-lg text-[var(--pas-muted)] hover:text-red-400 hover:bg-red-400/10 transition shrink-0"
                    title="Hapus produk ini"
                    onClick={() => setProductRows((rows) => rows.filter((_, idx) => idx !== pi))}
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
                    </svg>
                  </button>
                )}
              </div>
            );
          })}
        </div>

        <button
          type="button"
          className="pas-btn-ghost w-full py-2.5 text-[13px] mt-2"
          onClick={() =>
            setProductRows((rows) => [
              ...rows,
              { product: "", custom: false, qty: "" },
            ])
          }
        >
          + Tambah Produk
        </button>
      </div>

      <div className="grid grid-cols-2 gap-4">
      <div>
        <span className="text-[13px] text-[var(--pas-muted)]">Preview Design</span>
        <div className="flex flex-wrap gap-2.5 mt-1.5">
          {designPhotos.map((url, i) => (
            <div key={i} className="relative w-[76px] h-[76px] group">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={optimizeImageUrl(url, 320)} loading="lazy" alt={`Design ${i + 1}`} className="w-full h-full object-cover rounded-xl border border-[var(--pas-line)]" />
              <button type="button" className="absolute top-1 right-1 w-[22px] h-[22px] rounded-full bg-black/70 text-white grid place-items-center opacity-0 group-hover:opacity-100 transition" title="Hapus foto" onClick={() => setDesignPhotos((ps) => ps.filter((_, idx) => idx !== i))}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
              </button>
            </div>
          ))}
          <button type="button" className="w-[76px] h-[76px] rounded-xl border border-dashed border-[var(--pas-line)] grid place-items-center text-[var(--pas-muted)] hover:text-[var(--pas-accent)] hover:border-[var(--pas-accent)] transition" title="Upload foto desain" disabled={uploadingDesign} onClick={() => document.getElementById("design-photo-input")?.click()}>
            {uploadingDesign ? <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" className="animate-spin"><path d="M21 12a9 9 0 1 1-3.2-6.9" /></svg> : <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" /></svg>}
          </button>
        </div>
        <input id="design-photo-input" type="file" accept={IMAGE_ACCEPT} multiple className="hidden" onChange={async (e) => {
            const files = Array.from(e.target.files || []);
            e.target.value = "";
            if (files.length === 0) return;
            setUploadingDesign(true);
            try {
              for (const file of files) {
                const result = await uploadToCloudinary(file);
                setDesignPhotos((ps) => [...ps, optimizeImageUrl(result.url)]);
              }
            } catch (e) { console.error("[upload Design] exception", e); setError(e instanceof Error ? e.message : "Upload gagal. Coba lagi."); } finally { setUploadingDesign(false); }
          }}
        />
      </div>
      <div>
        <span className="text-[13px] text-[var(--pas-muted)]">WO</span>
        <p className="text-[11px] text-[var(--pas-muted)] -mt-0.5">Admin only</p>
        <div className="flex flex-wrap gap-2.5 mt-1.5">
          {woPhotos.map((url, i) => (
            <div key={i} className="relative w-[76px] h-[76px] group">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={optimizeImageUrl(url, 320)} loading="lazy" alt={`WO ${i + 1}`} className="w-full h-full object-cover rounded-xl border border-[var(--pas-line)]" />
              <button type="button" className="absolute top-1 right-1 w-[22px] h-[22px] rounded-full bg-black/70 text-white grid place-items-center opacity-0 group-hover:opacity-100 transition" title="Hapus foto WO" onClick={() => setWoPhotos((ps) => ps.filter((_, idx) => idx !== i))}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
              </button>
            </div>
          ))}
          <button type="button" className="w-[76px] h-[76px] rounded-xl border border-dashed border-[var(--pas-line)] grid place-items-center text-[var(--pas-muted)] hover:text-[var(--pas-accent)] hover:border-[var(--pas-accent)] transition" title="Upload foto WO" disabled={uploadingWo} onClick={() => document.getElementById("wo-photo-input")?.click()}>
            {uploadingWo ? <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" className="animate-spin"><path d="M21 12a9 9 0 1 1-3.2-6.9" /></svg> : <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" /></svg>}
          </button>
        </div>
        <input id="wo-photo-input" type="file" accept={IMAGE_ACCEPT} multiple className="hidden" onChange={async (e) => {
            const files = Array.from(e.target.files || []);
            e.target.value = "";
            if (files.length === 0) return;
            setUploadingWo(true);
            try {
              for (const file of files) {
                const result = await uploadToCloudinary(file);
                setWoPhotos((ps) => [...ps, optimizeImageUrl(result.url)]);
              }
            } catch (e) { console.error("[upload Wo] exception", e); setError(e instanceof Error ? e.message : "Upload gagal. Coba lagi."); } finally { setUploadingWo(false); }
          }}
        />
      </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="text-[13px] text-[var(--pas-muted)]">Tanggal Order</span>
          <input
            type="date"
            className="pas-field w-full px-4 py-2.5 mt-1.5 text-[15px]"
            value={form.created_at}
            onChange={set("created_at")}
          />
        </label>
        <label className="block">
          <span className="text-[13px] text-[var(--pas-muted)]">Tanggal Deadline</span>
          <input
            type="date"
            className="pas-field w-full px-4 py-2.5 mt-1.5 text-[15px]"
            value={form.deadline}
            onChange={set("deadline")}
          />
        </label>
      </div>
      {error && <p className="text-[13px] text-[#E84A12]">{error}</p>}
      <button className="pas-btn-accent w-full py-3.5 text-[15px]" disabled={saving}>
        {saving ? "Menyimpan..." : "Simpan Pesanan"}
      </button>
    </form>
  );
}

"use client";

import { useState, useEffect, useCallback, useRef, type ReactNode } from "react";
import { IMAGE_ACCEPT, optimizeImageUrl, uploadToCloudinary } from "@/lib/cloudinary";
import { MAKLON_STAGES, maklonProgress } from "@/lib/maklon-status";
import {
  DEFAULT_PRODUCTS,
  mergeProductOptions,
  rememberProducts,
} from "@/lib/product-options";
import { waNote } from "@/lib/notif-note";
import { compactPhone } from "@/lib/wa";
import {
  formatDateTimeWIB,
  formatNumericDateID,
  formatShortDateID,
} from "@/lib/format-date";
import { Search, AlertTriangle } from "lucide-react";

type StepRow = { id: string; name: string; position: number };

/**
 * Daftar tahap cadangan bila /api/pesanan/maklon/steps belum terisi.
 * Diturunkan dari MAKLON_STAGES (lib/maklon-status.ts) — satu sumber kebenaran
 * tahap maklon.
 */
const DEFAULT_STEPS: StepRow[] = MAKLON_STAGES.map((stage) => ({
  id: "",
  name: stage.label,
  position: stage.step,
}));

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
  pct: number;
};

type FilterKey = "all" | "baru" | "produksi" | "kirim" | "selesai";

const FILTER_LABEL: Record<FilterKey, string> = {
  all: "Semua",
  baru: "Baru",
  produksi: "Produksi",
  kirim: "Siap Dikirim",
  selesai: "Selesai",
};

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

function initials(name: string) {
  return name
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}

function NavIcon({ name, size = 18 }: { name: string; size?: number }) {
  const paths: Record<string, ReactNode> = {
    pesanan: (
      <path d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-4 0a1 1 0 01-1-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 01-1 1" />
    ),
    maklon: (
      <>
        <path d="M20 7l-8-4-8 4v10l8 4 8-4V7z" />
        <path d="M4 7l8 4 8-4M12 11v10" />
      </>
    ),
    jadwal: (
      <path d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
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
    laporan: <path d="M18 20V10M12 20V4M6 20v-6" />,
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

export default function MaklonDashboard() {
  const [orders, setOrders] = useState<OrderData[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<OrderData | null>(null);
  const [deletingOrder, setDeletingOrder] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [toast, setToast] = useState("");
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [steps, setSteps] = useState<StepRow[]>(DEFAULT_STEPS);

  const fetchOrders = useCallback(async () => {
    try {
      const res = await fetch("/api/pesanan/maklon");
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
      const res = await fetch("/api/pesanan/maklon/steps");
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

  const showToast = (msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 2200);
  };

  const closeAll = () => {
    setOpenId(null);
    setEditId(null);
    setShowAdd(false);
  };

  // Hapus dari daftar (ikon tong sampah di tabel / kartu mobile).
  // Endpoint DELETE-nya juga membuang foto design & WO dari Cloudinary.
  const doDeleteOrder = async () => {
    if (!deleteTarget) return;
    const targetId = deleteTarget.id;
    setDeletingOrder(true);
    try {
      const res = await fetch(`/api/pesanan/maklon/${targetId}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({} as any));
      if (!res.ok) {
        showToast(data?.error || "Gagal menghapus");
        return;
      }
      setDeleteTarget(null);
      // Kalau maklon yang dihapus sedang terbuka di sheet, tutup juga.
      if (openId === targetId) setOpenId(null);
      if (editId === targetId) setEditId(null);
      showToast(`Maklon ${targetId} dihapus`);
      fetchOrders();
    } catch {
      showToast("Gagal menghapus, coba lagi");
    } finally {
      setDeletingOrder(false);
    }
  };

  const filtered = orders
    .filter((o) => {
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
    produksi: orders.filter((o) => {
      const st = statusOf(o, steps.length);
      return st === "produksi" || st === "baru";
    }).length,
    kirim: orders.filter((o) => statusOf(o, steps.length) === "kirim").length,
    selesai: orders.filter((o) => statusOf(o, steps.length) === "selesai").length,
  };

  return (
    <div className="pas-shell">
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
          <a className="pas-navlink" href="/pesanan/orders">
            <span className="pas-ic"><NavIcon name="pesanan" /></span> Pesanan
          </a>
          <a className="pas-navlink on" href="/pesanan/maklon">
            <span className="pas-ic"><NavIcon name="maklon" /></span> Maklon
            {orders.length > 0 && (
              <em className="pas-badge-y ml-auto">{orders.length}</em>
            )}
          </a>
          <a className="pas-navlink" href="/pesanan/orders#jadwal">
            <span className="pas-ic"><NavIcon name="jadwal" /></span> Jadwal Produksi
          </a>
          <a className="pas-navlink" href="/pesanan/orders#kirim">
            <span className="pas-ic"><NavIcon name="kirim" /></span> Pengiriman
          </a>
        </nav>
        <p className="pas-navsec">Data</p>
        <nav className="flex flex-col gap-1">
          <a className="pas-navlink" href="/pesanan/orders#customer">
            <span className="pas-ic"><NavIcon name="customer" /></span> Customer
          </a>
          <a className="pas-navlink" href="/pesanan/orders#laporan">
            <span className="pas-ic"><NavIcon name="laporan" /></span> Laporan
          </a>
          <a className="pas-navlink" href="/pesanan/orders#notif">
            <span className="pas-ic"><NavIcon name="notif" /></span> Notifikasi
          </a>
          <a className="pas-navlink" href="/pesanan/orders#setting">
            <span className="pas-ic"><NavIcon name="setting" /></span> Pengaturan
          </a>
        </nav>
        <div className="pas-userbox mt-auto p-3 flex items-center gap-3">
          <span className="pas-avatar pas-avatar-invert">AD</span>
          <span className="leading-tight">
            <span className="block text-[13.5px] font-semibold">Admin TAFF</span>
            <span className="block text-[11.5px] opacity-70">admin@taffsport.id</span>
          </span>
        </div>
      </aside>

      <div className="flex-1 min-w-0">
        <header className="pas-topbar">
          <div className="px-4 sm:px-8 h-16 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              {/* Logo brand tidak lagi di topbar — di ponsel halaman ini dibuka
                  dari menu Pesanan, jadi yang dibutuhkan jalan kembali. */}
              <a
                href="/pesanan/orders"
                className="lg:hidden -ml-1.5 shrink-0 p-2.5 rounded-lg border border-[var(--pas-line)] text-[var(--pas-muted)] hover:text-[var(--pas-ink-1)] hover:bg-[var(--pas-surface-2)] transition"
                aria-label="Kembali ke Pesanan"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M15 6l-6 6 6 6" />
                </svg>
              </a>
              <div className="min-w-0">
                <p className="pas-kicker truncate">Operasional</p>
                <h1 className="pas-display pas-title mt-1 truncate">Maklon</h1>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className="hidden lg:inline text-[12.5px] text-[var(--pas-muted)]">
                {formatShortDateID(new Date())}
              </span>
              <button
                onClick={() => setShowAdd(true)}
                className="pas-btn-accent inline-flex items-center justify-center gap-1.5 whitespace-nowrap px-3 py-2.5 text-[12.5px] sm:px-4 sm:text-[14px]"
                aria-label="Tambah maklon baru"
              >
                <span aria-hidden="true" className="text-[15px] leading-none">+</span>
                Tambah Maklon
              </button>
            </div>
          </div>
        </header>

        <main className="px-5 sm:px-8 py-7 sm:py-9 w-full">
          <section className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 w-full">
            <div className="pas-card pas-kpi pas-kpi-hero p-4 sm:p-5">
              <p className="pas-kpi-label text-[13px]">Total Maklon</p>
              <div className="mt-2.5 flex flex-wrap items-end gap-x-2.5 gap-y-1.5">
                <p className="pas-display pas-num text-[34px] leading-none">{stats.total}</p>
              </div>
            </div>
            <div className="pas-card pas-kpi p-4 sm:p-5">
              <p className="text-[13px] text-[var(--pas-muted)]">Sedang Produksi</p>
              <div className="mt-2.5 flex flex-wrap items-end gap-x-2.5 gap-y-1.5">
                <p className="pas-display pas-num text-[30px] leading-none">{stats.produksi}</p>
              </div>
            </div>
            <div className="pas-card pas-kpi p-4 sm:p-5">
              <p className="text-[13px] text-[var(--pas-muted)]">Siap Dikirim</p>
              <div className="mt-2.5 flex flex-wrap items-end gap-x-2.5 gap-y-1.5">
                <p className="pas-display pas-num text-[30px] leading-none text-[#23627C]">{stats.kirim}</p>
              </div>
            </div>
            <div className="pas-card pas-kpi p-4 sm:p-5">
              <p className="text-[13px] text-[var(--pas-muted)]">Selesai</p>
              <div className="mt-2.5 flex flex-wrap items-end gap-x-2.5 gap-y-1.5">
                <p className="pas-display pas-num text-[30px] leading-none">{stats.selesai}</p>
              </div>
            </div>
          </section>

          <section className="mt-7 flex flex-col lg:flex-row lg:items-center gap-3 lg:justify-between">
            <div className="pas-search w-full lg:max-w-[400px]">
              <Search className="pas-mag" size={16} />
              <input
                className="pas-field w-full py-2.5 pr-4 text-[14px]"
                placeholder="Cari maklon, nama, kota..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
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

          {loading ? (
            <p className="text-[14px] text-[var(--pas-muted)] mt-6">Memuat data...</p>
          ) : (
            <>
              <section className="pas-card mt-4 p-2 sm:p-4 hidden md:block w-full overflow-x-auto">
                <table className="pas-tbl w-full">
                  <thead>
                    <tr>
                      <th className="w-[18%]">Pesanan</th>
                      <th className="w-[18%]">Customer</th>
                      <th className="w-[16%]">Produk</th>
                      <th className="w-[18%]">Progres</th>
                      <th className="w-[12%]">Order</th>
                      <th className="w-[10%]">Status</th>
                      <th className="w-[5%]"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.length === 0 && (
                      <tr>
                        <td colSpan={7}>
                          <div className="flex flex-col items-center justify-center py-16 gap-3">
                            <p className="text-[var(--pas-muted)] text-[15px] font-medium">Tidak ada maklon yang cocok</p>
                            <p className="text-[var(--pas-muted)] text-[13px]">Coba ubah filter atau kata kunci pencarian</p>
                          </div>
                        </td>
                      </tr>
                    )}
                    {filtered.map((o) => {
                      const st = statusOf(o, steps.length);
                      const ini = initials(o.customer_name);
                      return (
                        <tr key={o.id} onClick={() => setOpenId(o.id)}>
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
                                <i style={{ width: `${o.pct}%` }} />
                              </span>
                              <span className="text-[12.5px] text-[var(--pas-muted)] pas-num whitespace-nowrap">
                                {o.current_step}/{steps.length}
                              </span>
                            </div>
                            <span className="text-[12.5px] text-[var(--pas-muted)]">
                              {steps[o.current_step - 1]?.name || `Tahap ${o.current_step}`}
                            </span>
                          </td>
                          <td className="text-[12.5px] text-[var(--pas-muted)] whitespace-nowrap">
                            {formatDate(o.created_at)}
                          </td>
                          <td>
                            <span className={`pas-pill ${st}`}>{FILTER_LABEL[st]}</span>
                          </td>
                          <td className="text-right">
                            <div className="flex items-center justify-end gap-1">
                              <button
                                className="text-[var(--pas-muted)] hover:text-blue-400 transition p-1.5 rounded-lg hover:bg-blue-400/10"
                                title="Edit maklon"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setEditId(o.id);
                                }}
                              >
                                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
                                  <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1-1-4 9.5-9.5z"/>
                                </svg>
                              </button>
                              <button
                                className="text-[var(--pas-muted)] hover:text-red-400 transition p-1.5 rounded-lg hover:bg-red-400/10"
                                title="Hapus maklon"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setDeleteTarget(o);
                                }}
                              >
                                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
                                </svg>
                              </button>
                              <span className="text-[var(--pas-muted)]">›</span>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </section>

              <section className="mt-4 flex flex-col gap-3 md:hidden">
                {filtered.length === 0 && (
                  <div className="flex flex-col items-center justify-center py-16 gap-3">
                    <p className="text-[var(--pas-muted)] text-[15px] font-medium">Tidak ada maklon yang cocok</p>
                  </div>
                )}
                {filtered.map((o) => {
                  const st = statusOf(o, steps.length);
                  const ini = initials(o.customer_name);
                  const stageName = steps[o.current_step - 1]?.name || `Tahap ${o.current_step}`;
                  return (
                    <div key={o.id} className="pas-bento-card cursor-pointer" onClick={() => setOpenId(o.id)}>
                      <div className="flex items-center justify-between pr-2">
                        <p className="font-bold text-[16px] pas-num">{o.id}</p>
                        <div className="flex items-center gap-1.5">
                          <button
                            className="text-[var(--pas-muted)] hover:text-blue-400 transition p-1.5 rounded-lg hover:bg-blue-400/10"
                            title="Edit maklon"
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditId(o.id);
                            }}
                          >
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
                              <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1-1-4 9.5-9.5z"/>
                            </svg>
                          </button>
                          <button
                            className="text-[var(--pas-muted)] hover:text-red-400 transition p-1.5 rounded-lg hover:bg-red-400/10"
                            title="Hapus maklon"
                            onClick={(e) => {
                              e.stopPropagation();
                              setDeleteTarget(o);
                            }}
                          >
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
                            </svg>
                          </button>
                          <span className={`pas-pill ${st}`}>{FILTER_LABEL[st]}</span>
                        </div>
                      </div>
                      <div className="flex items-center justify-between mt-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <span className="pas-bento-avatar">{ini}</span>
                          <div className="min-w-0">
                            <p className="text-[14px] font-medium truncate">{o.customer_name}</p>
                          </div>
                        </div>
                        <p className="text-[14px] font-semibold pas-num shrink-0 ml-3">{o.quantity} pcs</p>
                      </div>
                      <p className="text-[13px] text-[var(--pas-muted)] mt-3">{o.product_name}</p>
                      <div className="mt-3">
                        <span className="pas-mini w-full block">
                          <i style={{ width: `${o.pct}%` }} />
                        </span>
                        <p className="text-[12px] text-[var(--pas-muted)] mt-1.5 pas-num">
                          {o.current_step}/{steps.length} <span className="text-[var(--pas-ink-1)] font-medium">{stageName}</span>
                        </p>
                      </div>
                      <div className="pas-bento-divider"></div>
                      <div className="flex items-center justify-between">
                        <p className="text-[12px] text-[var(--pas-muted)]">Order: {formatDate(o.created_at)}</p>
                        <p className="text-[12px] text-[var(--pas-muted)]">Deadline: {o.deadline ? formatDate(o.deadline) : "-"}</p>
                      </div>
                    </div>
                  );
                })}
              </section>
            </>
          )}
        </main>
      </div>

      {openId && (
        <DetailSheet
          orderId={openId}
          orders={orders}
          steps={steps}
          onClose={() => setOpenId(null)}
          onSaved={(msg) => {
            fetchOrders();
            setOpenId(null);
            showToast(msg);
          }}
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

      {showAdd && (
        <div className="pas-sheet open">
          <div className="pas-veil" onClick={closeAll} />
          <div className="pas-panel p-5 sm:p-7">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[12px] text-[var(--pas-accent)] font-semibold">Maklon Baru</p>
                <h2 className="pas-display text-[22px] mt-1.5">Tambah Maklon</h2>
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

      {/* Konfirmasi hapus dari daftar (tabel / kartu mobile) */}
      {deleteTarget && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-5" onClick={() => !deletingOrder && setDeleteTarget(null)}>
          <div className="pas-card p-6 max-w-md w-full" onClick={(e) => e.stopPropagation()}>
            <p className="pas-display text-[18px]">Hapus Maklon?</p>
            <p className="text-[14px] text-[var(--pas-muted)] mt-2 leading-relaxed">
              Maklon <span className="text-[var(--pas-ink-1)] font-semibold pas-num">{deleteTarget.id}</span> ({deleteTarget.customer_name}) akan dihapus permanen.
            </p>
            <p className="text-[13px] text-[#8A6A1F] mt-3 bg-[#F0EADF] border border-[#D9C89A] rounded-xl px-4 py-2.5 flex items-start gap-1.5">
              <AlertTriangle size={14} className="shrink-0 mt-0.5" /> Data tidak bisa dikembalikan.
            </p>
            <div className="flex gap-3 mt-5">
              <button className="pas-btn flex-1 py-3 text-[13px]" onClick={() => setDeleteTarget(null)} disabled={deletingOrder}>
                Batal
              </button>
              <button
                className="flex-1 py-3 text-[13px] rounded-xl font-semibold bg-red-500 text-white hover:bg-red-600 transition disabled:opacity-50"
                onClick={doDeleteOrder}
                disabled={deletingOrder}
              >
                {deletingOrder ? "Menghapus..." : "Hapus"}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className={`pas-toast ${toast ? "on" : ""}`}>{toast}</div>
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
  const DRAFT_KEY = "maklon_add_order_draft";
  const [form, setForm] = useState({
    customer_name: "",
    customer_phone: "",
    sizes: "",
    deadline: "",
    created_at: new Date().toISOString().slice(0, 10),
  });
  const [productOptions, setProductOptions] = useState<string[]>([...DEFAULT_PRODUCTS]);
  const [productRows, setProductRows] = useState<
    { product: string; custom: boolean; qty: string }[]
  >([
    { product: "", custom: false, qty: "" },
  ]);
  const [designPhotos, setDesignPhotos] = useState<string[]>([]);
  const [woPhotos, setWoPhotos] = useState<string[]>([]);
  const [uploadingDesign, setUploadingDesign] = useState(false);
  const [uploadingWo, setUploadingWo] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const shouldSkipDraftSaveRef = useRef(false);

  // Total qty dari semua produk (dihitung otomatis)
  const totalQty = productRows.reduce(
    (acc, p) => acc + (parseInt(p.qty, 10) || 0),
    0
  );

  // Load daftar produk custom yang pernah dipakai di perangkat ini
  useEffect(() => {
    setProductOptions(mergeProductOptions());
  }, []);

  // Load draft dari localStorage saat mount
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

  // Ref ke state terbaru biar draft tetap tersimpan saat unmount
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

  // Simpan draft (debounce)
  useEffect(() => {
    const timer = setTimeout(() => {
      if (shouldSkipDraftSaveRef.current) return;
      localStorage.setItem(
        DRAFT_KEY,
        JSON.stringify({
          form: latestForm.current,
          productRows: latestProductRows.current,
          designPhotos: latestDesignPhotos.current,
          woPhotos: latestWoPhotos.current,
        })
      );
    }, 500);
    return () => clearTimeout(timer);
  }, [form, productRows, designPhotos, woPhotos]);

  // Simpan draft saat unmount
  useEffect(() => {
    return () => {
      if (shouldSkipDraftSaveRef.current) return;
      localStorage.setItem(
        DRAFT_KEY,
        JSON.stringify({
          form: latestForm.current,
          productRows: latestProductRows.current,
          designPhotos: latestDesignPhotos.current,
          woPhotos: latestWoPhotos.current,
        })
      );
    };
  }, []);

  const updateProductRow = (rowIdx: number, patch: Partial<typeof productRows[0]>) =>
    setProductRows((rows) => rows.map((r, i) => (i === rowIdx ? { ...r, ...patch } : r)));

  const set = (key: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validasi: minimal 1 baris produk dengan nama & qty
    const validRows = productRows.filter((p) => p.product.trim() && p.qty.trim());
    if (!form.customer_name.trim() || !form.customer_phone.trim() || validRows.length === 0) {
      setError("Isi nama, HP, dan minimal 1 produk dengan jumlahnya.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      // Produk terstruktur + field backward-compat (sama seperti Tambah Pesanan)
      const products = validRows.map((p) => ({
        name: p.product.trim(),
        sizes: [{ size: "ALL", qty: parseInt(p.qty, 10) || 0 }],
      }));
      const totalPcs = products.reduce((a, p) => a + p.sizes.reduce((x, s) => x + s.qty, 0), 0);
      const combinedNames = products.map((p) => p.name).join(", ");
      const combinedSizes = products
        .flatMap((p) => p.sizes.map((s) => `${p.name}/${s.size}(${s.qty})`))
        .join(", ");

      const res = await fetch("/api/pesanan/maklon", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customer_name: form.customer_name.trim(),
          customer_phone: form.customer_phone.trim(),
          // Ukuran manual (khas maklon) diutamakan, kalau kosong pakai rekap dari produk
          sizes: form.sizes.trim() || combinedSizes,
          product_name: combinedNames,
          quantity: totalPcs > 0 ? String(totalPcs) : "-",
          products,
          design_photos: designPhotos,
          wo_photos: woPhotos,
          deadline: form.deadline || undefined,
          created_at: form.created_at ? new Date(form.created_at).toISOString() : undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Gagal menyimpan maklon");
        return;
      }
      // Simpan produk yang dipakai supaya muncul lagi di pengisian berikutnya
      const usedProducts = validRows.map((p) => p.product.trim());
      if (usedProducts.length > 0) setProductOptions(rememberProducts(usedProducts));
      shouldSkipDraftSaveRef.current = true;
      localStorage.removeItem(DRAFT_KEY);
      onSaved(`Maklon ${data.order?.id || ""} berhasil ditambahkan`);
    } catch {
      setError("Gagal menyimpan maklon, coba lagi");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="mt-6 flex flex-col gap-4">
      <div className="pas-card p-3.5 bg-[var(--pas-surface-2)]">
        <p className="pas-stencil text-[9px] text-[var(--pas-muted)]">Nomor Maklon</p>
        <p className="text-[14px] mt-1 text-[var(--pas-muted)] leading-relaxed">
          Nomor maklon digenerate otomatis saat disimpan
          <span className="text-[var(--pas-muted)]"> (format: MKLYYMMDDXXXX)</span>
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
                      <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2" />
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
          <button type="button" className="w-[76px] h-[76px] rounded-xl border border-dashed border-[var(--pas-line)] grid place-items-center text-[var(--pas-muted)] hover:text-[var(--pas-accent)] hover:border-[var(--pas-accent)] transition" title="Upload foto desain" disabled={uploadingDesign} onClick={() => document.getElementById("maklon-design-photo-input")?.click()}>
            {uploadingDesign ? <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" className="animate-spin"><path d="M21 12a9 9 0 1 1-3.2-6.9" /></svg> : <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" /></svg>}
          </button>
        </div>
        <input id="maklon-design-photo-input" type="file" accept={IMAGE_ACCEPT} multiple className="hidden" onChange={async (e) => {
            const files = Array.from(e.target.files || []);
            e.target.value = "";
            if (files.length === 0) return;
            setUploadingDesign(true);
            try {
              for (const file of files) {
                const result = await uploadToCloudinary(file);
                setDesignPhotos((ps) => [...ps, optimizeImageUrl(result.url)]);
              }
            } catch (err) {
              setError(err instanceof Error ? err.message : "Upload gagal. Coba lagi.");
            } finally {
              setUploadingDesign(false);
            }
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
          <button type="button" className="w-[76px] h-[76px] rounded-xl border border-dashed border-[var(--pas-line)] grid place-items-center text-[var(--pas-muted)] hover:text-[var(--pas-accent)] hover:border-[var(--pas-accent)] transition" title="Upload foto WO" disabled={uploadingWo} onClick={() => document.getElementById("maklon-wo-photo-input")?.click()}>
            {uploadingWo ? <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" className="animate-spin"><path d="M21 12a9 9 0 1 1-3.2-6.9" /></svg> : <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" /></svg>}
          </button>
        </div>
        <input id="maklon-wo-photo-input" type="file" accept={IMAGE_ACCEPT} multiple className="hidden" onChange={async (e) => {
            const files = Array.from(e.target.files || []);
            e.target.value = "";
            if (files.length === 0) return;
            setUploadingWo(true);
            try {
              for (const file of files) {
                const result = await uploadToCloudinary(file);
                setWoPhotos((ps) => [...ps, optimizeImageUrl(result.url)]);
              }
            } catch (err) {
              setError(err instanceof Error ? err.message : "Upload gagal. Coba lagi.");
            } finally {
              setUploadingWo(false);
            }
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

      <label className="block">
        <span className="text-[13px] text-[var(--pas-muted)]">Ukuran (opsional)</span>
        <input
          className="pas-field w-full px-4 py-2.5 mt-1.5 text-[15px]"
          placeholder="M=20, L=30 - kosongkan untuk rekap otomatis dari produk"
          value={form.sizes}
          onChange={set("sizes")}
        />
      </label>

      {error && <p className="text-[13px] text-[#C0392B]">{error}</p>}

      <div className="flex gap-3">
        <button
          type="button"
          className="pas-btn flex-1 py-3.5 text-[13.5px]"
          onClick={onCancel}
          disabled={saving}
        >
          Batal
        </button>
        <button className="pas-btn-accent flex-1 py-3.5 text-[15px]" disabled={saving}>
          {saving ? "Menyimpan..." : "Simpan Maklon"}
        </button>
      </div>
    </form>
  );
}

function DetailSheet({
  orderId,
  orders,
  steps,
  onClose,
  onSaved,
}: {
  orderId: string;
  orders: OrderData[];
  steps: StepRow[];
  onClose: () => void;
  onSaved: (msg: string) => void;
}) {
  const order = orders.find((o) => o.id === orderId);
  const [step, setStep] = useState(order?.current_step ?? 1);
  const [note, setNote] = useState(order?.note || "");
  const [courier, setCourier] = useState(order?.courier || "");
  const [resi, setResi] = useState(order?.tracking_number || "");
  const [woPhotos, setWoPhotos] = useState<string[]>(order?.wo_photos || []);
  const [uploadingWo, setUploadingWo] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState("");
  const [zoomUrl, setZoomUrl] = useState<string | null>(null);

  useEffect(() => {
    if (order) {
      setStep(order.current_step);
      setNote(order.note || "");
      setCourier(order.courier || "");
      setResi(order.tracking_number || "");
      setWoPhotos(order.wo_photos || []);
    }
  }, [order]);

  // Lightbox: Esc untuk tutup + kunci scroll body
  useEffect(() => {
    if (!zoomUrl) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setZoomUrl(null);
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [zoomUrl]);

  const handleWoUpload = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      setError("File harus gambar");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError("Maksimal 10MB");
      return;
    }
    setUploadingWo(true);
    setError("");
    try {
      const result = await uploadToCloudinary(file);
      setWoPhotos((prev) => [...prev, optimizeImageUrl(result.url)]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload gagal");
    } finally {
      setUploadingWo(false);
    }
  };

  if (!order) return null;

  const totalSteps = steps.length;
  const hasTracking = !!(courier && resi);
  const st = order.is_done
    ? "selesai"
    : step >= totalSteps
      ? "kirim"
      : step <= 1
        ? "baru"
        : "produksi";
  const pct = maklonProgress(step, hasTracking);

  const save = async () => {
    setError("");
    setSaving(true);
    try {
      const res = await fetch(`/api/pesanan/maklon/${order.id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          current_step: step,
          note,
          courier,
          tracking_number: resi,
          // Tahap akhir otomatis jadi Selesai di server - nomor resi opsional.
          wo_photos: woPhotos,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Gagal menyimpan");
        return;
      }
      // Status kirim WA ikut ditampilkan biar admin tahu notif jalan atau tidak
      onSaved(`Maklon ${order.id} diperbarui${waNote(data?.notification?.status)}`);
    } catch {
      setError("Gagal menyimpan, coba lagi");
    } finally {
      setSaving(false);
    }
  };

  const markDone = async () => {
    setError("");
    setSaving(true);
    try {
      const res = await fetch(`/api/pesanan/maklon/${order.id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          current_step: totalSteps,
          is_done: true,
          note,
          courier,
          tracking_number: resi,
          wo_photos: woPhotos,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Gagal menyimpan");
        return;
      }
      onSaved(`Maklon ${order.id} ditandai selesai`);
    } catch {
      setError("Gagal menyimpan, coba lagi");
    } finally {
      setSaving(false);
    }
  };

  const doDelete = async () => {
    setDeleting(true);
    try {
      const res = await fetch(`/api/pesanan/maklon/${order.id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Gagal menghapus");
        return;
      }
      onSaved(`Maklon ${order.id} dihapus`);
    } catch {
      setError("Gagal menghapus, coba lagi");
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  return (
    <div className="pas-sheet open">
      <div className="pas-veil" onClick={onClose} />
      {/* Jangan pakai height:100% - di layar <=640px .pas-panel di-set top:8%,
          height:100% bikin panel kepanjangan 8% ke bawah sehingga footer tombol
          Simpan/Selesai keluar dari layar dan tak bisa di-scroll. */}
      <div className="pas-panel p-0" style={{ display: "flex", flexDirection: "column" }}>
        {/* TOPBAR */}
        <div
          className="sticky top-0 z-10 flex items-center gap-3 px-5 py-3.5 border-b border-[var(--pas-line)]"
          style={{ background: "rgba(245,245,244,.85)", backdropFilter: "blur(14px)", WebkitBackdropFilter: "blur(14px)" }}
        >
          <button
            className="w-9 h-9 rounded-[10px] border border-[var(--pas-line)] bg-[var(--pas-surface)] grid place-items-center text-[var(--pas-muted)] hover:text-[var(--pas-ink-1)] hover:border-[rgba(10, 10, 10,.22)] transition shrink-0"
            onClick={onClose}
            aria-label="Kembali"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
          </button>
          <div className="min-w-0 flex-1">
            <div className="pas-display text-[16px] leading-tight">Detail Maklon</div>
            <div className="text-[12px] text-[var(--pas-muted)] pas-num mt-0.5">{order.id}</div>
          </div>
          <span className={`pas-pill ${st} text-[11px]`}>{FILTER_LABEL[st]}</span>
          <button
            className="w-9 h-9 rounded-[10px] border border-[var(--pas-line)] bg-[var(--pas-surface)] grid place-items-center text-[var(--pas-muted)] hover:text-red-500 hover:border-red-300 transition shrink-0"
            onClick={() => setConfirmDelete(true)}
            disabled={saving || deleting}
            aria-label="Hapus maklon"
            title="Hapus maklon"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2" /></svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 pt-5 pb-28" style={{ scrollbarColor: "var(--pas-line) transparent" }}>
          {/* STATUS HERO */}
          <div className="rounded-2xl border border-[var(--pas-line)] bg-[var(--pas-surface)] shadow-[0_1px_3px_rgba(0,0,0,.04),0_4px_12px_rgba(0,0,0,.04)] p-6 flex flex-col items-center text-center gap-3">
            <div className="w-14 h-14 rounded-full bg-[rgba(35,187,183,.18)] grid place-items-center text-[var(--pas-accent)] text-[22px]">
              {order.is_done ? (
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
              ) : (
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 3h15v13H1zM16 8h4l3 3v5h-7V8zM5.5 21a2.5 2.5 0 100-5 2.5 2.5 0 000 5zM18.5 21a2.5 2.5 0 100-5 2.5 2.5 0 000 5z" /></svg>
              )}
            </div>
            <div className="pas-display text-[18px] leading-tight">
              {order.is_done ? "Selesai" : steps[step - 1]?.name || `Tahap ${step}`}
            </div>
            <p className="text-[13px] text-[var(--pas-muted)] max-w-[300px] leading-relaxed">
              {order.is_done
                ? "Maklon sudah selesai dan diterima oleh customer."
                : `Pesanan maklon sedang dalam tahap ${steps[step - 1]?.name || `tahap ${step}`}.${order.note_time ? ` Terakhir diupdate ${formatDateTime(order.note_time)}.` : ""}`}
            </p>
          </div>

          {/* PROGRESS */}
          <p className="pas-stencil text-[9px] text-[var(--pas-muted)] mt-6 mb-2">Progress Produksi</p>
          <div className="rounded-2xl border border-[var(--pas-line)] bg-[var(--pas-surface)] shadow-[0_1px_3px_rgba(0,0,0,.04)] p-4">
            <div className="flex items-end justify-between mb-3">
              <div className="pas-display text-[28px] leading-none pas-num text-[var(--pas-accent)]">{pct}%</div>
              <div className="text-[13px] font-semibold text-[var(--pas-ink-2)]">Tahap {step} dari {totalSteps}</div>
            </div>
            <div className="h-[6px] rounded-full bg-[rgba(10, 10, 10,.08)] overflow-hidden">
              <div className="h-full rounded-full bg-[var(--pas-accent)]" style={{ width: `${pct}%`, transition: "width .6s cubic-bezier(.22,1,.36,1)" }} />
            </div>
          </div>

          {/* TIMELINE STEPPER */}
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
                          background: isDone ? "var(--pas-accent)" : "var(--pas-surface)",
                          border: isDone || isCur ? "2px solid var(--pas-accent)" : "2px solid var(--pas-line)",
                          color: isDone ? "#fff" : isCur ? "var(--pas-accent)" : "var(--pas-muted)",
                          boxShadow: isDone ? "none" : isCur ? "0 0 0 4px rgba(35,187,183,.18)" : "none",
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

          {/* INFO MAKLON */}
          <p className="pas-stencil text-[9px] text-[var(--pas-muted)] mt-6 mb-2">Informasi Maklon</p>
          <div className="rounded-2xl border border-[var(--pas-line)] bg-[var(--pas-surface)] shadow-[0_1px_3px_rgba(0,0,0,.04)] overflow-hidden">
            <div className="px-4 py-2.5 border-b border-[var(--pas-line)]" style={{ background: "rgba(10, 10, 10,.03)" }}>
              <span className="pas-stencil text-[9px] text-[var(--pas-muted)]">Data Order</span>
            </div>
            <div className="grid grid-cols-2">
              <div className="col-span-2 px-4 py-3 border-b border-[var(--pas-line)]">
                <span className="pas-stencil text-[9px] text-[var(--pas-muted)]">Customer</span>
                <p className="mt-1 text-[14px] font-semibold">{order.customer_name}</p>
                {/* Digit saja (compactPhone): nomor siap di-copy-paste ke WA. */}
                <p className="text-[12px] text-[var(--pas-muted)] mt-0.5 pas-num">
                  {compactPhone(order.customer_phone)}
                </p>
              </div>
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
                <p className="mt-1 text-[14px] font-semibold">{order.is_done ? "Selesai" : steps[step - 1]?.name || `Tahap ${step}`}</p>
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
                  <p className="mt-1 text-[14px] font-semibold">{order.product_name || "-"}</p>
                </div>
              )}
              <div className="px-4 py-3 border-b border-r border-[var(--pas-line)]">
                <span className="pas-stencil text-[9px] text-[var(--pas-muted)]">Jumlah</span>
                <p className="mt-1 text-[14px] font-semibold">{order.quantity} pcs</p>
              </div>
              <div className="px-4 py-3 border-b border-[var(--pas-line)]">
                <span className="pas-stencil text-[9px] text-[var(--pas-muted)]">Ekspedisi / Resi</span>
                <p className={`mt-1 text-[13px] font-semibold pas-num ${courier || resi ? "" : "text-[var(--pas-muted)] font-normal"}`}>
                  {courier || resi ? `${courier || "-"} / ${resi || "-"}` : "-"}
                </p>
              </div>
              {order.material && (
                <div className="px-4 py-3 border-b border-r border-[var(--pas-line)]">
                  <span className="pas-stencil text-[9px] text-[var(--pas-muted)]">Bahan</span>
                  <p className="mt-1 text-[14px] font-semibold">{order.material}</p>
                </div>
              )}
              {order.sizes && (
                <div className={`px-4 py-3 border-b border-[var(--pas-line)] ${order.material ? "" : "col-span-2"}`}>
                  <span className="pas-stencil text-[9px] text-[var(--pas-muted)]">Ukuran</span>
                  <p className="mt-1 text-[14px] font-semibold">{order.sizes}</p>
                </div>
              )}
            </div>
          </div>

          {/* MEDIA */}
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

          {/* CATATAN */}
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

          {/* DATA PENGIRIMAN */}
          <p className="pas-stencil text-[9px] text-[var(--pas-muted)] mt-6 mb-2">Data Pengiriman</p>
          <div className="rounded-2xl border border-[var(--pas-line)] bg-[var(--pas-surface)] shadow-[0_1px_3px_rgba(0,0,0,.04)] p-4">
            <div className="grid grid-cols-2 gap-3">
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
            {step < totalSteps && (
              <p className="text-[11px] text-[var(--pas-muted)] mt-2 opacity-70">
                Opsional - kalau diisi, nomor resi tampil di halaman tracking maklon.
              </p>
            )}
          </div>

          {error && (
            <p className="text-[13px] text-red-600 mt-4 bg-red-50 border border-red-200 rounded-xl px-4 py-2.5">
              {error}
            </p>
          )}
        </div>

        {/* FOOTER */}
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
            className="px-5 py-3.5 rounded-[10px] text-[12px] font-bold border border-[#2E5968] bg-[#3B6B7E] text-white cursor-pointer transition-all hover:bg-[#2E5968] disabled:opacity-50"
            style={{ fontFamily: "var(--font-display), system-ui, sans-serif", letterSpacing: ".04em", textTransform: "uppercase" }}
            onClick={markDone}
            disabled={saving}
          >
            Tandai Selesai
          </button>
        </div>
      </div>

      {/* ZOOM LIGHTBOX */}
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

      {confirmDelete && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-5" onClick={() => !deleting && setConfirmDelete(false)}>
          <div className="pas-card p-6 max-w-md w-full" onClick={(e) => e.stopPropagation()}>
            <p className="pas-display text-[18px]">Hapus Maklon?</p>
            <p className="text-[14px] text-[var(--pas-muted)] mt-2 leading-relaxed">
              Maklon <span className="text-[var(--pas-ink-1)] font-semibold pas-num">{order.id}</span> ({order.customer_name}) akan dihapus permanen.
            </p>
            <p className="text-[13px] text-[#8A6A1F] mt-3 bg-[#F0EADF] border border-[#D9C89A] rounded-xl px-4 py-2.5 flex items-start gap-1.5">
              <AlertTriangle size={14} className="shrink-0 mt-0.5" /> Data tidak bisa dikembalikan.
            </p>
            <div className="flex gap-3 mt-5">
              <button className="pas-btn flex-1 py-3 text-[13px]" onClick={() => setConfirmDelete(false)} disabled={deleting}>
                Batal
              </button>
              <button
                className="flex-1 py-3 text-[13px] rounded-xl font-semibold bg-red-500 text-white hover:bg-red-600 transition disabled:opacity-50"
                onClick={doDelete}
                disabled={deleting}
              >
                {deleting ? "Menghapus..." : "Hapus"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
   EDIT SHEET — ubah data order maklon (nama, HP, produk, bahan, ukuran,
   tanggal order/deadline, foto design & WO).

   Sengaja TANPA current_step di body PATCH: edit data tidak boleh menggeser
   tahap produksi ataupun memicu notifikasi WhatsApp ke customer (lihat
   app/api/pesanan/maklon/[id]/status/route.ts).
   ────────────────────────────────────────────────────────────────────────── */
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
    material: order?.material || "",
    sizes: order?.sizes || "",
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
      return prods.map((p) => ({
        product: p.name || "",
        custom: false,
        qty: String(p.sizes?.reduce((a: number, s) => a + (s.qty || 0), 0) || ""),
      }));
    }
    const qtyNum = order?.quantity ? String(order.quantity).replace(/\D/g, "") : "";
    return [{ product: order?.product_name || "", custom: false, qty: qtyNum }];
  });

  // Opsi = bawaan + produk custom perangkat ini + nama produk order yang sedang
  // dibuka, supaya <select> tidak kosong kalau order ini diedit di perangkat lain.
  useEffect(() => {
    setProductOptions(
      mergeProductOptions([
        ...(order?.products || []).map((p) => p.name),
        order?.product_name,
      ])
    );
  }, [order]);

  const totalQty = productRows.reduce((acc, p) => acc + (parseInt(p.qty, 10) || 0), 0);

  const updateProductRow = (rowIdx: number, patch: Partial<(typeof productRows)[0]>) =>
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
      const combinedSizes = products
        .flatMap((p) => p.sizes.map((s) => `${p.name}/${s.size}(${s.qty})`))
        .join(", ");

      // Simpan produk yang dipakai supaya muncul lagi di pengisian berikutnya
      const usedProducts = validRows.map((p) => p.product.trim());
      if (usedProducts.length > 0) setProductOptions(rememberProducts(usedProducts));

      const res = await fetch(`/api/pesanan/maklon/${orderId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customer_name: form.customer_name,
          customer_phone: form.customer_phone,
          product_name: combinedNames,
          quantity: String(totalPcs > 0 ? totalPcs : 1),
          sizes: form.sizes || combinedSizes,
          material: form.material,
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
      onSaved("Data maklon diperbarui");
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
            <p className="text-[12px] text-[var(--pas-accent)] font-semibold">Edit Maklon</p>
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
                      title="Hapus produk ini"
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
            <label className="block">
              <span className="text-[13px] text-[var(--pas-muted)]">Bahan</span>
              <input
                className="pas-field w-full px-4 py-2.5 mt-1.5 text-[15px]"
                placeholder="Dryfit Serena"
                value={form.material}
                onChange={set("material")}
              />
            </label>
            <label className="block">
              <span className="text-[13px] text-[var(--pas-muted)]">Ukuran</span>
              <input
                className="pas-field w-full px-4 py-2.5 mt-1.5 text-[15px]"
                placeholder="M(20), L(20)"
                value={form.sizes}
                onChange={set("sizes")}
              />
            </label>
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
                <button type="button" className="w-[76px] h-[76px] rounded-xl border border-dashed border-[var(--pas-line)] grid place-items-center text-[var(--pas-muted)] hover:text-[var(--pas-accent)] hover:border-[var(--pas-accent)] transition" title="Upload foto desain" disabled={uploadingDesign} onClick={() => document.getElementById("maklon-edit-design-photo-input")?.click()}>
                  {uploadingDesign ? <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" className="animate-spin"><path d="M21 12a9 9 0 1 1-3.2-6.9" /></svg> : <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" /></svg>}
                </button>
              </div>
              <input id="maklon-edit-design-photo-input" type="file" accept={IMAGE_ACCEPT} multiple className="hidden" onChange={async (e) => {
                const files = Array.from(e.target.files || []);
                e.target.value = "";
                if (files.length === 0) return;
                setUploadingDesign(true);
                try {
                  for (const file of files) {
                    const result = await uploadToCloudinary(file);
                    setDesignPhotos((ps) => [...ps, optimizeImageUrl(result.url)]);
                  }
                } catch (err) { setError(err instanceof Error ? err.message : "Upload gagal."); } finally { setUploadingDesign(false); }
              }} />
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
                <button type="button" className="w-[76px] h-[76px] rounded-xl border border-dashed border-[var(--pas-line)] grid place-items-center text-[var(--pas-muted)] hover:text-[var(--pas-accent)] hover:border-[var(--pas-accent)] transition" title="Upload foto WO" disabled={uploadingWo} onClick={() => document.getElementById("maklon-edit-wo-photo-input")?.click()}>
                  {uploadingWo ? <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" className="animate-spin"><path d="M21 12a9 9 0 1 1-3.2-6.9" /></svg> : <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" /></svg>}
                </button>
              </div>
              <input id="maklon-edit-wo-photo-input" type="file" accept={IMAGE_ACCEPT} multiple className="hidden" onChange={async (e) => {
                const files = Array.from(e.target.files || []);
                e.target.value = "";
                if (files.length === 0) return;
                setUploadingWo(true);
                try {
                  for (const file of files) {
                    const result = await uploadToCloudinary(file);
                    setWoPhotos((ps) => [...ps, optimizeImageUrl(result.url)]);
                  }
                } catch (err) { setError(err instanceof Error ? err.message : "Upload gagal."); } finally { setUploadingWo(false); }
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
          {error && <p className="text-[13px] text-[#C0392B]">{error}</p>}
          <button className="pas-btn-accent w-full py-3.5 text-[15px]" disabled={saving}>
            {saving ? "Menyimpan..." : "Simpan Perubahan"}
          </button>
        </form>
      </div>
    </div>
  );
}
import type { Metadata } from "next";
import { headers } from "next/headers";
import { createServiceClient } from "@/lib/supabase/server";
import { verifyToken } from "@/lib/verify-token";
import { clientIp, isTokenSharedAcrossDevices } from "@/lib/track-guard";
import { MAKLON_STAGES, MAKLON_STEP_PROGRESS } from "@/lib/maklon-status";
import { formatDateTimeWIB, formatShortDateID } from "@/lib/format-date";

/**
 * Halaman tracking publik untuk pesanan MAKLON.
 *
 * Dipakai oleh link di notifikasi WhatsApp (`buildMaklonTrackingUrl`).
 * Aksesnya pakai token HMAC yang sama dengan link jersey (lib/verify-token) —
 * kalau token tidak ada/kedaluwarsa, customer diarahkan minta link baru, bukan
 * jatuh ke halaman "pesanan tidak ditemukan".
 *
 * Sama seperti /status (jersey): halaman ini SENGAJA tidak punya tombol
 * WhatsApp/CS. Fungsinya murni melihat progres — kanal komunikasi tetap di
 * pesan WhatsApp yang dikirim otomatis tiap tahap.
 *
 * Token yang dibuka dari banyak perangkat berbeda (indikasi link diteruskan ke
 * grup) juga ditolak di sini — halaman maklon belum punya verifikasi nomor HP
 * sendiri, jadi jalan amannya minta link baru ke CS.
 *
 * Halaman ini SENGAJA terpisah dari /status (yang khusus pesanan jersey,
 * 11 tahap, dan punya alur verifikasi nomor HP sendiri) supaya alur jersey
 * tidak ikut berubah.
 */

export const metadata: Metadata = {
  title: "Status Pesanan Maklon — TAFF Sportwear",
  description: "Pantau progres produksi pesanan maklon kamu.",
  robots: { index: false, follow: false },
};

/** Nama tahap cadangan bila tabel `maklon_steps` belum berisi apa pun. */
const DEFAULT_STEP_NAMES = MAKLON_STAGES.map((stage) => stage.label);

type MaklonProduct = { name?: string; sizes?: { size?: string; qty?: number }[] };

type MaklonOrderRow = {
  order_number: string;
  customer_name: string;
  product_type: string | null;
  quantity: number | null;
  sizes: string | null;
  material: string | null;
  products: MaklonProduct[] | null;
  design_photos: unknown;
  design_notes: string | null;
  current_status: string;
  current_stage: number | null;
  courier: string | null;
  tracking_number: string | null;
  deadline: string | null;
  created_at: string;
  updated_at: string | null;
};

/** Ambil kolom yang aman ditampilkan (wo_photos & catatan internal tidak diikutkan). */
const SAFE_COLUMNS = [
  "order_number",
  "customer_name",
  "product_type",
  "quantity",
  "sizes",
  "material",
  "products",
  "design_photos",
  "design_notes",
  "current_status",
  "current_stage",
  "courier",
  "tracking_number",
  "deadline",
  "created_at",
  "updated_at",
].join(",");

// Format tanggal memakai lib/format-date.ts (zona Asia/Jakarta). Wrapper di
// bawah hanya menambahkan tanda "-" untuk nilai kosong/tidak valid.
const formatDate = (value: string | null | undefined) => formatShortDateID(value) || "-";
const formatDateTime = (value: string | null | undefined) => formatDateTimeWIB(value) || "-";

function photoUrls(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((p) => (typeof p === "string" ? p : ((p as { url?: string })?.url ?? "")))
    .filter((url): url is string => typeof url === "string" && url.length > 0);
}

function ProductList({ products, fallbackName, fallbackQty }: {
  products: MaklonProduct[] | null;
  fallbackName: string | null;
  fallbackQty: number | null;
}) {
  if (!products || products.length === 0) {
    return (
      <p className="trk-cell-value">
        {fallbackName || "-"}
        {fallbackQty ? ` - ${fallbackQty} pcs` : ""}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2 mt-2">
      {products.map((p, i) => {
        const qty = (p.sizes || []).reduce((acc, s) => acc + (s.qty || 0), 0);
        return (
          <div
            key={i}
            className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[.03] px-3.5 py-2.5"
          >
            <span className="text-[14px] font-medium">{p.name || "-"}</span>
            <span className="dpo-mono text-[14px] text-[#23BBB7]">{qty} pcs</span>
          </div>
        );
      })}
    </div>
  );
}

function InfoCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="trk-card p-6 sm:p-7">
      <p className="dpo-kicker">{title}</p>
      <div className="mt-4">{children}</div>
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="trk-bg min-h-screen">
      <div className="trk-grid min-h-screen">
        <div className="trk-glow">
          <header className="sticky top-0 z-30 border-b border-white/[.07] bg-[rgba(10,10,11,.72)] backdrop-blur-xl">
            <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-3 px-4 py-3 sm:px-6 sm:py-3.5">
              <div className="flex items-center gap-3">
                <a href="/track" className="shrink-0" aria-label="Kembali ke tracking">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {/* Mark saja (tanpa wordmark), karena teks TAFF Sportwear ada di sampingnya */}
                  <img
                    src="/logo-taff-mark.png"
                    alt=""
                    aria-hidden="true"
                    className="h-8 w-auto"
                  />
                </a>
                <div className="leading-tight">
                  <p className="trk-display text-[14.5px] font-semibold uppercase tracking-wide sm:text-[15px]">
                    TAFF Sportwear
                  </p>
                  <p className="text-[10.5px] text-[#8A8A85] sm:text-[11px]">
                    Pabrik Jersey Custom Full Printing
                  </p>
                </div>
              </div>
            </div>
          </header>
          <main className="mx-auto w-full max-w-3xl px-4 pb-20 sm:px-6">{children}</main>
        </div>
      </div>
    </div>
  );
}

async function loadMaklonOrder(orderNumber: string) {
  // `maklon_orders` tidak lagi bisa dibaca anon (migrasi 0027), jadi baca
  // lewat service role di server. Halaman ini publik — data yang ditampilkan
  // dibatasi lewat SAFE_COLUMNS, bukan lewat RLS.
  const supabase = createServiceClient();

  const { data: order } = await supabase
    .from("maklon_orders")
    .select(SAFE_COLUMNS)
    .eq("order_number", orderNumber)
    .maybeSingle<MaklonOrderRow>();

  if (!order) return null;

  const { data: steps } = await supabase
    .from("maklon_steps")
    .select("name, position")
    .order("position", { ascending: true });

  const stepNames =
    steps && steps.length > 0
      ? steps.map((s) => String(s.name))
      : DEFAULT_STEP_NAMES;

  return { order, stepNames };
}

export default async function MaklonStatusPage({
  searchParams,
}: {
  searchParams: Promise<{ order?: string; token?: string }>;
}) {
  const { order: orderParam, token } = await searchParams;
  const orderNumber = (orderParam || "").trim().toUpperCase();
  const session = token ? verifyToken(token) : null;

  // Pengaman "link dibagi": IP di sini dipakai sebagai penanda perangkat, bukan
  // pengunci — lihat lib/track-guard.ts untuk alasan dan batasannya.
  const tokenShared =
    !!token && !!session
      ? isTokenSharedAcrossDevices(token, clientIp(await headers()))
      : false;

  const authorized =
    !!session && !!orderNumber && session.orderId === orderNumber && !tokenShared;

  const result = authorized ? await loadMaklonOrder(orderNumber) : null;

  if (!authorized) {
    return (
      <Shell>
        <div className="pt-7 sm:pt-12">
          <InfoCard title="Status Pesanan Maklon">
            <h1 className="trk-display text-[22px] leading-tight">
              {tokenShared
                ? "Link ini sepertinya dibagikan ke orang lain"
                : "Link tidak valid atau kedaluwarsa"}
            </h1>
            <p className="mt-3 text-[14px] leading-relaxed text-[#A3A3A3]">
              {tokenShared
                ? "Link dari WhatsApp itu khusus untuk pemesan. Karena link ini dibuka dari beberapa perangkat berbeda, aksesnya kami tutup demi keamanan data pesanan. Minta link baru ke CS ya."
                : "Link ini cuma bisa dibuka dari pesan WhatsApp resmi kami dan berlaku 7 hari. Kalau link-nya sudah lama, minta link baru lewat WhatsApp ke nomor resmi kami ya."}
            </p>
          </InfoCard>
        </div>
      </Shell>
    );
  }

  if (!result) {
    return (
      <Shell>
        <div className="pt-7 sm:pt-12">
          <InfoCard title="Status Pesanan Maklon">
            <h1 className="trk-display text-[22px] leading-tight">Pesanan tidak ditemukan</h1>
            <p className="mt-3 text-[14px] leading-relaxed text-[#A3A3A3]">
              Pesanan <span className="dpo-mono text-[#E4E4DF]">{orderNumber}</span> tidak ada di
              sistem kami. Pastikan nomor pesanannya sudah benar.
            </p>
          </InfoCard>
        </div>
      </Shell>
    );
  }

  const { order, stepNames } = result;
  const totalSteps = stepNames.length;
  const step = Math.min(Math.max(order.current_stage || 1, 1), totalSteps);
  const isDone = order.current_status === "selesai";
  const hasTracking = !!(order.courier && order.tracking_number);
  const pct = isDone || (step >= totalSteps && hasTracking)
    ? 100
    : MAKLON_STEP_PROGRESS[step] ?? 0;
  const stageName = stepNames[step - 1] || `Tahap ${step}`;
  const designPhotos = photoUrls(order.design_photos);

  return (
    <Shell>
      <section className="pt-7 sm:pt-12">
        <p className="dpo-kicker">Status Pesanan Maklon</p>
        <h1 className="dpo-h1 mt-2.5">
          {isDone
            ? "Pesanan maklon kamu sudah selesai"
            : step >= totalSteps
              ? "Pesanan maklon kamu siap dikirim"
              : "Pesanan maklon kamu sedang kami kerjakan"}
        </h1>
        <p className="mt-3 text-[14px] text-[#A3A3A3]">
          Nomor <span className="dpo-mono text-[#E4E4DF]">{order.order_number}</span> -{" "}
          {order.customer_name}
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-2.5">
          <span className={`trk-pill ${isDone ? "trk-pill-shipped" : "trk-pill-active"}`}>
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: 999,
                background: "currentColor",
                display: "inline-block",
              }}
            />
            {isDone ? "Selesai" : stageName}
          </span>
          <span className="text-[12.5px] text-[#8A8A85]">
            Tahap {step} dari {totalSteps}
          </span>
        </div>

        <div className="trk-bar mt-6">
          <i style={{ width: `${pct}%` }} />
        </div>
        <div className="mt-2 flex items-center justify-between text-[12.5px] text-[#8A8A85]">
          <span className="dpo-mono">{pct}%</span>
          <span>Update terakhir {formatDateTime(order.updated_at)}</span>
        </div>
      </section>

      {/* TIMELINE */}
      <section className="mt-10">
        <p className="dpo-kicker">Tahapan Produksi</p>
        <div className="trk-card mt-3 p-6 sm:p-7">
          {stepNames.map((name, i) => {
            const pos = i + 1;
            const state = pos < step ? "trk-done" : pos === step ? "trk-current" : "trk-todo";
            return (
              <div key={pos} className={`trk-step ${state}`}>
                <div className="trk-dot">
                  {pos < step ? (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20 6L9 17l-5-5" />
                    </svg>
                  ) : (
                    pos
                  )}
                </div>
                <p className="trk-label text-[15px]">{name}</p>
                <p className="mt-1 text-[12.5px] text-[#8A8A85]">
                  {pos < step ? "Selesai" : pos === step ? (isDone ? "Selesai" : "Sedang dikerjakan") : "Menunggu"}
                </p>
              </div>
            );
          })}
        </div>
      </section>

      {/* RINCIAN */}
      <section className="mt-10">
        <p className="dpo-kicker">Rincian Pesanan</p>
        <div className="trk-card mt-3 overflow-hidden">
          <div className="grid grid-cols-2 border-b border-white/[.07]">
            <div className="trk-cell border-r border-white/[.07]">
              <p className="trk-cell-label">Tahap Sekarang</p>
              <p className="trk-cell-value">{isDone ? "Selesai" : stageName}</p>
            </div>
            <div className="trk-cell">
              <p className="trk-cell-label">Deadline</p>
              <p className="trk-cell-value">{formatDate(order.deadline)}</p>
            </div>
          </div>

          <div className="trk-cell border-b border-white/[.07]">
            <p className="trk-cell-label">Produk</p>
            <ProductList
              products={order.products}
              fallbackName={order.product_type}
              fallbackQty={order.quantity}
            />
          </div>

          <div className="grid grid-cols-2 border-b border-white/[.07]">
            <div className="trk-cell border-r border-white/[.07]">
              <p className="trk-cell-label">Jumlah</p>
              <p className="trk-cell-value dpo-mono">{order.quantity ?? "-"} pcs</p>
            </div>
            <div className="trk-cell">
              <p className="trk-cell-label">Tanggal Order</p>
              <p className="trk-cell-value">{formatDate(order.created_at)}</p>
            </div>
          </div>

          {/* Baris pengiriman hanya muncul kalau resinya memang ada. */}
          {hasTracking && (
            <div className="grid grid-cols-2 border-b border-white/[.07]">
              <div className="trk-cell border-r border-white/[.07]">
                <p className="trk-cell-label">Ekspedisi</p>
                <p className="trk-cell-value">{order.courier || "-"}</p>
              </div>
              <div className="trk-cell">
                <p className="trk-cell-label">No. Resi</p>
                <p className="trk-cell-value dpo-mono">{order.tracking_number || "-"}</p>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* DESIGN */}
      {designPhotos.length > 0 && (
        <section className="mt-10">
          <p className="dpo-kicker">Preview Design</p>
          <div className="trk-card mt-3 p-4 sm:p-5">
            <div className="flex flex-wrap gap-3">
              {designPhotos.map((url, i) => (
                <a
                  key={i}
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block h-[104px] w-[104px] overflow-hidden rounded-xl border border-white/10"
                  title="Klik untuk lihat ukuran penuh"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={url}
                    alt={`Preview design ${i + 1}`}
                    className="h-full w-full object-cover transition-transform duration-300 hover:scale-105"
                  />
                </a>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* CATATAN */}
      {order.design_notes && (
        <section className="mt-10">
          <p className="dpo-kicker">Catatan untuk Kamu</p>
          <div className="trk-update-box mt-3">
            <p className="text-[14px] leading-relaxed text-[#E4E4DF]">{order.design_notes}</p>
          </div>
        </section>
      )}
    </Shell>
  );
}

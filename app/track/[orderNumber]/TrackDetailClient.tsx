"use client";

import { useState } from "react";
import {
  BadgeCheck,
  Check,
  Circle,
  Clock,
  Flame,
  Flag,
  Layers,
  LayoutTemplate,
  MessageCircle,
  Package,
  Palette,
  Printer,
  Scissors,
  Shirt,
  Sparkles,
  Truck,
  type LucideIcon,
} from "lucide-react";
import {
  ORDER_STATUS_LABELS,
  ORDER_PHOTO_STAGES,
  type OrderStatus,
} from "@/lib/types";
import {
  isOrderCompleted,
  nextStageLabel,
  progressPercentFromStatus,
} from "@/lib/order-status";
import { waMeUrl } from "@/lib/wa";
import { formatDateTimeID } from "@/lib/format-date";

/**
 * Ikon per tahap — SVG (lucide), bukan emoji: emoji dirender berbeda-beda di
 * tiap perangkat/OS, sedangkan SVG mengikuti warna teks dan ukuran di sekitarnya.
 *
 * Kuncinya slug dari ORDER_STATUS_LIST. Versi lama peta ini memakai slug 10
 * tahap (order_diterima, printing_sublimasi, …) yang sudah tidak pernah muncul,
 * sehingga ikonnya sebenarnya tidak pernah tampil.
 */
const STAGE_ICONS: Record<string, LucideIcon> = {
  desain: Palette,
  layout: LayoutTemplate,
  profing_warna: Layers,
  cetak_print: Printer,
  press_transfer: Flame,
  potong_pola: Scissors,
  jahit: Shirt,
  finishing: Sparkles,
  quality_control: BadgeCheck,
  packing: Package,
  kirim: Truck,
  selesai: Flag,
};

/** Ikon tahap; status tak dikenal memakai lingkaran netral. */
function StageIcon({ status, className }: { status: string; className?: string }) {
  const Icon = STAGE_ICONS[status] ?? Circle;
  return <Icon className={className} aria-hidden="true" />;
}

const COURIER_LINKS: Record<string, string> = {
  JNE: "https://www.jne.co.id/tracking",
  "J&T": "https://www.jtexpress.co.id/track",
  SiCepat: "https://www.sicepat.com/checkAWB",
  AnterAja: "https://anteraja.com/cek-resi",
  TIKI: "https://www.tiki.id/tracking",
  Pos: "https://www.posindonesia.co.id/id/track-trace",
};

// Format tanggal & jam: lib/format-date.ts (zona Asia/Jakarta, bukan zona
// perangkat customer).

/** Identitas toko dari menu Pengaturan (dibaca server-side, dikirim sebagai prop). */
type BrandInfo = { name: string; whatsapp_number: string };

export function TrackDetailClient({
  orderNumber,
  brand,
  stepOrder,
}: {
  orderNumber: string;
  brand: BrandInfo;
  /** Urutan tahap dari tabel `production_steps` (dibaca server-side). */
  stepOrder: OrderStatus[];
}) {
  const [result, setResult] = useState<{
    order: any;
    history: any[];
  } | null>(null);
  const [phone, setPhone] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [verified, setVerified] = useState(false);

  async function verifyPhone(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/track", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderNumber, phone }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Pesanan tidak ditemukan");
        return;
      }

      const data = await res.json();
      setResult(data);
      setVerified(true);
    } catch {
      setError("Terjadi kesalahan. Coba lagi.");
    } finally {
      setLoading(false);
    }
  }

  if (verified && result) {
    return (
      <OrderDetailView
        order={result.order}
        history={result.history}
        orderNumber={orderNumber}
        brand={brand}
        stepOrder={stepOrder}
      />
    );
  }

  return (
    <main className="min-h-dvh flex flex-col items-center justify-center px-4 py-12 bg-background">
      <div className="w-full max-w-md animate-fade-in-up">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-brand mb-4">
            <Package className="w-7 h-7 text-on-primary" />
          </div>
          <h1 className="text-heading-lg text-ink font-bold">
            Verifikasi Pesanan
          </h1>
          <p className="text-body-sm text-stone mt-1">
            Masukkan nomor HP untuk melihat detail pesanan{" "}
            <span className="font-mono text-ink">{orderNumber}</span>
          </p>
        </div>

        <form
          onSubmit={verifyPhone}
          className="bg-surface-card rounded-2xl p-xl border border-hairline shadow-premium-lg flex flex-col gap-lg"
        >
          {error && (
            <div className="bg-danger/5 border border-danger/20 rounded-lg px-md py-sm text-caption text-danger">
              {error}
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <label className="text-caption font-semibold text-ink uppercase tracking-wider">
              Nomor HP
            </label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="08123456789"
              required
              autoFocus
              className="w-full bg-white text-ink rounded-lg px-md py-3 border border-hairline-strong text-body-sm placeholder:text-stone focus-visible:outline focus-visible:outline-2 focus-visible:outline-secondary focus-visible:outline-offset-1 dark:bg-surface-dark dark:text-on-dark dark:border-hairline"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="text-button-md inline-flex items-center justify-center gap-sm w-full h-12 rounded-full bg-primary text-on-primary hover:bg-secondary transition-colors duration-normal disabled:opacity-40"
          >
            {loading ? "Memverifikasi..." : "Lihat Detail Pesanan"}
          </button>
        </form>
      </div>
    </main>
  );
}

function OrderDetailView({
  order,
  history,
  orderNumber,
  brand,
  stepOrder,
}: {
  order: any;
  history: any[];
  orderNumber: string;
  brand: BrandInfo;
  /** Urutan tahap dari tabel `production_steps`, diteruskan dari halaman. */
  stepOrder: OrderStatus[];
}) {
  const progress = progressPercentFromStatus(order.current_status, false, stepOrder);
  const nextEstimate = nextStageLabel(order.current_status, stepOrder);
  const waLink = waMeUrl(
    brand.whatsapp_number,
    `Halo ${brand.name}, saya mau tanya soal pesanan ${orderNumber}`
  );
  const courierLink =
    COURIER_LINKS[order.courier] ||
    "https://www.google.com/search?q=track+pengiriman";

  return (
    <main className="min-h-dvh bg-background pb-24">
      {/* Header */}
      <div className="bg-gradient-brand text-on-primary py-8 px-4">
        <div className="max-w-lg mx-auto">
          <div className="flex items-center gap-sm mb-4">
            <Package className="w-5 h-5" />
            <span className="text-button-sm opacity-80">TAFF Sportwear</span>
          </div>
          <h1 className="text-heading-md font-bold">Pesanan {orderNumber}</h1>
          <p className="text-body-sm opacity-80 mt-1">{order.customer_name}</p>
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 -mt-4">
        {/* Progress Card */}
        <div className="bg-surface-card rounded-2xl p-xl border border-hairline shadow-premium-lg mb-4">
          {/* Progress bar */}
          <div className="mb-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-button-sm text-ink uppercase tracking-wider">
                Progres
              </span>
              <span className="text-button-sm text-primary font-bold">
                {progress}%
              </span>
            </div>
            <div className="w-full h-2.5 bg-surface rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-brand rounded-full transition-all duration-500"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>

          {/* Current status */}
          <div className="flex items-center gap-3 p-md bg-primary/5 rounded-xl border border-primary/10 mb-4">
            <StageIcon status={order.current_status} className="w-6 h-6 text-primary" />
            <div>
              <p className="text-caption text-stone uppercase tracking-wider">
                Status Saat Ini
              </p>
              <p className="text-body-md text-ink font-bold">
                {ORDER_STATUS_LABELS[order.current_status as OrderStatus]}
              </p>
            </div>
          </div>

          {/* Next estimate */}
          {nextEstimate && (
            <p className="text-caption text-stone mb-4">
              Tahap berikutnya:{" "}
              <span className="text-ink font-semibold">{nextEstimate}</span>
            </p>
          )}

          {/* Delay notice */}
          {order.delay_reason && (
            <div className="bg-warning/5 border border-warning/20 rounded-lg px-md py-sm text-caption text-warning mb-4">
              <strong>Penundaan:</strong> {order.delay_reason}
              {order.delay_estimated_date && (
                <span> — Estimasi baru: {order.delay_estimated_date}</span>
              )}
            </div>
          )}
        </div>

        {/* Shipping info */}
        {order.tracking_number && (
          <div className="bg-surface-card rounded-2xl p-xl border border-hairline shadow-premium-lg mb-4">
            <div className="flex items-center gap-2 mb-3">
              <Truck className="w-5 h-5 text-primary" />
              <h3 className="text-button-md text-ink">Pengiriman</h3>
            </div>
            <div className="flex flex-col gap-2">
              <div className="flex justify-between">
                <span className="text-body-sm text-stone">Ekspedisi</span>
                <span className="text-body-sm text-ink font-semibold">
                  {order.courier}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-body-sm text-stone">No. Resi</span>
                <span className="text-body-sm text-ink font-semibold font-mono">
                  {order.tracking_number}
                </span>
              </div>
            </div>
            <a
              href={courierLink}
              target="_blank"
              rel="noopener noreferrer"
              className="text-button-md inline-flex items-center justify-center gap-sm w-full h-10 rounded-full border border-hairline-strong bg-white text-charcoal hover:bg-surface hover:text-ink transition-colors duration-normal dark:bg-surface-dark dark:text-on-dark dark:border-hairline mt-4"
            >
              Lacak di Website Ekspedisi
            </a>
          </div>
        )}

        {/* Order Details */}
        <div className="bg-surface-card rounded-2xl p-xl border border-hairline shadow-premium-lg mb-4">
          <h3 className="text-button-md text-ink mb-4">Detail Pesanan</h3>
          <div className="flex flex-col gap-3">
            <DetailRow label="Jenis Produk" value={order.product_type} />
            <DetailRow label="Jumlah" value={`${order.quantity} pcs`} />
            <DetailRow label="Ukuran" value={order.sizes} />
            <DetailRow label="Nama Custom" value={order.custom_name} />
            <DetailRow label="Nomor Custom" value={order.custom_number} />
            {order.design_notes && (
              <DetailRow label="Catatan Desain" value={order.design_notes} />
            )}
            <DetailRow
              label="Tanggal Order"
              value={formatDateTimeID(order.created_at)}
            />
          </div>
        </div>

        {/* Status Timeline */}
        <div className="bg-surface-card rounded-2xl p-xl border border-hairline shadow-premium-lg mb-4">
          <h3 className="text-button-md text-ink mb-4">Riwayat Status</h3>
          <div className="flex flex-col gap-0">
            {stepOrder.map((status, idx) => {
              const historyEntry = history.find(
                (h: any) => h.status === status
              );
              // Order "selesai" = semua tahap tuntas: pakai tahap terakhir sebagai
              // penanda, dan nggak ada tahap yang masih "sedang berjalan".
              const isOrderDone = isOrderCompleted(order.current_status);
              const currentIdx = isOrderDone
                ? stepOrder.length - 1
                : stepOrder.indexOf(order.current_status);
              const isCompleted = currentIdx >= 0 && idx <= currentIdx;
              const isCurrent = !isOrderDone && idx === currentIdx;

              return (
                <div key={status} className="flex gap-3">
                  {/* Timeline line + dot */}
                  <div className="flex flex-col items-center">
                    <div
                      className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                        isCompleted
                          ? "bg-primary text-on-primary"
                          : "bg-surface border border-hairline text-stone"
                      }`}
                    >
                      {isCompleted ? (
                        <Check className="w-4 h-4" />
                      ) : (
                        <Circle className="w-3 h-3" />
                      )}
                    </div>
                    {idx < stepOrder.length - 1 && (
                      <div
                        className={`w-0.5 flex-1 min-h-[24px] ${
                          idx < currentIdx ? "bg-primary" : "bg-hairline"
                        }`}
                      />
                    )}
                  </div>

                  {/* Content */}
                  <div className="pb-6 flex-1 min-w-0">
                    <p
                      className={`text-body-sm font-semibold ${
                        isCurrent
                          ? "text-primary"
                          : isCompleted
                            ? "text-ink"
                            : "text-stone"
                      }`}
                    >
                      <StageIcon
                        status={status}
                        className="mr-1 inline-block w-4 h-4 align-text-bottom"
                      />
                      {ORDER_STATUS_LABELS[status as OrderStatus]}
                    </p>
                    {historyEntry ? (
                      <div className="mt-1">
                        <p className="text-caption text-stone">
                          {formatDateTimeID(historyEntry.created_at)}
                        </p>
                        {historyEntry.note && (
                          <p className="text-caption text-charcoal mt-0.5">
                            {historyEntry.note}
                          </p>
                        )}
                        {historyEntry.photo_url &&
                          ORDER_PHOTO_STAGES.includes(status) && (
                            <a
                              href={historyEntry.photo_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-caption text-link hover:underline mt-1 inline-block"
                            >
                              Lihat Foto
                            </a>
                          )}
                      </div>
                    ) : (
                      isCurrent && (
                        <p className="text-caption text-stone mt-1">
                          <Clock className="w-3 h-3 inline mr-1" />
                          Dalam proses...
                        </p>
                      )
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* WhatsApp CTA */}
        <a
          href={waLink}
          target="_blank"
          rel="noopener noreferrer"
          className="fixed bottom-6 right-6 z-50 flex items-center gap-2 bg-whatsapp text-white font-semibold px-5 py-3 rounded-full shadow-lg shadow-whatsapp/30 transition-all duration-300 hover:scale-105 hover:shadow-xl"
        >
          <MessageCircle className="w-5 h-5" />
          Tanya Admin
        </a>
      </div>
    </main>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-start gap-4">
      <span className="text-body-sm text-stone shrink-0">{label}</span>
      <span className="text-body-sm text-ink font-semibold text-right">
        {value || "-"}
      </span>
    </div>
  );
}

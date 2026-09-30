/**
 * Seed data DEMO untuk halaman admin Pesanan (jersey) + halaman tracking customer.
 *
 * Pakai:
 *   node --env-file=.env.local scripts/seed-pesanan-demo.mjs           # isi data demo
 *   node --env-file=.env.local scripts/seed-pesanan-demo.mjs --clean   # hapus data demo
 *
 * Baris demo dikenali dari customer_name yang diawali "Demo " dan catatan
 * "[DEMO]" — jadi --clean tidak akan menyentuh data asli. Riwayat tahapnya ikut
 * terhapus sendiri lewat `on delete cascade` di order_status_history.
 *
 * Nomor order ditulis tangan, bukan lewat generateOrderNumber(), supaya skrip
 * ini tidak menyeret lib TypeScript ke Node dan supaya nomornya stabil (bisa
 * dipakai berulang di demo/README). Formatnya tetap sama: TAFF + YYMMDD + 4
 * karakter dari charset aman — lihat lib/order-number.ts.
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error(
    "NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY belum terbaca dari .env.local"
  );
  process.exit(1);
}

const db = createClient(url, key, { auth: { persistSession: false } });
const TABLE = "orders";
const HISTORY_TABLE = "order_status_history";
const DEMO_PREFIX = "Demo ";

if (process.argv.includes("--clean")) {
  const { data, error } = await db
    .from(TABLE)
    .delete()
    .like("customer_name", `${DEMO_PREFIX}%`)
    .select("order_number");
  if (error) {
    console.error("Gagal hapus data demo:", error.message);
    process.exit(1);
  }
  console.log(`Berhasil hapus ${data.length} data demo pesanan.`);
  process.exit(0);
}

// Jalankan ulang = replace, jadi tidak pernah dobel.
const { error: delError } = await db
  .from(TABLE)
  .delete()
  .like("customer_name", `${DEMO_PREFIX}%`);
if (delError) {
  console.error("Gagal membersihkan data demo lama:", delError.message);
  process.exit(1);
}

const dayOffset = (days) => {
  const t = new Date();
  t.setDate(t.getDate() + days);
  return t.toISOString();
};

const photo = (seed) => `https://picsum.photos/seed/${seed}/640/640`;

const items = (name, sizes) => [
  { name, sizes: sizes.map(([size, qty]) => ({ size, qty })) },
];

/**
 * Dua pesanan dengan tahap yang berbeda jauh, biar satu dashboard kelihatan
 * hidup: satu masih di tengah produksi, satu sudah dikirim (punya resi).
 */
const seeds = [
  {
    order: {
      order_number: "TAFF260930K4XQ",
      customer_name: `${DEMO_PREFIX}Komunitas Gowes Jogja`,
      customer_phone: "081234567901",
      customer_city: "Yogyakarta",
      product_type: "Jersey Cycling Full Printing",
      material: "Dryfit Serena",
      quantity: 48,
      sizes: "S(12), M(20), L(16)",
      custom_name: "",
      custom_number: "",
      design_notes:
        "[DEMO] Layout sudah di-acc customer, sekarang masuk cetak. Warna dasar masih menunggu konfirmasi sponsor.",
      current_status: "cetak_print",
      current_stage: 4,
      design_photos: [photo("taff-demo-gowes-1"), photo("taff-demo-gowes-2")],
      wo_photos: [photo("taff-demo-wo-1")],
      products: items("Jersey Cycling Full Printing", [
        ["S", 12],
        ["M", 20],
        ["L", 16],
      ]),
      courier: "",
      tracking_number: "",
      deadline: dayOffset(5),
      created_at: dayOffset(-3),
      updated_at: dayOffset(0),
    },
    // Tahap-tahap yang sudah dilalui, lengkap dengan catatan & waktunya.
    history: [
      { status: "desain", note: "Brief diterima, mulai sketsa layout.", photo: "taff-demo-gowes-1", daysAgo: 3 },
      { status: "layout", note: "Layout dikirim ke customer untuk review.", photo: "taff-demo-gowes-2", daysAgo: 2 },
      { status: "profing_warna", note: "Profing warna disetujui, lanjut cetak.", photo: "", daysAgo: 1 },
      { status: "cetak_print", note: "Mulai cetak panel depan & belakang.", photo: "", daysAgo: 0 },
    ],
  },
  {
    order: {
      order_number: "TAFF260930P7MN",
      customer_name: `${DEMO_PREFIX}SMAN 2 Bantul`,
      customer_phone: "081234567902",
      customer_city: "Bantul",
      product_type: "Jersey Futsal Full Printing",
      material: "Dryfit Micro",
      quantity: 24,
      sizes: "M(10), L(10), XL(4)",
      custom_name: "",
      custom_number: "",
      design_notes:
        "[DEMO] Pesanan tuntas dan sudah dikirim. Resi JNE terlampir di halaman tracking.",
      current_status: "kirim",
      current_stage: 11,
      design_photos: [photo("taff-demo-sman-1")],
      wo_photos: [photo("taff-demo-wo-2")],
      products: items("Jersey Futsal Full Printing", [
        ["M", 10],
        ["L", 10],
        ["XL", 4],
      ]),
      courier: "JNE - REG",
      tracking_number: "JNE00998877665",
      deadline: dayOffset(1),
      created_at: dayOffset(-12),
      updated_at: dayOffset(0),
    },
    history: [
      { status: "desain", note: "Desain awal masuk.", photo: "taff-demo-sman-1", daysAgo: 12 },
      { status: "layout", note: "Penomoran punggung dikonfirmasi.", photo: "", daysAgo: 11 },
      { status: "profing_warna", note: "Profing warna lolos.", photo: "", daysAgo: 10 },
      { status: "cetak_print", note: "Cetak 24 set panel.", photo: "", daysAgo: 9 },
      { status: "press_transfer", note: "Press sublime selesai.", photo: "", daysAgo: 7 },
      { status: "potong_pola", note: "Cutting panel selesai.", photo: "", daysAgo: 6 },
      { status: "jahit", note: "Semua set selesai dijahit.", photo: "", daysAgo: 4 },
      { status: "finishing", note: "Buang benang & setrika.", photo: "", daysAgo: 3 },
      { status: "quality_control", note: "QC lolos, tidak ada cacat.", photo: "", daysAgo: 2 },
      { status: "packing", note: "Dikemas per nama pemesan.", photo: "", daysAgo: 1 },
      {
        status: "kirim",
        note: "Dikirim via JNE - REG, no. resi JNE00998877665.",
        photo: "",
        daysAgo: 0,
      },
    ],
  },
];

let insertedOrders = 0;
let insertedHistory = 0;

for (const seed of seeds) {
  const { data: order, error } = await db
    .from(TABLE)
    .insert(seed.order)
    .select("id, order_number")
    .single();

  if (error) {
    console.error(`Gagal insert ${seed.order.order_number}:`, error.message);
    process.exit(1);
  }
  insertedOrders++;

  const historyRows = seed.history.map((h) => ({
    order_id: order.id,
    status: h.status,
    note: h.note,
    photo_url: h.photo ? photo(h.photo) : "",
    created_at: dayOffset(-h.daysAgo),
  }));

  const { error: historyError } = await db
    .from(HISTORY_TABLE)
    .insert(historyRows);
  if (historyError) {
    console.error(
      `Gagal insert riwayat ${order.order_number}:`,
      historyError.message
    );
    process.exit(1);
  }
  insertedHistory += historyRows.length;
}

const { data } = await db
  .from(TABLE)
  .select("order_number, customer_name, current_stage, current_status, courier, deadline")
  .like("customer_name", `${DEMO_PREFIX}%`)
  .order("created_at", { ascending: false });

console.log(
  `Berhasil insert ${insertedOrders} pesanan demo + ${insertedHistory} baris riwayat tahap.\n`
);
console.table(data);
console.log(
  "Bersihkan lagi dengan: node --env-file=.env.local scripts/seed-pesanan-demo.mjs --clean"
);

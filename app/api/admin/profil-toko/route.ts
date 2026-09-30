import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/admin-auth";

// Tanpa guard, siapa pun bisa mengubah nomor WhatsApp toko lewat POST —
// yaitu mengalihkan semua pesanan customer ke nomor lain.
export async function GET() {
  const supabase = await getAdminDb();
  if (!supabase) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: brand } = await supabase
    .from("brand")
    .select("name, whatsapp_number")
    .eq("id", 1)
    .single();

  const { data: opHours } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "jam_operasional")
    .single();

  return NextResponse.json({
    name: brand?.name || "TAFF Sportwear",
    whatsapp_number: brand?.whatsapp_number || "",
    jam_operasional: opHours?.value || "Senin–Sabtu · 09.00–17.00 WIB",
  });
}

export async function POST(req: Request) {
  const supabase = await getAdminDb();
  if (!supabase) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { name, whatsapp_number, jam_operasional } = body;

  const { error: brandErr } = await supabase
    .from("brand")
    .update({ name: name || "TAFF Sportwear", whatsapp_number: whatsapp_number || "" })
    .eq("id", 1);

  if (brandErr) {
    return NextResponse.json({ error: brandErr.message }, { status: 500 });
  }

  const { error: opErr } = await supabase
    .from("app_settings")
    .upsert({ key: "jam_operasional", value: jam_operasional || "" }, { onConflict: "key" });

  if (opErr) {
    return NextResponse.json({ error: opErr.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}

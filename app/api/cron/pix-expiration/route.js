import { NextResponse } from "next/server";
import { processPixExpirations } from "@/lib/pix-expiration";

export const runtime = "nodejs";

export async function GET(request) {
  if (!process.env.CRON_SECRET || request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }
  return NextResponse.json({ ok: true, ...(await processPixExpirations()) });
}

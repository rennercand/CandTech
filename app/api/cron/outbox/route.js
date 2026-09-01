import { NextResponse } from "next/server";
import { processOutboxBatch } from "@/lib/outbox-worker";
import { reportServerError } from "@/lib/server-observability";

export const runtime = "nodejs";

export async function GET(request) {
  if (!process.env.CRON_SECRET || request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }
  try {
    return NextResponse.json({ ok: true, ...(await processOutboxBatch()) });
  } catch (error) {
    reportServerError(error, { request, route: "/api/cron/outbox", operation: "process" });
    return NextResponse.json({ error: "Não foi possível processar a fila." }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { enforceRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

export async function GET(request) {
  const limited = await enforceRateLimit(request, { scope: "profile-read", limit: 60 });
  if (limited) return limited;
  const user = await getSession(request, { allowInactiveSubscription: true });
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  return NextResponse.json(
    {
      profile: {
        name: user.name,
        email: user.email,
        subscriptionStatus: user.subscriptionStatus,
      },
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

export async function PUT() {
  return NextResponse.json(
    { error: "A identificação do pagamento usa somente o nome e o e-mail da conta." },
    { status: 405, headers: { Allow: "GET", "Cache-Control": "private, no-store" } },
  );
}

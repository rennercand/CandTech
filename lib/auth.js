import { SignJWT, jwtVerify } from "jose";
import { createHash, randomUUID } from "node:crypto";
import { createAuthSession, findActiveAuthSession, findUserById, revokeAuthSession } from "@/lib/db";

function secret() {
  // TODO antes de publicar: defina JWT_SECRET em .env.local e no provedor.
  if (!process.env.JWT_SECRET) throw new Error("JWT_SECRET não configurado");
  return new TextEncoder().encode(process.env.JWT_SECRET);
}

export async function createToken(user) {
  const sessionId = randomUUID();
  const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1_000);
  await createAuthSession({ sessionHash: hashSessionId(sessionId), userId: user.id, expiresAt });
  return new SignJWT({
    name: user.name,
    email: user.email,
    accountType: user.accountType || user.account_type || "person",
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(user.id))
    .setJti(sessionId)
    .setIssuedAt()
    .setExpirationTime(Math.floor(expiresAt.getTime() / 1_000))
    .sign(secret());
}

function hashSessionId(sessionId) {
  return createHash("sha256").update(String(sessionId)).digest("hex");
}

export async function getSession(request, { allowUnverified = false } = {}) {
  const token = request.cookies.get("finsight_token")?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"] });
    if (!payload.jti) return null;
    const sessionHash = hashSessionId(payload.jti);
    const active = await findActiveAuthSession(sessionHash);
    if (!active || active.userId !== Number(payload.sub)) return null;
    // Claims de perfil no JWT podem ficar desatualizadas. A sessão prova apenas
    // a identidade; atributos usados em autorização sempre vêm do banco atual.
    const currentUser = await findUserById(active.userId);
    if (!currentUser) return null;
    const emailVerified = !currentUser.email_verification_required || Boolean(currentUser.email_verified_at);
    if (!allowUnverified && !emailVerified) return null;
    return {
      id: Number(currentUser.id), name: currentUser.name, email: currentUser.email,
      accountType: currentUser.account_type || "person",
      emailVerified,
      sessionHash,
    };
  } catch {
    return null;
  }
}

export async function revokeSession(session) {
  if (!session?.sessionHash) return false;
  return revokeAuthSession(session.sessionHash);
}

export const authCookie = {
  httpOnly: true,
  // OAuth retorna por uma navegação GET de outro domínio; "lax" permite esse
  // retorno sem liberar o cookie para requisições POST feitas por terceiros.
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: 60 * 60 * 8,
};

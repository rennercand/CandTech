import { SignJWT, jwtVerify } from "jose";

function secret() {
  // TODO antes de publicar: defina JWT_SECRET em .env.local e no provedor.
  if (!process.env.JWT_SECRET) throw new Error("JWT_SECRET não configurado");
  return new TextEncoder().encode(process.env.JWT_SECRET);
}

export async function createToken(user) {
  return new SignJWT({ name: user.name, email: user.email })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(user.id))
    .setIssuedAt()
    .setExpirationTime("8h")
    .sign(secret());
}

export async function getSession(request) {
  const token = request.cookies.get("finsight_token")?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"] });
    return { id: Number(payload.sub), name: payload.name, email: payload.email };
  } catch {
    return null;
  }
}

export const authCookie = {
  httpOnly: true,
  sameSite: "strict",
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: 60 * 60 * 8,
};

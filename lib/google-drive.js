import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";

const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} não configurado`);
  return value;
}

function encryptionKey() {
  const key = Buffer.from(required("DRIVE_TOKEN_ENCRYPTION_KEY"), "base64");
  if (key.length !== 32) {
    throw new Error("DRIVE_TOKEN_ENCRYPTION_KEY deve possuir 32 bytes em base64");
  }
  return key;
}

function stateSecret() {
  // Mantém compatibilidade até OAUTH_STATE_SECRET ser configurado; em produção,
  // a chave separada reduz o impacto de uma rotação ou incidente de sessão.
  return new TextEncoder().encode(process.env.OAUTH_STATE_SECRET || required("JWT_SECRET"));
}

export function googleDriveConfigured() {
  return Boolean(
    process.env.GOOGLE_CLIENT_ID &&
      process.env.GOOGLE_CLIENT_SECRET &&
      process.env.DRIVE_TOKEN_ENCRYPTION_KEY,
  );
}

export function encryptDriveToken(refreshToken) {
  // AES-256-GCM protege o refresh token e também detecta alterações no texto cifrado.
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(refreshToken, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [iv, tag, encrypted].map((part) => part.toString("base64url")).join(".");
}

export function decryptDriveToken(value) {
  const [ivValue, tagValue, encryptedValue] = String(value).split(".");
  if (!ivValue || !tagValue || !encryptedValue) throw new Error("Token cifrado inválido");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(ivValue, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedValue, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

export async function createDriveState(userId, redirectUri, historyId = null, sessionHash = "", returnTo = "", filename = "") {
  // O state assinado vincula o retorno do Google ao usuário e impede CSRF no callback.
  // O ID também é assinado para que a exportação continue sem aceitar alterações do navegador.
  const safeReturnTo = returnTo === "inventory" ? "inventory" : "";
  const safeFilename = String(filename || "").replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 120);
  return new SignJWT({ purpose: "google-drive", redirectUri, historyId, sessionHash, returnTo: safeReturnTo, filename: safeFilename })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(userId))
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(stateSecret());
}

export async function verifyDriveState(state) {
  const { payload } = await jwtVerify(state, stateSecret(), {
    algorithms: ["HS256"],
  });
  if (payload.purpose !== "google-drive" || !payload.sub || !payload.redirectUri) {
    throw new Error("Estado OAuth inválido");
  }
  return {
    userId: Number(payload.sub),
    redirectUri: String(payload.redirectUri),
    historyId: typeof payload.historyId === "string" && /^[0-9a-f-]{36}$/i.test(payload.historyId)
      ? payload.historyId
      : null,
    sessionHash: String(payload.sessionHash || ""),
    returnTo: payload.returnTo === "inventory" ? "inventory" : "",
    filename: String(payload.filename || "").slice(0, 120),
  };
}

export async function googleAuthorizationUrl({ userId, redirectUri, historyId, sessionHash, returnTo = "", filename = "" }) {
  const state = await createDriveState(userId, redirectUri, historyId, sessionHash, returnTo, filename);
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: required("GOOGLE_CLIENT_ID"),
    redirect_uri: redirectUri,
    response_type: "code",
    scope: DRIVE_SCOPE,
    access_type: "offline",
    include_granted_scopes: "true",
    prompt: "consent",
    state,
  }).toString();
  return url;
}

export async function exchangeAuthorizationCode({ code, redirectUri }) {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: required("GOOGLE_CLIENT_ID"),
      client_secret: required("GOOGLE_CLIENT_SECRET"),
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    }),
    cache: "no-store",
  });
  const data = await response.json();
  if (!response.ok || !data.refresh_token) {
    throw new Error(data.error_description || data.error || "Google não devolveu refresh token");
  }
  return data.refresh_token;
}

export async function refreshDriveAccessToken(refreshToken) {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: required("GOOGLE_CLIENT_ID"),
      client_secret: required("GOOGLE_CLIENT_SECRET"),
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
    cache: "no-store",
  });
  const data = await response.json();
  if (!response.ok || !data.access_token) {
    const error = new Error(data.error_description || data.error || "Falha ao renovar acesso ao Drive");
    error.code = data.error;
    throw error;
  }
  return data.access_token;
}

export async function uploadFileToDrive({ accessToken, filename, content, mimeType }) {
  const boundary = `finsight-${randomBytes(16).toString("hex")}`;
  const metadata = JSON.stringify({ name: filename, mimeType });
  // O corpo multipart usa Buffer para não corromper arquivos binários como XLSX.
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`),
    Buffer.isBuffer(content) ? content : Buffer.from(content),
    Buffer.from(`\r\n--${boundary}--`),
  ]);
  const response = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body,
      cache: "no-store",
    },
  );
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error?.message || "Google Drive recusou o arquivo");
  }
  return data;
}

export async function uploadCsvToDrive({ accessToken, filename, csv }) {
  return uploadFileToDrive({
    accessToken,
    filename,
    content: Buffer.from(`\ufeff${csv}`, "utf8"),
    mimeType: "text/csv",
  });
}

export async function revokeDriveToken(refreshToken) {
  // A revogação é melhor esforço; a conexão local será apagada mesmo se o Google estiver indisponível.
  await fetch("https://oauth2.googleapis.com/revoke", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token: refreshToken }),
    cache: "no-store",
  }).catch(() => null);
}

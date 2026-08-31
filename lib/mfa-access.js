export function hasVerifiedMfa(user) {
  return Boolean(user?.mfaEnabled && user?.mfaVerified);
}

export function mfaRequiredResponse() {
  return Response.json(
    { error: "Ative e confirme o MFA para acessar esta área.", code: "MFA_REQUIRED" },
    { status: 403, headers: { "Cache-Control": "private, no-store" } },
  );
}

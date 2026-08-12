// Estes dados são públicos por natureza e podem ser trocados sem alterar código.
export const SUPPORT_EMAIL = process.env.NEXT_PUBLIC_SUPPORT_EMAIL || "rennerecriss@gmail.com";
export const SUPPORT_PHONE = process.env.NEXT_PUBLIC_SUPPORT_PHONE || "+55 11 94333-5740";

export function publicSupportContact() {
  return {
    email: SUPPORT_EMAIL,
    phone: SUPPORT_PHONE,
    whatsapp: String(SUPPORT_PHONE).replace(/\D/g, ""),
  };
}

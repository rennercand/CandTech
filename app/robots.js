import { SITE_URL } from "@/lib/site";

export default function robots() {
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/api/", "/admin/", "/central/"] },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}

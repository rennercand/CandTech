const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://finance-app-indol-alpha.vercel.app";

export default function sitemap() {
  return [
    { url: siteUrl, changeFrequency: "weekly", priority: 1 },
    { url: `${siteUrl}/assinar`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${siteUrl}/privacidade`, changeFrequency: "yearly", priority: 0.3 },
  ];
}

import CandTechApp from "./candtech-app";
import PublicHome from "./public-home";
import { HOME_DESCRIPTION, HOME_META_TITLE, SITE_URL } from "@/lib/site";

export const metadata = {
  title: { absolute: HOME_META_TITLE },
  description: HOME_DESCRIPTION,
  alternates: { canonical: SITE_URL },
  openGraph: {
    title: HOME_META_TITLE,
    description: HOME_DESCRIPTION,
    url: SITE_URL,
    siteName: "CandTech",
    locale: "pt_BR",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: HOME_META_TITLE,
    description: HOME_DESCRIPTION,
  },
};

export default function HomePage() {
  return <CandTechApp publicFallback={<PublicHome />} />;
}

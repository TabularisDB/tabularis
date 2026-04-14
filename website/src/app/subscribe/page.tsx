import type { Metadata } from "next";
import { JsonLd } from "@/components/JsonLd";
import { SiteHeader } from "@/components/SiteHeader";
import { Footer } from "@/components/Footer";
import { NewsletterForm } from "@/components/NewsletterForm";
import { OG_IMAGE_URL } from "@/lib/siteConfig";
import { buildBreadcrumbJsonLd } from "@/lib/seo";

export const metadata: Metadata = {
  title: "Subscribe | Tabularis",
  description:
    "Subscribe to the Tabularis newsletter. Get release announcements, development insights, and project updates.",
  alternates: { canonical: "/subscribe" },
  openGraph: {
    type: "website",
    url: "https://tabularis.dev/subscribe/",
    title: "Subscribe | Tabularis",
    description:
      "Subscribe to the Tabularis newsletter. Get release announcements, development insights, and project updates.",
    images: [OG_IMAGE_URL],
  },
  twitter: {
    card: "summary_large_image",
    title: "Subscribe | Tabularis",
    description:
      "Subscribe to the Tabularis newsletter. Get release announcements, development insights, and project updates.",
    images: [OG_IMAGE_URL],
  },
};

export default function SubscribePage() {
  return (
    <div className="container">
      <JsonLd
        data={[
          buildBreadcrumbJsonLd([
            { name: "Home", path: "/" },
            { name: "Subscribe", path: "/subscribe" },
          ]),
        ]}
      />
      <SiteHeader crumbs={[{ label: "subscribe" }]} />

      <section className="subscribe-page">
        <div className="subscribe-page-hero">
          <h1>Newsletter</h1>
          <p>
            Stay up to date with Tabularis. Get release announcements,
            development insights, tips, and project updates delivered to your
            inbox.
          </p>
        </div>

        <NewsletterForm />
      </section>

      <Footer />
    </div>
  );
}

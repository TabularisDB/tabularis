import type { Metadata } from "next";
import Link from "next/link";
import { JsonLd } from "@/components/JsonLd";
import { SiteHeader } from "@/components/SiteHeader";
import { Footer } from "@/components/Footer";
import { DownloadInline } from "@/components/DownloadInline";
import { NewsletterForm } from "@/components/NewsletterForm";
import { APP_VERSION } from "@/lib/version";
import { OG_IMAGE_URL } from "@/lib/siteConfig";
import { getReleaseDate, formatDate } from "@/lib/posts";
import {
  buildBreadcrumbJsonLd,
  buildSoftwareApplicationJsonLd,
} from "@/lib/seo";

export const metadata: Metadata = {
  title: "Download | Tabularis",
  description:
    "Download Tabularis for Windows, macOS, and Linux. Available via WinGet, Homebrew, Snap, AUR and more.",
  alternates: { canonical: "/download" },
  openGraph: {
    type: "website",
    url: "https://tabularis.dev/download/",
    title: "Download | Tabularis",
    description:
      "Download Tabularis for Windows, macOS, and Linux. Available via WinGet, Homebrew, Snap, AUR and more.",
    images: [OG_IMAGE_URL],
  },
  twitter: {
    card: "summary_large_image",
    title: "Download | Tabularis",
    description:
      "Download Tabularis for Windows, macOS, and Linux. Available via WinGet, Homebrew, Snap, AUR and more.",
    images: [OG_IMAGE_URL],
  },
};

export default function DownloadPage() {
  const rawDate = getReleaseDate(APP_VERSION);
  const isoDate = rawDate?.slice(0, 10) ?? "";
  const releaseDate = rawDate ? formatDate(rawDate) : "";

  return (
    <div className="container">
      <JsonLd
        data={[
          buildBreadcrumbJsonLd([
            { name: "Home", path: "/" },
            { name: "Download", path: "/download" },
          ]),
          buildSoftwareApplicationJsonLd(),
        ]}
      />
      <SiteHeader crumbs={[{ label: "download" }]} />

      <section className="dl-page">
        <div className="dl-page-hero">
          <img src="/img/logo.png" alt="Tabularis" className="dl-page-logo" />
          <div className="dl-page-meta">
            <h1 className="dl-page-version">v{APP_VERSION}</h1>
            <div className="dl-page-submeta">
              {releaseDate && <time dateTime={isoDate}>{releaseDate}</time>}
              <span className="dl-page-sep">·</span>
              <Link href="/changelog" className="dl-page-changelog-link">
                View changelog →
              </Link>
            </div>
          </div>
        </div>

        <DownloadInline />

        <div className="dl-page-footer-links">
          <a
            href={`https://github.com/debba/tabularis/releases/tag/v${APP_VERSION}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            Release notes on GitHub →
          </a>
          <a
            href="https://github.com/debba/tabularis/releases"
            target="_blank"
            rel="noopener noreferrer"
          >
            All releases →
          </a>
          <Link href="/solutions/postgresql-client">
            PostgreSQL client guide →
          </Link>
          <Link href="/solutions/sql-notebooks">
            SQL notebooks guide →
          </Link>
          <Link href="/solutions/mysql-client-for-developers">
            MySQL client guide →
          </Link>
          <Link href="/solutions/secure-database-client">
            Secure database client guide →
          </Link>
        </div>

        <div className="plugin-cta dl-mirror-box">
          <h3>Alternative Mirrors</h3>
          <p>
            Prefer a secondary download mirror? Tabularis is also available on
            SourceForge. The primary and most up-to-date release channel remains
            GitHub Releases.
          </p>
          <a
            href="https://sourceforge.net/projects/tabularis/files/latest/download"
            target="_blank"
            rel="noopener noreferrer"
            className="btn-download"
            style={{ display: "inline-flex", width: "auto" }}
          >
            Download from SourceForge &rarr;
          </a>
        </div>

        <NewsletterForm compact />

        <div className="plugin-cta dl-mirror-box">
          <h3>Explore by Workflow</h3>
          <p>
            Not every download starts from the same use case. If you are here
            because of PostgreSQL, MySQL, secure access, notebooks, or plugin
            extensibility, start from the matching guide.
          </p>
          <div className="dl-page-footer-links">
            <Link href="/solutions/postgresql-client">
              PostgreSQL →
            </Link>
            <Link href="/solutions/mysql-client-for-developers">
              MySQL →
            </Link>
            <Link href="/solutions/secure-database-client">
              Security →
            </Link>
            <Link href="/solutions/plugin-based-database-client">
              Plugins →
            </Link>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
}

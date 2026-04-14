import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { Footer } from "@/components/Footer";
import { NewsletterGoal } from "@/components/NewsletterGoal";

export const metadata: Metadata = {
  title: "You're subscribed! | Tabularis",
  description:
    "Thank you for subscribing to the Tabularis newsletter.",
  robots: { index: false, follow: false },
};

export default function ThanksNewsletterPage() {
  return (
    <div className="container">
      <SiteHeader
        crumbs={[
          { label: "subscribe", href: "/subscribe" },
          { label: "thank you" },
        ]}
      />

      <NewsletterGoal />

      <section className="nl-thankyou">
        <div className="nl-thankyou-hero">
          <span className="nl-thankyou-kicker">You&apos;re in!</span>
          <h1 className="nl-thankyou-title">Thanks for subscribing</h1>
          <p className="nl-thankyou-desc">
            You&apos;ll receive release announcements, development insights, and
            project updates straight to your inbox. No spam, ever.
          </p>
        </div>

        <div className="dl-thankyou-cards">
          <Link href="/download" className="dl-thankyou-card">
            <div className="dl-thankyou-card-visual dl-thankyou-card-visual--docs">
              <svg
                width="48"
                height="48"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
            </div>
            <h3 className="dl-thankyou-card-title">Download Tabularis</h3>
            <p className="dl-thankyou-card-desc">
              Get the latest version for Windows, macOS, or Linux and start
              working with your databases.
            </p>
          </Link>

          <a
            href="https://discord.gg/YrZPHAwMSG"
            target="_blank"
            rel="noopener noreferrer"
            className="dl-thankyou-card"
          >
            <div className="dl-thankyou-card-visual dl-thankyou-card-visual--discord">
              <svg
                width="48"
                height="48"
                viewBox="0 0 24 24"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.947 2.418-2.157 2.418z" />
              </svg>
            </div>
            <h3 className="dl-thankyou-card-title">Join our Discord</h3>
            <p className="dl-thankyou-card-desc">
              Connect with the community, share feedback, and get help from
              other developers.
            </p>
          </a>

          <Link href="/blog" className="dl-thankyou-card">
            <div className="dl-thankyou-card-visual dl-thankyou-card-visual--github">
              <svg
                width="48"
                height="48"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
                <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
              </svg>
            </div>
            <h3 className="dl-thankyou-card-title">Read the Blog</h3>
            <p className="dl-thankyou-card-desc">
              Explore release notes, tutorials, and behind-the-scenes posts
              about Tabularis development.
            </p>
          </Link>
        </div>
      </section>

      <Footer />
    </div>
  );
}

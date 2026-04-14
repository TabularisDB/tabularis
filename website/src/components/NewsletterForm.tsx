"use client";

import Script from "next/script";

interface NewsletterFormProps {
  compact?: boolean;
}

const EMAILCHEF_SCRIPT =
  "https://app.emailchef.com/signup/form.js/7o22666s726q5s6964223n2237353333227q/en/api";

export function NewsletterForm({ compact = false }: NewsletterFormProps) {
  if (compact) {
    return (
      <div className="newsletter-box newsletter-compact">
        <div className="newsletter-compact-body">
          <div className="newsletter-compact-text">
            <h3>Stay in the loop</h3>
            <p>
              Get release notes, tips, and project updates. No spam,
              unsubscribe anytime.
            </p>
          </div>
          <form
            method="POST"
            action="https://app.emailchef.com/signupwl/7o22666s726q5s6964223n2237353333227q/en"
            className="newsletter-form newsletter-form-inline"
          >
            <input type="hidden" name="form_id" value="7533" />
            <input type="hidden" name="lang" value="" />
            <input type="hidden" name="referrer" value="" />
            <input type="hidden" name="redirect" value="/thanks-newsletter" />
            <div className="newsletter-inline-fields">
              <input
                type="email"
                name="field[-1]"
                placeholder="Enter your email"
                required
                className="newsletter-input"
                aria-label="Email address"
              />
              <button type="submit" className="newsletter-btn">
                Subscribe &rarr;
              </button>
            </div>
            <Script src={EMAILCHEF_SCRIPT} strategy="lazyOnload" />
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="newsletter-box">
      <div className="newsletter-header">
        <h3>Subscribe to the newsletter</h3>
        <p>
          Get release announcements, development insights, and project updates
          delivered to your inbox. No spam, unsubscribe anytime.
        </p>
      </div>
      <form
        method="POST"
        action="https://app.emailchef.com/signupwl/7o22666s726q5s6964223n2237353333227q/en"
        className="newsletter-form"
      >
        <input type="hidden" name="form_id" value="7533" />
        <input type="hidden" name="lang" value="" />
        <input type="hidden" name="referrer" value="" />
        <div className="newsletter-fields">
          <div className="newsletter-row">
            <label className="newsletter-label" htmlFor="nl-fname">
              First name
            </label>
            <input
              type="text"
              id="nl-fname"
              name="field[-2]"
              className="newsletter-input"
              placeholder="John"
            />
          </div>
          <div className="newsletter-row">
            <label className="newsletter-label" htmlFor="nl-lname">
              Last name
            </label>
            <input
              type="text"
              id="nl-lname"
              name="field[-3]"
              className="newsletter-input"
              placeholder="Doe"
            />
          </div>
          <div className="newsletter-row">
            <label className="newsletter-label" htmlFor="nl-email">
              Email <span className="newsletter-required">*</span>
            </label>
            <input
              type="email"
              id="nl-email"
              name="field[-1]"
              className="newsletter-input"
              placeholder="you@example.com"
              required
            />
          </div>
        </div>
        <button type="submit" className="newsletter-btn">
          Subscribe
        </button>
        <Script src={EMAILCHEF_SCRIPT} strategy="lazyOnload" />
      </form>
    </div>
  );
}

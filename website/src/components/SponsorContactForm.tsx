"use client";

import Script from "next/script";

export function SponsorContactForm() {
  return (
    <>
      <form
        method="POST"
        action="https://app.emailchef.com/signupwl/7o22666s726q5s6964223n2237353130227q/en"
        id="form1"
        className="sponsor-form"
      >
        <div className="sponsor-form-row">
          <div className="sponsor-form-field">
            <label htmlFor="field-2">
              First name <span aria-hidden="true">*</span>
            </label>
            <input
              id="field-2"
              name="field[-2]"
              type="text"
              placeholder="Andrea"
              required
              autoComplete="given-name"
            />
          </div>
          <div className="sponsor-form-field">
            <label htmlFor="field-3">
              Last name <span aria-hidden="true">*</span>
            </label>
            <input
              id="field-3"
              name="field[-3]"
              type="text"
              placeholder="Rossi"
              required
              autoComplete="family-name"
            />
          </div>
        </div>

        <div className="sponsor-form-row">
          <div className="sponsor-form-field">
            <label htmlFor="field211351">
              Company <span aria-hidden="true">*</span>
            </label>
            <input
              id="field211351"
              name="field[211351]"
              type="text"
              placeholder="Acme Inc."
              required
              autoComplete="organization"
            />
          </div>
          <div className="sponsor-form-field">
            <label htmlFor="field-1">
              Email <span aria-hidden="true">*</span>
            </label>
            <input
              id="field-1"
              name="field[-1]"
              type="email"
              placeholder="you@example.com"
              required
              autoComplete="email"
            />
          </div>
        </div>

        <div className="sponsor-form-field">
          <label htmlFor="field211349">
            Website <span aria-hidden="true">*</span>
          </label>
          <input
            id="field211349"
            name="field[211349]"
            type="url"
            placeholder="https://yoursite.com"
            required
            autoComplete="url"
          />
        </div>

        <div className="sponsor-form-field">
          <label htmlFor="field211350">Message</label>
          <textarea
            id="field211350"
            name="field[211350]"
            rows={5}
            placeholder="Tell us about your product and what kind of sponsorship you're interested in..."
          />
        </div>

        <input type="hidden" name="form_id" value="7510" />
        <input type="hidden" name="lang" value="" />
        <input type="hidden" name="referrer" id="ec_referrer" value="" />
        <input type="hidden" name="redirect" value="/sponsors/confirm" />

        <button
          type="submit"
          id="mc-signup-form-button-submit"
          name="mc-signup-form-button-submit"
          className="sponsor-form-submit"
        >
          Send message
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <line x1="22" y1="2" x2="11" y2="13" />
            <polygon points="22 2 15 22 11 13 2 9 22 2" />
          </svg>
        </button>
      </form>

      <Script
        src="https://app.emailchef.com/signup/form.js/7o22666s726q5s6964223n2237353130227q/en/api"
        strategy="lazyOnload"
      />
    </>
  );
}

"use client";
import { useState } from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  BookOpen,
  LoaderCircle,
  LockKeyhole,
  Waves,
} from "lucide-react";
import { authClient } from "@/utils/authClient";
export function AuthForm({ signUp }: { signUp: boolean }) {
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  async function submit(form: FormData) {
    setError("");
    setPending(true);
    try {
      const credentials = {
        email: String(form.get("email")),
        password: String(form.get("password")),
      };
      const result = signUp
        ? await authClient.signUp.email({
            ...credentials,
            name: String(form.get("name")),
          })
        : await authClient.signIn.email(credentials);
      if (result.error) {
        setError(
          result.error.message || "Could not sign in. Check your details.",
        );
        return;
      }
      window.location.assign("/workspace");
    } catch {
      setError("Could not reach the sign-in service. Try again.");
    } finally {
      setPending(false);
    }
  }
  return (
    <main className="auth-layout">
      <section className="auth-story">
        <Link href="/" className="brand">
          <span className="brand-mark">
            <BookOpen size={22} />
          </span>
          Fieldnotes
        </Link>
        <div className="story-center">
          <div className="notebook-art">
            <div className="notebook-spine" />
            <Waves size={68} strokeWidth={1} />
            <span>
              A little room
              <br />
              for a big idea.
            </span>
            <div className="notebook-bottom">Fieldnotes / Research journal</div>
          </div>
          <h1>
            Make room
            <br />
            for your thinking.
          </h1>
          <p>
            Collect the fragments. Find the connections.
            <br />
            Keep the things that move your work forward.
          </p>
        </div>
        <div className="story-footer">
          <span>Tabularis Neon Lab</span>
          <span>
            Ideas start here <ArrowUpRight size={15} />
          </span>
        </div>
      </section>
      <section className="auth-form-panel">
        <div className="auth-form-wrap">
          <div className="small-logo">
            <BookOpen size={24} />
          </div>
          <h2>
            {signUp ? "Your next idea starts here." : "Good to see you again."}
          </h2>
          <p className="muted">
            {signUp
              ? "Create a private workspace for everything worth keeping."
              : "Sign in to pick up where your thinking left off."}
          </p>
          <form action={submit} className="auth-form">
            {signUp && (
              <label>
                Your name
                <input
                  name="name"
                  autoComplete="name"
                  required
                  maxLength={100}
                  placeholder="Alex Morgan"
                />
              </label>
            )}
            <label>
              Email address
              <input
                name="email"
                type="email"
                autoComplete="email"
                required
                placeholder="you@example.com"
              />
            </label>
            <label>
              Password
              <input
                name="password"
                type="password"
                autoComplete={signUp ? "new-password" : "current-password"}
                required
                minLength={8}
                placeholder={signUp ? "At least 8 characters" : "Your password"}
              />
            </label>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <button className="primary" disabled={pending}>
              {pending ? <LoaderCircle className="spin" size={18} /> : null}
              {signUp ? "Create workspace" : "Sign in"}
            </button>
          </form>
          <p className="auth-switch">
            {signUp ? "Already have an account?" : "New to Fieldnotes?"}{" "}
            <Link href={signUp ? "/auth/sign-in" : "/auth/sign-up"}>
              {signUp ? "Sign in" : "Create an account"}
            </Link>
          </p>
          <div className="privacy-note">
            <LockKeyhole size={14} />
            <span>Your notes and files stay in your account.</span>
          </div>
        </div>
      </section>
    </main>
  );
}

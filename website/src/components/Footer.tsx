import Link from "next/link";
import { ManageCookiesButton } from "./ManageCookiesButton";

export function Footer() {
  return (
    <footer>
      <p>
        &copy; 2026 Tabularis Project &mdash;{" "}
        Crafted by <a href="https://github.com/debba">Debba</a>.
      </p>
      <p className="footer-links">
        <Link href="/subscribe">Subscribe</Link>
        <Link href="/cookie-policy">Cookie Policy</Link>
        <a href="https://github.com/debba/tabularis" target="_blank" rel="noopener noreferrer">GitHub</a>
        <a href="https://discord.gg/YrZPHAwMSG" target="_blank" rel="noopener noreferrer">Discord</a>
        <ManageCookiesButton />
      </p>
    </footer>
  );
}

import Link from "next/link";
import fs from "fs";
import path from "path";
import { marked } from "@/lib/markdown";
import { Footer } from "@/components/Footer";
import { DiscordIcon } from "@/components/Icons";
import { LightboxGallery } from "@/components/Lightbox";
import { getAllPosts } from "@/lib/posts";
import { PostCard } from "@/components/PostCard";
import { APP_VERSION } from "@/lib/version";
import { getAllPlugins } from "@/lib/plugins";

import { SiteHeader } from "@/components/SiteHeader";
import { DownloadButtons } from "@/components/DownloadButtons";
import { SponsorsSection } from "@/components/SponsorsSection";

const GITHUB_EDIT_HOME_URL =
  "https://github.com/debba/tabularis/edit/main/website/content/home.md";

// Helper to parse home.md into sections
function getHomeContent() {
  const filePath = path.join(process.cwd(), "content", "home.md");
  if (!fs.existsSync(filePath)) return {};

  const content = fs.readFileSync(filePath, "utf-8");
  const sections: Record<string, string> = {};

  // Split by # Header
  const parts = content.split(/^# /m);
  parts.forEach((part) => {
    if (!part.trim()) return;
    const lines = part.split("\n");
    const title = lines[0].trim().toLowerCase().replace(/[^\w]/g, "_");
    const body = lines.slice(1).join("\n").trim();
    sections[title] = marked.parse(body) as string;
  });

  return sections;
}

const GALLERY_ITEMS = [
  {
    src: "/img/screenshot-1.png",
    alt: "Connection Manager",
    caption: "Connection Manager",
  },
  {
    src: "/img/screenshot-2.png",
    alt: "SQL Editor",
    caption: "Data Grid & Editor",
  },
  {
    src: "/img/screenshot-3.png",
    alt: "Table Wizard",
    caption: "Schema Creation Wizard",
  },
  {
    src: "/img/screenshot-4.png",
    alt: "New Connection",
    caption: "Connection Setup",
  },
  { src: "/img/screenshot-8.png", alt: "AI Settings", caption: "AI Settings" },
  {
    src: "/img/screenshot-6.png",
    alt: "ER Diagram",
    caption: "ER Diagram Viewer",
  },
  {
    src: "/img/screenshot-7.png",
    alt: "Theme System",
    caption: "Theme System & Settings",
  },
  {
    src: "/img/screenshot-5.png",
    alt: "Visual Query Builder",
    caption: "Visual Query Builder",
  },
  { src: "/img/screenshot-9.png", alt: "Plugins", caption: "Plugins" },
  {
    src: "/img/screenshot-10.png",
    alt: "Task Manager",
    caption: "Task Manager",
  },
];

const THEMES = [
  {
    name: "Tabularis Dark",
    colors: ["#020617", "#1e293b", "#3b82f6", "#f87171"],
  },
  {
    name: "Tabularis Light",
    colors: ["#ffffff", "#f1f5f9", "#3b82f6", "#dc2626"],
  },
  { name: "Dracula", colors: ["#282a36", "#44475a", "#bd93f9", "#ff79c6"] },
  { name: "Nord", colors: ["#2e3440", "#3b4252", "#88c0d0", "#bf616a"] },
  { name: "Monokai", colors: ["#272822", "#3e3d32", "#a6e22e", "#f92672"] },
  { name: "GitHub Dark", colors: ["#24292e", "#1f2428", "#0366d6", "#ea4a5a"] },
  {
    name: "One Dark Pro",
    colors: ["#282c34", "#21252b", "#61afef", "#e06c75"],
  },
  {
    name: "Solarized Dark",
    colors: ["#002b36", "#073642", "#268bd2", "#b58900"],
  },
  {
    name: "Solarized Light",
    colors: ["#fdf6e3", "#eee8d5", "#268bd2", "#b58900"],
  },
  {
    name: "High Contrast",
    colors: ["#000000", "#1a1a1a", "#ffffff", "#ffff00"],
  },
];

export default function HomePage() {
  const posts = getAllPosts();
  const plugins = getAllPlugins()
    .slice(0, 3)
    .map((plugin) => ({
      ...plugin,
      min_tabularis_version: plugin.releases.find(
        (release) => release.version === plugin.latest_version,
      )?.min_tabularis_version,
    }));
  const home = getHomeContent();

  return (
    <div className="container">
      <SiteHeader />
      {/* HERO */}
      <header className="hero">
        <div className="hero-badges">
          <span className="badge version">v{APP_VERSION}</span>
          <span className="badge">Open Source</span>
          <span className="badge">Apache 2.0</span>
          <span className="badge">🌍 EN | IT | ES</span>
        </div>

        <p
          style={{
            fontSize: "1.2rem",
            color: "var(--text-muted)",
            marginTop: "1rem",
          }}
        >
          A lightweight, developer-focused database management tool.
          <br />
          Supports <strong>MySQL</strong>, <strong>PostgreSQL</strong> and{" "}
          <strong>SQLite</strong>. Hackable with plugins.
          <br />
          Built for speed, security, and aesthetics.
        </p>

        <DownloadButtons showInstallLink />

      </header>

      {/* MAIN SCREENSHOT */}
      <div className="screenshot-container">
        <img
          src="/img/overview.png"
          alt="Tabularis Overview"
          className="screenshot-main"
        />
      </div>

      {/* SPONSORS */}
      <SponsorsSection />

      {/* WHY TABULARIS */}
      <section className="section">
        <h2>_why_tabularis</h2>
        <div
          className="post-content"
          dangerouslySetInnerHTML={{ __html: home.why_tabularis || "" }}
        />
        <a
          href={GITHUB_EDIT_HOME_URL}
          className="edit-on-github-link"
          target="_blank"
          rel="noopener noreferrer"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
          </svg>
          Edit on GitHub
        </a>
        <div
          className="tech-stack"
          style={{
            marginTop: "2rem",
            display: "flex",
            gap: "2rem",
            flexWrap: "wrap",
            color: "var(--text-muted)",
          }}
        >
          <div
            className="tech-item"
            style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}
          >
            <span
              className="dot"
              style={{
                background: "#dea584",
                width: "8px",
                height: "8px",
                borderRadius: "50%",
              }}
            />
            Rust
          </div>
          <div
            className="tech-item"
            style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}
          >
            <span
              className="dot"
              style={{
                background: "#2b7489",
                width: "8px",
                height: "8px",
                borderRadius: "50%",
              }}
            />
            TypeScript
          </div>
          <div
            className="tech-item"
            style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}
          >
            <span
              className="dot"
              style={{
                background: "#61dafb",
                width: "8px",
                height: "8px",
                borderRadius: "50%",
              }}
            />
            React
          </div>
          <div
            className="tech-item"
            style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}
          >
            <span
              className="dot"
              style={{
                background: "#f1e05a",
                width: "8px",
                height: "8px",
                borderRadius: "50%",
              }}
            />
            SQLite/PG/MySQL
          </div>
        </div>
      </section>

      {/* CAPABILITIES */}
      <section className="section">
        <h2>_capabilities</h2>
        <div className="features-grid">
          <article className="feature-card">
            <h3>🔌 Multi-Database</h3>
            <p>
              First-class support for <strong>PostgreSQL</strong> (with
              multi-schema support), <strong>MySQL/MariaDB</strong>, and{" "}
              <strong>SQLite</strong>. Manage multiple connection profiles with
              secure local persistence.
            </p>
          </article>
          <article className="feature-card">
            <h3>🤖 AI Assistance (Experimental)</h3>
            <p>
              Generate SQL from natural language (&quot;Show me active
              users&quot;) and get explanations for complex queries. Securely
              integrated with OpenAI, Anthropic, OpenRouter, and{" "}
              <strong>Ollama (Local LLM)</strong> for total privacy.
            </p>
          </article>
          <article className="feature-card">
            <h3>🔌 MCP Server</h3>
            <p>
              Built-in <strong>Model Context Protocol</strong> support. Expose
              your database schemas and run queries directly from Claude or
              other MCP-compatible AI agents.
            </p>
          </article>
          <article className="feature-card">
            <h3>🎨 Visual Query Builder</h3>
            <p>
              Construct complex queries visually. Drag tables, connect columns
              for JOINs, and let the tool write the SQL for you. Includes
              aggregate functions and advanced filtering.
            </p>
          </article>
          <article className="feature-card">
            <h3>🔒 SSH Tunneling &amp; Security</h3>
            <p>
              Connect to remote databases securely through SSH tunnels and
              manage SSH connections right from the connection manager.
              Passwords and API Keys are stored securely in your system&apos;s
              Keychain.
            </p>
          </article>
          <article className="feature-card">
            <h3>📝 Modern SQL Editor</h3>
            <p>
              Monaco-based editor with syntax highlighting, multiple tabs, and
              DataGrip-style execution (run selected, run all).
            </p>
          </article>
          <article className="feature-card">
            <h3>🪟 Split View</h3>
            <p>
              Work with <strong>multiple connections simultaneously</strong> in
              a resizable split-pane layout. Open any connection directly from
              the sidebar context menu and compare results across databases side
              by side.
            </p>
          </article>
          <article className="feature-card">
            <h3>🗄️ Schema Management</h3>
            <p>
              <strong>Inline editing</strong> of table and column properties
              directly from the sidebar. GUI wizards to Create Tables, Modify
              Columns, and Manage Indexes/Foreign Keys. Visualize your database
              structure with an interactive <strong>ER Diagram</strong>.
            </p>
          </article>
          <article className="feature-card">
            <h3>📦 SQL Dump &amp; Import</h3>
            <p>
              Export full database dumps and re-import SQL with a guided flow,
              making migrations and backups fast and safe.
            </p>
          </article>
          <article className="feature-card">
            <h3>📊 Data Grid</h3>
            <p>
              Inline editing, row deletion, and easy data entry. Copy selected
              rows to the clipboard, or export results to JSON or CSV with a
              single click.
            </p>
          </article>
          <article className="feature-card">
            <h3>🔄 Seamless Updates</h3>
            <p>
              <strong>Automatic:</strong> Tabularis checks for updates on
              startup and notifies you when a new version is available.{" "}
              <strong>Manual:</strong> You can always check for updates manually
              or download the latest release from GitHub.
            </p>
          </article>
          <article className="feature-card">
            <h3>📈 Task Manager</h3>
            <p>
              Monitor <strong>plugin processes</strong> in real time. Track CPU,
              RAM and disk usage for each plugin, inspect child processes, and
              force-kill or restart any plugin directly from the built-in Task
              Manager window.
            </p>
          </article>
        </div>
      </section>

      {/* PLUGINS */}
      <section className="section" id="plugins">
        <h2>_plugins</h2>
        <div
          className="post-content"
          dangerouslySetInnerHTML={{ __html: home.plugins || "" }}
        />
        <a
          href={GITHUB_EDIT_HOME_URL}
          className="edit-on-github-link"
          target="_blank"
          rel="noopener noreferrer"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
          </svg>
          Edit on GitHub
        </a>

        <h3
          style={{
            color: "var(--text-bright)",
            fontSize: "1rem",
            margin: "2.5rem 0 1.25rem",
            fontWeight: 600,
          }}
        >
          Available Plugins
        </h3>

        <div className="plugin-list">
          {plugins.length === 0 && (
            <p style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}>
              No plugins found in registry.
            </p>
          )}
          {plugins.map((plugin) => (
            <div key={plugin.id} className="plugin-entry">
              <div className="plugin-entry-info">
                <div className="plugin-entry-header">
                  <a
                    href={plugin.homepage}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="plugin-name"
                  >
                    {plugin.name}
                  </a>
                  <span className="plugin-badge">v{plugin.latest_version}</span>
                </div>
                <p className="plugin-desc">{plugin.description}</p>
                <div className="plugin-meta">
                  by{" "}
                  {plugin.author.includes("<") ? (
                    <a
                      href={plugin.author.match(/<(.*)>/)?.[1]}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {plugin.author.split("<")[0].trim()}
                    </a>
                  ) : (
                    plugin.author
                  )}{" "}
                  &middot;{" "}
                  {plugin?.min_tabularis_version && (
                    <span className="plugin-platforms">
                      Supports Tabularis v{plugin.min_tabularis_version}
                    </span>
                  )}
                </div>
              </div>
              <a
                href={plugin.homepage}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-plugin"
              >
                Repo &rarr;
              </a>
            </div>
          ))}
        </div>

        <p style={{ fontSize: "0.9rem", marginTop: "1.5rem" }}>
          <Link href="/plugins">Browse the full plugin registry &rarr;</Link>
        </p>
      </section>

      {/* THEMES */}
      <section className="section">
        <h2>_themes</h2>
        <p>
          Why stare at a dull interface? Tabularis brings a first-class theming
          experience. Switch instantly between <strong>10+ presets</strong>{" "}
          without restarting. Syntax highlighting is automatically generated
          from the UI theme.
        </p>

        <div className="theme-grid">
          {THEMES.map((theme) => (
            <div key={theme.name} className="theme-card">
              <div
                className="theme-card-preview"
                style={{ background: theme.colors[0] }}
              >
                <div
                  className="theme-card-sidebar"
                  style={{ background: theme.colors[1] }}
                >
                  <div
                    className="theme-card-dot"
                    style={{ background: theme.colors[2] }}
                  />
                  <div
                    className="theme-card-dot"
                    style={{ background: theme.colors[3] }}
                  />
                  <div
                    className="theme-card-dot"
                    style={{ background: theme.colors[2], opacity: 0.5 }}
                  />
                </div>
                <div className="theme-card-content">
                  <div
                    className="theme-card-line"
                    style={{ background: theme.colors[2], width: "60%" }}
                  />
                  <div
                    className="theme-card-line"
                    style={{ background: theme.colors[3], width: "40%" }}
                  />
                  <div
                    className="theme-card-line"
                    style={{
                      background: theme.colors[1],
                      width: "75%",
                      opacity: 0.6,
                    }}
                  />
                </div>
              </div>
              <div className="theme-card-label">{theme.name}</div>
            </div>
          ))}
        </div>
      </section>

      {/* WIKI */}
      <section className="section" id="wiki">
        <h2>_wiki</h2>
        <p>
          Need a deeper dive? Explore our documentation to learn about all the
          powerful features Tabularis has to offer.
        </p>
        <p className="blog-all-link" style={{ marginTop: "1rem" }}>
          <Link href="/wiki" style={{ fontWeight: 600 }}>
            Go to Wiki →
          </Link>
        </p>
      </section>

      {/* BLOG */}
      <section className="section" id="blog">
        <h2>_blog</h2>
        <div className="post-list">
          {posts.slice(0, 3).map((post) => (
            <PostCard key={post.slug} post={post} />
          ))}
        </div>
        <p className="blog-all-link" style={{ marginTop: "2rem" }}>
          <Link href="/blog" style={{ fontWeight: 600 }}>
            View all posts →
          </Link>
        </p>
      </section>

      {/* GALLERY */}
      <section className="section">
        <h2>_gallery</h2>
        <LightboxGallery items={GALLERY_ITEMS} />
      </section>

      {/* COMMUNITY */}
      <section className="section">
        <h2>_community</h2>
        <p>
          Join our <strong>Discord server</strong> to chat with the maintainers,
          suggest new features, or get help from the community.
        </p>
        <div style={{ marginTop: "2rem" }}>
          <a
            href="https://discord.gg/YrZPHAwMSG"
            className="discord-btn"
            style={{
              padding: "0.75rem 1.5rem",
              fontSize: "1rem",
            }}
          >
            <DiscordIcon size={20} />
            <span>Join Discord</span>
          </a>
        </div>
      </section>

      {/* INSTALLATION */}
      <section className="section" id="download">
        <h2>_installation</h2>

        <div className="post-content">
          <h3>Direct Download</h3>
          <p>Get the pre-compiled binaries for your operating system.</p>
        </div>

        <DownloadButtons />

        <div
          className="post-content"
          dangerouslySetInnerHTML={{ __html: home.installation || "" }}
        />
      </section>

      <Footer />
    </div>
  );
}

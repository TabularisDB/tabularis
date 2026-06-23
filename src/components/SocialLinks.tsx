import { openUrl } from "@tauri-apps/plugin-opener";
import clsx from "clsx";
import { SOCIAL_LINKS } from "../config/socialLinks";

interface SocialLinksProps {
  /** Icon size in px. */
  iconSize?: number;
  /** Show the network name next to each icon. */
  showLabels?: boolean;
  /** Labels to omit (e.g. networks already shown elsewhere). */
  exclude?: string[];
  /** Class applied to the container. */
  className?: string;
}

/**
 * Renders the project social links as buttons that open the URL externally.
 * Used in the Info settings tab and the update/what's-new/welcome modals.
 */
export function SocialLinks({
  iconSize = 18,
  showLabels = false,
  exclude,
  className,
}: SocialLinksProps) {
  const links = exclude?.length
    ? SOCIAL_LINKS.filter((link) => !exclude.includes(link.label))
    : SOCIAL_LINKS;

  return (
    <div className={clsx("flex flex-wrap items-center gap-2", className)}>
      {links.map(({ label, href, Icon }) => (
        <button
          key={label}
          type="button"
          onClick={() => openUrl(href)}
          title={label}
          aria-label={label}
          className={clsx(
            "flex items-center gap-2 rounded-lg border border-strong bg-surface-secondary text-secondary transition-colors hover:bg-surface-tertiary hover:text-primary",
            showLabels ? "px-3 py-2 text-sm font-medium" : "p-2",
          )}
        >
          <Icon size={iconSize} />
          {showLabels && <span>{label}</span>}
        </button>
      ))}
    </div>
  );
}

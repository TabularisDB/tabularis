import type { ComponentType } from "react";
import { Github } from "lucide-react";
import { LINKS } from "./links";
import { DiscordIcon } from "../components/icons/DiscordIcon";
import {
  XIcon,
  BlueskyIcon,
  MastodonIcon,
} from "../components/icons/BrandIcons";

interface SocialIconProps {
  size?: number;
  className?: string;
}

export interface SocialLink {
  label: string;
  href: string;
  Icon: ComponentType<SocialIconProps>;
}

/**
 * Project social links, kept in sync with the marketing site.
 * URLs come from the auto-generated src/config/links.ts (see scripts/sync-links.js).
 */
export const SOCIAL_LINKS: SocialLink[] = [
  { label: "GitHub", href: LINKS.GITHUB, Icon: Github },
  { label: "Discord", href: LINKS.DISCORD, Icon: DiscordIcon },
  { label: "X", href: LINKS.X, Icon: XIcon },
  { label: "Bluesky", href: LINKS.BLUESKY, Icon: BlueskyIcon },
  { label: "Mastodon", href: LINKS.MASTODON, Icon: MastodonIcon },
];

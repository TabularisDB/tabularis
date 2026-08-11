import { useState } from "react";
import type { ReactNode } from "react";

interface RegistryDriverIconProps {
  /** Icon URL served by the registry (http(s) or data URI). */
  src: string;
  /** Rendered square size of the image in px. */
  size: number;
  /** Shown instead of the image when the URL fails to load. */
  fallback: ReactNode;
}

/**
 * Remote driver icon that swaps to the generic fallback when the registry
 * URL is broken or unreachable, instead of leaving an invisible broken <img>.
 */
export function RegistryDriverIcon({ src, size, fallback }: RegistryDriverIconProps) {
  const [failed, setFailed] = useState(false);
  if (failed) return <>{fallback}</>;
  return (
    <img
      src={src}
      alt=""
      style={{ width: size, height: size }}
      className="rounded object-contain"
      onError={() => setFailed(true)}
    />
  );
}

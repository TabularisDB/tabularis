import { useEffect, useRef, useState } from "react";
import { usePlatformCapabilities } from "../hooks/usePlatformCapabilities";

interface Props {
  path: string;       // relative path "connection-icons/foo-abcd.png"
  size: number;
  fallback: React.ReactNode;
}

/**
 * Outer wrapper that keys on `path` so React unmounts/remounts the inner
 * component whenever the path changes — cleanly resetting all internal
 * state without calling setState during render or inside an effect body.
 */
export function ConnectionIconImage(props: Props) {
  return <ConnectionIconImageInner key={props.path} {...props} />;
}

function ConnectionIconImageInner({ path, size, fallback }: Props) {
  const platform = usePlatformCapabilities();
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => () => { mountedRef.current = false; }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const assetSource = await platform.resolveAppAsset(path);
        if (!cancelled) setSrc(assetSource);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => { cancelled = true; };
  }, [path, platform]);

  if (failed) return <>{fallback}</>;
  if (!src) return <>{fallback}</>;
  return (
    <img
      src={src}
      width={size}
      height={size}
      alt=""
      onError={() => {
        if (import.meta.env.DEV) {
          console.error("[ConnectionIconImage] Failed to load icon from path:", path, "src:", src);
        }
        if (mountedRef.current) setFailed(true);
      }}
      style={{ objectFit: "contain", borderRadius: 4 }}
    />
  );
}

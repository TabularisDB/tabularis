import { useEffect, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { appDataDir, join } from "@tauri-apps/api/path";

interface Props {
  path: string;       // relative path "connection-icons/foo-abcd.png"
  size: number;
  fallback: React.ReactNode;
}

export function ConnectionIconImage({ path, size, fallback }: Props) {
  // Reset src/failed when path changes by keying state to the current path.
  // This avoids calling setState inside an effect body (react-hooks/set-state-in-effect).
  const [loadedPath, setLoadedPath] = useState<string>(path);
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => () => { mountedRef.current = false; }, []);

  if (loadedPath !== path) {
    setLoadedPath(path);
    setSrc(null);
    setFailed(false);
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const abs = await join(await appDataDir(), path);
        if (!cancelled) setSrc(convertFileSrc(abs));
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => { cancelled = true; };
  }, [path]);

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

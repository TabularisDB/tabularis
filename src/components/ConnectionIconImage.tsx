import { useEffect, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { appDataDir, join } from "@tauri-apps/api/path";

interface Props {
  path: string;       // relative path "connection-icons/foo-abcd.png"
  size: number;
  fallback: React.ReactNode;
}

export function ConnectionIconImage({ path, size, fallback }: Props) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

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
      onError={() => setFailed(true)}
      style={{ objectFit: "contain", borderRadius: 4 }}
    />
  );
}

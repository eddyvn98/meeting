"use client";

import { useEffect, useRef, useState } from "react";

interface ScreenWakeLockSentinel extends EventTarget {
  released: boolean;
  release: () => Promise<void>;
}

interface WakeLockNavigator {
  wakeLock?: {
    request: (type: "screen") => Promise<ScreenWakeLockSentinel>;
  };
}

export function useScreenWakeLock(enabled: boolean): {
  supported: boolean;
  active: boolean;
} {
  const sentinelRef = useRef<ScreenWakeLockSentinel | null>(null);
  const [supported, setSupported] = useState(false);
  const [active, setActive] = useState(false);

  useEffect(() => {
    const wakeLock = (navigator as WakeLockNavigator).wakeLock;
    setSupported(Boolean(wakeLock?.request));
    let cancelled = false;

    const release = () => {
      const sentinel = sentinelRef.current;
      sentinelRef.current = null;
      setActive(false);
      if (sentinel) void sentinel.release().catch(() => undefined);
    };

    const acquire = async () => {
      if (cancelled || !enabled || !wakeLock || document.visibilityState !== "visible") return;
      if (sentinelRef.current?.released) sentinelRef.current = null;
      if (sentinelRef.current) return;
      try {
        const sentinel = await wakeLock.request("screen");
        if (cancelled || !enabled || document.visibilityState !== "visible") {
          await sentinel.release().catch(() => undefined);
          return;
        }
        sentinelRef.current = sentinel;
        setActive(true);
        sentinel.addEventListener("release", () => {
          if (sentinelRef.current === sentinel) {
            sentinelRef.current = null;
            setActive(false);
          }
        });
      } catch {
        setActive(false);
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") void acquire();
      else {
        const sentinel = sentinelRef.current;
        sentinelRef.current = null;
        setActive(false);
        if (sentinel) void sentinel.release().catch(() => undefined);
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    if (enabled) void acquire();
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      release();
    };
  }, [enabled]);

  return { supported, active };
}

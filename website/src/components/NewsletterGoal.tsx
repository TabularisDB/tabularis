"use client";

import { useEffect } from "react";

export function NewsletterGoal() {
  useEffect(() => {
    const _paq: unknown[][] | undefined = (
      window as unknown as { _paq?: unknown[][] }
    )._paq;
    if (_paq) {
      _paq.push(["trackGoal", 1]);
    }
  }, []);

  return null;
}

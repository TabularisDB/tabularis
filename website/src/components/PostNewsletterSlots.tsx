"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { NewsletterForm } from "./NewsletterForm";

export function PostNewsletterSlots() {
  const [slots, setSlots] = useState<Element[]>([]);

  useEffect(() => {
    setSlots(Array.from(document.querySelectorAll("[data-newsletter]")));
  }, []);

  if (slots.length === 0) return null;

  return (
    <>
      {slots.map((el, i) =>
        createPortal(<NewsletterForm compact />, el, `nl-slot-${i}`),
      )}
    </>
  );
}

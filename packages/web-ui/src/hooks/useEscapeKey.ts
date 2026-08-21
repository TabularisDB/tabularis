import { useEffect, useRef } from "react";

const modalStack: symbol[] = [];

export const useEscapeKey = (isOpen: boolean, onClose: () => void) => {
  const id = useRef(Symbol());

  useEffect(() => {
    if (!isOpen) return;

    const modalId = id.current;
    modalStack.push(modalId);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && modalStack[modalStack.length - 1] === modalId) {
        e.preventDefault();
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);

    return () => {
      const idx = modalStack.lastIndexOf(modalId);
      if (idx !== -1) modalStack.splice(idx, 1);
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [isOpen, onClose]);
};

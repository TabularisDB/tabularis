import { createPortal } from "react-dom";
import { useEscapeKey } from "../../hooks/useEscapeKey";

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
  overlayClassName?: string;
  closeOnBackdrop?: boolean;
}

export const Modal = ({
  isOpen,
  onClose,
  children,
  overlayClassName = "fixed inset-0 bg-black/50 flex items-center justify-center z-[100] backdrop-blur-sm",
  closeOnBackdrop = false,
}: ModalProps) => {
  useEscapeKey(isOpen, onClose);

  if (!isOpen) return null;

  return createPortal(
    // Backdrop only: the dialog inside carries the semantics, Escape closes it
    // via useEscapeKey, and clicks on the child never reach this check.
    <div
      role="presentation"
      className={overlayClassName}
      onMouseDown={(event) => {
        if (
          closeOnBackdrop &&
          event.target === event.currentTarget
        ) {
          onClose();
        }
      }}
    >
      {children}
    </div>,
    document.body,
  );
};

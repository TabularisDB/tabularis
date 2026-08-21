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
    <div
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

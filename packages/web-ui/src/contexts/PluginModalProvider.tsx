import { useState, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

import { PluginModalContext } from "./PluginModalContext";
import type { PluginModalOptions } from "./PluginModalContext";
import { Modal } from "../components/ui/Modal";

const SIZE_CLASSES: Record<string, string> = {
  sm: "w-[500px] h-[50vh]",
  md: "w-[700px] h-[65vh]",
  lg: "w-[900px] h-[80vh]",
  xl: "w-[1100px] h-[90vh]",
};

export const PluginModalProvider = ({ children }: { children: React.ReactNode }) => {
  const [modalState, setModalState] = useState<PluginModalOptions | null>(null);

  const openModal = useCallback((options: PluginModalOptions) => {
    setModalState(options);
  }, []);

  const closeModal = useCallback(() => {
    setModalState(null);
  }, []);

  const value = useMemo(() => ({ openModal, closeModal }), [openModal, closeModal]);

  const sizeClass = SIZE_CLASSES[modalState?.size ?? "lg"];

  const modal = (
    <Modal
      isOpen={modalState !== null}
      onClose={closeModal}
      overlayClassName="fixed inset-0 bg-black/50 flex items-center justify-center z-[10000] backdrop-blur-sm"
    >
      <div className={`bg-elevated border border-strong rounded-xl shadow-2xl flex flex-col ${sizeClass}`}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-default bg-base rounded-t-xl shrink-0">
          <h2 className="text-sm font-semibold text-primary">{modalState?.title}</h2>
          <button
            onClick={closeModal}
            className="p-1 rounded-md text-muted hover:text-primary hover:bg-hover transition-colors"
          >
            <X size={16} />
          </button>
        </div>
        <div className="flex-1 overflow-auto min-h-0">
          {modalState?.content}
        </div>
      </div>
    </Modal>
  );

  return (
    <PluginModalContext.Provider value={value}>
      {children}
      {createPortal(modal, document.body)}
    </PluginModalContext.Provider>
  );
};

import { Loader2 } from "lucide-react";

export const LoadingState = () => (
  <div className="flex h-full min-h-24 w-full items-center justify-center bg-base text-muted" aria-busy="true">
    <Loader2 size={24} className="animate-spin" />
  </div>
);

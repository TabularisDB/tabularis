import type { HTMLAttributes, ReactNode } from "react";
import clsx from "clsx";

/** Shared compact layout for saved connections and plugin management cards. */
export function CompactCard({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...props}
      className={clsx(
        "group relative flex min-w-0 flex-col rounded-2xl border transition-all duration-150 overflow-hidden",
        className,
      )}
    />
  );
}

export function CompactCardHeader({ icon, iconColor, children }: {
  icon: ReactNode;
  iconColor: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-start gap-3.5 px-4 pt-4 pb-3">
      <div
        className="w-11 h-11 rounded-xl flex items-center justify-center text-white shrink-0 shadow-md"
        style={{ backgroundColor: iconColor }}
      >
        {icon}
      </div>
      <div className="flex-1 min-w-0 pt-0.5">{children}</div>
    </div>
  );
}

export function CompactCardFooter({ children, className }: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={clsx("flex items-center justify-end px-3 py-2 border-t border-default/50 mt-auto", className)}>
      {children}
    </div>
  );
}

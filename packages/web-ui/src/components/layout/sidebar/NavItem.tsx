import React from "react";
import { NavLink } from "react-router-dom";
import clsx from "clsx";
import { RailIndicator } from "./RailIndicator";

interface NavItemProps {
  to: string;
  icon: React.ElementType;
  label: string;
  isConnected?: boolean;
}

export const NavItem = ({ to, icon: Icon, label, isConnected }: NavItemProps) => (
  <NavLink
    to={to}
    className={({ isActive }) =>
      clsx(
        "flex items-center justify-center w-12 h-12 rounded-lg transition-colors mb-2 relative group",
        isActive
          ? "bg-blue-600 text-white"
          : "text-muted hover:bg-surface-secondary hover:text-primary",
      )
    }
  >
    {({ isActive }) => (
      <>
        <RailIndicator isActive={isActive} className="-left-2" />
        <div className="relative">
          <Icon size={24} />
          {isConnected && (
            <span className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-green-500 border-2 border-elevated"></span>
          )}
        </div>
        <span className="absolute left-14 bg-surface-secondary text-primary text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-30 pointer-events-none">
          {label}
        </span>
      </>
    )}
  </NavLink>
);

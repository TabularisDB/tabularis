import React, { useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Calculator, ChevronDown } from "lucide-react";
import { isGeometricType } from "../../utils/geometry";
import {
  isRawSqlFunction,
  toggleGeometryMode,
} from "../../utils/geometryInput";

interface DropdownPosition {
  top: number;
  left: number;
}

interface GeometryInputProps {
  value: string;
  onChange: (value: string, isRawSql: boolean) => void;
  onBlur?: () => void;
  onKeyDown?: (e: React.KeyboardEvent) => void;
  placeholder?: string;
  dataType: string;
  inputRef?: React.RefObject<HTMLInputElement | null>;
  className?: string;
  onSqlFunctionsClick?: () => void; // Callback when SQL Functions button is clicked
  disabled?: boolean;
}

/**
 * Input component for geometry values with support for SQL functions
 * Shows a dropdown menu with SQL function presets when clicking the button
 */
export const GeometryInput = ({
  value,
  onChange,
  onBlur,
  onKeyDown,
  placeholder,
  dataType,
  inputRef,
  className = "",
  onSqlFunctionsClick,
  disabled = false,
}: GeometryInputProps) => {
  const { t } = useTranslation();
  const isRawSqlMode = isRawSqlFunction(value);
  const [showDropdown, setShowDropdown] = useState(false);
  const [showTooltip, setShowTooltip] = useState(false);
  const [dropdownPosition, setDropdownPosition] = useState<DropdownPosition | null>(null);
  const internalRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const actualRef = inputRef || internalRef;

  // Update dropdown position when it opens
  useEffect(() => {
    if (showDropdown && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      const dropdownHeight = 300; // Approximate height of dropdown
      const spaceBelow = window.innerHeight - rect.bottom;
      const spaceAbove = rect.top;
      
      // Open upward if there's not enough space below but there is above
      const openUpward = spaceBelow < dropdownHeight && spaceAbove > spaceBelow;
      
      setDropdownPosition({
        top: openUpward ? rect.top - dropdownHeight - 4 : rect.bottom + 4,
        left: rect.right - 256, // 256px = w-64
      });
    }
  }, [showDropdown]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowDropdown(false);
      }
    };

    if (showDropdown) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [showDropdown]);

  const handleToggleMode = () => {
    const newMode = !isRawSqlMode;
    const newValue = toggleGeometryMode(value, newMode);
    onChange(newValue, newMode);
  };

  const handleInsertFunction = (funcTemplate: string) => {
    onChange(funcTemplate, true);
    setShowDropdown(false);
    if (actualRef.current) {
      actualRef.current.focus();
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    onChange(newValue, isRawSqlMode);
  };

  const getPlaceholderText = () => {
    if (placeholder) return placeholder;
    return isRawSqlMode 
      ? t("geometryInput.sqlPlaceholder") 
      : t("geometryInput.wktPlaceholder");
  };

  const sqlFunctions = [
    { label: "ST_GeomFromText", template: "ST_GeomFromText('POINT(0 0)', 4326)" },
    { label: "ST_GeomFromText (no SRID)", template: "ST_GeomFromText('POINT(0 0)')" },
    { label: "ST_Point", template: "ST_Point(0, 0)" },
    { label: "ST_MakePoint", template: "ST_MakePoint(0, 0)" },
    { label: "ST_SetSRID", template: "ST_SetSRID(ST_MakePoint(0, 0), 4326)" },
  ];

  if (!isGeometricType(dataType)) {
    // Fallback to regular input for non-geometric types
    return (
      <input
        ref={actualRef as React.RefObject<HTMLInputElement>}
        value={value}
        onChange={handleChange}
        onBlur={onBlur}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        className={className}
        disabled={disabled}
      />
    );
  }

  return (
    <div className="relative w-full" ref={dropdownRef}>
      <div className="flex items-center gap-1">
        <input
          ref={actualRef as React.RefObject<HTMLInputElement>}
          value={value}
          onChange={handleChange}
          onBlur={onBlur}
          onKeyDown={onKeyDown}
          placeholder={getPlaceholderText()}
          className={`flex-1 bg-base text-primary border-none outline-none p-0 m-0 font-mono ${className}`}
          style={{ minWidth: 0 }}
          disabled={disabled}
        />
        <div className="relative">
          <button
            type="button"
            onMouseDown={(e) => {
              e.preventDefault(); // Prevent input blur
              e.stopPropagation();
            }}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (disabled) return;
              setShowTooltip(false);
              
              // If callback is provided, call it and close inline editing
              if (onSqlFunctionsClick) {
                onSqlFunctionsClick();
              } else {
                // Otherwise, toggle dropdown as before
                setShowDropdown(!showDropdown);
              }
            }}
            ref={buttonRef}
            disabled={disabled}
            onMouseEnter={() => !showDropdown && setShowTooltip(true)}
            onMouseLeave={() => setShowTooltip(false)}
            className={`flex-shrink-0 p-1.5 rounded transition-colors flex items-center gap-0.5 ${
              isRawSqlMode
                ? "bg-amber-500/20 text-amber-400 hover:bg-amber-500/30"
                : "bg-secondary/20 text-secondary hover:bg-secondary/30"
            }`}
            title={isRawSqlMode ? t("geometryInput.sqlMode") : t("geometryInput.toggleTooltip")}
          >
            <Calculator size={14} />
            <ChevronDown size={10} />
          </button>
          
          {/* Tooltip on hover */}
          {showTooltip && !showDropdown && (
            <div className="absolute z-[60] bottom-full right-0 mb-1 p-2 bg-surface-secondary border border-strong rounded shadow-lg text-xs text-secondary whitespace-nowrap pointer-events-none">
              {isRawSqlMode ? t("geometryInput.sqlMode") : t("geometryInput.toggleTooltip")}
            </div>
          )}
          
          {/* Dropdown menu */}
          {showDropdown && (
            <div 
              className="fixed z-[9999] w-64 bg-surface-secondary border border-strong rounded shadow-lg overflow-hidden"
              style={dropdownPosition ? {
                top: `${dropdownPosition.top}px`,
                left: `${dropdownPosition.left}px`,
              } : { display: 'none' }}
            >
              <div className="p-2 bg-surface-tertiary/50 border-b border-strong">
                <p className="text-xs font-medium text-primary">
                  {t("geometryInput.sqlMode")}
                </p>
                <p className="text-[10px] text-secondary mt-0.5">
                  {t("geometryInput.sqlHelper")}
                </p>
              </div>
               <div className="py-1">
                {sqlFunctions.map((func) => (
                  <button
                    key={func.label}
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      handleInsertFunction(func.template);
                    }}
                    className="w-full px-3 py-2 text-left text-xs text-secondary hover:bg-surface-tertiary hover:text-primary transition-colors"
                  >
                    {func.label}
                  </button>
                ))}
              </div>
              <div className="border-t border-strong p-2 bg-surface-tertiary/30">
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    handleToggleMode();
                  }}
                  className="w-full px-2 py-1.5 text-left text-xs text-secondary hover:text-primary transition-colors"
                >
                  {isRawSqlMode 
                    ? "← " + t("geometryInput.wktMode") 
                    : "→ " + t("geometryInput.sqlMode")}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};


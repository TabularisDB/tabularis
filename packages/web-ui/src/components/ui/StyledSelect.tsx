import { ChevronDown } from "lucide-react";

export interface StyledSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: string[];
  className?: string;
}

export const StyledSelect = ({ value, onChange, options, className = "" }: StyledSelectProps) => (
  <div className={`relative shrink-0 ${className}`}>
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full appearance-none bg-base border border-default rounded px-2 pr-6 py-1 text-xs text-secondary font-mono focus:outline-none focus:border-blue-500/60 cursor-pointer transition-colors hover:border-default/80"
    >
      {options.map((opt) => (
        <option key={opt} value={opt}>
          {opt}
        </option>
      ))}
    </select>
    <ChevronDown
      size={10}
      className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none"
    />
  </div>
);

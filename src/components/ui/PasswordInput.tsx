import { useState, type KeyboardEventHandler } from "react";
import { Eye, EyeOff } from "lucide-react";
import clsx from "clsx";

interface PasswordInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  className?: string;
  onKeyDown?: KeyboardEventHandler<HTMLInputElement>;
  "aria-label"?: string;
}

/**
 * Password field with a reveal (show/hide) toggle, matching the connection
 * form's field styling. The eye button is skipped in the tab order so keyboard
 * focus flows straight to the next real field.
 */
export const PasswordInput = ({
  value,
  onChange,
  placeholder,
  autoFocus,
  className,
  onKeyDown,
  "aria-label": ariaLabel,
}: PasswordInputProps) => {
  const [showPassword, setShowPassword] = useState(false);

  return (
    <div className="relative group">
      <input
        type={showPassword ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        autoFocus={autoFocus}
        autoCorrect="off"
        autoCapitalize="off"
        autoComplete="off"
        spellCheck={false}
        aria-label={ariaLabel}
        className={clsx(
          "w-full px-3 py-2 pr-10 bg-base border border-strong rounded-lg text-sm text-primary placeholder:text-muted focus:border-blue-500 focus:outline-none transition-colors",
          className,
        )}
      />
      <button
        type="button"
        onClick={() => setShowPassword((v) => !v)}
        className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted hover:text-primary transition-colors focus:outline-none"
        tabIndex={-1}
        aria-label={showPassword ? "Hide password" : "Show password"}
      >
        {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
      </button>
    </div>
  );
};

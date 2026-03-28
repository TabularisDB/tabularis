# Modal Styling Rules

This document defines the standard styling and structural patterns for all modal components in Tabularis.

## File Location

- **Primary location**: `src/components/modals/*.tsx` - for standalone modals
- **Secondary location**: `src/components/ui/*.tsx` - when modal is part of a larger UI component set

## Component Structure

### 1. Props Interface

Every modal must follow this interface pattern:

```typescript
interface XxxModalProps {
  isOpen: boolean;           // Controls modal visibility
  onClose: () => void;       // Close handler
  // ... additional specific props
}
```

### 2. Standard Imports

```typescript
import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { X, Loader2 } from "lucide-react";  // Close icon + loading spinner
import { invoke } from "@tauri-apps/api/core";  // If using Tauri commands
import { useAlert } from "../../hooks/useAlert";  // For notifications (showAlert)
```

### 3. Render Pattern

All modals must follow this HTML structure:

```tsx
if (!isOpen) return null;

return (
  <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[100] backdrop-blur-sm">
    <div className="bg-elevated border border-strong rounded-xl shadow-2xl w-[600px] max-h-[90vh] overflow-hidden flex flex-col">
      
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-default bg-base">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-{color}-900/30 rounded-lg">
            <Icon size={20} className="text-{color}-400" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-primary">{t("xxx.title")}</h2>
            <p className="text-xs text-secondary">{t("xxx.subtitle")}</p>
          </div>
        </div>
        <button onClick={onClose} className="text-secondary hover:text-primary transition-colors">
          <X size={20} />
        </button>
      </div>

      {/* Content */}
      <div className="p-6 space-y-6 overflow-y-auto">
        {/* Modal content goes here */}
      </div>

      {/* Footer (optional) */}
      <div className="p-4 border-t border-default bg-base/50 flex justify-end gap-3">
        <button onClick={onClose} className="px-4 py-2 text-secondary hover:text-primary transition-colors text-sm">
          {t("common.cancel")}
        </button>
        <button onClick={handleAction} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium">
          {t("common.save")}
        </button>
      </div>
    </div>
  </div>
);
```

## Visual Styling Standards

### Overlay
- `fixed inset-0 bg-black/50` - Semi-transparent black background
- `backdrop-blur-sm` - Subtle blur effect
- `z-[100]` - High z-index to appear above all other elements
- `flex items-center justify-center` - Center modal vertically and horizontally

### Container
- `bg-elevated` - Use elevated background color
- `border border-strong` - Strong border for definition
- `rounded-xl` - Large border radius (12px)
- `shadow-2xl` - Large shadow for depth
- `w-[600px]` - Standard width (600px)
- `max-h-[90vh] overflow-hidden` - Prevent overflow on small screens
- `flex flex-col` - Vertical layout

### Header
- `p-4 border-b border-default bg-base` - Padding, bottom border, base background
- Icon container: `p-2 bg-{color}-900/30 rounded-lg` - Themed background
- Icon: `text-{color}-400` - Themed icon color (use semantic colors: purple for tools, blue for info, green for success, red for danger)
- Title: `text-lg font-semibold text-primary`
- Subtitle: `text-xs text-secondary`

### Content
- `p-6 space-y-6` - Consistent padding and vertical spacing
- `overflow-y-auto` - Scrollable if content exceeds height

### Form Elements (when applicable)

**Labels:**
- `text-xs uppercase font-bold text-muted` - Small, uppercase, muted color

**Inputs:**
- `w-full px-3 py-2 bg-base border border-strong rounded-lg text-primary focus:border-blue-500 focus:outline-none`

**Textareas:**
- Same as inputs with `resize-none` to prevent manual resizing

### Footer
- `p-4 border-t border-default bg-base/50` - Padding, top border, semi-transparent background
- `flex justify-end gap-3` - Right-aligned buttons with gap

### Buttons

**Primary Action:**
- `px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium transition-colors`
- Add `shadow-lg shadow-blue-900/20` for emphasis on important actions

**Secondary/Cancel:**
- `px-4 py-2 text-secondary hover:text-primary transition-colors text-sm`

**Danger Action:**
- `px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded-lg text-sm font-medium transition-colors`

**Icon Buttons:**
- `p-2 bg-surface-secondary text-secondary hover:text-primary rounded transition-all`
- Position with `absolute` when inside relative containers

## Theming Guidelines

### Icon Colors (Semantic)
- **Purple** (`bg-purple-900/30`, `text-purple-400`): Tools, integrations, advanced features
- **Blue** (`bg-blue-900/30`, `text-blue-400`): Information, configuration, connections
- **Green** (`bg-green-900/30`, `text-green-400`): Success, confirmation, enabled states
- **Red** (`bg-red-900/30`, `text-red-400`): Danger, delete, error states
- **Yellow** (`bg-yellow-900/30`, `text-yellow-400`): Warnings, primary keys

### Status Indicators

**Success Badge:**
```tsx
<div className="flex items-center gap-2 text-green-400 bg-green-900/20 px-3 py-1 rounded-full text-xs font-medium border border-green-900/50">
  <Check size={14} />
  <span>{t("xxx.installed")}</span>
</div>
```

**Loading State:**
```tsx
<div className="text-center py-8 text-muted">
  <Loader2 size={24} className="animate-spin mx-auto mb-2" />
  {t("xxx.loading")}
</div>
```

## Content Patterns

### Description Box
Use for explanatory text at the top of the modal:
```tsx
<div className="bg-surface-secondary/50 p-4 rounded-lg border border-strong">
  <p className="text-sm text-secondary leading-relaxed">
    {t("xxx.description")}
  </p>
</div>
```

### Info Row
Use for displaying key-value information:
```tsx
<div className="flex items-center justify-between bg-base p-4 rounded-lg border border-default">
  <div className="flex items-center gap-3">
    <div className={`w-3 h-3 rounded-full ${isActive ? 'bg-green-500' : 'bg-surface-tertiary'}`} />
    <div>
      <div className="font-medium text-primary">{t("xxx.label")}</div>
      <div className="text-xs text-muted font-mono mt-1">{value}</div>
    </div>
  </div>
  {/* Status or action */}
</div>
```

## Accessibility Requirements

1. **Early Return**: Always use `if (!isOpen) return null;` before any logic or rendering
2. **Close Button**: Always include the X button in the top-right corner
3. **Focus Management**: Use `autoFocus` on primary input fields when modal opens
4. **Escape Key**: Modal should close when pressing Escape (implement via useEffect if needed)
5. **Backdrop Click**: Optional: close modal when clicking outside (on the overlay)

## Best Practices

1. **Translations**: All user-facing text must use `useTranslation()` hook
2. **Loading States**: Show loading indicator during async operations
3. **Error Handling**: Display inline errors or use dialog notifications
4. **Form Validation**: Validate before submitting, show inline errors
5. **Consistent Width**: Use 600px for standard modals, adjust only when necessary
6. **Scrollable Content**: Ensure content is scrollable with `overflow-y-auto` when needed

## Examples

### Simple Information Modal
```tsx
export const InfoModal = ({ isOpen, onClose, title, message }: InfoModalProps) => {
  const { t } = useTranslation();
  if (!isOpen) return null;
  
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[100] backdrop-blur-sm">
      <div className="bg-elevated border border-strong rounded-xl shadow-2xl w-[600px] max-h-[90vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-default bg-base">
          <h2 className="text-lg font-semibold text-primary">{title}</h2>
          <button onClick={onClose} className="text-secondary hover:text-primary transition-colors">
            <X size={20} />
          </button>
        </div>
        <div className="p-6">
          <p className="text-secondary">{message}</p>
        </div>
        <div className="p-4 border-t border-default bg-base/50 flex justify-end">
          <button onClick={onClose} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium">
            {t("common.ok")}
          </button>
        </div>
      </div>
    </div>
  );
};
```

### Form Modal with Loading State
```tsx
export const CreateModal = ({ isOpen, onClose, onSubmit }: CreateModalProps) => {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  
  if (!isOpen) return null;
  
  const handleSubmit = async () => {
    setLoading(true);
    try {
      await onSubmit(name);
      onClose();
    } finally {
      setLoading(false);
    }
  };
  
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[100] backdrop-blur-sm">
      <div className="bg-elevated border border-strong rounded-xl shadow-2xl w-[600px] max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header with icon */}
        <div className="flex items-center justify-between p-4 border-b border-default bg-base">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-900/30 rounded-lg">
              <Plus size={20} className="text-blue-400" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-primary">{t("create.title")}</h2>
              <p className="text-xs text-secondary">{t("create.subtitle")}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-secondary hover:text-primary transition-colors">
            <X size={20} />
          </button>
        </div>
        
        {/* Form content */}
        <div className="p-6 space-y-4">
          <div>
            <label className="text-xs uppercase font-bold text-muted mb-1 block">
              {t("create.nameLabel")}
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 bg-base border border-strong rounded-lg text-primary focus:border-blue-500 focus:outline-none"
              placeholder={t("create.namePlaceholder")}
              autoFocus
            />
          </div>
        </div>
        
        {/* Footer with loading state */}
        <div className="p-4 border-t border-default bg-base/50 flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-secondary hover:text-primary transition-colors text-sm">
            {t("common.cancel")}
          </button>
          <button 
            onClick={handleSubmit}
            disabled={loading || !name}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
          >
            {loading && <Loader2 size={16} className="animate-spin" />}
            {t("common.create")}
          </button>
        </div>
      </div>
    </div>
  );
};
```

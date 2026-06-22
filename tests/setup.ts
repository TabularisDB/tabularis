import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";
import { vi } from "vitest";

// Cleanup after each test
afterEach(() => {
  cleanup();
});

// Mock browser APIs missing in JSDOM for Monaco Editor
Object.defineProperty(document, "queryCommandSupported", {
  value: vi.fn().mockImplementation(() => true),
});
Object.defineProperty(document, "execCommand", {
  value: vi.fn(),
});

// Mock Tauri APIs
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/window", () => ({
  UserAttentionType: {
    Critical: 1,
    Informational: 2,
  },
  getCurrentWindow: () => ({
    isAlwaysOnTop: vi.fn().mockResolvedValue(false),
    isVisible: vi.fn().mockResolvedValue(true),
    isMinimized: vi.fn().mockResolvedValue(false),
    setAlwaysOnTop: vi.fn().mockResolvedValue(undefined),
    show: vi.fn().mockResolvedValue(undefined),
    hide: vi.fn().mockResolvedValue(undefined),
    minimize: vi.fn().mockResolvedValue(undefined),
    unminimize: vi.fn().mockResolvedValue(undefined),
    setFocus: vi.fn().mockResolvedValue(undefined),
    requestUserAttention: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock("@tauri-apps/plugin-notification", () => ({
  isPermissionGranted: vi.fn().mockResolvedValue(true),
  requestPermission: vi.fn().mockResolvedValue("granted"),
  sendNotification: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  ask: vi.fn(),
  message: vi.fn(),
  open: vi.fn(),
  save: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-fs", () => ({
  writeTextFile: vi.fn(),
  BaseDirectory: {
    Document: 1,
  },
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(),
}));

// Mock Lingui so components render their source English without an I18nProvider.
// `t` handles both the tagged-template macro (t`...${x}...`) and the descriptor
// form (t({ message, context })); `i18n._` resolves a MessageDescriptor to its
// message. Mirrors how the macros behave at runtime for source-text catalogs.
// Loosely typed: the macro `t` is called both as a tagged template and with a
// descriptor object, which TS can't narrow cleanly via Array.isArray here.
const linguiT = (strings: unknown, ...values: unknown[]): string => {
  if (Array.isArray(strings)) {
    return strings.reduce(
      (acc: string, s: string, i: number) => acc + s + (i < values.length ? String(values[i]) : ""),
      "",
    );
  }
  if (typeof strings === "object" && strings !== null) {
    const d = strings as { message?: string; id?: string };
    return d.message ?? d.id ?? "";
  }
  return String(strings);
};
const linguiI18n = {
  _: (d: { message?: string; id?: string } | string, values?: Record<string, unknown>) => {
    let msg = typeof d === "string" ? d : (d?.message ?? d?.id ?? "");
    if (values) for (const [k, v] of Object.entries(values)) msg = msg.replaceAll(`{${k}}`, String(v));
    return msg;
  },
  locale: "en",
  load: vi.fn(),
  activate: vi.fn(),
};
vi.mock("@lingui/react/macro", () => ({
  useLingui: () => ({ t: linguiT, i18n: linguiI18n }),
  Trans: ({ children }: { children?: unknown }) => children,
}));
vi.mock("@lingui/react", () => ({
  useLingui: () => ({ i18n: linguiI18n, _: linguiI18n._ }),
  I18nProvider: ({ children }: { children?: unknown }) => children,
  Trans: ({ children }: { children?: unknown }) => children,
}));

// Mock Monaco Editor
vi.mock("@monaco-editor/react", () => ({
  __esModule: true,
  default: vi.fn(() => null),
  loader: {
    init: vi.fn().mockResolvedValue({
      languages: {
        registerCompletionItemProvider: vi.fn(),
      },
    }),
  },
}));

// Mock lucide-react icons
vi.mock("lucide-react", () => ({
  Trash2: () => null,
  Edit: () => null,
  ArrowUp: () => null,
  ArrowDown: () => null,
  ArrowUpDown: () => null,
  Filter: () => null,
  ListFilter: () => null,
  X: () => null,
  Database: () => null,
  ChevronDown: () => null,
  Plus: () => null,
  Save: () => null,
  Play: () => null,
  MoreHorizontal: () => null,
  LayoutGrid: () => null,
  Settings: () => null,
  Copy: () => null,
  Link: () => null,
  Eye: () => null,
  RefreshCw: () => null,
  SquareStack: () => null,
  Check: () => null,
  Undo: () => null,
  Minus: () => null,
  Network: () => null,
  Code: () => null,
  FileText: () => null,
  Command: () => null,
  Braces: () => null,
  Sparkles: () => null,
  Ban: () => null,
  FileDigit: () => null,
  HelpCircle: () => null,
  Maximize: () => null,
  Maximize2: () => null,
  Minimize: () => null,
  ZoomIn: () => null,
  ZoomOut: () => null,
  RotateCcw: () => null,
  Hash: () => null,
  Columns: () => null,
  Key: () => null,
  KeyRound: () => null,
  Table2: () => null,
  Trash: () => null,
  ChevronRight: () => null,
  ChevronLeft: () => null,
  ChevronUp: () => null,
  FirstPage: () => null,
  LastPage: () => null,
  Menu: () => null,
  Search: () => null,
  Loader2: () => null,
  PanelLeft: () => null,
  GripVertical: () => null,
  PanelLeftOpen: () => null,
  PanelLeftClose: () => null,
  MoreVertical: () => null,
  Pencil: () => null,
  ExternalLink: () => null,
  Star: () => null,
  Cpu: () => null,
  Globe: () => null,
  Lock: () => null,
  Unlock: () => null,
  Shield: () => null,
  User: () => null,
  Folder: () => null,
  FolderOpen: () => null,
  File: () => null,
  FileCode: () => null,
  Terminal: () => null,
  History: () => null,
  Clock: () => null,
  Calendar: () => null,
  XCircle: () => null,
  ChevronsLeft: () => null,
  ChevronsRight: () => null,
  ListChecks: () => null,
  ArrowRightToLine: () => null,
  ArrowLeftToLine: () => null,
  Code2: () => null,
  Rows3: () => null,
  WrapText: () => null,
  PanelTop: () => null,
  ChevronsDownUp: () => null,
  ChevronsUpDown: () => null,
  AlertTriangle: () => null,
  Home: () => null,
  Github: () => null,
  Share2: () => null,
  // CONNECTION_ICON_PACK icons
  Server: () => null,
  HardDrive: () => null,
  Cloud: () => null,
  CloudCog: () => null,
  ShieldCheck: () => null,
  Flame: () => null,
  Bug: () => null,
  Beaker: () => null,
  Wrench: () => null,
  Hammer: () => null,
  Heart: () => null,
  Flag: () => null,
  Bookmark: () => null,
  Box: () => null,
  Archive: () => null,
  Activity: () => null,
  Zap: () => null,
  Layers: () => null,
  Truck: () => null,
  Rocket: () => null,
  TestTube: () => null,
  Briefcase: () => null,
  Plug: () => null,
  // AppearanceSection tab icons
  Grid3x3: () => null,
  Smile: () => null,
  Image: () => null,
  Pipette: () => null,
  Upload: () => null,
}));

// Mock lucide-react/dynamicIconImports with a small deterministic set
vi.mock("lucide-react/dynamicIconImports", () => ({
  default: new Proxy({}, {
    get(_t: object, _key: string) {
      // Each entry must be a function returning a Promise resolving to a default-exported component
      return () => Promise.resolve({ default: () => null });
    },
    has(_t: object, key: string) {
      // Whitelist a few known names for filtering tests
      return ["shield-check", "shield", "server", "database", "circle"].includes(key);
    },
    ownKeys() {
      return ["shield-check", "shield", "server", "database", "circle"];
    },
    getOwnPropertyDescriptor() {
      return { enumerable: true, configurable: true, value: () => Promise.resolve({ default: () => null }) };
    },
  }),
}));

// Mock scrollIntoView (not available in JSDOM)
Element.prototype.scrollIntoView = vi.fn();

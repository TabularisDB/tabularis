import "@testing-library/jest-dom";
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

// Mock react-i18next
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      if (options) {
        // Simple interpolation for testing
        let result = key;
        Object.entries(options).forEach(([k, v]) => {
          result = result.replace(`{{${k}}}`, String(v));
        });
        return result;
      }
      return key;
    },
    i18n: {
      language: "en",
      changeLanguage: vi.fn(),
    },
  }),
  initReactI18next: {
    type: "3rdParty",
    init: vi.fn(),
  },
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
}));

// Mock scrollIntoView (not available in JSDOM)
Element.prototype.scrollIntoView = vi.fn();

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CellCodeEditor } from "../../../src/components/ui/CellCodeEditor";
import { ThemeContext, type ThemeContextType } from "../../../src/contexts/ThemeContext";
import type { Theme } from "../../../src/types/theme";
import type { ReactNode } from "react";

interface MonacoMockProps {
  value?: string;
  language?: string;
  theme?: string;
  height?: string | number;
  options?: Record<string, unknown>;
  onChange?: (val: string | undefined) => void;
  onValidate?: (markers: unknown[]) => void;
  beforeMount?: (monaco: unknown) => void;
}

const lastProps: { current: MonacoMockProps | null } = { current: null };

vi.mock("@monaco-editor/react", () => {
  return {
    __esModule: true,
    default: (props: MonacoMockProps) => {
      lastProps.current = props;
      props.beforeMount?.({});
      return (
        <textarea
          data-testid="monaco-editor"
          data-language={props.language}
          data-theme={props.theme}
          data-readonly={String(props.options?.readOnly ?? false)}
          value={props.value ?? ""}
          onChange={(e) => props.onChange?.(e.target.value)}
        />
      );
    },
  };
});

vi.mock("../../../src/themes/themeUtils", () => ({
  loadMonacoTheme: vi.fn(),
}));

const makeTheme = (id: string): Theme =>
  ({
    id,
    name: id,
    monacoTheme: { themeName: id },
  }) as unknown as Theme;

const makeContextValue = (theme: Theme): ThemeContextType =>
  ({
    currentTheme: theme,
    settings: {} as ThemeContextType["settings"],
    allThemes: [theme],
    isLoading: false,
    setTheme: vi.fn(),
    createCustomTheme: vi.fn(),
    updateCustomTheme: vi.fn(),
    deleteCustomTheme: vi.fn(),
    duplicateTheme: vi.fn(),
    importTheme: vi.fn(),
    exportTheme: vi.fn(),
    updateSettings: vi.fn(),
  }) as unknown as ThemeContextType;

const withTheme =
  (theme: Theme) =>
  ({ children }: { children: ReactNode }) => (
    <ThemeContext.Provider value={makeContextValue(theme)}>
      {children}
    </ThemeContext.Provider>
  );

describe("CellCodeEditor", () => {
  beforeEach(() => {
    lastProps.current = null;
    vi.clearAllMocks();
  });

  it("defaults to the json language when language is omitted", () => {
    render(<CellCodeEditor value='{"a":1}' onChange={vi.fn()} />);

    const editor = screen.getByTestId("monaco-editor");
    expect(editor).toHaveValue('{"a":1}');
    expect(editor.getAttribute("data-language")).toBe("json");
  });

  it("renders with the plaintext language when requested", () => {
    render(
      <CellCodeEditor value="hello" onChange={vi.fn()} language="plaintext" />,
    );

    expect(
      screen.getByTestId("monaco-editor").getAttribute("data-language"),
    ).toBe("plaintext");
  });

  it("falls back to vs-dark when no ThemeContext is present", () => {
    render(<CellCodeEditor value="" onChange={vi.fn()} />);

    expect(screen.getByTestId("monaco-editor").getAttribute("data-theme")).toBe(
      "vs-dark",
    );
  });

  it("uses currentTheme.id when ThemeContext provides one", () => {
    render(<CellCodeEditor value="" onChange={vi.fn()} />, {
      wrapper: withTheme(makeTheme("tabularis-dark")),
    });

    expect(screen.getByTestId("monaco-editor").getAttribute("data-theme")).toBe(
      "tabularis-dark",
    );
  });

  it("forwards edits through onChange", () => {
    const onChange = vi.fn();
    render(<CellCodeEditor value="" onChange={onChange} />);

    fireEvent.change(screen.getByTestId("monaco-editor"), {
      target: { value: '{"updated":true}' },
    });

    expect(onChange).toHaveBeenCalledWith('{"updated":true}');
  });

  it("passes an empty string when Monaco reports undefined", () => {
    const onChange = vi.fn();
    render(<CellCodeEditor value="x" onChange={onChange} />);

    lastProps.current?.onChange?.(undefined);

    expect(onChange).toHaveBeenCalledWith("");
  });

  it("surfaces validation markers via onValidate", () => {
    const onValidate = vi.fn();
    render(
      <CellCodeEditor value="" onChange={vi.fn()} onValidate={onValidate} />,
    );

    const markers = [{ message: "bad", severity: 8 }];
    lastProps.current?.onValidate?.(markers);

    expect(onValidate).toHaveBeenCalledWith(markers);
  });

  it("configures Monaco options per spec for json", () => {
    render(<CellCodeEditor value="" onChange={vi.fn()} />);

    const opts = lastProps.current?.options ?? {};
    expect(opts).toMatchObject({
      minimap: { enabled: false },
      lineNumbers: "on",
      automaticLayout: true,
      formatOnPaste: true,
      scrollBeyondLastLine: false,
      readOnly: false,
    });
  });

  it("disables formatOnPaste for plaintext", () => {
    render(
      <CellCodeEditor value="" onChange={vi.fn()} language="plaintext" />,
    );

    expect(lastProps.current?.options?.formatOnPaste).toBe(false);
  });

  it("respects the readOnly prop", () => {
    render(<CellCodeEditor value="" onChange={vi.fn()} readOnly />);

    expect(
      screen.getByTestId("monaco-editor").getAttribute("data-readonly"),
    ).toBe("true");
    expect(lastProps.current?.options?.readOnly).toBe(true);
  });

  it("forwards the height prop", () => {
    render(<CellCodeEditor value="" onChange={vi.fn()} height="240px" />);

    expect(lastProps.current?.height).toBe("240px");
  });
});

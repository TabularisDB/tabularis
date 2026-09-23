import { useEffect } from "react";
import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { ThemeSqlSample } from "../../../src/components/ui/ThemeSqlSample";
import { builtinCatalog } from "../../../src/utils/themeCatalog";

const mocks = vi.hoisted(() => ({ load: vi.fn(), independent: { id: "independent-editor" }, engine: {} }));
vi.mock("../../../src/hooks/useEditorTheme", () => ({ useEditorTheme: () => mocks.independent }));
vi.mock("../../../src/themes/themeUtils", async (original) => ({ ...await original<typeof import("../../../src/themes/themeUtils")>(), loadMonacoTheme: mocks.load }));
vi.mock("../../../src/components/ui/LazyMonaco", () => ({ MonacoEditor: function Sample({ beforeMount }: { beforeMount: (engine: object) => void }) {
  useEffect(() => { beforeMount(mocks.engine); }, [beforeMount]);
  return <div>Monaco sample</div>;
} }));

describe("ThemeSqlSample", () => {
  it("previews through the shared loader and restores the independent editor on unmount", () => {
    const entry = builtinCatalog().themes[0].entry;
    const view = render(<ThemeSqlSample contribution={entry} />);
    expect(mocks.load).toHaveBeenCalledWith(expect.objectContaining({ id: entry.id }), mocks.engine);
    view.unmount();
    expect(mocks.load).toHaveBeenLastCalledWith(mocks.independent, mocks.engine);
  });
});

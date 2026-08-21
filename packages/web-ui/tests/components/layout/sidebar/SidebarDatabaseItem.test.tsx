import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SidebarDatabaseItem } from "../../../../src/components/layout/sidebar/SidebarDatabaseItem";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe("SidebarDatabaseItem", () => {
  it("starts one lazy load when an unloaded database is expanded", async () => {
    const onLoadDatabase = vi.fn();

    render(
      <SidebarDatabaseItem
        databaseName="issue637"
        databaseData={undefined}
        activeTable={null}
        activeSchema={null}
        connectionId="conn-637"
        driver="mysql"
        schemaVersion={1}
        onLoadDatabase={onLoadDatabase}
        onRefreshDatabase={vi.fn()}
        onTableClick={vi.fn()}
        onTableDoubleClick={vi.fn()}
        onViewClick={vi.fn()}
        onViewDoubleClick={vi.fn()}
        onRoutineDoubleClick={vi.fn()}
        onTriggerDoubleClick={vi.fn()}
        onContextMenu={vi.fn()}
        onAddColumn={vi.fn()}
        onEditColumn={vi.fn()}
        onAddIndex={vi.fn()}
        onDropIndex={vi.fn()}
        onAddForeignKey={vi.fn()}
        onDropForeignKey={vi.fn()}
        onCreateTable={vi.fn()}
        onCreateView={vi.fn()}
        onCreateTrigger={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByText("issue637"));

    await waitFor(() => {
      expect(onLoadDatabase).toHaveBeenCalledTimes(1);
    });
    expect(onLoadDatabase).toHaveBeenCalledWith("issue637");
  });
});

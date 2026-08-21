import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { SidebarSchemaItem } from "../../../../src/components/layout/sidebar/SidebarSchemaItem";
import { invoke } from "@tauri-apps/api/core";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(() => Promise.resolve([])),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe("SidebarSchemaItem — materialized view double-click", () => {
  const baseSchemaData = {
    tables: [],
    views: [],
    materializedViews: [],
    routines: [],
    triggers: [],
    isLoaded: true,
    isLoading: false,
  };

  const defaultProps = {
    schemaName: "public",
    activeTable: null,
    // Matching activeSchema auto-expands the schema body on first render.
    activeSchema: "public",
    connectionId: "conn-123",
    driver: "postgres",
    schemaVersion: 1,
    onLoadSchema: vi.fn(),
    onRefreshSchema: vi.fn(),
    onTableClick: vi.fn(),
    onTableDoubleClick: vi.fn(),
    onViewClick: vi.fn(),
    onViewDoubleClick: vi.fn(),
    onRoutineDoubleClick: vi.fn(),
    onTriggerDoubleClick: vi.fn(),
    onContextMenu: vi.fn(),
    onAddColumn: vi.fn(),
    onEditColumn: vi.fn(),
    onAddIndex: vi.fn(),
    onDropIndex: vi.fn(),
    onAddForeignKey: vi.fn(),
    onDropForeignKey: vi.fn(),
    onCreateTable: vi.fn(),
    onCreateView: vi.fn(),
    onCreateTrigger: vi.fn(),
  };

  beforeEach(() => {
    vi.mocked(invoke).mockClear();
  });

  it("flags a materialized view (materialized=true) on double-click", () => {
    const onViewDoubleClick = vi.fn();
    render(
      <SidebarSchemaItem
        {...defaultProps}
        onViewDoubleClick={onViewDoubleClick}
        schemaData={{
          ...baseSchemaData,
          materializedViews: [{ name: "mv_sales" }],
        }}
      />,
    );

    // The materialized-views group is collapsed by default — open it first.
    fireEvent.click(screen.getByText("sidebar.materializedViews (1)"));
    fireEvent.doubleClick(screen.getByText("mv_sales"));

    expect(onViewDoubleClick).toHaveBeenCalledWith("mv_sales", "public", true);
  });

  it("does not flag a regular view as materialized on double-click", () => {
    const onViewDoubleClick = vi.fn();
    render(
      <SidebarSchemaItem
        {...defaultProps}
        onViewDoubleClick={onViewDoubleClick}
        schemaData={{ ...baseSchemaData, views: [{ name: "v_active" }] }}
      />,
    );

    // The views group is open by default.
    fireEvent.doubleClick(screen.getByText("v_active"));

    // Called with only (name, schema) — the materialized arg stays undefined.
    expect(onViewDoubleClick).toHaveBeenCalledWith("v_active", "public");
    expect(onViewDoubleClick).not.toHaveBeenCalledWith(
      "v_active",
      "public",
      true,
    );
  });
});

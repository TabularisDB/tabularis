import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { SidebarViewItem } from "../../../../src/components/layout/sidebar/SidebarViewItem";
import { invoke } from "@tauri-apps/api/core";
import React from "react";

// Mock Tauri invoke
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

// Mock i18n
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

describe("SidebarViewItem", () => {
  const mockView = { name: "active_users" };
  const mockColumns = [
    { name: "id", data_type: "int", is_pk: true, is_nullable: false, is_auto_increment: false },
    { name: "username", data_type: "varchar", is_pk: false, is_nullable: false, is_auto_increment: false },
    { name: "email", data_type: "varchar", is_pk: false, is_nullable: true, is_auto_increment: false },
  ];

  const defaultProps = {
    view: mockView,
    activeView: null,
    onViewClick: vi.fn(),
    onViewDoubleClick: vi.fn(),
    onContextMenu: vi.fn(),
    connectionId: "conn-123",
    driver: "mysql",
  };

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "get_view_columns") return Promise.resolve(mockColumns);
      return Promise.reject(new Error(`Unexpected command: ${cmd}`));
    });
  });

  it("renders view name correctly", () => {
    render(<SidebarViewItem {...defaultProps} />);
    expect(screen.getByText("active_users")).toBeInTheDocument();
  });

  it("calls onViewClick when clicked", () => {
    const onViewClick = vi.fn();
    render(<SidebarViewItem {...defaultProps} onViewClick={onViewClick} />);

    fireEvent.click(screen.getByText("active_users"));
    expect(onViewClick).toHaveBeenCalledWith("active_users");
  });

  it("calls onViewDoubleClick when double clicked", () => {
    const onViewDoubleClick = vi.fn();
    render(<SidebarViewItem {...defaultProps} onViewDoubleClick={onViewDoubleClick} />);

    fireEvent.doubleClick(screen.getByText("active_users"));
    expect(onViewDoubleClick).toHaveBeenCalledWith("active_users");
  });

  it("calls onContextMenu when right clicked", () => {
    const onContextMenu = vi.fn();
    render(<SidebarViewItem {...defaultProps} onContextMenu={onContextMenu} />);

    fireEvent.contextMenu(screen.getByText("active_users"));
    expect(onContextMenu).toHaveBeenCalled();
  });

  it("expands when expand button is clicked", async () => {
    render(<SidebarViewItem {...defaultProps} />);

    // Initially not expanded - columns should not be visible
    expect(screen.queryByText("columns")).not.toBeInTheDocument();

    // Click expand button
    const expandButton = screen.getByRole("button");
    fireEvent.click(expandButton);

    // Should show loading or columns
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("get_view_columns", {
        connectionId: "conn-123",
        viewName: "active_users",
      });
    });
  });

  it("loads and displays columns when expanded", async () => {
    render(<SidebarViewItem {...defaultProps} />);

    // Click expand button
    const expandButton = screen.getByRole("button");
    fireEvent.click(expandButton);

    // Wait for columns to load
    await waitFor(() => {
      expect(screen.getByText("sidebar.columns")).toBeInTheDocument();
    });

    // Should display column names
    expect(screen.getByText("id")).toBeInTheDocument();
    expect(screen.getByText("username")).toBeInTheDocument();
    expect(screen.getByText("email")).toBeInTheDocument();
  });

  it("applies active styling when activeView matches", () => {
    render(<SidebarViewItem {...defaultProps} activeView="active_users" />);
    
    const viewElement = screen.getByText("active_users").parentElement;
    expect(viewElement?.className).toContain("text-accent-secondary");
  });

  it("does not apply active styling when view is not active", () => {
    render(<SidebarViewItem {...defaultProps} activeView="other_view" />);

    const viewElement = screen.getByText("active_users").parentElement;
    expect(viewElement?.className).not.toContain("text-accent-secondary");
  });

  it("collapses when expand button is clicked again", async () => {
    render(<SidebarViewItem {...defaultProps} />);

    const expandButton = screen.getByRole("button");
    
    // Expand
    fireEvent.click(expandButton);
    await waitFor(() => {
      expect(screen.getByText("sidebar.columns")).toBeInTheDocument();
    });

    // Collapse
    fireEvent.click(expandButton);
    
    // Columns should not be visible
    expect(screen.queryByText("sidebar.columns")).not.toBeInTheDocument();
  });

  it("displays column count in folder header", async () => {
    render(<SidebarViewItem {...defaultProps} />);

    const expandButton = screen.getByRole("button");
    fireEvent.click(expandButton);

    await waitFor(() => {
      // Should show column count
      expect(screen.getByText("3")).toBeInTheDocument();
    });
  });

  it("handles error when loading columns", async () => {
    vi.mocked(invoke).mockRejectedValue(new Error("Failed to load columns"));
    
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    
    render(<SidebarViewItem {...defaultProps} />);

    const expandButton = screen.getByRole("button");
    fireEvent.click(expandButton);

    await waitFor(() => {
      expect(consoleSpy).toHaveBeenCalled();
    });

    consoleSpy.mockRestore();
  });
});

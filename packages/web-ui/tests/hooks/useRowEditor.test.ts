import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useRowEditor } from "../../src/hooks/useRowEditor";

describe("useRowEditor", () => {
  const initialData = {
    id: 1,
    name: "John Doe",
    email: "john@example.com",
  };

  it("should initialize with provided data", () => {
    const { result } = renderHook(() =>
      useRowEditor({ initialData })
    );

    expect(result.current.editedData).toEqual(initialData);
  });

  it("should update a field and call onChange immediately", () => {
    const onChange = vi.fn();
    const { result } = renderHook(() =>
      useRowEditor({ initialData, onChange })
    );

    act(() => {
      result.current.updateField("name", "Jane Doe");
    });

    expect(result.current.editedData.name).toBe("Jane Doe");
    expect(onChange).toHaveBeenCalledWith("name", "Jane Doe");
  });

  it("should call onChange for each field update", () => {
    const onChange = vi.fn();
    const { result } = renderHook(() =>
      useRowEditor({ initialData, onChange })
    );

    act(() => {
      result.current.updateField("name", "Jane Doe");
      result.current.updateField("email", "jane@example.com");
    });

    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onChange).toHaveBeenCalledWith("name", "Jane Doe");
    expect(onChange).toHaveBeenCalledWith("email", "jane@example.com");
  });

  it("should update data when initialData changes", () => {
    const { result, rerender } = renderHook(
      ({ data }) => useRowEditor({ initialData: data }),
      { initialProps: { data: initialData } }
    );

    const newData = { ...initialData, name: "Updated Name" };

    rerender({ data: newData });

    expect(result.current.editedData).toEqual(newData);
  });

  it("should handle multiple field updates", () => {
    const { result } = renderHook(() =>
      useRowEditor({ initialData })
    );

    act(() => {
      result.current.updateField("name", "Jane Doe");
      result.current.updateField("email", "jane@example.com");
    });

    expect(result.current.editedData).toEqual({
      id: 1,
      name: "Jane Doe",
      email: "jane@example.com",
    });
  });

  it("should work without onChange callback", () => {
    const { result } = renderHook(() =>
      useRowEditor({ initialData })
    );

    act(() => {
      result.current.updateField("name", "Jane Doe");
    });

    expect(result.current.editedData.name).toBe("Jane Doe");
  });
});

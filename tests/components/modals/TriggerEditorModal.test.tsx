import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TriggerEditorModal } from "../../../src/components/modals/TriggerEditorModal";

const { invokeMock, askMock, showAlertMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  askMock: vi.fn(),
  showAlertMock: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  ask: askMock,
}));

vi.mock("../../../src/hooks/useAlert", () => ({
  useAlert: () => ({ showAlert: showAlertMock }),
}));

vi.mock("../../../src/hooks/useDatabase", () => ({
  useDatabase: () => ({ activeSchema: "public" }),
}));

vi.mock("../../../src/components/ui/Modal", () => ({
  Modal: ({
    isOpen,
    children,
  }: {
    isOpen: boolean;
    children: React.ReactNode;
  }) => (isOpen ? <div>{children}</div> : null),
}));

vi.mock("../../../src/components/ui/SqlEditorWrapper", () => ({
  SqlEditorWrapper: () => <div data-testid="sql-editor" />,
}));

// useTranslation: return keys as-is so button labels are predictable. The `t`
// function is a stable reference (module-level) so useCallback deps that
// depend on `t` don't re-fire on every render (which would loop).
const stableT = (key: string, opts?: Record<string, string>) => {
  if (!opts) return key;
  return key.replace(/\{\{(\w+)\}\}/g, (_, k) => opts[k] ?? "");
};
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: stableT }),
}));

/**
 * TriggerEditorModal save-ordering regression tests (debba review, PR #822,
 * blocking 3). The PostgreSQL edit flow must create/replace the trigger
 * function BEFORE dropping the existing trigger, so a failure in the function
 * step leaves the existing trigger intact. The create flow must not silently
 * clobber a pre-existing user function that shares the generated name.
 */
describe("TriggerEditorModal save ordering", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    askMock.mockResolvedValue(true);
  });

  /** Returns the sequence of invoke command names in call order. */
  function invokeOrder(): string[] {
    return invokeMock.mock.calls.map((c) => c[0] as string);
  }

  it("creates the trigger function before dropping the trigger on edit (postgres)", async () => {
    // get_trigger_definition is fetched on open for an existing trigger.
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "get_trigger_definition") {
        return [
          'CREATE TRIGGER "audit"',
          "AFTER INSERT",
          'ON "store"."products"',
          "FOR EACH ROW",
          'EXECUTE FUNCTION "store"."products_audit_fn"();',
        ].join("\n");
      }
      if (cmd === "get_routine_definition") {
        return [
          "CREATE OR REPLACE FUNCTION store.products_audit_fn() RETURNS trigger LANGUAGE plpgsql AS $function$",
          "BEGIN",
          "  RETURN NEW;",
          "END;",
          "$function$",
        ].join("\n");
      }
      return "";
    });

    render(
      <TriggerEditorModal
        isOpen
        onClose={vi.fn()}
        connectionId="conn-1"
        triggerName="audit"
        tableName="products"
        schema="store"
        database="analytics"
        driver="postgres"
        isNewTrigger={false}
        onSuccess={vi.fn()}
      />,
    );

    // Wait for the load to settle.
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith(
        "get_trigger_definition",
        expect.objectContaining({ triggerName: "audit" }),
      );
    });

    // Click Save.
    const saveButton = screen.getByText("triggers.save");
    fireEvent.click(saveButton);

    await waitFor(() => {
      // The function creation (execute_query) must precede drop_trigger.
      const order = invokeOrder();
      const fnIdx = order.indexOf("execute_query");
      const dropIdx = order.indexOf("drop_trigger");
      expect(fnIdx).toBeGreaterThan(-1);
      expect(dropIdx).toBeGreaterThan(-1);
      expect(fnIdx).toBeLessThan(dropIdx);
    });
  });

  it("does not drop the trigger when the function-creation step fails (edit)", async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "get_trigger_definition") {
        return [
          'CREATE TRIGGER "audit"',
          "AFTER INSERT",
          'ON "store"."products"',
          "FOR EACH ROW",
          'EXECUTE FUNCTION "store"."products_audit_fn"();',
        ].join("\n");
      }
      if (cmd === "get_routine_definition") {
        return [
          "CREATE OR REPLACE FUNCTION store.products_audit_fn() RETURNS trigger LANGUAGE plpgsql AS $function$",
          "BEGIN",
          "  RETURN NEW;",
          "END;",
          "$function$",
        ].join("\n");
      }
      // The function creation fails.
      if (cmd === "execute_query") {
        throw new Error("syntax error in PL/pgSQL");
      }
      return "";
    });

    render(
      <TriggerEditorModal
        isOpen
        onClose={vi.fn()}
        connectionId="conn-1"
        triggerName="audit"
        tableName="products"
        schema="store"
        database="analytics"
        driver="postgres"
        isNewTrigger={false}
        onSuccess={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith(
        "get_trigger_definition",
        expect.objectContaining({ triggerName: "audit" }),
      );
    });

    fireEvent.click(screen.getByText("triggers.save"));

    await waitFor(() => {
      // execute_query was attempted (and threw), but drop_trigger was NOT called.
      expect(invokeMock).toHaveBeenCalledWith("execute_query", expect.anything());
      expect(invokeMock).not.toHaveBeenCalledWith("drop_trigger", expect.anything());
      // create_trigger was also NOT called since the function step failed.
      expect(invokeMock).not.toHaveBeenCalledWith("create_trigger", expect.anything());
    });
  });

  it("aborts create when a function with the generated name already exists", async () => {
    // A new trigger: get_routine_definition succeeds (function already exists).
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "get_routine_definition") {
        return "CREATE OR REPLACE FUNCTION products_audit_fn() ...";
      }
      return "";
    });

    render(
      <TriggerEditorModal
        isOpen
        onClose={vi.fn()}
        connectionId="conn-1"
        tableName="products"
        schema="store"
        database="analytics"
        driver="postgres"
        isNewTrigger={true}
        onSuccess={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByText("triggers.create"));

    await waitFor(() => {
      // The collision probe found an existing function, so save aborts.
      expect(invokeMock).toHaveBeenCalledWith(
        "get_routine_definition",
        expect.objectContaining({ routineType: "FUNCTION" }),
      );
      expect(invokeMock).not.toHaveBeenCalledWith("execute_query", expect.anything());
      expect(invokeMock).not.toHaveBeenCalledWith("create_trigger", expect.anything());
    });
  });

  it(
    "updates the trigger's real (non-convention) function on edit instead of creating " +
      "a second, convention-named one (debba review, PR #822, blocking 4)",
    async () => {
      // The seeded trigger's EXECUTE clause references `audit_fn` — not the
      // convention name `products_audit_fn` that triggerName="audit" +
      // tableName="products" would generate. With the fix, save correctly
      // updates `audit_fn` via CREATE OR REPLACE, and does NOT run a
      // collision probe (the real function identity is already known from load).
      invokeMock.mockImplementation(async (cmd: string) => {
        if (cmd === "get_trigger_definition") {
          return [
            'CREATE TRIGGER "audit"',
            "AFTER INSERT",
            'ON "store"."products"',
            "FOR EACH ROW",
            'EXECUTE FUNCTION "store"."audit_fn"();',
          ].join("\n");
        }
        if (cmd === "get_routine_definition") {
          return [
            "CREATE OR REPLACE FUNCTION store.audit_fn() RETURNS trigger LANGUAGE plpgsql AS $function$",
            "BEGIN",
            "  RETURN NEW;",
            "END;",
            "$function$",
          ].join("\n");
        }
        return "";
      });

      render(
        <TriggerEditorModal
          isOpen
          onClose={vi.fn()}
          connectionId="conn-1"
          triggerName="audit"
          tableName="products"
          schema="store"
          database="analytics"
          driver="postgres"
          isNewTrigger={false}
          onSuccess={vi.fn()}
        />,
      );

      await waitFor(() => {
        expect(invokeMock).toHaveBeenCalledWith(
          "get_trigger_definition",
          expect.objectContaining({ triggerName: "audit" }),
        );
      });

      fireEvent.click(screen.getByText("triggers.save"));

      await waitFor(() => {
        // The execute_query step creates/replaces the REAL function (audit_fn),
        // not the generated convention name (products_audit_fn).
        const executeQueryCalls = invokeMock.mock.calls.filter(([cmd]) => cmd === "execute_query");
        expect(executeQueryCalls.length).toBeGreaterThan(0);
        const query: string = (executeQueryCalls[0][1] as { query: string }).query;
        expect(query).toContain('CREATE OR REPLACE FUNCTION "store"."audit_fn"()');
        expect(query).not.toContain("products_audit_fn");
      });

      // get_routine_definition was called exactly once (on load), not a
      // second time as a collision probe during save.
      const routineLookups = invokeMock.mock.calls.filter(([cmd]) => cmd === "get_routine_definition");
      expect(routineLookups).toHaveLength(1);
    },
  );
});

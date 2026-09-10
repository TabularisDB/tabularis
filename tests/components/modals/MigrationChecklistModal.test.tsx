import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { MigrationChecklistModal } from "../../../src/components/modals/MigrationChecklistModal";
import type { SavedConnection } from "../../../src/contexts/DatabaseContext";
import type { PluginManifest } from "../../../src/types/plugins";
import type { MigrationOutcome } from "../../../src/hooks/useBuiltinDriverMigration";
import { openUrl } from "@tauri-apps/plugin-opener";

const settingsMock = {
  settings: {} as { knownCapabilityGaps?: Record<string, string[]> },
  updateSetting: vi.fn<(key: string, value: unknown) => Promise<void>>(),
};

vi.mock("../../../src/hooks/useSettings", () => ({
  useSettings: () => settingsMock,
}));

const makeManifest = (capabilities: Partial<PluginManifest["capabilities"]>): PluginManifest => ({
  id: "postgresql",
  name: "PostgreSQL",
  version: "1.0.0",
  description: "",
  default_port: 5432,
  capabilities: {
    schemas: true,
    views: true,
    routines: true,
    file_based: false,
    folder_based: false,
    identifier_quote: '"',
    alter_primary_key: true,
    ...capabilities,
  } as PluginManifest["capabilities"],
});

const makeConn = (id: string, name: string, params: Partial<SavedConnection["params"]> = {}): SavedConnection => ({
  id,
  name,
  params: { driver: "postgres", database: "db", ...params },
});

const outcomeFor = (connectionId: string): MigrationOutcome => ({
  connectionId,
  connectionName: connectionId,
  status: "ok",
});

describe("MigrationChecklistModal", () => {
  const onClose = vi.fn();
  let migrateConnection: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    settingsMock.settings = {};
    settingsMock.updateSetting.mockReset();
    settingsMock.updateSetting.mockResolvedValue(undefined);
    migrateConnection = vi.fn(async (id: string) => outcomeFor(id));
  });

  it("renders nothing when isOpen is false", () => {
    const { container } = render(
      <MigrationChecklistModal
        isOpen={false}
        onClose={onClose}
        connections={[]}
        manifest={undefined}
        repoUrl={undefined}
        pluginVersion="1.0.0"
        migrateConnection={migrateConnection}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  describe("mounts fresh with whatever data it's given", () => {
    // Connections.tsx conditionally mounts this component
    // ({isMigrationChecklistOpen && <MigrationChecklistModal ... />}), so
    // every mount is a genuine cold start with real props already in hand —
    // the "Review connections" link that mounts it only renders once the
    // banner has resolved to "nudge", which itself requires connections and
    // the plugin manifest to have already loaded. A plain useState
    // initializer is enough; there's no route to mounting before that data
    // exists, so no rising-edge-of-isOpen effect is needed to re-derive
    // anything after the fact.
    it("checks a clean connection immediately on mount", () => {
      const manifest = makeManifest({ supports_ssl: true, connection_uri: true });
      const cleanConn = makeConn("c1", "Clean Connection");

      render(
        <MigrationChecklistModal
          isOpen
          onClose={onClose}
          connections={[cleanConn]}
          manifest={manifest}
          repoUrl="https://github.com/TabularisDB/tabularis-postgresql-plugin"
          pluginVersion="1.0.0"
          migrateConnection={migrateConnection}
        />,
      );

      expect(screen.getByRole("checkbox")).toBeChecked();
      expect(screen.getByText(/migration\.checklist\.migrateSelected/).closest("button")).not.toBeDisabled();
    });

    it("keeps a migrated row visible and a user's manual uncheck intact when connections shrinks mid-open", async () => {
      // A connection dropping out of `connections` as it migrates (during a
      // bulk run) must not make its row disappear, and must not reset the
      // checked state for the remaining rows — candidateRows is a snapshot
      // taken once at mount, independent of later `connections` prop churn.
      const manifest = makeManifest({ supports_ssl: true, connection_uri: true });
      const conns = [makeConn("c1", "Conn 1"), makeConn("c2", "Conn 2")];

      const { rerender } = render(
        <MigrationChecklistModal
          isOpen
          onClose={onClose}
          connections={conns}
          manifest={manifest}
          repoUrl="https://github.com/TabularisDB/tabularis-postgresql-plugin"
          pluginVersion="1.0.0"
          migrateConnection={migrateConnection}
        />,
      );
      const checkboxes = screen.getAllByRole("checkbox");
      // Manually uncheck c2 — a user override that must survive prop churn.
      fireEvent.click(checkboxes[1]);
      expect(checkboxes[1]).not.toBeChecked();

      // c1 migrates and drops out of the `connections` prop, as
      // Connections.tsx's `migration.builtinConnections` would do mid-batch.
      rerender(
        <MigrationChecklistModal
          isOpen
          onClose={onClose}
          connections={[conns[1]]}
          manifest={manifest}
          repoUrl="https://github.com/TabularisDB/tabularis-postgresql-plugin"
          pluginVersion="1.0.0"
          migrateConnection={migrateConnection}
        />,
      );

      // Both rows still render — c1's row doesn't vanish just because it
      // dropped out of `connections` — and c2's manual uncheck still holds.
      expect(screen.getByText("Conn 1")).toBeInTheDocument();
      expect(screen.getByText("Conn 2")).toBeInTheDocument();
      const checkboxesAfter = screen.getAllByRole("checkbox");
      expect(checkboxesAfter).toHaveLength(2);
      expect(checkboxesAfter[1]).not.toBeChecked();
    });

    it("derives a fresh default selection on each new mount", () => {
      const manifest = makeManifest({ supports_ssl: true, connection_uri: true });
      const conn = makeConn("c1", "Conn 1");

      const { unmount } = render(
        <MigrationChecklistModal
          isOpen
          onClose={onClose}
          connections={[conn]}
          manifest={manifest}
          repoUrl="https://github.com/TabularisDB/tabularis-postgresql-plugin"
          pluginVersion="1.0.0"
          migrateConnection={migrateConnection}
        />,
      );
      fireEvent.click(screen.getByRole("checkbox")); // user unchecks it
      expect(screen.getByRole("checkbox")).not.toBeChecked();

      // Closing unmounts the component (Connections.tsx's conditional
      // render), and reopening mounts a brand-new instance — the same
      // lifecycle transition `{isMigrationChecklistOpen && <... />}` performs.
      unmount();
      render(
        <MigrationChecklistModal
          isOpen
          onClose={onClose}
          connections={[conn]}
          manifest={manifest}
          repoUrl="https://github.com/TabularisDB/tabularis-postgresql-plugin"
          pluginVersion="1.0.0"
          migrateConnection={migrateConnection}
        />,
      );

      // Back to the default: checked, since it's still gap-free.
      expect(screen.getByRole("checkbox")).toBeChecked();
    });
  });

  describe("default checked/unchecked state", () => {
    it("checks a connection with no capability gap by default", () => {
      const manifest = makeManifest({ supports_ssl: true, connection_uri: true });
      const conn = makeConn("c1", "Clean Connection");
      render(
        <MigrationChecklistModal
          isOpen
          onClose={onClose}
          connections={[conn]}
          manifest={manifest}
          repoUrl="https://github.com/TabularisDB/tabularis-postgresql-plugin"
          pluginVersion="1.0.0"
          migrateConnection={migrateConnection}
        />,
      );
      const checkbox = screen.getByRole("checkbox");
      expect(checkbox).toBeChecked();
    });

    it("leaves a connection with an SSL gap unchecked by default", () => {
      const manifest = makeManifest({ supports_ssl: false });
      const conn = makeConn("c1", "SSL Connection", { ssl_mode: "verify-ca" });
      render(
        <MigrationChecklistModal
          isOpen
          onClose={onClose}
          connections={[conn]}
          manifest={manifest}
          repoUrl="https://github.com/TabularisDB/tabularis-postgresql-plugin"
          pluginVersion="1.0.0"
          migrateConnection={migrateConnection}
        />,
      );
      const checkbox = screen.getByRole("checkbox");
      expect(checkbox).not.toBeChecked();
      // The gap is named inline.
      expect(screen.getByText("migration.checklist.gap.ssl")).toBeInTheDocument();
    });

    it("still lets the user check a gapped connection manually", () => {
      const manifest = makeManifest({ supports_ssl: false });
      const conn = makeConn("c1", "SSL Connection", { ssl_mode: "verify-ca" });
      render(
        <MigrationChecklistModal
          isOpen
          onClose={onClose}
          connections={[conn]}
          manifest={manifest}
          repoUrl="https://github.com/TabularisDB/tabularis-postgresql-plugin"
          pluginVersion="1.0.0"
          migrateConnection={migrateConnection}
        />,
      );
      const checkbox = screen.getByRole("checkbox");
      fireEvent.click(checkbox);
      expect(checkbox).toBeChecked();
    });
  });

  describe("Report this gap", () => {
    it("opens the capability-gap issue URL and records knownCapabilityGaps", async () => {
      const manifest = makeManifest({ supports_ssl: false });
      const conn = makeConn("c1", "SSL Connection", { ssl_mode: "verify-ca" });
      render(
        <MigrationChecklistModal
          isOpen
          onClose={onClose}
          connections={[conn]}
          manifest={manifest}
          repoUrl="https://github.com/TabularisDB/tabularis-postgresql-plugin"
          pluginVersion="1.2.3"
          migrateConnection={migrateConnection}
        />,
      );
      fireEvent.click(screen.getByText("migration.checklist.reportThisGap"));

      await waitFor(() => expect(openUrl).toHaveBeenCalledTimes(1));
      const url = (openUrl as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(url).toContain("template=capability-gap.yml");
      expect(url).toContain("feature=ssl");
      expect(url).toContain("plugin_version=1.2.3");

      await waitFor(() =>
        expect(settingsMock.updateSetting).toHaveBeenCalledWith("knownCapabilityGaps", {
          postgresql: ["ssl"],
        }),
      );
    });

    it("shows an already-reported state instead of the button when the gap was previously filed", () => {
      settingsMock.settings = { knownCapabilityGaps: { postgresql: ["ssl"] } };
      const manifest = makeManifest({ supports_ssl: false });
      const conn = makeConn("c1", "SSL Connection", { ssl_mode: "verify-ca" });
      render(
        <MigrationChecklistModal
          isOpen
          onClose={onClose}
          connections={[conn]}
          manifest={manifest}
          repoUrl="https://github.com/TabularisDB/tabularis-postgresql-plugin"
          pluginVersion="1.0.0"
          migrateConnection={migrateConnection}
        />,
      );
      expect(screen.queryByText("migration.checklist.reportThisGap")).not.toBeInTheDocument();
      expect(screen.getByText("migration.checklist.alreadyReported")).toBeInTheDocument();
    });

    it("disables the report action when repoUrl is unavailable", () => {
      const manifest = makeManifest({ supports_ssl: false });
      const conn = makeConn("c1", "SSL Connection", { ssl_mode: "verify-ca" });
      render(
        <MigrationChecklistModal
          isOpen
          onClose={onClose}
          connections={[conn]}
          manifest={manifest}
          repoUrl={undefined}
          pluginVersion="1.0.0"
          migrateConnection={migrateConnection}
        />,
      );
      expect(screen.getByText("migration.checklist.reportThisGap").closest("button")).toBeDisabled();
    });
  });

  describe("bulk migrate", () => {
    it("migrates only checked connections, sequentially", async () => {
      const manifest = makeManifest({ supports_ssl: true, connection_uri: true });
      const conns = [makeConn("c1", "Conn 1"), makeConn("c2", "Conn 2")];
      render(
        <MigrationChecklistModal
          isOpen
          onClose={onClose}
          connections={conns}
          manifest={manifest}
          repoUrl="https://github.com/TabularisDB/tabularis-postgresql-plugin"
          pluginVersion="1.0.0"
          migrateConnection={migrateConnection}
        />,
      );
      // Both connections are gap-free, so both start checked.
      fireEvent.click(screen.getByText(/migration\.checklist\.migrateSelected/));

      await waitFor(() => expect(migrateConnection).toHaveBeenCalledTimes(2));
      expect(migrateConnection).toHaveBeenCalledWith("c1");
      expect(migrateConnection).toHaveBeenCalledWith("c2");
    });

    it("keeps every row visible with its own status, and shrinks the footer count, as connections drops out mid-run", async () => {
      // Regression: Connections.tsx passes migration.builtinConnections,
      // which shrinks as each row's own migrateConnection call flips its
      // driver — this simulates that by rerendering with a shorter
      // `connections` prop from inside the mocked migrateConnection, exactly
      // as the real loadConnections()-driven update would land mid-batch.
      const manifest = makeManifest({ supports_ssl: true, connection_uri: true });
      const conns = [makeConn("c1", "Conn 1"), makeConn("c2", "Conn 2")];
      let rerenderWithShrunkConnections: (() => void) | null = null;
      migrateConnection = vi.fn(async (id: string) => {
        rerenderWithShrunkConnections?.();
        return outcomeFor(id);
      });

      const { rerender } = render(
        <MigrationChecklistModal
          isOpen
          onClose={onClose}
          connections={conns}
          manifest={manifest}
          repoUrl="https://github.com/TabularisDB/tabularis-postgresql-plugin"
          pluginVersion="1.0.0"
          migrateConnection={migrateConnection}
        />,
      );
      rerenderWithShrunkConnections = () =>
        rerender(
          <MigrationChecklistModal
            isOpen
            onClose={onClose}
            connections={[]}
            manifest={manifest}
            repoUrl="https://github.com/TabularisDB/tabularis-postgresql-plugin"
            pluginVersion="1.0.0"
            migrateConnection={migrateConnection}
          />,
        );

      fireEvent.click(screen.getByText(/migration\.checklist\.migrateSelected/));

      // Both rows stay visible and reach "ok" even though `connections`
      // dropped to empty after the first call — candidateRows doesn't track
      // the live prop mid-run.
      await waitFor(() => expect(migrateConnection).toHaveBeenCalledTimes(2));
      expect(screen.getByText("Conn 1")).toBeInTheDocument();
      expect(screen.getByText("Conn 2")).toBeInTheDocument();

      // Each id is dropped from `checked` as it completes, so the button
      // ends up disabled once nothing is left checked — not stuck stale at
      // the original selection — and a further click can't re-run
      // migrateConnection on either already-migrated connection.
      const migrateButtonAfter = screen
        .getByText(/migration\.checklist\.migrateSelected/)
        .closest("button");
      await waitFor(() => expect(migrateButtonAfter).toBeDisabled());
      fireEvent.click(migrateButtonAfter!);
      expect(migrateConnection).toHaveBeenCalledTimes(2); // unchanged
    });

    it("continues the batch and clears the migrating flag when one migration rejects unexpectedly", async () => {
      // migrateConnection's real implementation never rejects (it resolves a
      // "failed" outcome instead), but this guards the modal's own loop
      // defensively: if it ever did throw, one bad connection must not abort
      // the remaining batch or leave `migrating` stuck true forever.
      const manifest = makeManifest({ supports_ssl: true, connection_uri: true });
      const conns = [makeConn("c1", "Conn 1"), makeConn("c2", "Conn 2")];
      migrateConnection = vi.fn(async (id: string) => {
        if (id === "c1") throw new Error("unexpected");
        return outcomeFor(id);
      });
      render(
        <MigrationChecklistModal
          isOpen
          onClose={onClose}
          connections={conns}
          manifest={manifest}
          repoUrl="https://github.com/TabularisDB/tabularis-postgresql-plugin"
          pluginVersion="1.0.0"
          migrateConnection={migrateConnection}
        />,
      );
      const migrateButton = screen.getByText(/migration\.checklist\.migrateSelected/).closest("button");
      fireEvent.click(migrateButton!);

      await waitFor(() => expect(migrateConnection).toHaveBeenCalledTimes(2));
      expect(migrateConnection).toHaveBeenCalledWith("c1");
      expect(migrateConnection).toHaveBeenCalledWith("c2");
      // The migrate button is now legitimately disabled — both checked ids
      // completed and were removed from `checked`, so there's nothing left
      // to select — but `migrating` itself must have cleared (checkboxes
      // are re-enabled), proving the throw in c1's attempt didn't leave the
      // loop's `finally` unreached.
      await waitFor(() => {
        for (const checkbox of screen.getAllByRole("checkbox")) {
          expect(checkbox).not.toBeDisabled();
        }
      });
    });

    it("does not migrate an unchecked (gapped) connection", async () => {
      const manifest = makeManifest({ supports_ssl: false });
      const conns = [
        makeConn("c1", "Gapped", { ssl_mode: "verify-ca" }),
        makeConn("c2", "Clean"),
      ];
      render(
        <MigrationChecklistModal
          isOpen
          onClose={onClose}
          connections={conns}
          manifest={manifest}
          repoUrl="https://github.com/TabularisDB/tabularis-postgresql-plugin"
          pluginVersion="1.0.0"
          migrateConnection={migrateConnection}
        />,
      );
      fireEvent.click(screen.getByText(/migration\.checklist\.migrateSelected/));

      await waitFor(() => expect(migrateConnection).toHaveBeenCalledTimes(1));
      expect(migrateConnection).toHaveBeenCalledWith("c2");
      expect(migrateConnection).not.toHaveBeenCalledWith("c1");
    });

    it("disables the migrate button when nothing is checked", () => {
      const manifest = makeManifest({ supports_ssl: false });
      const conn = makeConn("c1", "Gapped", { ssl_mode: "verify-ca" });
      render(
        <MigrationChecklistModal
          isOpen
          onClose={onClose}
          connections={[conn]}
          manifest={manifest}
          repoUrl="https://github.com/TabularisDB/tabularis-postgresql-plugin"
          pluginVersion="1.0.0"
          migrateConnection={migrateConnection}
        />,
      );
      expect(screen.getByText(/migration\.checklist\.migrateSelected/).closest("button")).toBeDisabled();
    });
  });

  describe("in-progress feedback", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it("shows a testing-connection label only once a running row has been pending a few seconds", async () => {
      vi.useFakeTimers();
      const manifest = makeManifest({ supports_ssl: true, connection_uri: true });
      const conn = makeConn("c1", "Conn 1");
      let resolveMigration: (outcome: MigrationOutcome) => void = () => {};
      migrateConnection = vi.fn(
        () =>
          new Promise<MigrationOutcome>((resolve) => {
            resolveMigration = resolve;
          }),
      );
      render(
        <MigrationChecklistModal
          isOpen
          onClose={onClose}
          connections={[conn]}
          manifest={manifest}
          repoUrl="https://github.com/TabularisDB/tabularis-postgresql-plugin"
          pluginVersion="1.0.0"
          migrateConnection={migrateConnection}
        />,
      );

      fireEvent.click(screen.getByText(/migration\.checklist\.migrateSelected/));
      await act(async () => {
        await Promise.resolve();
      });
      expect(migrateConnection).toHaveBeenCalledTimes(1);

      // Not yet — the row only just started running.
      expect(screen.queryByText("migration.checklist.testing")).not.toBeInTheDocument();

      await act(async () => {
        vi.advanceTimersByTime(3000);
      });
      expect(screen.getByText("migration.checklist.testing")).toBeInTheDocument();

      await act(async () => {
        resolveMigration(outcomeFor("c1"));
        await Promise.resolve();
      });
    });

    it("shows the migrating notice in the footer only while the batch is running", async () => {
      const manifest = makeManifest({ supports_ssl: true, connection_uri: true });
      const conn = makeConn("c1", "Conn 1");
      let resolveMigration: (outcome: MigrationOutcome) => void = () => {};
      migrateConnection = vi.fn(
        () =>
          new Promise<MigrationOutcome>((resolve) => {
            resolveMigration = resolve;
          }),
      );
      render(
        <MigrationChecklistModal
          isOpen
          onClose={onClose}
          connections={[conn]}
          manifest={manifest}
          repoUrl="https://github.com/TabularisDB/tabularis-postgresql-plugin"
          pluginVersion="1.0.0"
          migrateConnection={migrateConnection}
        />,
      );
      expect(screen.queryByText("migration.checklist.migratingNotice")).not.toBeInTheDocument();

      fireEvent.click(screen.getByText(/migration\.checklist\.migrateSelected/));
      await waitFor(() => expect(migrateConnection).toHaveBeenCalledTimes(1));
      expect(screen.getByText("migration.checklist.migratingNotice")).toBeInTheDocument();

      await act(async () => {
        resolveMigration(outcomeFor("c1"));
        await Promise.resolve();
      });
      await waitFor(() =>
        expect(screen.queryByText("migration.checklist.migratingNotice")).not.toBeInTheDocument(),
      );
    });
  });

  describe("URI pre-flight", () => {
    it("shows an inline warning for a connection-URI-based connection", () => {
      const manifest = makeManifest({ supports_ssl: true, connection_uri: true });
      const conn = makeConn("c1", "URI Connection", { connection_uri_in_keychain: true });
      render(
        <MigrationChecklistModal
          isOpen
          onClose={onClose}
          connections={[conn]}
          manifest={manifest}
          repoUrl="https://github.com/TabularisDB/tabularis-postgresql-plugin"
          pluginVersion="1.0.0"
          migrateConnection={migrateConnection}
        />,
      );
      expect(screen.getByText("migration.checklist.uriWarning")).toBeInTheDocument();
    });
  });

  it("shows an empty state when there are no connections to review", () => {
    render(
      <MigrationChecklistModal
        isOpen
        onClose={onClose}
        connections={[]}
        manifest={undefined}
        repoUrl={undefined}
        pluginVersion="1.0.0"
        migrateConnection={migrateConnection}
      />,
    );
    expect(screen.getByText("migration.checklist.noGaps")).toBeInTheDocument();
  });
});

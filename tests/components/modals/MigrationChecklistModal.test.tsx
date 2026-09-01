import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
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

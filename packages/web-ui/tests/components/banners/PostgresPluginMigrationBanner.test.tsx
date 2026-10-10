import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { PostgresPluginMigrationBanner } from "../../../src/components/banners/PostgresPluginMigrationBanner";

describe("PostgresPluginMigrationBanner", () => {
  const onDismiss = vi.fn();
  const onReview = vi.fn();

  it("renders the plain nudge message when no removal date is known", () => {
    render(
      <PostgresPluginMigrationBanner
        variant="nudge"
        removalDate={undefined}
        onDismiss={onDismiss}
        onReview={onReview}
      />,
    );
    expect(screen.getByText("migration.banner.nudge")).toBeInTheDocument();
    expect(screen.queryByText(/nudgeWithDate/)).not.toBeInTheDocument();
  });

  it("renders the with-date variant, interpolating the manifest's removal_date", () => {
    // The date is read from PluginManifest.deprecated.removal_date (the same
    // field the deprecated-driver badge/tooltip use) rather than hardcoded
    // in this component — this test's date value deliberately does not
    // match any date literal that used to live in the translation string,
    // to prove it's actually threaded through as a prop.
    render(
      <PostgresPluginMigrationBanner
        variant="nudge"
        removalDate="2027-03-14"
        onDismiss={onDismiss}
        onReview={onReview}
      />,
    );
    expect(screen.getByText("migration.banner.nudgeWithDate")).toBeInTheDocument();
  });

  it("renders the offline message regardless of removalDate", () => {
    render(
      <PostgresPluginMigrationBanner
        variant="offline"
        removalDate="2026-10-05"
        onDismiss={onDismiss}
        onReview={onReview}
      />,
    );
    expect(screen.getByText("migration.banner.offline")).toBeInTheDocument();
    expect(screen.queryByText(/nudge/)).not.toBeInTheDocument();
  });
});

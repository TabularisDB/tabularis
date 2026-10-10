import { describe, expect, it } from "vitest";
import {
  buildPluginInstallRoute,
  parsePluginInstallRoute,
} from "../../src/utils/pluginInstallRoute";

describe("pluginInstallRoute", () => {
  it("builds the canonical browser install route with source selection", () => {
    expect(
      buildPluginInstallRoute({
        slug: "postgres-driver",
        version: "1.2.3",
        registry: "https://registry.example/api/",
      }),
    ).toBe(
      "/install/postgres-driver?version=1.2.3&registry=https%3A%2F%2Fregistry.example%2Fapi",
    );
  });

  it("parses the canonical route into the shared confirmation request", () => {
    expect(
      parsePluginInstallRoute(
        "postgres-driver",
        new URLSearchParams(
          "version=1.2.3&registry=http%3A%2F%2F127.0.0.1%3A9000%2Fregistry%2F",
        ),
      ),
    ).toEqual({
      slug: "postgres-driver",
      version: "1.2.3",
      registry: "http://127.0.0.1:9000/registry",
    });
  });

  it("allows omitted optional selections", () => {
    expect(
      parsePluginInstallRoute("sqlite", new URLSearchParams()),
    ).toEqual({ slug: "sqlite", version: null, registry: null });
  });

  it.each([
    ["missing slug", undefined, ""],
    ["unsafe slug", "../plugin", ""],
    ["uppercase registry slug", "Postgres", ""],
    ["non-HTTP registry", "postgres", "registry=file%3A%2F%2F%2Ftmp%2Fplugins"],
    ["registry credentials", "postgres", "registry=https%3A%2F%2Fuser%3Asecret%40registry.example"],
    ["registry query", "postgres", "registry=https%3A%2F%2Fregistry.example%2Fapi%3Ftoken%3Dsecret"],
  ])("rejects %s", (_label, slug, search) => {
    expect(parsePluginInstallRoute(slug, new URLSearchParams(search))).toBeNull();
  });
});

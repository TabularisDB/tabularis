import { msg } from "@lingui/core/macro";
import type { MessageDescriptor } from "@lingui/core";

export const openSourceLibrariesSections: Record<string, MessageDescriptor> = {
  "npm-runtime": msg`Frontend Dependencies`,
  "npm-tooling": msg`Frontend Dev Dependencies`,
  "cargo-runtime": msg`Rust Dependencies`,
  "cargo-tooling": msg`Rust Build and Test`,
};

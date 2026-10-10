// Ambient global declarations for WebDriverIO v10.
// @wdio/globals exports $/$$/browser/expect as modules but its WebdriverIO.Element
// interface is an empty declaration-merge stub. The full chainable element API
// (click/setValue/getText/keys) lives on webdriverio's ChainablePromiseElement.
// Source the globals from @wdio/globals but type elements via webdriverio.
import type { Browser as WdioBrowser, Element as WdioElement } from "webdriverio";

declare global {
  const $: typeof import("@wdio/globals")["$"];
  const $$: typeof import("@wdio/globals")["$$"];
  const browser: WdioBrowser;
  const expect: typeof import("@wdio/globals")["expect"];
  namespace WebdriverIO {
    interface Element {}
    interface Browser {}
  }
}

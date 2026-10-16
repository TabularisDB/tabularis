// Smoke test: prove the real tabularis app launches under tauri-wd on macOS.
// Handles various states: fresh Connections page, already-connected, or mid-flow
// from a prior spec. Only asserts the app's root rendered (the app is alive).
describe("tabularis app smoke", () => {
  it("launches and renders the app", async () => {
    const root = await $("#root");
    await root.waitForExist({ timeout: 30000 });
    // The app is alive. We don't assert a specific view since prior specs may
    // have left the app in any state (Connections page, editor, modal open).
  });
});

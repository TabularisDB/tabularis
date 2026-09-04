import { describe, it, expect } from "vitest";
import {
  createMonacoEnvironment,
  selectMonacoWorker,
  type MonacoWorkerConstructors,
} from "../../src/utils/monacoWorkers";

class FakeWorker {
  constructor(public readonly kind: string) {}
}

const EditorWorker = class extends FakeWorker {
  constructor() {
    super("editor");
  }
} as unknown as MonacoWorkerConstructors["editor"];

const JsonWorker = class extends FakeWorker {
  constructor() {
    super("json");
  }
} as unknown as MonacoWorkerConstructors["json"];

const workers: MonacoWorkerConstructors = { editor: EditorWorker, json: JsonWorker };

describe("monacoWorkers", () => {
  describe("selectMonacoWorker", () => {
    it("should use the JSON language service worker for json", () => {
      expect(selectMonacoWorker("json", workers)).toBe(JsonWorker);
    });

    it("should use the generic editor worker for editorWorkerService", () => {
      expect(selectMonacoWorker("editorWorkerService", workers)).toBe(EditorWorker);
    });

    it("should fall back to the editor worker for languages without a service", () => {
      for (const label of ["sql", "plaintext", "xml", "", "typescript"]) {
        expect(selectMonacoWorker(label, workers)).toBe(EditorWorker);
      }
    });
  });

  describe("createMonacoEnvironment", () => {
    it("should instantiate a fresh worker per request", () => {
      const env = createMonacoEnvironment(workers);
      const first = env.getWorker?.("id-1", "json") as unknown as FakeWorker;
      const second = env.getWorker?.("id-2", "json") as unknown as FakeWorker;

      expect(first).toBeInstanceOf(FakeWorker);
      expect(first.kind).toBe("json");
      expect(second).not.toBe(first);
    });

    it("should route unknown labels to the editor worker", () => {
      const env = createMonacoEnvironment(workers);
      const worker = env.getWorker?.("id", "sql") as unknown as FakeWorker;
      expect(worker.kind).toBe("editor");
    });
  });
});

import { lazy, Suspense } from "react";
import type { EditorProps, DiffEditorProps } from "@monaco-editor/react";
import { ensureMonaco } from "../../utils/monaco";
import { LoadingState } from "./LoadingState";

let editorsPromise: Promise<typeof import("./MonacoEditors")> | undefined;
const loadEditors = () => {
  editorsPromise ??= ensureMonaco().then(() => import("./MonacoEditors"));
  return editorsPromise;
};

const Editor = lazy(() => loadEditors().then((editors) => ({ default: editors.Editor })));
const DiffEditor = lazy(() => loadEditors().then((editors) => ({ default: editors.DiffEditor })));

export const MonacoEditor = (props: EditorProps) => (
  <Suspense fallback={<div style={{ height: props.height ?? "100%" }}><LoadingState /></div>}>
    <Editor {...props} />
  </Suspense>
);

export const MonacoDiffEditor = (props: DiffEditorProps) => (
  <Suspense fallback={<div style={{ height: props.height ?? "100%" }}><LoadingState /></div>}>
    <DiffEditor {...props} />
  </Suspense>
);

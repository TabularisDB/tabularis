import type {
  ChooseSaveTargetOptions,
  ChooseServerPathOptions,
  ChosenSaveTarget,
  PlatformDialogRequest,
} from "./capabilities";

const SERVER_PATH_EVENT = "tabularis:browser-server-path";
const MESSAGE_EVENT = "tabularis:browser-platform-message";

export type BrowserPathPickerOptions =
  | ({ readonly mode: "open" } & ChooseServerPathOptions)
  | ({ readonly mode: "save" } & ChooseSaveTargetOptions);

export interface BrowserServerPathRequest {
  readonly options: BrowserPathPickerOptions;
  readonly resolve: (selection: ChosenSaveTarget | null) => void;
  readonly reject: (error: unknown) => void;
}

export interface BrowserMessageRequest {
  readonly request: PlatformDialogRequest;
  readonly resolve: () => void;
}

export function requestBrowserServerPath(
  options: ChooseServerPathOptions,
): Promise<ChosenSaveTarget | null> {
  return new Promise((resolve, reject) => {
    window.dispatchEvent(
      new CustomEvent<BrowserServerPathRequest>(SERVER_PATH_EVENT, {
        detail: { options: { ...options, mode: "open" }, resolve, reject },
      }),
    );
  });
}

export function requestBrowserSaveTarget(
  options: ChooseSaveTargetOptions,
): Promise<ChosenSaveTarget | null> {
  return new Promise((resolve, reject) => {
    window.dispatchEvent(
      new CustomEvent<BrowserServerPathRequest>(SERVER_PATH_EVENT, {
        detail: { options: { ...options, mode: "save" }, resolve, reject },
      }),
    );
  });
}

export function requestBrowserMessage(
  request: PlatformDialogRequest,
): Promise<void> {
  return new Promise((resolve) => {
    window.dispatchEvent(
      new CustomEvent<BrowserMessageRequest>(MESSAGE_EVENT, {
        detail: { request, resolve },
      }),
    );
  });
}

export function subscribeBrowserServerPathRequests(
  handler: (request: BrowserServerPathRequest) => void,
): () => void {
  const listener = (event: Event) => {
    handler((event as CustomEvent<BrowserServerPathRequest>).detail);
  };
  window.addEventListener(SERVER_PATH_EVENT, listener);
  return () => window.removeEventListener(SERVER_PATH_EVENT, listener);
}

export function subscribeBrowserMessageRequests(
  handler: (request: BrowserMessageRequest) => void,
): () => void {
  const listener = (event: Event) => {
    handler((event as CustomEvent<BrowserMessageRequest>).detail);
  };
  window.addEventListener(MESSAGE_EVENT, listener);
  return () => window.removeEventListener(MESSAGE_EVENT, listener);
}

import { UserAttentionType, getCurrentWindow } from "@tauri-apps/api/window";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";

export interface ApprovalNotificationContent {
  title: string;
  body: string;
}

interface WindowAttentionSnapshot {
  alwaysOnTop?: boolean;
  visible?: boolean;
  minimized?: boolean;
}

const ALERT_DURATION_MS = 220;
const ALERT_FREQUENCY_HZ = 880;

let approvalAttentionOwnerId: string | null = null;
let approvalAttentionVersion = 0;
let windowAttentionSnapshot: WindowAttentionSnapshot | null | undefined;
let windowAttentionSnapshotApprovalId: string | null = null;

function hasWindowAttentionSnapshot(
  snapshot: WindowAttentionSnapshot | null | undefined,
): snapshot is WindowAttentionSnapshot {
  return Boolean(
    snapshot &&
      (snapshot.alwaysOnTop !== undefined ||
        snapshot.visible !== undefined ||
        snapshot.minimized !== undefined),
  );
}

async function captureWindowAttentionSnapshot(
  appWindow: ReturnType<typeof getCurrentWindow>,
): Promise<WindowAttentionSnapshot | null> {
  const [alwaysOnTop, visible, minimized] = await Promise.allSettled([
    appWindow.isAlwaysOnTop(),
    appWindow.isVisible(),
    appWindow.isMinimized(),
  ]);

  const snapshot: WindowAttentionSnapshot = {};

  if (alwaysOnTop.status === "fulfilled") {
    snapshot.alwaysOnTop = alwaysOnTop.value;
  }

  if (visible.status === "fulfilled") {
    snapshot.visible = visible.value;
  }

  if (minimized.status === "fulfilled") {
    snapshot.minimized = minimized.value;
  }

  return hasWindowAttentionSnapshot(snapshot) ? snapshot : null;
}

function isCurrentApprovalAttention(
  approvalId: string,
  version: number,
): boolean {
  return (
    approvalAttentionOwnerId === approvalId &&
    approvalAttentionVersion === version
  );
}

export async function focusWindowForApproval(approvalId: string): Promise<void> {
  const appWindow = getCurrentWindow();

  approvalAttentionOwnerId = approvalId;
  const version = ++approvalAttentionVersion;

  if (windowAttentionSnapshot === undefined || windowAttentionSnapshotApprovalId !== approvalId) {
    windowAttentionSnapshot = await captureWindowAttentionSnapshot(appWindow).catch(
      () => null,
    );
    windowAttentionSnapshotApprovalId = approvalId;

    if (!isCurrentApprovalAttention(approvalId, version)) {
      return;
    }
  }

  if (!hasWindowAttentionSnapshot(windowAttentionSnapshot)) {
    await appWindow
      .requestUserAttention(UserAttentionType.Informational)
      .catch(() => {});
    if (!isCurrentApprovalAttention(approvalId, version)) return;

    await appWindow.setFocus().catch(() => {});
    return;
  }

  await appWindow.show().catch(() => {});
  if (!isCurrentApprovalAttention(approvalId, version)) return;

  await appWindow.unminimize().catch(() => {});
  if (!isCurrentApprovalAttention(approvalId, version)) return;

  if (windowAttentionSnapshot.alwaysOnTop !== undefined) {
    await appWindow.setAlwaysOnTop(true).catch(() => {});
    if (!isCurrentApprovalAttention(approvalId, version)) return;
  }

  await appWindow.setFocus().catch(() => {});
  if (!isCurrentApprovalAttention(approvalId, version)) return;

  await appWindow
    .requestUserAttention(UserAttentionType.Informational)
    .catch(() => {});
}

export async function restoreWindowAlwaysOnTop(
  approvalId: string | null,
): Promise<void> {
  if (
    !approvalId ||
    (approvalAttentionOwnerId !== approvalId &&
      windowAttentionSnapshotApprovalId !== approvalId)
  ) {
    return;
  }

  if (approvalAttentionOwnerId === approvalId) {
    approvalAttentionOwnerId = null;
    approvalAttentionVersion += 1;
  }

  const previousWindowState = windowAttentionSnapshot;

  if (!hasWindowAttentionSnapshot(previousWindowState)) {
    windowAttentionSnapshot = undefined;
    windowAttentionSnapshotApprovalId = null;
    return;
  }

  const appWindow = getCurrentWindow();
  const remainingWindowState: WindowAttentionSnapshot = {};

  if (previousWindowState.alwaysOnTop !== undefined) {
    const restoredAlwaysOnTop = await appWindow
      .setAlwaysOnTop(previousWindowState.alwaysOnTop)
      .then(() => true)
      .catch(() => false);

    if (!restoredAlwaysOnTop) {
      remainingWindowState.alwaysOnTop = previousWindowState.alwaysOnTop;
    }
  }

  if (previousWindowState.minimized) {
    const restoredMinimized = await appWindow
      .minimize()
      .then(() => true)
      .catch(() => false);

    if (!restoredMinimized) {
      remainingWindowState.minimized = previousWindowState.minimized;
    }
  }

  if (previousWindowState.visible === false) {
    const restoredVisibility = await appWindow
      .hide()
      .then(() => true)
      .catch(() => false);

    if (!restoredVisibility) {
      remainingWindowState.visible = previousWindowState.visible;
    }
  }

  if (hasWindowAttentionSnapshot(remainingWindowState)) {
    windowAttentionSnapshot = remainingWindowState;
    windowAttentionSnapshotApprovalId = approvalId;
    return;
  }

  windowAttentionSnapshot = undefined;
  windowAttentionSnapshotApprovalId = null;
}

// XDG theme sound played through the OS notification on Linux. The file ships
// with the freedesktop sound theme and exists on every desktop we target.
const LINUX_NOTIFICATION_SOUND = "message-new-instant";

/**
 * On Linux the WebKitGTK autoplay policy keeps the programmatically-started
 * AudioContext suspended, so the in-page alert tone never reaches the speakers.
 * Returning a sound name here routes the alert through the OS notification
 * instead. macOS/Windows return undefined and keep using the Web Audio tone,
 * which their webviews allow without a user gesture.
 */
function approvalNotificationSound(): string | undefined {
  const platform = typeof navigator !== "undefined" ? navigator.platform : "";
  return platform.toUpperCase().includes("LINUX")
    ? LINUX_NOTIFICATION_SOUND
    : undefined;
}

export async function notifyApprovalRequest(
  content: ApprovalNotificationContent,
): Promise<void> {
  let permissionGranted = await isPermissionGranted().catch(() => false);
  if (!permissionGranted) {
    const permission = await requestPermission().catch(() => "denied" as const);
    permissionGranted = permission === "granted";
  }

  const sound = approvalNotificationSound();

  if (permissionGranted) {
    sendNotification({
      title: content.title,
      body: content.body,
      ...(sound ? { sound } : {}),
    });
  }

  // When the OS notification carries the sound (Linux) we skip the in-page tone
  // to avoid a double alert; elsewhere the Web Audio tone is the alert.
  if (!sound) {
    try {
      playApprovalSound();
    } catch {
      // Keep notification failures isolated from the short alert sound.
    }
  }
}

function playApprovalSound(): void {
  if (typeof window === "undefined") return;

  const AudioContextCtor = window.AudioContext;
  if (!AudioContextCtor) return;

  const audioContext = new AudioContextCtor();
  const oscillator = audioContext.createOscillator();
  const gainNode = audioContext.createGain();

  const closeAudioContext = () => {
    void audioContext.close().catch(() => {});
  };

  const startAlertTone = () => {
    oscillator.type = "triangle";
    oscillator.frequency.setValueAtTime(
      ALERT_FREQUENCY_HZ,
      audioContext.currentTime,
    );

    gainNode.gain.setValueAtTime(0.0001, audioContext.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(
      0.18,
      audioContext.currentTime + 0.02,
    );
    gainNode.gain.exponentialRampToValueAtTime(
      0.0001,
      audioContext.currentTime + ALERT_DURATION_MS / 1000,
    );

    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);

    oscillator.start();
    oscillator.stop(audioContext.currentTime + ALERT_DURATION_MS / 1000);
    oscillator.onended = closeAudioContext;
  };

  if (audioContext.state === "suspended") {
    void audioContext
      .resume()
      .then(() => {
        if (audioContext.state !== "running") {
          closeAudioContext();
          return;
        }

        startAlertTone();
      })
      .catch(closeAudioContext);

    return;
  }

  startAlertTone();
}

import { useSshAskpass } from "../../hooks/useSshAskpass";
import { SshAskpassModal } from "./SshAskpassModal";

/// Listens for `ssh-askpass://request` events emitted while a system ssh
/// process authenticates (key passphrase, security-key PIN or touch) and
/// presents one prompt at a time. Mounted once at the App level, so it shows
/// over any current page.
export function SshAskpassGate() {
  const { current, respond, dismiss } = useSshAskpass();
  if (!current) return null;

  const handleClose = () => {
    if (current.kind === "notify") {
      // Notifications have no answer channel; just hide the modal. The
      // backend dismisses it for real once the security key is touched.
      dismiss(current.id);
    } else {
      // Closing without an answer is a cancel — ssh is blocked waiting on
      // us, so silent dismissal would just burn its timeout.
      respond(current.id, null).catch(() => {});
    }
  };

  return (
    <SshAskpassModal
      key={current.id}
      isOpen
      request={current}
      onSubmit={(response) => respond(current.id, response).catch(() => {})}
      onClose={handleClose}
    />
  );
}

use super::PluginCommand;
use tokio::sync::mpsc;

/// Cancels a dispatched call when its awaiting future is aborted or dropped.
pub(super) struct PendingCallGuard {
    sender: mpsc::Sender<PluginCommand>,
    id: u64,
    armed: bool,
}

impl PendingCallGuard {
    pub(super) fn new(sender: mpsc::Sender<PluginCommand>, id: u64) -> Self {
        Self {
            sender,
            id,
            armed: true,
        }
    }

    pub(super) fn disarm(&mut self) {
        self.armed = false;
    }
}

impl Drop for PendingCallGuard {
    fn drop(&mut self) {
        if !self.armed {
            return;
        }
        if let Err(mpsc::error::TrySendError::Full(command)) =
            self.sender.try_send(PluginCommand::Cancel(self.id))
        {
            // A saturated request queue must not silently discard cancellation.
            if let Ok(runtime) = tokio::runtime::Handle::try_current() {
                let sender = self.sender.clone();
                runtime.spawn(async move {
                    let _ = sender.send(command).await;
                });
            }
        }
    }
}

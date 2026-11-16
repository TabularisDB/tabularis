use super::*;
use windows_sys::Win32::System::JobObjects::IsProcessInJob;

fn sleeping_child() -> tokio::process::Child {
    tokio::process::Command::new("ping")
        .args(["-n", "30", "127.0.0.1"])
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .kill_on_drop(true)
        .spawn()
        .expect("spawn ping")
}

fn is_in_host_job(child: &tokio::process::Child) -> bool {
    let job = windows::host_job().expect("host job");
    let mut result = 0;
    let handle = child.raw_handle().expect("live child");
    // SAFETY: both handles are live for the duration of the call.
    let ok = unsafe { IsProcessInJob(handle, job.handle(), &mut result) };
    assert_ne!(ok, 0, "IsProcessInJob failed");
    result != 0
}

#[tokio::test]
async fn a_bound_plugin_joins_the_kill_on_close_job() {
    let mut child = sleeping_child();
    bind_to_host(&child);
    assert!(is_in_host_job(&child));
    child.kill().await.unwrap();
}

#[tokio::test]
async fn an_unbound_process_stays_outside_the_job() {
    let mut child = sleeping_child();
    assert!(!is_in_host_job(&child));
    child.kill().await.unwrap();
}

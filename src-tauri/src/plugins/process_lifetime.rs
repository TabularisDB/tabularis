//! Ties plugin processes to the lifetime of the Tabularis process that
//! started them (issue #1280).
//!
//! The host stops its plugins on a clean shutdown, and a plugin is expected
//! to exit when its stdin closes. Neither helps when the host is terminated
//! outright, which is how MCP clients usually stop `tabularis --mcp`: a
//! plugin that is still busy, or that ignores EOF, keeps running with nobody
//! left to stop it, and on Windows its open executable blocks plugin updates.
//!
//! On Windows every plugin joins one job object that kills its processes
//! when the last handle to it closes. Only the host holds that handle (it is
//! not inheritable), so the kernel kills the plugins however the host exits,
//! including `TerminateProcess`. On other platforms this is a no-op: the
//! kernel closes the host's end of the plugin's stdin when the host dies, and
//! the plugin sees EOF.

/// Make `child` exit when this process exits. Logs and carries on if the OS
/// refuses, so a plugin still starts without the guarantee.
pub(crate) fn bind_to_host(child: &tokio::process::Child) {
    #[cfg(windows)]
    {
        let Some(handle) = child.raw_handle() else {
            // The child has already exited and been reaped.
            return;
        };
        if let Err(error) = windows::assign_to_host_job(handle) {
            log::warn!(
                "Plugin process {:?} will not be stopped if Tabularis is killed: {error}",
                child.id()
            );
        }
    }
    #[cfg(not(windows))]
    let _ = child;
}

#[cfg(windows)]
pub(crate) mod windows {
    use std::os::windows::io::RawHandle;
    use std::sync::OnceLock;

    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
        SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };

    /// The job every plugin joins. Never closed by hand: the kernel closes it
    /// when this process exits, which is what kills the plugins.
    pub(crate) struct HostJob(HANDLE);

    // SAFETY: a job handle is a kernel object handle; Win32 allows using it
    // from any thread.
    unsafe impl Send for HostJob {}
    unsafe impl Sync for HostJob {}

    impl HostJob {
        pub(crate) fn handle(&self) -> HANDLE {
            self.0
        }
    }

    fn create_kill_on_close_job() -> Result<HostJob, String> {
        // SAFETY: plain Win32 calls. A null security descriptor makes the
        // handle non-inheritable, so no plugin can keep the job open.
        unsafe {
            let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
            if job.is_null() {
                return Err(format!(
                    "CreateJobObjectW failed: {}",
                    std::io::Error::last_os_error()
                ));
            }
            let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            let ok = SetInformationJobObject(
                job,
                JobObjectExtendedLimitInformation,
                (&info as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast(),
                std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            );
            if ok == 0 {
                let error = std::io::Error::last_os_error();
                CloseHandle(job);
                return Err(format!("SetInformationJobObject failed: {error}"));
            }
            Ok(HostJob(job))
        }
    }

    pub(crate) fn host_job() -> Result<&'static HostJob, String> {
        static JOB: OnceLock<Result<HostJob, String>> = OnceLock::new();
        JOB.get_or_init(create_kill_on_close_job)
            .as_ref()
            .map_err(Clone::clone)
    }

    pub(crate) fn assign_to_host_job(process: RawHandle) -> Result<(), String> {
        // `RawHandle` and `HANDLE` are both `*mut c_void`.
        let job = host_job()?;
        // SAFETY: `process` is a live process handle owned by the caller's
        // `Child`. Windows 8 and later allow nested jobs, so this also works
        // when an MCP client already runs Tabularis inside a job of its own.
        let ok = unsafe { AssignProcessToJobObject(job.handle(), process) };
        if ok == 0 {
            return Err(format!(
                "AssignProcessToJobObject failed: {}",
                std::io::Error::last_os_error()
            ));
        }
        Ok(())
    }
}

#[cfg(all(test, windows))]
#[path = "process_lifetime_tests.rs"]
mod tests;

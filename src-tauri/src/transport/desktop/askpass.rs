/// Frontend answer to an askpass prompt. `response = None` means the user
/// cancelled.
#[tauri::command]
pub fn respond_ssh_askpass(id: u64, response: Option<String>) {
    crate::askpass::respond_ssh_askpass(id, response)
}

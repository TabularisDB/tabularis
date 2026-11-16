#[tauri::command]
pub fn set_proxy_password(slot: String, password: String) -> Result<(), String> {
    crate::proxy::set_proxy_password(slot, password)
}

#[tauri::command]
pub fn proxy_password_is_set(slot: String) -> Result<bool, String> {
    crate::proxy::proxy_password_is_set(slot)
}

#[tauri::command]
pub fn delete_proxy_password(slot: String) -> Result<(), String> {
    crate::proxy::delete_proxy_password(slot)
}

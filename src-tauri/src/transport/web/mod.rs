pub mod auth;
pub mod contract;
pub mod events;
mod login_page;
mod login_target;
pub mod rpc;
pub mod server;
pub mod server_files;
pub mod static_assets;

#[cfg(test)]
mod events_tests;
#[cfg(test)]
mod login_page_tests;
#[cfg(test)]
mod login_target_tests;
#[cfg(test)]
mod tests;

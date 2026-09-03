pub mod commands;
pub mod compat; // COMPAT(registry-ga): remove with the BC layer
pub mod deep_link;
pub mod driver;
pub mod install_cancellation;
pub mod installer;
pub mod integrity;
pub mod manager;
pub mod registry;
pub mod rpc;
pub mod runtime_version;
pub mod tabularium;

#[cfg(test)]
mod tests;

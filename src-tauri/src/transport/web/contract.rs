use serde::{Deserialize, Serialize};

pub const WEB_API_VERSION: &str = "v1";

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionNegotiation {
    pub api_version: String,
    pub server_version: String,
    pub authenticated: bool,
    pub capabilities: WebTransportCapabilities,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebTransportCapabilities {
    pub rpc: bool,
    pub events: bool,
    pub uploads: bool,
    pub downloads: bool,
    pub plugin_assets: bool,
}

impl SessionNegotiation {
    pub fn skeleton() -> Self {
        Self {
            api_version: WEB_API_VERSION.to_string(),
            server_version: env!("CARGO_PKG_VERSION").to_string(),
            authenticated: false,
            capabilities: WebTransportCapabilities {
                rpc: false,
                events: false,
                uploads: false,
                downloads: false,
                plugin_assets: false,
            },
        }
    }
}

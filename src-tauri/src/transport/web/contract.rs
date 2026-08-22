use serde::{Deserialize, Serialize};

pub const WEB_API_VERSION: &str = "v1";

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionNegotiation {
    pub api_version: String,
    pub server_version: String,
    pub server_build: ServerBuildInformation,
    pub authenticated: bool,
    pub csrf_token: String,
    pub capabilities: WebTransportCapabilities,
    pub query_response_policy: WebQueryResponsePolicy,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebTransportCapabilities {
    pub rpc: bool,
    pub events: bool,
    pub uploads: bool,
    pub downloads: bool,
    pub plugin_assets: bool,
    pub mcp_host_configuration: bool,
    pub native_updater: bool,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerBuildInformation {
    pub target: String,
    pub profile: String,
    pub commit: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebQueryResponsePolicy {
    pub max_rows_per_page: u32,
    pub max_response_bytes: usize,
    pub streaming: bool,
}

impl SessionNegotiation {
    pub fn skeleton() -> Self {
        Self::new(false, String::new(), false)
    }

    pub fn authenticated(csrf_token: String, mcp_host_configuration: bool) -> Self {
        Self::new(true, csrf_token, mcp_host_configuration)
    }

    fn new(authenticated: bool, csrf_token: String, mcp_host_configuration: bool) -> Self {
        Self {
            api_version: WEB_API_VERSION.to_string(),
            server_version: env!("CARGO_PKG_VERSION").to_string(),
            server_build: ServerBuildInformation {
                target: format!("{}-{}", std::env::consts::OS, std::env::consts::ARCH),
                profile: if cfg!(debug_assertions) {
                    "debug".to_string()
                } else {
                    "release".to_string()
                },
                commit: option_env!("TABULARIS_BUILD_COMMIT")
                    .map(str::trim)
                    .filter(|commit| !commit.is_empty())
                    .map(str::to_string),
            },
            authenticated,
            csrf_token,
            capabilities: WebTransportCapabilities {
                rpc: true,
                events: true,
                uploads: true,
                downloads: true,
                plugin_assets: true,
                mcp_host_configuration,
                native_updater: false,
            },
            query_response_policy: WebQueryResponsePolicy {
                max_rows_per_page: crate::application::queries::WEB_MAX_ROWS_PER_PAGE,
                max_response_bytes: crate::application::queries::WEB_MAX_RESPONSE_BYTES,
                streaming: false,
            },
        }
    }
}

//! MCP tool-output negotiation and serialization.
//!
//! MCP itself continues to use JSON-RPC. This module only controls the text
//! carried by a successful tool result's `content` item.

use crate::config::{AppConfig, DEFAULT_MCP_OUTPUT_FORMAT};
use serde::Serialize;
use serde_json::{Map, Value};

const OUTPUT_FORMAT_ARGUMENT: &str = "output_format";

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub(super) enum ToolOutputFormat {
    #[default]
    Json,
    Toon,
}

#[derive(Debug, Eq, PartialEq)]
pub(super) enum OutputFormatError {
    InvalidArgument,
    Encoding(String),
}

impl ToolOutputFormat {
    pub(super) fn as_str(self) -> &'static str {
        match self {
            Self::Json => "json",
            Self::Toon => "toon",
        }
    }

    pub(super) fn from_config(config: &AppConfig) -> Self {
        match config
            .mcp_output_format
            .as_deref()
            .unwrap_or(DEFAULT_MCP_OUTPUT_FORMAT)
        {
            "toon" => Self::Toon,
            _ => Self::Json,
        }
    }

    pub(super) fn from_arguments(
        arguments: Option<&Map<String, Value>>,
        default: Self,
    ) -> Result<Self, OutputFormatError> {
        let Some(value) = arguments.and_then(|args| args.get(OUTPUT_FORMAT_ARGUMENT)) else {
            return Ok(default);
        };

        match value.as_str() {
            Some("json") => Ok(Self::Json),
            Some("toon") => Ok(Self::Toon),
            _ => Err(OutputFormatError::InvalidArgument),
        }
    }

    pub(super) fn encode<T: Serialize>(self, value: &T) -> Result<String, OutputFormatError> {
        match self {
            // Keep the existing default representation byte-for-byte compatible.
            Self::Json => serde_json::to_string_pretty(value)
                .map_err(|error| OutputFormatError::Encoding(error.to_string())),
            Self::Toon => toon_format::encode_default(value)
                .map_err(|error| OutputFormatError::Encoding(error.to_string())),
        }
    }
}

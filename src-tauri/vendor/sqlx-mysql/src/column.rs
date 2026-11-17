use crate::ext::ustr::UStr;
use crate::protocol::text::ColumnFlags;
use crate::{MySql, MySqlTypeInfo};
pub(crate) use sqlx_core::column::*;

#[derive(Debug, Clone)]
#[cfg_attr(feature = "offline", derive(serde::Serialize, serde::Deserialize))]
pub struct MySqlColumn {
    pub(crate) ordinal: usize,
    pub(crate) name: UStr,
    pub(crate) type_info: MySqlTypeInfo,

    #[cfg_attr(feature = "offline", serde(skip))]
    pub(crate) flags: Option<ColumnFlags>,

    #[cfg_attr(feature = "offline", serde(skip))]
    pub(crate) source: Option<MySqlColumnSource>,
}

/// Where a result column originates, as sent by the server in the column
/// definition packet. Tabularis patch: upstream parses these fields and drops
/// them.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MySqlColumnSource {
    /// Schema (database) of the original table.
    pub schema: String,
    /// Original table name, not the alias.
    pub table: String,
    /// Alias of the table in the query (equals `table` when none was given).
    pub table_alias: String,
    /// Original column name, not the output label.
    pub column: String,
}

impl MySqlColumn {
    /// The table column this result column was read from, or `None` for an
    /// expression, a literal or any column the server gave no origin for.
    pub fn source(&self) -> Option<&MySqlColumnSource> {
        self.source.as_ref()
    }
}

impl Column for MySqlColumn {
    type Database = MySql;

    fn ordinal(&self) -> usize {
        self.ordinal
    }

    fn name(&self) -> &str {
        &self.name
    }

    fn type_info(&self) -> &MySqlTypeInfo {
        &self.type_info
    }
}

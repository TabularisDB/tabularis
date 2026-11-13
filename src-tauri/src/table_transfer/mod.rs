//! Pure rules for copying table rows between two database connections:
//! which driver pairs are supported, how columns map, and which values may
//! cross without losing information.

mod convert;
mod mapping;
mod model;
mod types;

#[cfg(test)]
mod tests;

pub use convert::apply as apply_conversion;
pub use mapping::{build_table_plan, PlanInputs};
pub use model::*;
pub use types::{capabilities, dialect_for_driver, ensure_supported_pair};

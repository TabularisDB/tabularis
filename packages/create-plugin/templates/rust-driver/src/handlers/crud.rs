//! Row-level CRUD.
//!
//! Implement these to enable inline row editing in the Tabularis data grid.
//! Not implementing them means the grid is read-only for this driver,
//! which is a valid stance — set `capabilities.readonly: true` in
//! the `.tabularium` manifest to hide the edit UI altogether.

use serde_json::Value;

use crate::rpc::not_implemented;

pub fn insert_record(id: Value, _params: &Value) -> Value {
    not_implemented(id, "insert_record")
}

pub fn update_record(id: Value, _params: &Value) -> Value {
    not_implemented(id, "update_record")
}

pub fn delete_record(id: Value, _params: &Value) -> Value {
    not_implemented(id, "delete_record")
}

//! Schema metadata: databases, schemas, tables, columns, indexes, FKs,
//! views, routines. Each handler below returns a valid-but-empty response
//! so the plugin loads without errors. Replace the bodies one by one.
//!
//! Full reference: https://github.com/TabularisDB/tabularis/blob/main/plugins/PLUGIN_GUIDE.md#5-required-methods

use serde_json::{json, Value};

use crate::rpc::ok_response;

pub fn get_databases(id: Value, _params: &Value) -> Value {
    // TODO: return your real database list.
    ok_response(id, json!([]))
}

pub fn get_schemas(id: Value, _params: &Value) -> Value {
    // Only meaningful if `capabilities.schemas` is true in manifest.json.
    ok_response(id, json!([]))
}

pub fn get_tables(id: Value, _params: &Value) -> Value {
    // TODO: return [{ name, schema, comment }].
    ok_response(id, json!([]))
}

pub fn get_columns(id: Value, _params: &Value) -> Value {
    // TODO: return [{ name, data_type, is_nullable, column_default,
    //                 is_primary_key, is_auto_increment, comment }].
    ok_response(id, json!([]))
}

pub fn get_foreign_keys(id: Value, _params: &Value) -> Value {
    ok_response(id, json!([]))
}

pub fn get_indexes(id: Value, _params: &Value) -> Value {
    ok_response(id, json!([]))
}

pub fn get_views(id: Value, _params: &Value) -> Value {
    ok_response(id, json!([]))
}

pub fn get_view_definition(id: Value, _params: &Value) -> Value {
    ok_response(id, Value::String(String::new()))
}

pub fn get_view_columns(id: Value, _params: &Value) -> Value {
    ok_response(id, json!([]))
}

pub fn get_routines(id: Value, _params: &Value) -> Value {
    ok_response(id, json!([]))
}

pub fn get_routine_parameters(id: Value, _params: &Value) -> Value {
    ok_response(id, json!([]))
}

pub fn get_routine_definition(id: Value, _params: &Value) -> Value {
    ok_response(id, Value::String(String::new()))
}

pub fn get_schema_snapshot(id: Value, _params: &Value) -> Value {
    // Used for the ER diagram. Return
    // [{ name, columns: [...], foreign_keys: [...] }].
    ok_response(id, json!([]))
}

pub fn get_all_columns_batch(id: Value, _params: &Value) -> Value {
    ok_response(id, json!({}))
}

pub fn get_all_foreign_keys_batch(id: Value, _params: &Value) -> Value {
    ok_response(id, json!({}))
}

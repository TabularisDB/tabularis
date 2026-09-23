use serde::de::{self, DeserializeSeed, MapAccess, SeqAccess, Visitor};
use serde_json::{Map, Number, Value};
use std::fmt;

struct Seed<'a> {
    nodes: &'a mut usize,
    depth: usize,
    max_nodes: usize,
    max_depth: usize,
}

impl<'de> DeserializeSeed<'de> for Seed<'_> {
    type Value = Value;

    fn deserialize<D: de::Deserializer<'de>>(self, deserializer: D) -> Result<Value, D::Error> {
        *self.nodes += 1;
        if *self.nodes > self.max_nodes {
            return Err(de::Error::custom("Theme JSON exceeds the node limit"));
        }
        deserializer.deserialize_any(self)
    }
}

impl<'de> Visitor<'de> for Seed<'_> {
    type Value = Value;

    fn expecting(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
        formatter.write_str("bounded JSON with unique object keys")
    }

    fn visit_map<A: MapAccess<'de>>(self, mut access: A) -> Result<Value, A::Error> {
        if self.depth >= self.max_depth {
            return Err(de::Error::custom("Theme JSON exceeds the depth limit"));
        }
        let mut result = Map::new();
        while let Some(key) = access.next_key::<String>()? {
            if result.contains_key(&key) {
                return Err(de::Error::custom("Duplicate theme JSON property"));
            }
            let value = access.next_value_seed(Seed {
                nodes: self.nodes,
                depth: self.depth + 1,
                max_nodes: self.max_nodes,
                max_depth: self.max_depth,
            })?;
            result.insert(key, value);
        }
        Ok(Value::Object(result))
    }

    fn visit_seq<A: SeqAccess<'de>>(self, mut access: A) -> Result<Value, A::Error> {
        if self.depth >= self.max_depth {
            return Err(de::Error::custom("Theme JSON exceeds the depth limit"));
        }
        let mut result = Vec::new();
        while let Some(value) = access.next_element_seed(Seed {
            nodes: self.nodes,
            depth: self.depth + 1,
            max_nodes: self.max_nodes,
            max_depth: self.max_depth,
        })? {
            result.push(value);
        }
        Ok(Value::Array(result))
    }

    fn visit_str<E: de::Error>(self, value: &str) -> Result<Value, E> {
        Ok(Value::String(value.to_owned()))
    }

    fn visit_string<E: de::Error>(self, value: String) -> Result<Value, E> {
        Ok(Value::String(value))
    }

    fn visit_bool<E: de::Error>(self, value: bool) -> Result<Value, E> {
        Ok(Value::Bool(value))
    }

    fn visit_unit<E: de::Error>(self) -> Result<Value, E> {
        Ok(Value::Null)
    }

    fn visit_i64<E: de::Error>(self, value: i64) -> Result<Value, E> {
        Ok(Value::Number(value.into()))
    }

    fn visit_u64<E: de::Error>(self, value: u64) -> Result<Value, E> {
        Ok(Value::Number(value.into()))
    }

    fn visit_f64<E: de::Error>(self, value: f64) -> Result<Value, E> {
        Number::from_f64(value)
            .map(Value::Number)
            .ok_or_else(|| de::Error::custom("Invalid JSON number"))
    }
}

pub(crate) fn parse_bounded_json(
    input: &[u8],
    max_bytes: usize,
    max_depth: usize,
    max_nodes: usize,
) -> Result<Value, String> {
    if input.len() > max_bytes {
        return Err("Theme JSON exceeds the byte limit".into());
    }
    let mut deserializer = serde_json::Deserializer::from_slice(input);
    let mut nodes = 0;
    let result = Seed {
        nodes: &mut nodes,
        depth: 0,
        max_nodes,
        max_depth,
    }
    .deserialize(&mut deserializer)
    .map_err(|error| error.to_string())?;
    deserializer.end().map_err(|error| error.to_string())?;
    Ok(result)
}

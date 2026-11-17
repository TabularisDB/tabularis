use super::model::*;

struct Decimal<'a> {
    negative: bool,
    int: &'a str,
    frac: &'a str,
}

fn parse_decimal(text: &str) -> Option<Decimal<'_>> {
    let (negative, rest) = match text.strip_prefix('-') {
        Some(rest) => (true, rest),
        None => (false, text.strip_prefix('+').unwrap_or(text)),
    };
    let (int, frac) = rest.split_once('.').unwrap_or((rest, ""));
    if int.is_empty() && frac.is_empty() {
        return None;
    }
    let digits = |part: &str| part.bytes().all(|b| b.is_ascii_digit());
    if !digits(int) || !digits(frac) {
        return None;
    }
    let int = int.trim_start_matches('0');
    let frac = frac.trim_end_matches('0');
    let negative = negative && !(int.is_empty() && frac.is_empty());
    Some(Decimal { negative, int, frac })
}

fn decimal_fits(text: &str, precision: Option<u32>, scale: Option<u32>) -> Result<(), ConvertError> {
    match text {
        "NaN" => return Ok(()),
        "Infinity" | "-Infinity" => {
            return if precision.is_none() { Ok(()) } else { Err(ConvertError::OutOfRange) };
        }
        _ => {}
    }
    let parts = parse_decimal(text).ok_or(ConvertError::Malformed)?;
    let Some(precision) = precision else {
        return Ok(());
    };
    let scale = scale.unwrap_or(0);
    if parts.frac.len() > scale as usize {
        return Err(ConvertError::Lossy);
    }
    if parts.int.len() > precision.saturating_sub(scale) as usize {
        return Err(ConvertError::OutOfRange);
    }
    Ok(())
}

fn decimal_to_i64(text: &str, min: i64, max: i64) -> Result<i64, ConvertError> {
    let parts = parse_decimal(text).ok_or(ConvertError::Malformed)?;
    if !parts.frac.is_empty() {
        return Err(ConvertError::Lossy);
    }
    if parts.int.len() > 19 {
        return Err(ConvertError::OutOfRange);
    }
    let magnitude: i128 = if parts.int.is_empty() { 0 } else { parts.int.parse().map_err(|_| ConvertError::Malformed)? };
    let value = if parts.negative { -magnitude } else { magnitude };
    i64::try_from(value)
        .ok()
        .filter(|v| *v >= min && *v <= max)
        .ok_or(ConvertError::OutOfRange)
}

fn same_decimal(a: &str, b: &str) -> bool {
    match (parse_decimal(a), parse_decimal(b)) {
        (Some(a), Some(b)) => a.negative == b.negative && a.int == b.int && a.frac == b.frac,
        _ => false,
    }
}

/// The f32 whose shortest decimal form is `value`, if there is one.
fn fits_f32(value: f64) -> bool {
    ((value as f32).to_string()).parse::<f64>().ok() == Some(value)
}

fn decimal_to_f64(text: &str, bits: u8, allow_non_finite: bool) -> Result<f64, ConvertError> {
    let special = match text {
        "NaN" => Some(f64::NAN),
        "Infinity" => Some(f64::INFINITY),
        "-Infinity" => Some(f64::NEG_INFINITY),
        _ => None,
    };
    if let Some(value) = special {
        return if allow_non_finite { Ok(value) } else { Err(ConvertError::NonFinite) };
    }
    parse_decimal(text).ok_or(ConvertError::Malformed)?;
    let value: f64 = text.parse().map_err(|_| ConvertError::Malformed)?;
    if !value.is_finite() {
        return Err(ConvertError::OutOfRange);
    }
    let shown = if bits == 32 {
        if !fits_f32(value) {
            return Err(ConvertError::Lossy);
        }
        (value as f32).to_string()
    } else {
        value.to_string()
    };
    if same_decimal(text, &shown) {
        Ok(value)
    } else {
        Err(ConvertError::Lossy)
    }
}

fn fraction_digits(text: &str) -> usize {
    text.split_once('.')
        .map(|(_, rest)| rest.bytes().take_while(u8::is_ascii_digit).count())
        .unwrap_or(0)
}

fn text_of(value: TransferValue) -> Result<String, ConvertError> {
    match value {
        TransferValue::Text(text) => Ok(text),
        _ => Err(ConvertError::Malformed),
    }
}

fn int_of(value: &TransferValue) -> Result<i64, ConvertError> {
    match value {
        TransferValue::Int(v) => Ok(*v),
        _ => Err(ConvertError::Malformed),
    }
}

pub fn apply(conversion: &Conversion, value: TransferValue) -> Result<TransferValue, ConvertError> {
    if value == TransferValue::Null {
        return Ok(value);
    }
    match conversion.op {
        Op::Copy => Ok(value),
        Op::BoolToInt => match value {
            TransferValue::Bool(b) => Ok(TransferValue::Int(i64::from(b))),
            _ => Err(ConvertError::Malformed),
        },
        Op::IntRange { min, max } => {
            let v = int_of(&value)?;
            if v < min || v > max { Err(ConvertError::OutOfRange) } else { Ok(value) }
        }
        Op::IntToFloat { max_exact } => {
            let v = int_of(&value)?;
            if v.unsigned_abs() > max_exact as u64 {
                Err(ConvertError::Lossy)
            } else {
                Ok(TransferValue::Float(v as f64))
            }
        }
        Op::IntToDecimal { precision, scale } => {
            let text = int_of(&value)?.to_string();
            decimal_fits(&text, precision, scale)?;
            Ok(TransferValue::Text(text))
        }
        Op::FloatCheck { bits, allow_non_finite } => {
            let TransferValue::Float(v) = value else {
                return Err(ConvertError::Malformed);
            };
            if !v.is_finite() {
                return if allow_non_finite { Ok(value) } else { Err(ConvertError::NonFinite) };
            }
            if bits == 32 && !fits_f32(v) { Err(ConvertError::Lossy) } else { Ok(value) }
        }
        Op::DecimalFit { precision, scale } => {
            let text = text_of(value)?;
            decimal_fits(&text, precision, scale)?;
            Ok(TransferValue::Text(text))
        }
        Op::DecimalToInt { min, max } => {
            decimal_to_i64(&text_of(value)?, min, max).map(TransferValue::Int)
        }
        Op::DecimalToFloat { bits, allow_non_finite } => {
            decimal_to_f64(&text_of(value)?, bits, allow_non_finite).map(TransferValue::Float)
        }
        Op::DecimalToNumeric => {
            let text = text_of(value)?;
            match decimal_to_i64(&text, i64::MIN, i64::MAX) {
                Ok(v) => Ok(TransferValue::Int(v)),
                Err(ConvertError::Malformed) => Err(ConvertError::Malformed),
                Err(_) => decimal_to_f64(&text, 64, false).map(TransferValue::Float),
            }
        }
        Op::TextMaxLen { max } => {
            let text = text_of(value)?;
            if text.chars().count() as u64 > max { Err(ConvertError::TooLong) } else { Ok(TransferValue::Text(text)) }
        }
        Op::Temporal { precision } => {
            let text = text_of(value)?;
            if fraction_digits(&text) > precision as usize { Err(ConvertError::Lossy) } else { Ok(TransferValue::Text(text)) }
        }
        Op::JsonNotNumeric => {
            let text = text_of(value)?;
            if text.trim().parse::<f64>().is_ok() { Err(ConvertError::Lossy) } else { Ok(TransferValue::Text(text)) }
        }
    }
}

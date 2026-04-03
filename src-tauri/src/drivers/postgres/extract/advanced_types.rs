use std::net::IpAddr;

use serde_json::{Number as JsonNumber, Value as JsonValue};
use tokio_postgres::types::{FromSql, Type};

use crate::drivers::common::encode_blob;

// System Identifiers & Object References (The "Reg" Types)

macro_rules! u32_wrapper {
    ($name: ident, $pg_type: ident) => {
        pub struct $name(u32);

        impl<'a> FromSql<'a> for $name {
            fn from_sql(
                ty: &Type,
                raw: &[u8],
            ) -> Result<Self, Box<dyn std::error::Error + Sync + Send>> {
                Ok(Self(<u32 as FromSql>::from_sql(ty, raw)?))
            }

            fn accepts(ty: &Type) -> bool {
                match *ty {
                    Type::$pg_type => true,
                    _ => false,
                }
            }
        }

        impl From<$name> for JsonValue {
            #[inline(always)]
            fn from(value: $name) -> Self {
                JsonValue::Number(JsonNumber::from(value.0))
            }
        }
    };
}

u32_wrapper!(Xid, XID);
u32_wrapper!(Cid, CID);

// NOTE:
// These are all literally just Oids under the hood and we should get the name of the object
// from the database but we can't do that from here so instead we just return the Oid (u32)
u32_wrapper!(RegClass, REGCLASS);
u32_wrapper!(RegProc, REGPROC);
u32_wrapper!(RegProcedure, REGPROCEDURE);
u32_wrapper!(RegOper, REGOPER);
u32_wrapper!(RegOperator, REGOPERATOR);
u32_wrapper!(RegType, REGTYPE);
u32_wrapper!(RegConfig, REGCONFIG);
u32_wrapper!(RegDictionary, REGDICTIONARY);
u32_wrapper!(RegNamespace, REGNAMESPACE);
u32_wrapper!(RegRole, REGROLE);
u32_wrapper!(RegCollation, REGCOLLATION);

pub struct Xid8(u64);

impl<'a> FromSql<'a> for Xid8 {
    fn from_sql(
        ty: &Type,
        raw: &'a [u8],
    ) -> Result<Self, Box<dyn std::error::Error + Sync + Send>> {
        Ok(Self(<i64 as FromSql>::from_sql(ty, raw)? as u64))
    }

    fn accepts(ty: &Type) -> bool {
        match *ty {
            Type::XID8 => true,
            _ => false,
        }
    }
}

impl From<Xid8> for JsonValue {
    #[inline(always)]
    fn from(value: Xid8) -> Self {
        JsonValue::Number(JsonNumber::from(value.0))
    }
}

pub struct Tid {
    block_num: u32,
    offset: u16,
}

impl<'a> FromSql<'a> for Tid {
    fn from_sql(
        _ty: &Type,
        raw: &'a [u8],
    ) -> Result<Self, Box<dyn std::error::Error + Sync + Send>> {
        if raw.len() != 6 {
            return Err(format!("expected 6 bytes for TID, got {}", raw.len()).into());
        };

        Ok(Self {
            block_num: <u32 as FromSql>::from_sql(&Type::OID, &raw[..4])?,
            offset: <i16 as FromSql>::from_sql(&Type::INT2, &raw[4..])? as u16,
        })
    }

    fn accepts(ty: &Type) -> bool {
        match *ty {
            Type::TID => true,
            _ => false,
        }
    }
}

impl From<Tid> for JsonValue {
    #[inline(always)]
    fn from(value: Tid) -> Self {
        JsonValue::String(format!("({}, {})", value.block_num, value.offset))
    }
}

// Geometric Types

pub struct Point {
    pub x: f64,
    pub y: f64,
}

impl Point {
    #[inline]
    fn extract(raw: &[u8]) -> Result<Self, Box<dyn std::error::Error + Sync + Send>> {
        if raw.len() != 16 {
            return Err(format!("expected 16 bytes for Point, got {}", raw.len()).into());
        };

        Ok(Self {
            x: <f64 as FromSql>::from_sql(&Type::FLOAT8, &raw[..8])?,
            y: <f64 as FromSql>::from_sql(&Type::FLOAT8, &raw[8..])?,
        })
    }
}

impl<'a> FromSql<'a> for Point {
    fn from_sql(
        _ty: &Type,
        raw: &'a [u8],
    ) -> Result<Self, Box<dyn std::error::Error + Sync + Send>> {
        Point::extract(raw)
    }

    fn accepts(ty: &Type) -> bool {
        match *ty {
            Type::POINT => true,
            _ => false,
        }
    }
}

impl From<Point> for JsonValue {
    #[inline(always)]
    fn from(value: Point) -> Self {
        JsonValue::String(format!("({}, {})", value.x, value.y))
    }
}

pub struct Lseg {
    pub p1: Point,
    pub p2: Point,
}

impl<'a> FromSql<'a> for Lseg {
    fn from_sql(
        _ty: &Type,
        raw: &'a [u8],
    ) -> Result<Self, Box<dyn std::error::Error + Sync + Send>> {
        if raw.len() != 32 {
            return Err(format!("expected 32 bytes for Lseg, got {}", raw.len()).into());
        };

        Ok(Self {
            p1: Point::extract(&raw[..16])?,
            p2: Point::extract(&raw[16..])?,
        })
    }

    fn accepts(ty: &Type) -> bool {
        match *ty {
            Type::LSEG => true,
            _ => false,
        }
    }
}

impl From<Lseg> for JsonValue {
    #[inline(always)]
    fn from(value: Lseg) -> Self {
        JsonValue::String(format!(
            "[({}, {}), ({}, {})]",
            value.p1.x, value.p1.y, value.p2.x, value.p2.y
        ))
    }
}

pub struct PgBox {
    pub upper_right_p: Point,
    pub lower_left_p: Point,
}

impl<'a> FromSql<'a> for PgBox {
    fn from_sql(
        _ty: &Type,
        raw: &'a [u8],
    ) -> Result<Self, Box<dyn std::error::Error + Sync + Send>> {
        if raw.len() != 32 {
            return Err(format!("expected 32 bytes for Box, got {}", raw.len()).into());
        };

        Ok(Self {
            upper_right_p: Point::extract(&raw[..16])?,
            lower_left_p: Point::extract(&raw[16..])?,
        })
    }

    fn accepts(ty: &Type) -> bool {
        match *ty {
            Type::BOX => true,
            _ => false,
        }
    }
}

impl From<PgBox> for JsonValue {
    #[inline(always)]
    fn from(value: PgBox) -> Self {
        JsonValue::String(format!(
            "(({}, {}), ({}, {}))",
            value.upper_right_p.x,
            value.upper_right_p.y,
            value.lower_left_p.x,
            value.lower_left_p.y
        ))
    }
}

pub struct Polygon {
    pub points: Vec<Point>,
}

impl<'a> FromSql<'a> for Polygon {
    fn from_sql(
        _ty: &Type,
        raw: &'a [u8],
    ) -> Result<Self, Box<dyn std::error::Error + Sync + Send>> {
        if raw.len() < 4 {
            return Err(format!("expected at least 4 bytes for Polygon, got {}", raw.len()).into());
        };

        let num_points = i32::from_be_bytes(raw[..4].try_into().unwrap());

        if num_points < 0 {
            return Err(format!(
                "expected non-negative number of points for Polygon, got {}",
                num_points
            )
            .into());
        };

        if num_points == 0 {
            return Ok(Self { points: Vec::new() });
        };

        let num_points = num_points as usize;

        if raw.len() < 4 + num_points * 16 {
            return Err(format!(
                "expected at least {} bytes for Polygon, got {}",
                4 + num_points * 16,
                raw.len()
            )
            .into());
        }

        let mut points = Vec::with_capacity(num_points);
        let mut buf = raw[4..].chunks_exact(16);

        while let Some(chunk) = buf.next() {
            points.push(Point::extract(chunk)?);
        }

        Ok(Self { points })
    }

    fn accepts(ty: &Type) -> bool {
        match *ty {
            Type::POLYGON => true,
            _ => false,
        }
    }
}

impl From<Polygon> for JsonValue {
    #[inline]
    fn from(value: Polygon) -> Self {
        let mut s = String::with_capacity(5 + value.points.len() * 16);

        s.push('(');
        if value.points.is_empty() {
            s.push(')');
            return JsonValue::String(s);
        };

        s.push_str(&format!("({}, {})", value.points[0].x, value.points[0].y));
        for p in value.points[1..].iter() {
            s.push_str(&format!(", ({}, {})", p.x, p.y));
        }

        s.push(')');

        JsonValue::String(s)
    }
}

pub struct Path {
    pub flag: u8,
    pub points: Vec<Point>,
}

impl<'a> FromSql<'a> for Path {
    fn from_sql(
        _ty: &Type,
        raw: &'a [u8],
    ) -> Result<Self, Box<dyn std::error::Error + Sync + Send>> {
        if raw.len() < 5 {
            return Err(format!("expected at least 5 bytes for Path, got {}", raw.len()).into());
        };

        let flag = raw[0];

        let num_points = i32::from_be_bytes(raw[1..5].try_into().unwrap());

        if num_points < 0 {
            return Err(format!(
                "expected non-negative number of points for Path, got {}",
                num_points
            )
            .into());
        }

        if num_points == 0 {
            return Ok(Self {
                flag,
                points: Vec::new(),
            });
        }

        let num_points = num_points as usize;

        if raw.len() < 5 + num_points * 16 {
            return Err(format!(
                "expected at least {} bytes for Path, got {}",
                5 + num_points * 16,
                raw.len()
            )
            .into());
        }

        let mut points = Vec::with_capacity(num_points);
        let mut buf = raw[5..].chunks_exact(16);
        while let Some(chunk) = buf.next() {
            points.push(Point::extract(chunk)?);
        }

        Ok(Self { flag, points })
    }

    fn accepts(ty: &Type) -> bool {
        match *ty {
            Type::PATH => true,
            _ => false,
        }
    }
}

impl From<Path> for JsonValue {
    #[inline]
    fn from(value: Path) -> Self {
        let (opening, closing) = if value.flag & 0x01 == 1 {
            ('(', ')')
        } else {
            ('[', ']')
        };

        let mut s = String::with_capacity(6 + value.points.len() * 16);

        s.push(opening);

        if value.points.is_empty() {
            s.push(closing);
            return JsonValue::String(s);
        };

        s.push_str(&format!("({}, {})", value.points[0].x, value.points[0].y));
        for p in value.points[1..].iter() {
            s.push_str(&format!(", ({}, {})", p.x, p.y));
        }

        s.push(closing);

        JsonValue::String(s)
    }
}

pub struct Line {
    pub a: f64,
    pub b: f64,
    pub c: f64,
}

impl<'a> FromSql<'a> for Line {
    fn from_sql(_ty: &Type, raw: &[u8]) -> Result<Self, Box<dyn std::error::Error + Sync + Send>> {
        if raw.len() != 24 {
            return Err(format!("expected 24 bytes for Line, got {}", raw.len()).into());
        };

        let a = f64::from_sql(&Type::FLOAT8, &raw[..8])?;
        let b = f64::from_sql(&Type::FLOAT8, &raw[8..16])?;
        let c = f64::from_sql(&Type::FLOAT8, &raw[16..])?;
        Ok(Self { a, b, c })
    }

    fn accepts(ty: &Type) -> bool {
        match *ty {
            Type::LINE => true,
            _ => false,
        }
    }
}

impl From<Line> for JsonValue {
    #[inline(always)]
    fn from(value: Line) -> Self {
        JsonValue::String(format!("{{{}, {}, {}}}", value.a, value.b, value.c))
    }
}

pub struct Circle {
    pub point: Point,
    pub radius: f64,
}

impl<'a> FromSql<'a> for Circle {
    fn from_sql(_ty: &Type, raw: &[u8]) -> Result<Self, Box<dyn std::error::Error + Sync + Send>> {
        if raw.len() != 24 {
            return Err(format!("expected 24 bytes for Circle, got {}", raw.len()).into());
        };

        let point = Point::extract(&raw[..16])?;
        let radius = f64::from_sql(&Type::FLOAT8, &raw[16..])?;
        Ok(Self { point, radius })
    }

    fn accepts(ty: &Type) -> bool {
        match *ty {
            Type::CIRCLE => true,
            _ => false,
        }
    }
}

impl From<Circle> for JsonValue {
    #[inline(always)]
    fn from(value: Circle) -> Self {
        JsonValue::String(format!(
            "<({}, {}), {}>",
            value.point.x, value.point.y, value.radius
        ))
    }
}

// Network types

pub struct MacAddr {
    bytes: [u8; 6],
}

impl<'a> FromSql<'a> for MacAddr {
    fn from_sql(_ty: &Type, raw: &[u8]) -> Result<Self, Box<dyn std::error::Error + Sync + Send>> {
        if raw.len() != 6 {
            return Err(format!("expected 6 bytes for MacAddr, got {}", raw.len()).into());
        }
        let mut bytes = [0u8; 6];
        bytes.copy_from_slice(raw);
        Ok(Self { bytes })
    }

    fn accepts(ty: &Type) -> bool {
        match *ty {
            Type::MACADDR => true,
            _ => false,
        }
    }
}

impl From<MacAddr> for JsonValue {
    #[inline(always)]
    fn from(value: MacAddr) -> Self {
        JsonValue::String(format!(
            "{:02x}:{:02x}:{:02x}:{:02x}:{:02x}:{:02x}",
            value.bytes[0],
            value.bytes[1],
            value.bytes[2],
            value.bytes[3],
            value.bytes[4],
            value.bytes[5]
        ))
    }
}

pub struct MacAddr8 {
    bytes: [u8; 8],
}

impl<'a> FromSql<'a> for MacAddr8 {
    fn from_sql(_ty: &Type, raw: &[u8]) -> Result<Self, Box<dyn std::error::Error + Sync + Send>> {
        if raw.len() != 8 {
            return Err(format!("expected 8 bytes for MacAddr8, got {}", raw.len()).into());
        }
        let mut bytes = [0u8; 8];
        bytes.copy_from_slice(raw);
        Ok(Self { bytes })
    }

    fn accepts(ty: &Type) -> bool {
        match *ty {
            Type::MACADDR8 => true,
            _ => false,
        }
    }
}

impl From<MacAddr8> for JsonValue {
    #[inline(always)]
    fn from(value: MacAddr8) -> Self {
        JsonValue::String(format!(
            "{:02x}:{:02x}:{:02x}:{:02x}:{:02x}:{:02x}:{:02x}:{:02x}",
            value.bytes[0],
            value.bytes[1],
            value.bytes[2],
            value.bytes[3],
            value.bytes[4],
            value.bytes[5],
            value.bytes[6],
            value.bytes[7]
        ))
    }
}

pub struct CidrOrInet {
    pub addr: IpAddr,
    pub netmask: u8,
}

impl<'a> FromSql<'a> for CidrOrInet {
    fn from_sql(_ty: &Type, raw: &[u8]) -> Result<Self, Box<dyn std::error::Error + Sync + Send>> {
        if raw.len() < 8 {
            return Err("invalid buffer size".into());
        }

        let family = raw[0];
        let netmask = raw[1];
        // let _is_cidr = raw[2];
        let len = raw[3];

        match family {
            2 => {
                if netmask > 32 {
                    return Err(
                        format!("expected IPv4 netmask to be <= 32, got {}", netmask).into(),
                    );
                }
                if len != 4 {
                    return Err(format!("expected IP4v address length to be 4, got {}", len).into());
                }

                let octets: [u8; 4] = raw[4..8].try_into().unwrap();
                let addr = IpAddr::from(octets);
                Ok(Self { addr, netmask })
            }
            3 => {
                if netmask > 128 {
                    return Err(
                        format!("expected IPv6 netmask to be <= 128, got {}", netmask).into(),
                    );
                }
                if len != 16 {
                    return Err(
                        format!("expected IP6v address length to be 16, got {}", len).into(),
                    );
                };
                if raw.len() < 20 {
                    return Err(format!(
                        "expected IP6v address buffer length to be 20, got {}",
                        raw.len()
                    )
                    .into());
                }

                let bytes: [u8; 16] = raw[4..20].try_into().unwrap();
                let addr = IpAddr::from(bytes);
                Ok(Self { addr, netmask })
            }

            _ => {
                return Err(format!(
                    "expected IP family to be 2 (IPv4) or 3 (IPv6) got {}",
                    family
                )
                .into())
            }
        }
    }

    fn accepts(ty: &Type) -> bool {
        match *ty {
            Type::CIDR | Type::INET => true,
            _ => false,
        }
    }
}

impl From<CidrOrInet> for JsonValue {
    #[inline(always)]
    fn from(value: CidrOrInet) -> Self {
        JsonValue::String(format!("{}/{}", value.addr, value.netmask))
    }
}

pub struct BitOrVarBit {
    pub bits: String,
}

impl<'a> FromSql<'a> for BitOrVarBit {
    fn from_sql(_ty: &Type, raw: &[u8]) -> Result<Self, Box<dyn std::error::Error + Send + Sync>> {
        if raw.len() < 4 {
            return Err(format!(
                "expected at least 4 bytes for BIT/VARBIT, got {}",
                raw.len()
            )
            .into());
        };

        let bits_num = i32::from_be_bytes(raw[..4].try_into().unwrap()) as usize;

        let mut bits_len = bits_num / 8;
        let remainder = bits_num % 8;

        if remainder > 0 {
            bits_len += 1;
        };

        if raw.len() < 4 + bits_len {
            return Err(format!(
                "expected at least {} bytes for BIT/VARBIT, got {}",
                4 + bits_len,
                raw.len()
            )
            .into());
        };

        if bits_len == 0 {
            return Ok(Self {
                bits: String::new(),
            });
        }

        let mut bits = String::with_capacity(bits_num);

        for b in raw[4..4 + bits_len - 1].iter() {
            bits.push_str(&format!("{:08b}", b));
        }

        let last_byte = format!("{:08b}", raw[4 + bits_len - 1]);
        if remainder > 0 {
            // remove padded zeros
            bits.push_str(&last_byte[..remainder]);
        } else {
            bits.push_str(&last_byte);
        }

        Ok(Self { bits })
    }

    fn accepts(ty: &Type) -> bool {
        match *ty {
            Type::BIT | Type::VARBIT => true,
            _ => false,
        }
    }
}

impl From<BitOrVarBit> for JsonValue {
    #[inline(always)]
    fn from(value: BitOrVarBit) -> Self {
        JsonValue::String(value.bits)
    }
}

// Time types

pub struct TimeTz {
    hrs: u8,
    mins: u8,
    secs: u8,
    microseconds: u32,
    offset_sign: char,
    offset_hrs: u8,
    offset_mins: u8,
    offset_secs: u8,
}

impl<'a> FromSql<'a> for TimeTz {
    fn from_sql(_ty: &Type, raw: &[u8]) -> Result<Self, Box<dyn std::error::Error + Send + Sync>> {
        if raw.len() < 12 {
            return Err(format!("expected at least 12 bytes for TIMETZ, got {}", raw.len()).into());
        }

        let mut microseconds = i64::from_be_bytes([
            raw[0], raw[1], raw[2], raw[3], raw[4], raw[5], raw[6], raw[7],
        ]);

        if microseconds < 0 {
            return Err(format!(
                "microseconds must not be negative for TIMETZ: {}",
                microseconds
            )
            .into());
        };

        // it is important to check for this because we need to convert to hours `u8` safely
        if microseconds > 1000 * 1000 * 60 * 60 * 24 {
            return Err(format!(
                "microseconds must not exceed 24 hours for TIMETZ: {}",
                microseconds
            )
            .into());
        };

        let hrs = (microseconds / (1000 * 1000 * 60 * 60)) as u8;
        microseconds %= 1000 * 1000 * 60 * 60;
        let mins = (microseconds / (1000 * 1000 * 60)) as u8;
        microseconds %= 1000 * 1000 * 60;
        let secs = (microseconds / (1000 * 1000)) as u8;
        let microseconds = (microseconds % (1000 * 1000)) as u32;

        let mut timezone_offset = i32::from_be_bytes([raw[8], raw[9], raw[10], raw[11]]);

        let offset_sign = if timezone_offset.is_positive() {
            '-'
        } else {
            timezone_offset = -timezone_offset;
            '+'
        };

        let offset_hrs = (timezone_offset / (60 * 60)) as u8;
        let remainder = timezone_offset % (60 * 60);
        let offset_mins = (remainder / 60) as u8;
        let offset_secs = (remainder % 60) as u8;

        Ok(Self {
            hrs,
            mins,
            secs,
            microseconds,
            offset_sign,
            offset_hrs,
            offset_mins,
            offset_secs,
        })
    }

    fn accepts(ty: &Type) -> bool {
        match *ty {
            Type::TIMETZ => true,
            _ => false,
        }
    }
}

impl From<TimeTz> for JsonValue {
    fn from(value: TimeTz) -> Self {
        let mut time = format!("{:02}:{:02}:{:02}", value.hrs, value.mins, value.secs,);

        if value.microseconds > 0 {
            time.push('.');
            time.push_str(&value.microseconds.to_string().trim_end_matches('0'));
        };

        time.push_str(&format!("{}{:02}", value.offset_sign, value.offset_hrs));

        if value.offset_mins > 0 {
            time.push_str(&format!(":{:02}", value.offset_mins));
        }

        if value.offset_secs > 0 {
            time.push_str(&format!(":{:02}", value.offset_secs));
        };

        JsonValue::String(time)
    }
}

pub struct Interval {
    pub years: i32,
    pub months: i8,
    pub days: i32,
    pub sign: char,
    pub hours: u8,
    pub minutes: u8,
    pub seconds: u8,
    pub microseconds: u32,
}

impl<'a> FromSql<'a> for Interval {
    fn from_sql(_ty: &Type, raw: &[u8]) -> Result<Self, Box<dyn std::error::Error + Send + Sync>> {
        if raw.len() < 16 {
            return Err(format!("expected 16 bytes for Interval, got {}", raw.len()).into());
        };

        let mut microseconds = i64::from_be_bytes(raw[..8].try_into().unwrap());
        let mut days = i32::from_be_bytes(raw[8..12].try_into().unwrap());
        let mut months = i32::from_be_bytes(raw[12..].try_into().unwrap());
        let mut years = 0;

        if months > 11 || months < -11 {
            years = (months / 12) as i32;
            months %= 12;
        };

        let sign;

        if microseconds < 0 {
            sign = '-';
            microseconds = -microseconds;
        } else {
            sign = '+';
        }

        let mut hrs = microseconds / (1000 * 1000 * 60 * 60);
        microseconds %= 1000 * 1000 * 60 * 60;
        let mins = (microseconds / (1000 * 1000 * 60)) as u8;
        microseconds %= 1000 * 1000 * 60;
        let secs = (microseconds / (1000 * 1000)) as u8;

        let microseconds = (microseconds % (1000 * 1000)) as u32;

        if hrs > 23 || hrs < -23 {
            days += (hrs / 24) as i32;
            hrs %= 24;
        };

        Ok(Interval {
            years,
            months: months as i8,
            days,
            sign,
            hours: hrs as u8,
            minutes: mins,
            seconds: secs,
            microseconds,
        })
    }

    fn accepts(ty: &Type) -> bool {
        match *ty {
            Type::INTERVAL => true,
            _ => false,
        }
    }
}

impl From<Interval> for JsonValue {
    fn from(value: Interval) -> Self {
        let mut s = String::new();

        if value.years != 0 {
            let years_str = if value.years == 1 || value.years == -1 {
                "year"
            } else {
                "years"
            };
            s.push_str(&format!("{} {} ", value.years, years_str));
        };

        if value.months != 0 {
            let months_str = if value.months == 1 || value.months == -1 {
                "month"
            } else {
                "months"
            };
            s.push_str(&format!("{} {} ", value.months, months_str));
        };

        if value.days != 0 {
            let days_str = if value.days == 1 || value.days == -1 {
                "day"
            } else {
                "days"
            };
            s.push_str(&format!("{} {} ", value.days, days_str));
        };

        if value.hours != 0 || value.minutes != 0 || value.seconds != 0 || value.microseconds != 0 {
            if value.sign != '+' {
                s.push(value.sign);
            };

            s.push_str(&format!(
                "{:02}:{:02}:{:02}",
                value.hours, value.minutes, value.seconds
            ));
            if value.microseconds != 0 {
                s.push_str(&format!(
                    ".{}",
                    value.microseconds.to_string().trim_end_matches('0')
                ));
            }
        };

        JsonValue::String(s)
    }
}

/// Represents the total value in "cents" or the fractional unit of the database's locale.
pub struct Money(i64);

impl<'a> FromSql<'a> for Money {
    fn from_sql(_ty: &Type, raw: &[u8]) -> Result<Self, Box<dyn std::error::Error + Sync + Send>> {
        Ok(Self(<i64 as FromSql>::from_sql(&Type::INT8, raw)?))
    }

    fn accepts(ty: &Type) -> bool {
        match *ty {
            Type::MONEY => true,
            _ => false,
        }
    }
}

impl From<Money> for JsonValue {
    fn from(value: Money) -> Self {
        JsonValue::Number(JsonNumber::from(value.0))
    }
}

macro_rules! utf8_wrapper {
    ($name: ident, $pg_type: ident) => {
        pub struct $name(String);

        impl<'a> FromSql<'a> for $name {
            fn from_sql(
                _ty: &Type,
                raw: &[u8],
            ) -> Result<Self, Box<dyn std::error::Error + Sync + Send>> {
                Ok(Self(String::from_utf8(raw.to_vec())?))
            }

            fn accepts(ty: &Type) -> bool {
                match *ty {
                    Type::$pg_type => true,
                    _ => false,
                }
            }
        }

        impl From<$name> for JsonValue {
            #[inline(always)]
            fn from(value: $name) -> Self {
                JsonValue::String(value.0)
            }
        }
    };
}

utf8_wrapper!(Xml, XML);
utf8_wrapper!(RefCursor, REFCURSOR);

pub struct JsonPath {
    _version: u8,
    path: String,
}

impl<'a> FromSql<'a> for JsonPath {
    fn from_sql(_ty: &Type, raw: &[u8]) -> Result<Self, Box<dyn std::error::Error + Sync + Send>> {
        if raw.len() < 1 {
            return Err("invalid JSON path".into());
        }

        let version = raw[0];
        let path = String::from_utf8(raw[1..].to_vec())?;
        Ok(Self {
            _version: version,
            path,
        })
    }

    fn accepts(ty: &Type) -> bool {
        match *ty {
            Type::JSONPATH => true,
            _ => false,
        }
    }
}

impl From<JsonPath> for JsonValue {
    #[inline(always)]
    fn from(value: JsonPath) -> Self {
        JsonValue::String(value.path)
    }
}

// Full Text Search types

pub struct Lexeme {
    pub text: String,
    pub positions_weights: Vec<(u16, char)>, // char: A, B, C, D (default: D and it is implict)
}

impl Lexeme {
    pub fn try_extract_from(
        buf: &mut &[u8],
    ) -> Result<Self, Box<dyn std::error::Error + Sync + Send>> {
        let text = try_extract_lexeme_text(buf)?;

        let position_count = i16::from_be_bytes(match buf[..2].try_into() {
            Ok(arr) => arr,
            Err(e) => return Err(format!("buf too short for position count: {}", e).into()),
        });

        if position_count < 0 {
            return Err(format!(
                "expected non-negative position count, got: {}",
                position_count
            )
            .into());
        };

        if position_count == 0 {
            return Ok(Self {
                text,
                positions_weights: Vec::new(),
            });
        };

        *buf = &buf[2..];

        if buf.len() < (position_count as usize) * 2 {
            return Err(format!(
                "buf too short for positions and weights: expected {} bytes, got {}",
                (position_count as usize) * 2,
                buf.len()
            )
            .into());
        };

        let mut positions_weights = Vec::with_capacity(position_count as usize);
        for _ in 0..position_count {
            let position_weight = u16::from_be_bytes(buf[..2].try_into().unwrap());

            let weight = match position_weight >> 14 {
                0 => 'D',
                1 => 'C',
                2 => 'B',
                3 => 'A',
                _ => unreachable!(),
            };

            let position = position_weight & 0x3FFF;

            *buf = &buf[2..];
            positions_weights.push((position, weight));
        }

        Ok(Self {
            text,
            positions_weights,
        })
    }
}

pub struct TsVector {
    lexemes: Vec<Lexeme>,
}

impl<'a> FromSql<'a> for TsVector {
    fn from_sql(
        _ty: &Type,
        raw: &'a [u8],
    ) -> Result<Self, Box<dyn std::error::Error + Sync + Send>> {
        if raw.len() < 4 {
            return Err(format!(
                "raw buffer too short for TsVector: expected at least 4 bytes, got {}",
                raw.len()
            )
            .into());
        };

        let count = i32::from_be_bytes(raw[..4].try_into().unwrap());

        if count == 0 {
            return Ok(Self {
                lexemes: Vec::new(),
            });
        }

        let mut buf = &raw[4..];

        let mut lexemes = Vec::with_capacity(count as usize);
        for _ in 0..count {
            let lexeme = Lexeme::try_extract_from(&mut buf)?;
            lexemes.push(lexeme);
        }

        Ok(Self { lexemes })
    }

    fn accepts(ty: &Type) -> bool {
        match *ty {
            Type::TS_VECTOR => true,
            _ => false,
        }
    }
}

impl From<TsVector> for JsonValue {
    #[inline]
    fn from(value: TsVector) -> Self {
        let mut ss = Vec::with_capacity(value.lexemes.len());

        for lexeme in value.lexemes {
            let mut s = String::new();
            s.push_str(&format!("'{}':", lexeme.text));

            let mut positions_weights = lexeme.positions_weights.into_iter();

            if let Some((position, weight)) = positions_weights.next() {
                s.push_str(&format!("{}", position));
                if weight != 'D' {
                    s.push(weight);
                };
            };

            while let Some((position, weight)) = positions_weights.next() {
                s.push_str(&format!(",{}", position));
                if weight != 'D' {
                    s.push(weight);
                };
            }
            ss.push(s);
        }

        JsonValue::String(ss.join(" "))
    }
}

// NOTE: the structure of this type is very complex so it will be converted to a string representation directly
// instead of parsing the raw bytes
pub struct TsQuery {
    pub query: String,
}

impl<'a> FromSql<'a> for TsQuery {
    fn from_sql(
        _ty: &Type,
        raw: &'a [u8],
    ) -> Result<Self, Box<dyn std::error::Error + Send + Sync>> {
        if raw.len() < 4 {
            return Err(format!(
                "error extracting TsQuery: expected at least 4 bytes, got {}",
                raw.len()
            )
            .into());
        };

        // ignore length prefix
        let mut buf = &raw[4..];
        match try_extract_ts_query(&mut buf, 4) {
            Ok(query) => Ok(TsQuery { query }),
            Err(e) => Err(e.into()),
        }
    }

    fn accepts(ty: &Type) -> bool {
        match *ty {
            Type::TSQUERY => true,
            _ => false,
        }
    }
}

impl From<TsQuery> for JsonValue {
    #[inline(always)]
    fn from(value: TsQuery) -> Self {
        JsonValue::String(value.query)
    }
}

pub struct GtsVector {
    pub header: [u8; 4],
    pub signature: u8,
}

impl<'a> FromSql<'a> for GtsVector {
    fn from_sql(
        _ty: &Type,
        raw: &'a [u8],
    ) -> Result<Self, Box<dyn std::error::Error + Send + Sync>> {
        if raw.len() < 5 {
            return Err(format!(
                "fail to extract gts_vector: expected at least 5 bytes, got {}",
                raw.len()
            )
            .into());
        };

        let header = [raw[0], raw[1], raw[2], raw[3]];
        let signature = raw[4];

        Ok(Self { header, signature })
    }

    fn accepts(ty: &Type) -> bool {
        match *ty {
            Type::GTS_VECTOR => true,
            _ => false,
        }
    }
}

impl From<GtsVector> for JsonValue {
    #[inline(always)]
    fn from(value: GtsVector) -> Self {
        JsonValue::String(encode_blob(&[
            value.header[0],
            value.header[1],
            value.header[2],
            value.header[3],
            value.signature,
        ]))
    }
}

fn try_extract_ts_query(buf: &mut &[u8], pre_lvl: u8) -> Result<String, String> {
    if buf.len() == 0 {
        return Err("fail to extract ts_query: buffer is empty".into());
    };

    match buf[0] {
        1 => {
            if buf.len() < 3 {
                return Err("fail to extract ts_query operand: buffer is too short".into());
            };

            let weight = match buf[1] {
                0 => None,
                1 => Some('D'),
                2 => Some('C'),
                4 => Some('B'),
                8 => Some('A'),
                _ => {
                    return Err(
                        "fail to extract ts_query operand weight: invalid weight value".into(),
                    );
                }
            };

            let prefixed = buf[2] == 1;

            *buf = &buf[3..];

            let lexeme = try_extract_lexeme_text(buf)?;

            let mut s = String::new();

            s.push('\'');
            s.push_str(&lexeme);
            s.push('\'');
            if prefixed {
                s.push_str(":*");
            };

            if let Some(weight) = weight {
                if prefixed {
                    s.push_str(&format!("{}", weight));
                } else {
                    s.push_str(&format!(":{}", weight));
                }
            };

            Ok(s)
        }

        2 => {
            let operator = match buf.get(1) {
                Some(b) => *b,
                None => {
                    return Err("fail to extract ts_query operator: buffer is too short".into());
                }
            };

            *buf = &buf[2..];

            let (cur_lvl, operator) = match operator {
                1 => {
                    let operand = try_extract_ts_query(buf, 1)?;
                    return Ok(format!("!{}", operand));
                }

                2 => (3, "&".into()),
                3 => (4, "|".into()),
                4 => {
                    if buf.len() < 2 {
                        return Err(
                            "fail to extract ts_query phrase operator distance: buffer is to short"
                                .into(),
                        );
                    };

                    let distance = i16::from_be_bytes(buf[..2].try_into().unwrap());

                    *buf = &buf[2..];

                    if distance == 1 {
                        (2, "<->".into())
                    } else {
                        (2, format!("<{}>", distance))
                    }
                }

                _ => {
                    return Err(format!("fail to extract ts_query operator: invalid operator expected 1, 2, 3, or 4, got: {}", operator));
                }
            };

            let right_operand = try_extract_ts_query(buf, cur_lvl)?;
            let left_operand = try_extract_ts_query(buf, cur_lvl)?;

            if pre_lvl < cur_lvl {
                Ok(format!("({} {} {})", left_operand, operator, right_operand))
            } else {
                Ok(format!("{} {} {}", left_operand, operator, right_operand))
            }
        }

        _ => {
            return Err(format!(
                "fail to extract ts_query: expected 1 or 2 got: {}",
                buf[0]
            ));
        }
    }
}

#[inline]
fn try_extract_lexeme_text(buf: &mut &[u8]) -> Result<String, String> {
    let Some(nul_pos) = buf.iter().position(|b| *b == 0) else {
        return Err("lexeme string not terminated".into());
    };

    let text = match String::from_utf8(buf[..nul_pos].to_vec()) {
        Ok(s) => s,
        Err(e) => return Err(format!("invalid UTF-8 in lexeme string: {}", e)),
    };

    *buf = &buf[nul_pos + 1..];

    Ok(text)
}

// Internal System, Snapshots & Statistics postgres types

pub struct PgLsn {
    pub upper: u32,
    pub lower: u32,
}

impl<'a> FromSql<'a> for PgLsn {
    fn from_sql(
        _ty: &Type,
        raw: &'a [u8],
    ) -> Result<Self, Box<dyn std::error::Error + Send + Sync>> {
        if raw.len() != 8 {
            return Err(
                format!("fail to extract PgLsn: expected 8 bytes, got {}", raw.len()).into(),
            );
        };

        Ok(Self {
            upper: u32::from_be_bytes([raw[0], raw[1], raw[2], raw[3]]),
            lower: u32::from_be_bytes([raw[4], raw[5], raw[6], raw[7]]),
        })
    }

    fn accepts(ty: &Type) -> bool {
        match *ty {
            Type::PG_LSN => true,
            _ => false,
        }
    }
}

impl From<PgLsn> for JsonValue {
    #[inline(always)]
    fn from(value: PgLsn) -> Self {
        JsonValue::String(format!("{:X}/{:X}", value.upper, value.lower))
    }
}

pub struct TxidSnapshotOrPgSnapshot {
    xmin: i64,
    xmax: i64,
    active_xids: Vec<i64>,
}

impl<'a> FromSql<'a> for TxidSnapshotOrPgSnapshot {
    fn from_sql(
        _ty: &Type,
        raw: &'a [u8],
    ) -> Result<Self, Box<dyn std::error::Error + Send + Sync>> {
        if raw.len() < 20 {
            return Err(format!(
                "fail to extract TxidSnapshotOrPgSnapshot: expected at least 20 bytes, got {}",
                raw.len()
            )
            .into());
        };

        let count = i32::from_be_bytes([raw[0], raw[1], raw[2], raw[3]]);

        if count < 0 {
            return Err(format!(
                "fail to extract TxidSnapshot/PgSnapshot: count is negative: {}",
                count
            )
            .into());
        };

        let xmin = i64::from_be_bytes(raw[4..12].try_into().unwrap());
        let xmax = i64::from_be_bytes(raw[12..20].try_into().unwrap());

        if count == 0 {
            return Ok(Self {
                xmin,
                xmax,
                active_xids: Vec::new(),
            });
        };

        let count = count as usize;

        let mut chunks = (&raw[20..]).chunks_exact(8);

        if chunks.len() < count {
            return Err(format!(
                "fail to extract TxidSnapshot/PgSnapshot: expected {} 8-byte chunks, got {}",
                count,
                chunks.len()
            )
            .into());
        };

        let mut active_xids = Vec::with_capacity(count as usize);

        while let Some(chunk) = chunks.next() {
            let xid = i64::from_be_bytes(chunk.try_into().unwrap());
            active_xids.push(xid);
        }

        Ok(Self {
            xmin,
            xmax,
            active_xids,
        })
    }

    fn accepts(ty: &Type) -> bool {
        match *ty {
            Type::TXID_SNAPSHOT | Type::PG_SNAPSHOT => true,
            _ => false,
        }
    }
}

impl From<TxidSnapshotOrPgSnapshot> for JsonValue {
    fn from(value: TxidSnapshotOrPgSnapshot) -> Self {
        JsonValue::String(format!(
            "{}:{}:{}",
            value.xmin,
            value.xmax,
            value
                .active_xids
                .into_iter()
                .map(|xid| xid.to_string())
                .collect::<Vec<_>>()
                .join(",")
        ))
    }
}

// FIXME: Postgres Wire Protocol has two formats for sending data - text and binary.
// The current format is binary (it is either set by `tokio-postgres` or by postgres
// because it is the default). anyway binary format doesn't support sending `AclItem`
utf8_wrapper!(AclItem, ACLITEM);
utf8_wrapper!(PgNodeTree, PG_NODE_TREE);

macro_rules! binary_wrapper {
    ($name: ident, $pg_type: ident) => {
        pub struct $name(pub Vec<u8>);

        impl<'a> FromSql<'a> for $name {
            fn from_sql(
                _ty: &Type,
                raw: &[u8],
            ) -> Result<Self, Box<dyn std::error::Error + Sync + Send>> {
                Ok(Self(raw.to_vec()))
            }

            fn accepts(ty: &Type) -> bool {
                match *ty {
                    Type::$pg_type => true,
                    _ => false,
                }
            }
        }

        impl From<$name> for JsonValue {
            #[inline(always)]
            fn from(value: $name) -> Self {
                JsonValue::String(encode_blob(&value.0))
            }
        }
    };
}

// Some of the following types have a complex binary structure but since
// they are very rarly used, we send them as blobs. anyway if someone requests,
// we should implement a proper text representation

binary_wrapper!(PgMcvList, PG_MCV_LIST);
binary_wrapper!(PgDependencies, PG_DEPENDENCIES);
binary_wrapper!(PgNdistinct, PG_NDISTINCT);
binary_wrapper!(PgBrinBloomSummary, PG_BRIN_BLOOM_SUMMARY);
binary_wrapper!(PgBrinMinmaxMultiSummary, PG_BRIN_MINMAX_MULTI_SUMMARY);

/*
'14:30:00-05'::timetz AS timetz_val => null,
'1 year 2 months 3 days 04:05:06'::interval AS interval_val =>
1 year2 months8 days +170:00:00;
 */

//! Daily schedule evaluation for scheduled database backups, in the local
//! system timezone or a named IANA timezone.

use chrono::{DateTime, Duration, NaiveDate, TimeZone, Utc};
use chrono_tz::Tz;
use std::str::FromStr;

/// After a failed attempt the scheduler waits this long before retrying.
pub const RETRY_AFTER_FAILURE: Duration = Duration::minutes(15);

pub fn parse_time_hh_mm(s: &str) -> Option<(u32, u32)> {
    let mut parts = s.split(':');
    let h: u32 = parts.next()?.parse().ok()?;
    let m: u32 = parts.next()?.parse().ok()?;
    if h < 24 && m < 60 {
        Some((h, m))
    } else {
        None
    }
}

/// Evaluates plan scheduling in either the local OS timezone or an IANA named timezone.
#[derive(Debug, Clone, Copy)]
pub enum PlanTimezone {
    Local,
    Named(Tz),
}

impl PlanTimezone {
    pub fn parse(tz_str: &str) -> Self {
        if tz_str.eq_ignore_ascii_case("local") || tz_str.trim().is_empty() {
            PlanTimezone::Local
        } else {
            match Tz::from_str(tz_str.trim()) {
                Ok(tz) => PlanTimezone::Named(tz),
                Err(_) => {
                    log::warn!(
                        "Invalid timezone '{tz_str}', falling back to local system timezone"
                    );
                    PlanTimezone::Local
                }
            }
        }
    }

    pub fn date_of(&self, dt_utc: DateTime<Utc>) -> NaiveDate {
        match self {
            PlanTimezone::Local => dt_utc.with_timezone(&chrono::Local).date_naive(),
            PlanTimezone::Named(tz) => dt_utc.with_timezone(tz).date_naive(),
        }
    }

    /// The instant `hour:minute` happens on `date` in this timezone. In a DST
    /// gap the wall time does not exist, so the run moves one hour later; in a
    /// DST fold it happens twice, so the run takes the first occurrence.
    pub fn target_utc(&self, date: NaiveDate, hour: u32, minute: u32) -> Option<DateTime<Utc>> {
        match self {
            PlanTimezone::Local => resolve_wall_time(&chrono::Local, date, hour, minute),
            PlanTimezone::Named(tz) => resolve_wall_time(tz, date, hour, minute),
        }
    }
}

fn resolve_wall_time<Z: TimeZone>(
    tz: &Z,
    date: NaiveDate,
    hour: u32,
    minute: u32,
) -> Option<DateTime<Utc>> {
    let naive = date.and_hms_opt(hour, minute, 0)?;
    match tz.from_local_datetime(&naive) {
        chrono::LocalResult::Single(dt) => Some(dt.with_timezone(&Utc)),
        chrono::LocalResult::Ambiguous(earliest, _) => Some(earliest.with_timezone(&Utc)),
        chrono::LocalResult::None => tz
            .from_local_datetime(&(naive + Duration::hours(1)))
            .earliest()
            .map(|dt| dt.with_timezone(&Utc)),
    }
}

/// Checks if a daily backup is currently due.
/// A backup is due when:
/// 1. The current time is at or past today's target time in the plan's timezone, AND
/// 2. No successful backup has already run today in that timezone.
pub fn is_backup_due(
    now_utc: DateTime<Utc>,
    time_str: &str,
    timezone_str: &str,
    last_successful_run_at: Option<DateTime<Utc>>,
) -> bool {
    let ptz = PlanTimezone::parse(timezone_str);
    let (target_h, target_m) = parse_time_hh_mm(time_str).unwrap_or((2, 0));
    let today_date = ptz.date_of(now_utc);
    let Some(today_target_utc) = ptz.target_utc(today_date, target_h, target_m) else {
        return false;
    };

    if now_utc < today_target_utc {
        return false;
    }

    !last_successful_run_at.is_some_and(|last| ptz.date_of(last) == today_date)
}

/// Whether a failed attempt at `last_failure_at` still blocks a retry.
pub fn is_retry_blocked(now_utc: DateTime<Utc>, last_failure_at: Option<DateTime<Utc>>) -> bool {
    last_failure_at.is_some_and(|failed| now_utc - failed < RETRY_AFTER_FAILURE)
}

/// Computes the next scheduled daily run after the last successful one.
pub fn compute_next_run_utc(
    now_utc: DateTime<Utc>,
    time_str: &str,
    timezone_str: &str,
    last_successful_run_at: Option<DateTime<Utc>>,
) -> DateTime<Utc> {
    let ptz = PlanTimezone::parse(timezone_str);
    let (target_h, target_m) = parse_time_hh_mm(time_str).unwrap_or((2, 0));
    let today_date = ptz.date_of(now_utc);
    let today_target_utc = ptz
        .target_utc(today_date, target_h, target_m)
        .unwrap_or(now_utc);

    let already_ran_today =
        last_successful_run_at.is_some_and(|last| ptz.date_of(last) == today_date);

    if !already_ran_today && now_utc < today_target_utc {
        today_target_utc
    } else {
        let tomorrow_date = today_date + Duration::days(1);
        ptz.target_utc(tomorrow_date, target_h, target_m)
            .unwrap_or_else(|| today_target_utc + Duration::days(1))
    }
}

/// When the scheduler will next start a backup: now if one is due, after the
/// retry delay if the last attempt failed, otherwise the next daily run.
pub fn next_attempt_utc(
    now_utc: DateTime<Utc>,
    time_str: &str,
    timezone_str: &str,
    last_successful_run_at: Option<DateTime<Utc>>,
    last_failure_at: Option<DateTime<Utc>>,
) -> DateTime<Utc> {
    if is_backup_due(now_utc, time_str, timezone_str, last_successful_run_at) {
        return match last_failure_at {
            Some(failed) if is_retry_blocked(now_utc, Some(failed)) => failed + RETRY_AFTER_FAILURE,
            _ => now_utc,
        };
    }
    compute_next_run_utc(now_utc, time_str, timezone_str, last_successful_run_at)
}

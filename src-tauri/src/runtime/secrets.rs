use keyring::Entry;

const SERVICE_NAME: &str = "tabularis";

pub trait RuntimeSecrets: Send + Sync {
    fn get(&self, account: &str) -> Result<Option<String>, String>;
    fn set(&self, account: &str, secret: &str) -> Result<(), String>;
    fn delete(&self, account: &str) -> Result<(), String>;
}

#[derive(Default)]
pub struct KeyringRuntimeSecrets;

impl RuntimeSecrets for KeyringRuntimeSecrets {
    fn get(&self, account: &str) -> Result<Option<String>, String> {
        match Entry::new(SERVICE_NAME, account)
            .map_err(|error| error.to_string())?
            .get_password()
        {
            Ok(secret) => Ok(Some(secret)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(error) => Err(error.to_string()),
        }
    }

    fn set(&self, account: &str, secret: &str) -> Result<(), String> {
        Entry::new(SERVICE_NAME, account)
            .and_then(|entry| entry.set_password(secret))
            .map_err(|error| error.to_string())
    }

    fn delete(&self, account: &str) -> Result<(), String> {
        match Entry::new(SERVICE_NAME, account)
            .map_err(|error| error.to_string())?
            .delete_credential()
        {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(error) => Err(error.to_string()),
        }
    }
}

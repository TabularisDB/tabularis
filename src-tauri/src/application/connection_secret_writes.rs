use crate::runtime::RuntimeContext;

#[derive(Default)]
pub(crate) struct SecretWrites(Vec<(String, Option<String>)>);

impl SecretWrites {
    pub(crate) fn set(
        &mut self,
        runtime: &RuntimeContext,
        account: String,
        value: &str,
    ) -> Result<(), String> {
        let previous = runtime.secrets.get(&account)?;
        runtime.secrets.set(&account, value)?;
        self.0.push((account, previous));
        Ok(())
    }

    pub(crate) fn delete(
        &mut self,
        runtime: &RuntimeContext,
        account: String,
    ) -> Result<(), String> {
        let previous = runtime.secrets.get(&account)?;
        runtime.secrets.delete(&account)?;
        self.0.push((account, previous));
        Ok(())
    }

    pub(super) fn append(&mut self, mut other: Self) {
        self.0.append(&mut other.0);
    }

    pub(crate) fn rollback(&mut self, runtime: &RuntimeContext) {
        for (account, previous) in self.0.drain(..).rev() {
            let result = match previous {
                Some(value) => runtime.secrets.set(&account, &value),
                None => runtime.secrets.delete(&account),
            };
            if let Err(error) = result {
                log::warn!("Failed to restore connection credential {account}: {error}");
            }
        }
    }
}

use std::future::Future;
use std::pin::Pin;

use tokio::sync::mpsc;

/// A byte pipe to a printer. Incoming notifications are delivered on the
/// receiver returned by [`Transport::open`]; it closes when the link drops.
pub trait Transport: Send + Sync + 'static {
    fn write<'a>(&'a self, data: &'a [u8]) -> Pin<Box<dyn Future<Output = crate::Result<()>> + Send + 'a>>;
    fn close(&self) -> Pin<Box<dyn Future<Output = ()> + Send + '_>>;
}

pub type Incoming = mpsc::UnboundedReceiver<Vec<u8>>;

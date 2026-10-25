//! Find a printer by name, connect and print what it reports about itself.
//! `cargo run -p printer --example probe -- M3` (the argument is a name prefix).
//! Add `print 30 20` to also print one W × L mm label with a frame and a cross.

use std::time::Duration;

use printer::ble::Bluetooth;
use printer::{Bitmap, Client, PrintDirection, PrintOptions};

#[tokio::main(flavor = "current_thread")]
async fn main() -> printer::Result<()> {
    let prefix = std::env::args().nth(1).unwrap_or_default();
    let bt = Bluetooth::new().await?;
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
    bt.start_scan(move |found| {
        let _ = tx.send(found);
    })
    .await?;
    let printer = tokio::time::timeout(Duration::from_secs(20), async {
        while let Some(found) = rx.recv().await {
            if let Some(p) = found.into_iter().find(|p| p.name.starts_with(&prefix)) {
                return Some(p);
            }
        }
        None
    })
    .await
    .ok()
    .flatten()
    .ok_or(printer::Error::Timeout)?;
    println!("found {} ({})", printer.name, printer.id);

    let (transport, incoming) = bt.connect(&printer.id).await?;
    let client = Client::new(transport, incoming);
    let info = client.handshake().await?;
    println!("{info:#?}");
    println!("heartbeat: {:#?}", client.heartbeat().await);

    let args: Vec<String> = std::env::args().collect();
    if args.get(2).map(String::as_str) == Some("print") {
        let mm = |i: usize| args.get(i).and_then(|a| a.parse::<f32>().ok()).unwrap_or(20.0);
        let meta = info.model.expect("a known model");
        let dots = |v: f32| (v * meta.dpi as f32 / 25.4).round() as u32;
        // Width runs across the printhead: canvas x for top-first printers, canvas y otherwise.
        let (across, along) = (dots(mm(3)), dots(mm(4)));
        let (w, h) = if meta.print_direction == PrintDirection::Top { (across, along) } else { (along, across) };
        let mut bits = vec![0u8; (w * h).div_ceil(8) as usize];
        for y in 0..h {
            for x in 0..w {
                let frame = x < 4 || y < 4 || x >= w - 4 || y >= h - 4;
                let cross = (x * h).abs_diff(y * w) < 3 * w.max(h) || (x * h).abs_diff((h - 1 - y) * w) < 3 * w.max(h);
                if frame || cross {
                    let i = (y * w + x) as usize;
                    bits[i / 8] |= 0x80 >> (i % 8);
                }
            }
        }
        let started = std::time::Instant::now();
        let result = client.print(&Bitmap::from_packed(w, h, &bits), PrintOptions { density: meta.density_default, ..Default::default() }).await;
        println!("print {w}x{h} dots: {result:?} in {:?}", started.elapsed());
    }
    client.disconnect().await;
    Ok(())
}

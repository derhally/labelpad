//! MCP server for AI agents. `labelpad --mcp` is a stdio MCP server that
//! forwards messages to the running app over a local socket (a named pipe on
//! Windows), starting the app if it isn't open. The app hands each message to
//! the UI, which runs the tools with the same code a person's clicks use.

use std::collections::HashMap;
use std::io;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use interprocess::local_socket::tokio::{prelude::*, Stream};
use interprocess::local_socket::{GenericNamespaced, ListenerOptions, Name};
use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, State};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::sync::{mpsc, oneshot, Mutex};

/// Printing and scanning take a while; anything slower than this has gone wrong.
const REPLY_TIMEOUT: Duration = Duration::from_secs(300);
/// How long the stdio shim waits for a freshly started app to be ready.
const LAUNCH_TIMEOUT: Duration = Duration::from_secs(30);

/// One socket per user, so two people signed in to one computer don't meet.
fn socket_name() -> io::Result<Name<'static>> {
    let user = std::env::var("USERNAME").or_else(|_| std::env::var("USER")).unwrap_or_default();
    let user: String = user.chars().filter(|c| c.is_ascii_alphanumeric()).collect();
    format!("labelpad-mcp-{user}.sock").to_ns_name::<GenericNamespaced>().map(|n| n.into_owned())
}

/// Requests waiting for the UI's answer, keyed by a number unique to this run.
#[derive(Default)]
pub struct Bridge {
    started: AtomicBool,
    next: AtomicU64,
    pending: Mutex<HashMap<u64, oneshot::Sender<Option<Value>>>>,
}

#[derive(Clone, Serialize)]
struct Request {
    key: u64,
    message: Value,
}

/// The UI is listening for requests: start taking connections. Called again
/// when the page reloads, which changes nothing.
#[tauri::command]
pub fn mcp_ready(app: AppHandle, bridge: State<'_, Arc<Bridge>>) {
    if bridge.started.swap(true, Ordering::SeqCst) {
        return;
    }
    let bridge = bridge.inner().clone();
    tauri::async_runtime::spawn(async move {
        if let Err(e) = serve(app, bridge).await {
            log::warn!("Agent connections are off: {e}");
        }
    });
}

/// The UI's answer to a request; `None` for notifications, which get none.
#[tauri::command]
pub async fn mcp_reply(bridge: State<'_, Arc<Bridge>>, key: u64, response: Option<Value>) -> Result<(), String> {
    if let Some(tx) = bridge.pending.lock().await.remove(&key) {
        let _ = tx.send(response);
    }
    Ok(())
}

async fn serve(app: AppHandle, bridge: Arc<Bridge>) -> io::Result<()> {
    // Another LabelPad window already serving agents fails here, which is fine.
    let listener = ListenerOptions::new().name(socket_name()?).try_overwrite(true).create_tokio()?;
    loop {
        let conn = listener.accept().await?;
        tauri::async_runtime::spawn(connection(app.clone(), bridge.clone(), conn));
    }
}

/// One agent: newline-delimited JSON-RPC in, answers out in whatever order they finish.
async fn connection(app: AppHandle, bridge: Arc<Bridge>, conn: Stream) {
    let conn = Arc::new(conn);
    let (out, mut outgoing) = mpsc::unbounded_channel::<Value>();
    let send_conn = conn.clone();
    let writer = tauri::async_runtime::spawn(async move {
        let mut send = &*send_conn;
        while let Some(msg) = outgoing.recv().await {
            let mut line = msg.to_string();
            line.push('\n');
            if send.write_all(line.as_bytes()).await.is_err() {
                break;
            }
        }
    });

    let mut lines = BufReader::new(&*conn).lines();
    while let Ok(Some(line)) = lines.next_line().await {
        if line.trim().is_empty() {
            continue;
        }
        let message: Value = match serde_json::from_str(&line) {
            Ok(v) => v,
            Err(e) => {
                let _ = out.send(json!({ "jsonrpc": "2.0", "id": null, "error": { "code": -32700, "message": format!("Parse error: {e}") } }));
                continue;
            }
        };
        let (app, bridge, out) = (app.clone(), bridge.clone(), out.clone());
        tauri::async_runtime::spawn(async move {
            let id = message.get("id").cloned();
            let key = bridge.next.fetch_add(1, Ordering::Relaxed);
            let (tx, rx) = oneshot::channel();
            bridge.pending.lock().await.insert(key, tx);
            let _ = app.emit("mcp-request", Request { key, message });
            let reply = match tokio::time::timeout(REPLY_TIMEOUT, rx).await {
                Ok(Ok(reply)) => reply,
                _ => {
                    bridge.pending.lock().await.remove(&key);
                    // Only requests (with an id) expect an answer.
                    id.map(|id| json!({ "jsonrpc": "2.0", "id": id, "error": { "code": -32603, "message": "LabelPad didn't answer in time" } }))
                }
            };
            if let Some(reply) = reply {
                let _ = out.send(reply);
            }
        });
    }
    drop(out);
    let _ = writer.await;
}

/// `labelpad --mcp`: pass stdin and stdout through to the running app,
/// starting it first if needed. Returns the process exit code.
pub fn run_stdio() -> i32 {
    let runtime = match tokio::runtime::Builder::new_multi_thread().enable_all().build() {
        Ok(rt) => rt,
        Err(e) => {
            eprintln!("LabelPad: {e}");
            return 1;
        }
    };
    match runtime.block_on(proxy()) {
        Ok(()) => 0,
        Err(e) => {
            eprintln!("LabelPad: {e}");
            1
        }
    }
}

async fn proxy() -> io::Result<()> {
    let conn = match Stream::connect(socket_name()?).await {
        Ok(conn) => conn,
        Err(_) => {
            launch_app()?;
            wait_for_app().await?
        }
    };
    let (mut recv, mut send) = (&conn, &conn);
    let mut stdin = tokio::io::stdin();
    let mut stdout = tokio::io::stdout();
    // Whichever side closes first ends the session.
    tokio::select! {
        r = tokio::io::copy(&mut stdin, &mut send) => r.map(|_| ()),
        r = async {
            tokio::io::copy(&mut recv, &mut stdout).await?;
            stdout.flush().await
        } => r,
    }
}

async fn wait_for_app() -> io::Result<Stream> {
    let deadline = tokio::time::Instant::now() + LAUNCH_TIMEOUT;
    loop {
        match Stream::connect(socket_name()?).await {
            Ok(conn) => return Ok(conn),
            Err(_) if tokio::time::Instant::now() < deadline => tokio::time::sleep(Duration::from_millis(250)).await,
            Err(e) => return Err(io::Error::new(e.kind(), format!("LabelPad didn't start in time: {e}"))),
        }
    }
}

/// Start the app as its own process, not tied to this one's stdio or lifetime.
fn launch_app() -> io::Result<()> {
    let exe = std::env::current_exe()?;
    let mut cmd = std::process::Command::new(exe);
    cmd.stdin(std::process::Stdio::null()).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        use windows_sys::Win32::Foundation::{SetHandleInformation, HANDLE_FLAG_INHERIT};
        use windows_sys::Win32::System::Console::{GetStdHandle, STD_ERROR_HANDLE, STD_INPUT_HANDLE, STD_OUTPUT_HANDLE};
        // The app would otherwise inherit the agent's pipes and hold them open
        // after this process ends, so the agent never sees the server close.
        for std_handle in [STD_INPUT_HANDLE, STD_OUTPUT_HANDLE, STD_ERROR_HANDLE] {
            // SAFETY: only changes the inherit flag of this process's own standard handles.
            unsafe { SetHandleInformation(GetStdHandle(std_handle), HANDLE_FLAG_INHERIT, 0) };
        }
        const DETACHED_PROCESS: u32 = 0x0000_0008;
        const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
        cmd.creation_flags(DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP);
    }
    cmd.spawn().map(|_| ())
}

/// Read an image for the agent tools, which pass a file path rather than a picked file.
#[tauri::command]
pub async fn image_read(path: String) -> Result<tauri::ipc::Response, String> {
    let bytes = tokio::fs::read(&path).await.map_err(|e| format!("Couldn't open {path}: {e}"))?;
    Ok(tauri::ipc::Response::new(bytes))
}

use std::{
    collections::HashMap,
    fmt::Display,
    process::{Child, Command, Stdio},
    sync::{Arc, Mutex},
};

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use futures_util::{Sink, SinkExt, StreamExt};
use reqwest::header::{HeaderName, HeaderValue};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::State;
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpStream},
};
use tokio_tungstenite::{connect_async, tungstenite::Message};
use url::Url;

const MIN_LOCAL_PORT: u16 = 10_000;
const DESKTOP_MCP_ADDR: &str = "127.0.0.1:38789";
const MCP_PROTOCOL_VERSION: &str = "2024-11-05";
const KEYRING_SERVICE: &str = "dev.tuniq.desktop";

const SECRET_FIELDS: &[&str] = &["agent_api_token", "relay_token"];

fn secret_account(project_id: &str, field: &str) -> String {
    format!("{project_id}:{field}")
}

fn secret_entry(project_id: &str, field: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYRING_SERVICE, &secret_account(project_id, field))
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn secret_set(project_id: String, field: String, value: String) -> Result<(), String> {
    let entry = secret_entry(&project_id, &field)?;
    entry
        .set_password(&value)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn secret_get(project_id: String, field: String) -> Result<Option<String>, String> {
    let entry = secret_entry(&project_id, &field)?;
    match entry.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

#[tauri::command]
fn secret_delete(project_id: String, field: String) -> Result<(), String> {
    let entry = secret_entry(&project_id, &field)?;
    match entry.delete_credential() {
        Ok(_) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

#[tauri::command]
fn secret_clear_project(project_id: String) -> Result<(), String> {
    for field in SECRET_FIELDS {
        let entry = secret_entry(&project_id, field)?;
        let _ = entry.delete_credential();
    }
    Ok(())
}

#[derive(Clone, Serialize)]
struct TunnelStatus {
    state: String,
    message: String,
    public_url: Option<String>,
}

impl Default for TunnelStatus {
    fn default() -> Self {
        Self {
            state: "offline".to_string(),
            message: "No tunnel is running".to_string(),
            public_url: None,
        }
    }
}

struct TunnelHandle {
    task: tauri::async_runtime::JoinHandle<()>,
    status: Arc<Mutex<TunnelStatus>>,
}

struct AppState {
    tunnels: Mutex<HashMap<String, TunnelHandle>>,
    keep_awake_handle: Mutex<Option<Child>>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            tunnels: Mutex::new(HashMap::new()),
            keep_awake_handle: Mutex::new(None),
        }
    }
}

impl AppState {
    fn snapshot_status(&self, agent_id: &str) -> TunnelStatus {
        if let Ok(guard) = self.tunnels.lock() {
            if let Some(handle) = guard.get(agent_id) {
                if let Ok(status) = handle.status.lock() {
                    return status.clone();
                }
            }
        }
        TunnelStatus::default()
    }

    fn snapshot_all(&self) -> HashMap<String, TunnelStatus> {
        let mut out = HashMap::new();
        if let Ok(guard) = self.tunnels.lock() {
            for (agent_id, handle) in guard.iter() {
                if let Ok(status) = handle.status.lock() {
                    out.insert(agent_id.clone(), status.clone());
                }
            }
        }
        out
    }
}

impl Drop for AppState {
    fn drop(&mut self) {
        if let Ok(mut guard) = self.keep_awake_handle.lock() {
            if let Some(child) = guard.as_mut() {
                let _ = child.kill();
            }
        }
        if let Ok(mut guard) = self.tunnels.lock() {
            for (_, handle) in guard.drain() {
                handle.task.abort();
            }
        }
    }
}

#[derive(Clone, Serialize)]
struct KeepAwakeStatus {
    enabled: bool,
    message: String,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TunnelConfig {
    relay_url: String,
    agent_id: String,
    agent_token: String,
}

#[derive(Deserialize)]
struct TunnelRequest {
    #[serde(rename = "requestId")]
    request_id: String,
    method: String,
    path: String,
    #[serde(rename = "targetPort")]
    target_port: u16,
    headers: HashMap<String, String>,
    #[serde(rename = "bodyBase64")]
    body_base64: String,
}

#[derive(Serialize)]
struct TunnelResponseHead {
    #[serde(rename = "type")]
    message_type: &'static str,
    #[serde(rename = "requestId")]
    request_id: String,
    status: u16,
    headers: HashMap<String, String>,
}

#[derive(Serialize)]
struct TunnelResponseChunk {
    #[serde(rename = "type")]
    message_type: &'static str,
    #[serde(rename = "requestId")]
    request_id: String,
    #[serde(rename = "bodyBase64")]
    body_base64: String,
}

#[derive(Serialize)]
struct TunnelResponseEnd {
    #[serde(rename = "type")]
    message_type: &'static str,
    #[serde(rename = "requestId")]
    request_id: String,
}

#[derive(Serialize)]
struct TunnelResponseError {
    #[serde(rename = "type")]
    message_type: &'static str,
    #[serde(rename = "requestId")]
    request_id: String,
    message: String,
}

fn public_url(config: &TunnelConfig) -> String {
    format!("http://localhost:10181/{}/", config.agent_id)
}

fn set_status(status: &Arc<Mutex<TunnelStatus>>, state: &str, message: &str, url: Option<String>) {
    if let Ok(mut guard) = status.lock() {
        *guard = TunnelStatus {
            state: state.to_string(),
            message: message.to_string(),
            public_url: url,
        };
    }
}

fn validate_config(config: &TunnelConfig) -> Result<Url, String> {
    if config.agent_id.trim().len() < 3 {
        return Err("Agent id is required".to_string());
    }

    if config.agent_token.trim().len() < 12 {
        return Err("Agent token is too short".to_string());
    }

    let mut url = Url::parse(&config.relay_url).map_err(|error| error.to_string())?;
    match url.scheme() {
        "ws" | "wss" => {}
        _ => return Err("Relay URL must start with ws:// or wss://".to_string()),
    }

    url.query_pairs_mut()
        .append_pair("agentId", &config.agent_id)
        .append_pair("token", &config.agent_token);

    Ok(url)
}

#[cfg(target_os = "macos")]
fn spawn_keep_awake_process() -> Result<Child, String> {
    Command::new("caffeinate")
        .args(["-dimsu"])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| format!("Could not start caffeinate: {error}"))
}

#[cfg(target_os = "linux")]
fn spawn_keep_awake_process() -> Result<Child, String> {
    Command::new("systemd-inhibit")
        .args([
            "--what=idle:sleep",
            "--why=Tuniq active tunnel",
            "--mode=block",
            "sleep",
            "infinity",
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| format!("Could not start systemd-inhibit: {error}"))
}

#[cfg(target_os = "windows")]
fn spawn_keep_awake_process() -> Result<Child, String> {
    const SCRIPT: &str = r#"
Add-Type -Namespace Win32 -Name NativeMethods -MemberDefinition '[DllImport("kernel32.dll", SetLastError=true)] public static extern uint SetThreadExecutionState(uint esFlags);'
[Win32.NativeMethods]::SetThreadExecutionState(0x80000000 -bor 0x00000001 -bor 0x00000002) | Out-Null
while ($true) { Start-Sleep -Seconds 60 }
"#;

    Command::new("powershell")
        .args([
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            SCRIPT,
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| format!("Could not start Windows keep-awake worker: {error}"))
}

#[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
fn spawn_keep_awake_process() -> Result<Child, String> {
    Err("Keep-awake is not supported on this operating system".to_string())
}

fn stop_keep_awake_process(state: &AppState) {
    if let Ok(mut guard) = state.keep_awake_handle.lock() {
        if let Some(mut child) = guard.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

async fn send_frame<W, T>(write: &mut W, frame: &T) -> Result<(), String>
where
    W: Sink<Message> + Unpin,
    W::Error: Display,
    T: Serialize,
{
    let payload = serde_json::to_string(frame).map_err(|error| error.to_string())?;
    write
        .send(Message::Text(payload.into()))
        .await
        .map_err(|error| error.to_string())
}

async fn send_plain_response<W>(
    write: &mut W,
    request_id: String,
    status: u16,
    message: String,
) -> Result<(), String>
where
    W: Sink<Message> + Unpin,
    W::Error: Display,
{
    send_frame(
        write,
        &TunnelResponseHead {
            message_type: "response-head",
            request_id: request_id.clone(),
            status,
            headers: HashMap::from([(
                "content-type".to_string(),
                "text/plain; charset=utf-8".to_string(),
            )]),
        },
    )
    .await?;
    send_frame(
        write,
        &TunnelResponseChunk {
            message_type: "response-chunk",
            request_id: request_id.clone(),
            body_base64: BASE64.encode(message),
        },
    )
    .await?;
    send_frame(
        write,
        &TunnelResponseEnd {
            message_type: "response-end",
            request_id,
        },
    )
    .await
}

async fn forward_request<W>(
    client: &reqwest::Client,
    write: &mut W,
    request: TunnelRequest,
) -> Result<(), String>
where
    W: Sink<Message> + Unpin,
    W::Error: Display,
{
    if request.target_port < MIN_LOCAL_PORT {
        return send_plain_response(
            write,
            request.request_id,
            502,
            "Relay request is missing a valid target port".to_string(),
        )
        .await;
    }

    let target = format!(
        "http://127.0.0.1:{}{}",
        request.target_port,
        if request.path.starts_with('/') {
            request.path
        } else {
            format!("/{}", request.path)
        }
    );

    let method = request
        .method
        .parse::<reqwest::Method>()
        .unwrap_or(reqwest::Method::GET);
    let body = BASE64.decode(request.body_base64).unwrap_or_default();
    let mut builder = client.request(method, target).body(body);

    for (name, value) in request.headers {
        let lower = name.to_ascii_lowercase();
        if matches!(
            lower.as_str(),
            "host" | "connection" | "content-length" | "transfer-encoding"
        ) {
            continue;
        }

        if let (Ok(header_name), Ok(header_value)) = (
            HeaderName::from_bytes(name.as_bytes()),
            HeaderValue::from_str(&value),
        ) {
            builder = builder.header(header_name, header_value);
        }
    }

    let response = match builder.send().await {
        Ok(response) => response,
        Err(error) => {
            return send_plain_response(
                write,
                request.request_id,
                502,
                format!("Local service unavailable: {error}"),
            )
            .await;
        }
    };

    let status = response.status().as_u16();
    let headers = response
        .headers()
        .iter()
        .filter_map(|(name, value)| {
            value
                .to_str()
                .ok()
                .map(|value| (name.to_string(), value.to_string()))
        })
        .collect::<HashMap<_, _>>();
    let request_id = request.request_id;

    send_frame(
        write,
        &TunnelResponseHead {
            message_type: "response-head",
            request_id: request_id.clone(),
            status,
            headers,
        },
    )
    .await?;

    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        match chunk {
            Ok(bytes) => {
                send_frame(
                    write,
                    &TunnelResponseChunk {
                        message_type: "response-chunk",
                        request_id: request_id.clone(),
                        body_base64: BASE64.encode(bytes),
                    },
                )
                .await?;
            }
            Err(error) => {
                return send_frame(
                    write,
                    &TunnelResponseError {
                        message_type: "response-error",
                        request_id,
                        message: error.to_string(),
                    },
                )
                .await;
            }
        }
    }

    send_frame(
        write,
        &TunnelResponseEnd {
            message_type: "response-end",
            request_id,
        },
    )
    .await
}

async fn run_tunnel(config: TunnelConfig, url: Url, status: Arc<Mutex<TunnelStatus>>) {
    set_status(
        &status,
        "connecting",
        "Connecting to relay",
        Some(public_url(&config)),
    );

    let connection = connect_async(url.as_str()).await;
    let Ok((socket, _)) = connection else {
        set_status(&status, "failed", "Could not connect to relay", None);
        return;
    };

    set_status(
        &status,
        "online",
        "Tunnel is forwarding traffic",
        Some(public_url(&config)),
    );

    let client = reqwest::Client::new();
    let (mut write, mut read) = socket.split();

    while let Some(message) = read.next().await {
        let Ok(Message::Text(text)) = message else {
            continue;
        };

        let Ok(request) = serde_json::from_str::<TunnelRequest>(&text) else {
            continue;
        };

        let _ = forward_request(&client, &mut write, request).await;
    }

    set_status(&status, "offline", "Relay connection closed", None);
}

fn start_tunnel_in_state(
    config: TunnelConfig,
    state: Arc<AppState>,
) -> Result<TunnelStatus, String> {
    let url = validate_config(&config)?;
    let mut tunnels = state.tunnels.lock().map_err(|_| "State lock failed")?;

    if let Some(existing) = tunnels.remove(&config.agent_id) {
        existing.task.abort();
    }

    let status = Arc::new(Mutex::new(TunnelStatus::default()));
    let task_status = status.clone();
    let task_config = config.clone();

    let task = tauri::async_runtime::spawn(async move {
        run_tunnel(task_config, url, task_status).await;
    });

    set_status(
        &status,
        "starting",
        "Tunnel task started",
        Some(public_url(&config)),
    );

    let snapshot = status.lock().map(|guard| guard.clone()).unwrap_or_default();
    tunnels.insert(config.agent_id.clone(), TunnelHandle { task, status });
    Ok(snapshot)
}

fn stop_tunnel_in_state(agent_id: &str, state: &AppState) -> Result<TunnelStatus, String> {
    let mut tunnels = state.tunnels.lock().map_err(|_| "State lock failed")?;
    if let Some(handle) = tunnels.remove(agent_id) {
        handle.task.abort();
    }
    Ok(TunnelStatus {
        state: "offline".to_string(),
        message: "Tunnel stopped".to_string(),
        public_url: None,
    })
}

fn tunnel_status_from_state(agent_id: &str, state: &AppState) -> Result<TunnelStatus, String> {
    Ok(state.snapshot_status(agent_id))
}

fn tunnel_statuses_from_state(state: &AppState) -> Result<HashMap<String, TunnelStatus>, String> {
    Ok(state.snapshot_all())
}

fn set_keep_awake_in_state(enabled: bool, state: &AppState) -> Result<KeepAwakeStatus, String> {
    if !enabled {
        stop_keep_awake_process(state);
        return Ok(KeepAwakeStatus {
            enabled: false,
            message: "Computer sleep prevention is off".to_string(),
        });
    }

    let mut guard = state
        .keep_awake_handle
        .lock()
        .map_err(|_| "State lock failed")?;

    if guard.is_some() {
        return Ok(KeepAwakeStatus {
            enabled: true,
            message: "Computer sleep prevention is already on".to_string(),
        });
    }

    *guard = Some(spawn_keep_awake_process()?);

    Ok(KeepAwakeStatus {
        enabled: true,
        message: "Computer sleep prevention is on".to_string(),
    })
}

fn keep_awake_status_from_state(state: &AppState) -> Result<KeepAwakeStatus, String> {
    let mut guard = state
        .keep_awake_handle
        .lock()
        .map_err(|_| "State lock failed")?;

    if let Some(child) = guard.as_mut() {
        match child.try_wait() {
            Ok(Some(_)) => {
                *guard = None;
                Ok(KeepAwakeStatus {
                    enabled: false,
                    message: "Computer sleep prevention stopped".to_string(),
                })
            }
            Ok(None) => Ok(KeepAwakeStatus {
                enabled: true,
                message: "Computer sleep prevention is on".to_string(),
            }),
            Err(error) => Err(format!("Could not inspect keep-awake process: {error}")),
        }
    } else {
        Ok(KeepAwakeStatus {
            enabled: false,
            message: "Computer sleep prevention is off".to_string(),
        })
    }
}

fn find_http_header_end(buffer: &[u8]) -> Option<usize> {
    buffer.windows(4).position(|window| window == b"\r\n\r\n")
}

fn parse_http_request_head(head: &str) -> Result<(String, String, HashMap<String, String>), String> {
    let mut lines = head.lines();
    let request_line = lines.next().ok_or("Missing request line")?;
    let mut request_parts = request_line.split_whitespace();
    let method = request_parts
        .next()
        .ok_or("Missing HTTP method")?
        .to_string();
    let path = request_parts
        .next()
        .ok_or("Missing HTTP path")?
        .to_string();
    let mut headers = HashMap::new();

    for line in lines {
        if let Some((name, value)) = line.split_once(':') {
            headers.insert(name.trim().to_ascii_lowercase(), value.trim().to_string());
        }
    }

    Ok((method, path, headers))
}

fn desktop_mcp_authorized(headers: &HashMap<String, String>) -> bool {
    match std::env::var("TUNIQ_DESKTOP_MCP_TOKEN") {
        Ok(expected) if !expected.trim().is_empty() => headers
            .get("authorization")
            .map(|value| value == &format!("Bearer {expected}"))
            .unwrap_or(false),
        _ => true,
    }
}

fn rpc_result(id: Value, result: Value) -> Value {
    json!({
        "jsonrpc": "2.0",
        "id": id,
        "result": result
    })
}

fn rpc_error(id: Value, code: i64, message: impl Into<String>) -> Value {
    json!({
        "jsonrpc": "2.0",
        "id": id,
        "error": {
            "code": code,
            "message": message.into()
        }
    })
}

fn desktop_mcp_tools() -> Value {
    json!({
        "tools": [
            {
                "name": "tuniq_desktop.status",
                "description": "Return the local desktop tunnel, keep-awake, and MCP endpoint status.",
                "inputSchema": {
                    "type": "object",
                    "properties": {},
                    "additionalProperties": false
                }
            },
            {
                "name": "tuniq_desktop.start_tunnel",
                "description": "Start the local tunnel using a relay URL, agent id, and relay token.",
                "inputSchema": {
                    "type": "object",
                    "required": ["relayUrl", "agentId", "relayToken"],
                    "properties": {
                        "relayUrl": { "type": "string" },
                        "agentId": { "type": "string" },
                        "relayToken": { "type": "string" }
                    },
                    "additionalProperties": false
                }
            },
            {
                "name": "tuniq_desktop.stop_tunnel",
                "description": "Stop the local tunnel for an enrolled agent.",
                "inputSchema": {
                    "type": "object",
                    "required": ["agentId"],
                    "properties": {
                        "agentId": { "type": "string" }
                    },
                    "additionalProperties": false
                }
            },
            {
                "name": "tuniq_desktop.set_keep_awake",
                "description": "Turn local computer sleep prevention on or off.",
                "inputSchema": {
                    "type": "object",
                    "required": ["enabled"],
                    "properties": {
                        "enabled": { "type": "boolean" }
                    },
                    "additionalProperties": false
                }
            }
        ]
    })
}

fn desktop_tool_result(value: Value) -> Value {
    let text = serde_json::to_string_pretty(&value).unwrap_or_else(|_| "{}".to_string());

    json!({
        "content": [
            {
                "type": "text",
                "text": text
            }
        ]
    })
}

fn mcp_string_argument(arguments: &Value, key: &str) -> Result<String, String> {
    arguments
        .get(key)
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .map(ToString::to_string)
        .ok_or_else(|| format!("{key} is required"))
}

fn mcp_bool_argument(arguments: &Value, key: &str) -> Result<bool, String> {
    arguments
        .get(key)
        .and_then(Value::as_bool)
        .ok_or_else(|| format!("{key} is required"))
}

fn call_desktop_mcp_tool(
    state: Arc<AppState>,
    name: &str,
    arguments: Value,
) -> Result<Value, String> {
    match name {
        "tuniq_desktop.status" => Ok(desktop_tool_result(json!({
            "tunnels": tunnel_statuses_from_state(state.as_ref())?,
            "keepAwake": keep_awake_status_from_state(state.as_ref())?,
            "mcp": {
                "endpoint": format!("http://{DESKTOP_MCP_ADDR}/mcp"),
                "authentication": if std::env::var("TUNIQ_DESKTOP_MCP_TOKEN").ok().filter(|token| !token.trim().is_empty()).is_some() {
                    "bearer"
                } else {
                    "loopback"
                }
            }
        }))),
        "tuniq_desktop.start_tunnel" => {
            let config = TunnelConfig {
                relay_url: mcp_string_argument(&arguments, "relayUrl")?,
                agent_id: mcp_string_argument(&arguments, "agentId")?,
                agent_token: mcp_string_argument(&arguments, "relayToken")?,
            };
            Ok(desktop_tool_result(json!({
                "tunnel": start_tunnel_in_state(config, state)?
            })))
        }
        "tuniq_desktop.stop_tunnel" => {
            let agent_id = mcp_string_argument(&arguments, "agentId")?;
            Ok(desktop_tool_result(json!({
                "tunnel": stop_tunnel_in_state(&agent_id, state.as_ref())?
            })))
        }
        "tuniq_desktop.set_keep_awake" => Ok(desktop_tool_result(json!({
            "keepAwake": set_keep_awake_in_state(
                mcp_bool_argument(&arguments, "enabled")?,
                state.as_ref()
            )?
        }))),
        _ => Err(format!("Unknown tool: {name}")),
    }
}

fn handle_desktop_mcp_rpc(state: Arc<AppState>, body: &[u8]) -> Result<Option<Value>, Value> {
    let request: Value =
        serde_json::from_slice(body).map_err(|_| rpc_error(Value::Null, -32700, "Invalid JSON"))?;
    let Some(method) = request.get("method").and_then(Value::as_str) else {
        return Err(rpc_error(Value::Null, -32600, "Invalid MCP request"));
    };
    let id = request.get("id").cloned().unwrap_or(Value::Null);

    if request.get("id").is_none() && method.starts_with("notifications/") {
        return Ok(None);
    }

    match method {
        "initialize" => Ok(Some(rpc_result(
            id,
            json!({
                "protocolVersion": MCP_PROTOCOL_VERSION,
                "capabilities": {
                    "tools": {}
                },
                "serverInfo": {
                    "name": "tuniq-desktop",
                    "version": "0.1.0"
                }
            }),
        ))),
        "ping" => Ok(Some(rpc_result(id, json!({})))),
        "tools/list" => Ok(Some(rpc_result(id, desktop_mcp_tools()))),
        "tools/call" => {
            let params = request.get("params").cloned().unwrap_or_else(|| json!({}));
            let Some(tool_name) = params.get("name").and_then(Value::as_str) else {
                return Err(rpc_error(id, -32602, "Tool name is required"));
            };
            let arguments = params.get("arguments").cloned().unwrap_or_else(|| json!({}));

            call_desktop_mcp_tool(state, tool_name, arguments)
                .map(|result| Some(rpc_result(id.clone(), result)))
                .map_err(|error| rpc_error(id, -32602, error))
        }
        _ => Err(rpc_error(
            id,
            -32601,
            format!("Method not found: {method}"),
        )),
    }
}

async fn write_http_response(
    stream: &mut TcpStream,
    status: &str,
    content_type: &str,
    body: &[u8],
) -> Result<(), String> {
    let response_head = format!(
        "HTTP/1.1 {status}\r\ncontent-type: {content_type}\r\ncontent-length: {}\r\nconnection: close\r\n\r\n",
        body.len()
    );

    stream
        .write_all(response_head.as_bytes())
        .await
        .map_err(|error| error.to_string())?;
    stream
        .write_all(body)
        .await
        .map_err(|error| error.to_string())
}

async fn handle_desktop_mcp_connection(
    mut stream: TcpStream,
    state: Arc<AppState>,
) -> Result<(), String> {
    let mut buffer = Vec::new();
    let mut chunk = [0_u8; 4096];
    let mut header_end = None;
    let mut content_length = 0_usize;

    loop {
        let read = stream
            .read(&mut chunk)
            .await
            .map_err(|error| error.to_string())?;
        if read == 0 {
            break;
        }

        buffer.extend_from_slice(&chunk[..read]);
        if buffer.len() > 1_048_576 {
            return write_http_response(
                &mut stream,
                "413 Payload Too Large",
                "text/plain; charset=utf-8",
                b"MCP request is too large",
            )
            .await;
        }

        if header_end.is_none() {
            if let Some(position) = find_http_header_end(&buffer) {
                let head = String::from_utf8_lossy(&buffer[..position]);
                let (_, _, headers) = parse_http_request_head(&head)?;
                content_length = headers
                    .get("content-length")
                    .and_then(|value| value.parse::<usize>().ok())
                    .unwrap_or(0);
                header_end = Some(position);
            }
        }

        if let Some(position) = header_end {
            if buffer.len() >= position + 4 + content_length {
                break;
            }
        }
    }

    let Some(position) = header_end else {
        return write_http_response(
            &mut stream,
            "400 Bad Request",
            "text/plain; charset=utf-8",
            b"Invalid HTTP request",
        )
        .await;
    };

    let head = String::from_utf8_lossy(&buffer[..position]);
    let (method, path, headers) = parse_http_request_head(&head)?;

    if path != "/mcp" {
        return write_http_response(
            &mut stream,
            "404 Not Found",
            "text/plain; charset=utf-8",
            b"Not found",
        )
        .await;
    }

    if !desktop_mcp_authorized(&headers) {
        return write_http_response(
            &mut stream,
            "401 Unauthorized",
            "application/json",
            br#"{"error":"Authentication required"}"#,
        )
        .await;
    }

    if method == "GET" {
        let body = json!({
            "name": "tuniq-desktop",
            "protocolVersion": MCP_PROTOCOL_VERSION,
            "transport": "streamable-http",
            "endpoint": format!("http://{DESKTOP_MCP_ADDR}/mcp")
        })
        .to_string();

        return write_http_response(&mut stream, "200 OK", "application/json", body.as_bytes())
            .await;
    }

    if method != "POST" {
        return write_http_response(
            &mut stream,
            "405 Method Not Allowed",
            "text/plain; charset=utf-8",
            b"Method not allowed",
        )
        .await;
    }

    let body_start = position + 4;
    let body_end = body_start + content_length;
    let body = &buffer[body_start..body_end];

    match handle_desktop_mcp_rpc(state, body) {
        Ok(Some(response)) => {
            let body = response.to_string();
            write_http_response(&mut stream, "200 OK", "application/json", body.as_bytes()).await
        }
        Ok(None) => write_http_response(&mut stream, "204 No Content", "text/plain", b"").await,
        Err(response) => {
            let body = response.to_string();
            write_http_response(&mut stream, "200 OK", "application/json", body.as_bytes()).await
        }
    }
}

async fn run_desktop_mcp_server(state: Arc<AppState>) {
    let listener = match TcpListener::bind(DESKTOP_MCP_ADDR).await {
        Ok(listener) => listener,
        Err(error) => {
            eprintln!("Could not start Tuniq desktop MCP server: {error}");
            return;
        }
    };

    loop {
        let Ok((stream, _)) = listener.accept().await else {
            continue;
        };
        let state = state.clone();

        tauri::async_runtime::spawn(async move {
            let _ = handle_desktop_mcp_connection(stream, state).await;
        });
    }
}

#[tauri::command]
async fn start_tunnel(
    config: TunnelConfig,
    state: State<'_, Arc<AppState>>,
) -> Result<TunnelStatus, String> {
    start_tunnel_in_state(config, state.inner().clone())
}

#[tauri::command]
async fn stop_tunnel(
    agent_id: String,
    state: State<'_, Arc<AppState>>,
) -> Result<TunnelStatus, String> {
    stop_tunnel_in_state(&agent_id, state.inner().as_ref())
}

#[tauri::command]
fn tunnel_status(
    agent_id: String,
    state: State<'_, Arc<AppState>>,
) -> Result<TunnelStatus, String> {
    tunnel_status_from_state(&agent_id, state.inner().as_ref())
}

#[tauri::command]
fn tunnel_statuses(
    state: State<'_, Arc<AppState>>,
) -> Result<HashMap<String, TunnelStatus>, String> {
    tunnel_statuses_from_state(state.inner().as_ref())
}

#[tauri::command]
fn set_keep_awake(
    enabled: bool,
    state: State<'_, Arc<AppState>>,
) -> Result<KeepAwakeStatus, String> {
    set_keep_awake_in_state(enabled, state.inner().as_ref())
}

#[tauri::command]
fn keep_awake_status(state: State<'_, Arc<AppState>>) -> Result<KeepAwakeStatus, String> {
    keep_awake_status_from_state(state.inner().as_ref())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app_state = Arc::new(AppState::default());
    let mcp_state = app_state.clone();

    tauri::Builder::default()
        .manage(app_state)
        .plugin(tauri_plugin_opener::init())
        .setup(move |_| {
            let state = mcp_state.clone();
            tauri::async_runtime::spawn(async move {
                run_desktop_mcp_server(state).await;
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            start_tunnel,
            stop_tunnel,
            tunnel_status,
            tunnel_statuses,
            set_keep_awake,
            keep_awake_status,
            secret_set,
            secret_get,
            secret_delete,
            secret_clear_project
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

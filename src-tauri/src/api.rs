//! Local HTTP API for other agents/tools. Shares all logic with the UI
//! through `Core`, so both surfaces behave identically.

use std::net::SocketAddr;
use std::sync::Arc;
use std::time::{Duration, Instant};

use axum::body::Body;
use axum::extract::{Path, Query, Request, State};
use axum::http::{header, HeaderMap, StatusCode};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::core::{write_json, ApiStatus, Core};
use crate::jobs::{self, GenParams, Job};
use crate::msg::Coded;

type AppState = State<Arc<Core>>;

pub struct ApiError(StatusCode, String, String);

impl ApiError {
    fn new(status: StatusCode, code: &str, message: impl Into<String>) -> Self {
        Self(status, code.to_string(), message.into())
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.0, Json(json!({ "error": { "code": self.1, "message": self.2 } }))).into_response()
    }
}

impl From<Coded> for ApiError {
    fn from(e: Coded) -> Self {
        let status = match e.code.as_str() {
            "not_found" | "unknown_model" => StatusCode::NOT_FOUND,
            "busy" | "model_busy_download" | "model_in_use" => StatusCode::CONFLICT,
            "engine_missing" | "no_model_installed" | "model_not_installed" => StatusCode::PRECONDITION_FAILED,
            _ => StatusCode::BAD_REQUEST,
        };
        ApiError(status, e.code, e.message)
    }
}

fn job_json(job: &Job) -> Value {
    let mut v = serde_json::to_value(job).unwrap_or(Value::Null);
    if let Value::Object(map) = &mut v {
        map.remove("peaks");
        if job.output_path.is_some() {
            map.insert("audioUrl".into(), json!(format!("/api/v1/generations/{}/audio", job.id)));
        }
    }
    v
}

async fn auth(State(core): AppState, headers: HeaderMap, req: Request, next: Next) -> Response {
    let settings = core.settings();
    let path = req.uri().path();
    if path == "/api/v1/health" || !settings.api_require_token {
        return next.run(req).await;
    }
    let bearer = headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "));
    let key = headers.get("x-api-key").and_then(|v| v.to_str().ok());
    if bearer.or(key) == Some(settings.api_token.as_str()) {
        next.run(req).await
    } else {
        ApiError::new(
            StatusCode::UNAUTHORIZED,
            "unauthorized",
            "A valid API token is required (Authorization: Bearer <token>)",
        )
        .into_response()
    }
}

async fn health(State(core): AppState) -> Json<Value> {
    let engine = core.engine.read().unwrap().clone();
    let installed: Vec<&str> = core.catalog.iter().filter(|m| core.is_installed(m.id)).map(|m| m.id).collect();
    Json(json!({
        "ok": true,
        "app": "Songhearth",
        "version": env!("CARGO_PKG_VERSION"),
        "engine": { "ready": engine.installed, "version": engine.version },
        "installedModels": installed,
        "authRequired": core.settings().api_require_token,
    }))
}

async fn list_models(State(core): AppState) -> Json<Value> {
    Json(json!({ "models": core.model_views() }))
}

async fn get_model(State(core): AppState, Path(id): Path<String>) -> Result<Json<Value>, ApiError> {
    let def = core.model(&id).ok_or(ApiError::new(StatusCode::NOT_FOUND, "unknown_model", format!("Unknown model: {id}")))?;
    Ok(Json(serde_json::to_value(core.model_view(def)).unwrap()))
}

async fn install_model(State(core): AppState, Path(id): Path<String>) -> Result<(StatusCode, Json<Value>), ApiError> {
    crate::models::start_install(&core, &id)?;
    let def = core.model(&id).unwrap();
    Ok((StatusCode::ACCEPTED, Json(serde_json::to_value(core.model_view(def)).unwrap())))
}

async fn delete_model(State(core): AppState, Path(id): Path<String>) -> Result<StatusCode, ApiError> {
    crate::models::delete(&core, &id)?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
struct ListQuery {
    limit: Option<usize>,
    status: Option<String>,
}

async fn list_jobs(State(core): AppState, Query(q): Query<ListQuery>) -> Json<Value> {
    let jobs = core.jobs.lock().unwrap().clone();
    let limit = q.limit.unwrap_or(50).min(500);
    let items: Vec<Value> = jobs
        .iter()
        .rev()
        .filter(|j| {
            q.status
                .as_deref()
                .map(|s| serde_json::to_value(j.status).ok().and_then(|v| v.as_str().map(|x| x == s)).unwrap_or(false))
                .unwrap_or(true)
        })
        .take(limit)
        .map(job_json)
        .collect();
    Json(json!({ "generations": items }))
}

async fn create_job(State(core): AppState, Json(params): Json<GenParams>) -> Result<(StatusCode, Json<Value>), ApiError> {
    // Decoding a reference song takes a moment; keep it off the async workers.
    let job = tokio::task::spawn_blocking(move || jobs::create(&core, params, "api"))
        .await
        .map_err(|e| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "internal", e.to_string()))??;
    Ok((StatusCode::ACCEPTED, Json(job_json(&job))))
}

fn find(core: &Core, id: &str) -> Result<Job, ApiError> {
    core.job(id).ok_or(ApiError::new(StatusCode::NOT_FOUND, "not_found", format!("Job not found: {id}")))
}

async fn get_job(State(core): AppState, Path(id): Path<String>) -> Result<Json<Value>, ApiError> {
    Ok(Json(job_json(&find(&core, &id)?)))
}

async fn cancel_job(State(core): AppState, Path(id): Path<String>) -> Result<Json<Value>, ApiError> {
    Ok(Json(job_json(&jobs::cancel(&core, &id)?)))
}

#[derive(Deserialize)]
struct DeleteQuery {
    #[serde(default, rename = "deleteFile")]
    delete_file: bool,
}

async fn delete_job(State(core): AppState, Path(id): Path<String>, Query(q): Query<DeleteQuery>) -> Result<StatusCode, ApiError> {
    jobs::delete(&core, &id, q.delete_file)?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
struct WaitQuery {
    timeout: Option<u64>,
}

/// Long-poll until the job finishes or the timeout (default 600 s) expires.
async fn wait_job(State(core): AppState, Path(id): Path<String>, Query(q): Query<WaitQuery>) -> Result<Json<Value>, ApiError> {
    let deadline = Instant::now() + Duration::from_secs(q.timeout.unwrap_or(600).min(3600));
    loop {
        let job = find(&core, &id)?;
        if job.status.is_finished() || Instant::now() >= deadline {
            return Ok(Json(job_json(&job)));
        }
        tokio::time::sleep(Duration::from_millis(500)).await;
    }
}

async fn get_audio(State(core): AppState, Path(id): Path<String>) -> Result<Response, ApiError> {
    let job = find(&core, &id)?;
    let path = job
        .output_path
        .ok_or(ApiError::new(StatusCode::CONFLICT, "not_ready", "The audio has not been generated yet"))?;
    let bytes = tokio::fs::read(&path)
        .await
        .map_err(|e| ApiError::new(StatusCode::GONE, "file_missing", format!("The audio file cannot be read: {e}")))?;
    let name = std::path::Path::new(&path).file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    Ok(Response::builder()
        .header(header::CONTENT_TYPE, "audio/wav")
        .header(header::CONTENT_DISPOSITION, format!("attachment; filename*=UTF-8''{}", urlencode(&name)))
        .body(Body::from(bytes))
        .unwrap())
}

fn urlencode(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' => (b as char).to_string(),
            _ => format!("%{b:02X}"),
        })
        .collect()
}

async fn engine_status(State(core): AppState) -> Json<Value> {
    Json(serde_json::to_value(core.engine.read().unwrap().clone()).unwrap())
}

async fn engine_install(State(core): AppState) -> (StatusCode, Json<Value>) {
    let c = core.clone();
    tauri::async_runtime::spawn(async move {
        let _ = crate::engine::install(c).await;
    });
    (StatusCode::ACCEPTED, Json(serde_json::to_value(core.engine.read().unwrap().clone()).unwrap()))
}

fn router(core: Arc<Core>) -> Router {
    Router::new()
        .route("/api/v1/health", get(health))
        .route("/api/v1/engine", get(engine_status))
        .route("/api/v1/engine/install", post(engine_install))
        .route("/api/v1/models", get(list_models))
        .route("/api/v1/models/{id}", get(get_model).delete(delete_model))
        .route("/api/v1/models/{id}/install", post(install_model))
        .route("/api/v1/generations", get(list_jobs).post(create_job))
        .route("/api/v1/generations/{id}", get(get_job).delete(delete_job))
        .route("/api/v1/generations/{id}/cancel", post(cancel_job))
        .route("/api/v1/generations/{id}/wait", get(wait_job))
        .route("/api/v1/generations/{id}/audio", get(get_audio))
        .layer(middleware::from_fn_with_state(core.clone(), auth))
        .with_state(core)
}

/// Primary LAN address: the source IP the OS would use for an outbound
/// route. A UDP connect sends no packets.
fn lan_ip() -> Option<std::net::IpAddr> {
    let sock = std::net::UdpSocket::bind("0.0.0.0:0").ok()?;
    sock.connect("192.0.2.1:9").ok()?;
    let ip = sock.local_addr().ok()?.ip();
    (!ip.is_loopback() && !ip.is_unspecified()).then_some(ip)
}
/// (Re)starts the server according to current settings and writes the
/// discovery file agents read (`api.json`, mode 0600).
pub async fn restart(core: Arc<Core>) {
    let previous = core.api_shutdown.lock().unwrap().take();
    if let Some(tx) = previous {
        let _ = tx.send(());
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
    let settings = core.settings();
    if !settings.api_enabled {
        *core.api_status.write().unwrap() = ApiStatus::default();
        let _ = std::fs::remove_file(&core.paths.api_info);
        core.emit_api_status();
        return;
    }
    let ip: [u8; 4] = if settings.api_lan { [0, 0, 0, 0] } else { [127, 0, 0, 1] };
    let addr = SocketAddr::from((ip, settings.api_port));
    let url = format!("http://127.0.0.1:{}", settings.api_port);
    let lan_url = settings
        .api_lan
        .then(lan_ip)
        .flatten()
        .map(|ip| format!("http://{ip}:{}", settings.api_port));
    match tokio::net::TcpListener::bind(addr).await {
        Ok(listener) => {
            let (tx, rx) = tokio::sync::oneshot::channel::<()>();
            *core.api_shutdown.lock().unwrap() = Some(tx);
            let app = router(core.clone());
            tauri::async_runtime::spawn(async move {
                let _ = axum::serve(listener, app)
                    .with_graceful_shutdown(async move {
                        let _ = rx.await;
                    })
                    .await;
            });
            let info = json!({
                "url": url,
                "token": if settings.api_require_token { Some(settings.api_token.clone()) } else { None },
                "pid": std::process::id(),
                "version": env!("CARGO_PKG_VERSION"),
            });
            if write_json(&core.paths.api_info, &info).is_ok() {
                let _ = crate::util::set_unix_mode(&core.paths.api_info, 0o600);
            }
            *core.api_status.write().unwrap() = ApiStatus { running: true, url: Some(url), lan_url, error: None };
        }
        Err(e) => {
            *core.api_status.write().unwrap() = ApiStatus {
                running: false,
                url: None,
                lan_url: None,
                error: Some(
                    Coded::new("port_unavailable", format!("Port {} cannot be bound: {e}", settings.api_port))
                        .with("port", settings.api_port)
                        .with("detail", e),
                ),
            };
        }
    }
    core.emit_api_status();
}

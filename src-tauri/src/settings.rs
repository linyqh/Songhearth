use serde::{Deserialize, Serialize};

use crate::util::random_token;

pub const DEFAULT_API_PORT: u16 = 17865;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    /// UI language: `system` or a locale code (e.g. `en`, `zh-CN`). Validated
    /// by the frontend, which owns the list of installed locales.
    pub language: String,
    /// Directory (or full path to `audiocpp_cli`) chosen by the user. `None`
    /// means: bundled engine, then the app-managed download.
    pub engine_path: Option<String>,
    /// `None` uses `<app data>/models`.
    pub models_dir: Option<String>,
    /// `None` uses `~/Music/Songhearth`.
    pub output_dir: Option<String>,
    pub threads: u32,
    pub hf_endpoint: String,
    pub hf_token: Option<String>,
    pub api_enabled: bool,
    pub api_port: u16,
    /// Listen on all interfaces (LAN) instead of loopback only.
    pub api_lan: bool,
    pub api_require_token: bool,
    pub api_token: String,
    pub notify_on_finish: bool,
}

impl Default for Settings {
    fn default() -> Self {
        let cores = std::thread::available_parallelism()
            .map(|n| n.get() as u32)
            .unwrap_or(8);
        Self {
            language: "system".into(),
            engine_path: None,
            models_dir: None,
            output_dir: None,
            threads: cores.clamp(2, 8),
            hf_endpoint: "https://huggingface.co".into(),
            hf_token: None,
            api_enabled: true,
            api_port: DEFAULT_API_PORT,
            api_lan: true,
            api_require_token: false,
            api_token: random_token(),
            notify_on_finish: true,
        }
    }
}

impl Settings {
    /// Normalises user input so later code never has to re-check it.
    pub fn normalized(mut self) -> Self {
        let blank = |v: Option<String>| v.map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
        self.engine_path = blank(self.engine_path);
        self.models_dir = blank(self.models_dir);
        self.output_dir = blank(self.output_dir);
        self.hf_token = blank(self.hf_token);
        if self.language.trim().is_empty() {
            self.language = "system".into();
        }
        self.threads = self.threads.clamp(1, 64);
        let endpoint = self.hf_endpoint.trim().trim_end_matches('/').to_string();
        self.hf_endpoint = if endpoint.is_empty() {
            "https://huggingface.co".into()
        } else {
            endpoint
        };
        if self.api_port < 1024 {
            self.api_port = DEFAULT_API_PORT;
        }
        if self.api_token.trim().is_empty() {
            self.api_token = random_token();
        }
        self
    }
}

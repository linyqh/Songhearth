//! Structured, translatable messages. The backend never produces UI prose for
//! the app window: it emits a stable `code` plus `params`, and the frontend
//! translates `errors:<code>`. `message` is an English fallback, also what
//! HTTP API clients (agents) read.

use std::collections::BTreeMap;
use std::fmt;

use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Coded {
    pub code: String,
    #[serde(default)]
    pub params: BTreeMap<String, String>,
    #[serde(default)]
    pub message: String,
}

impl Coded {
    pub fn new(code: &str, message: impl Into<String>) -> Self {
        Self { code: code.to_string(), params: BTreeMap::new(), message: message.into() }
    }

    pub fn with(mut self, key: &str, value: impl ToString) -> Self {
        self.params.insert(key.to_string(), value.to_string());
        self
    }
}

impl fmt::Display for Coded {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for Coded {}

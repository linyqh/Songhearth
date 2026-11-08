mod api;
mod catalog;
mod commands;
mod core;
mod engine;
mod jobs;
mod models;
mod msg;
mod runner;
mod settings;
mod skill;
mod util;

use tauri::Manager;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            let core = core::Core::init(app.handle().clone())?;
            app.manage(core.clone());
            tauri::async_runtime::spawn(async move {
                engine::refresh(&core).await;
                api::restart(core.clone()).await;
                runner::worker(core).await;
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::bootstrap,
            commands::save_settings,
            commands::regenerate_api_token,
            commands::refresh_engine,
            commands::install_engine,
            commands::cancel_engine_install,
            commands::install_model,
            commands::pause_model,
            commands::delete_model,
            commands::create_job,
            commands::cancel_job,
            commands::delete_job,
            commands::retry_job,
            commands::update_job_meta,
            commands::export_track,
            commands::install_skill,
            commands::skill_markdown,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Songhearth");
}

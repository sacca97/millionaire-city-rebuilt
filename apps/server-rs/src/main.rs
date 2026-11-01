//! Standalone offline Millionaire City server (make run, oracle harness, conformance suite). The code lives in the library (src/lib.rs).

use mcity_server::{config, server_app};

#[tokio::main]
async fn main() {
    let config = config::get_server_config();
    match server_app::run(config).await {
        Ok(()) => std::process::exit(0),
        Err(e) => {
            eprintln!("[mcity] Failed to start server: {e}");
            std::process::exit(1);
        }
    }
}

# Rust Service Development

## Project Conventions
- Naming: `rs-{name}` for Rust services
- CLI: `clap` with derive macros
- Config: `config.toml.example` pattern, real config gitignored
- Error handling: `thiserror::Error` derive, `pub type Result<T>`

## Axum 0.8 Web Framework
- Handlers return `Result<impl IntoResponse, AppError>`
- Use `#[debug_handler(state = AppState)]` for better error messages
- All extractors must implement `FromRequestParts` (except possibly the last)
- `HeaderMap` implements `FromRequestParts` — can go anywhere in params
- Error types must implement `IntoResponse` for `Result<T, E>` return types

## Async Considerations
- `Box<dyn ToSql + Sync>` in async code needs `+ Send` for axum handlers
- When casting for `client.query()`, use `p.as_ref() as &(dyn ToSql + Sync)`

## Database
- PostgreSQL via `tokio-postgres` or `deadpool-postgres`
- Migrations in `migrations/` directory, applied at startup

## Build & Run
```bash
cargo build --release
cargo run -- --config config.toml
```

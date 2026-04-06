mod config;
mod error;
mod printer;
mod raster;
mod tui;

use std::io;
use std::time::Duration;

use clap::{Parser, Subcommand};
use crossterm::event::{DisableMouseCapture, EnableMouseCapture};
use crossterm::execute;
use crossterm::terminal::{
    disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen,
};
use ratatui::backend::CrosstermBackend;
use ratatui::Terminal;

use crate::config::{load_config, Config, PrinterConfig};
use crate::printer::protocol::PrinterProtocol;
use crate::printer::usb::UsbPrinter;
use crate::raster::convert::image_to_raster;
use crate::raster::encode::encode_print_job;
use crate::tui::TuiApp;

#[derive(Parser)]
#[command(name = "rs-label")]
#[command(about = "TUI for Brother PT-D600 label printing over USB")]
#[command(version)]
struct Cli {
    /// Path to the configuration file
    #[arg(short, long, default_value = "config.toml")]
    config: String,

    /// Enable verbose logging
    #[arg(short, long)]
    verbose: bool,

    #[command(subcommand)]
    command: Option<Commands>,
}

#[derive(Subcommand)]
enum Commands {
    /// Discover Brother USB devices
    Discover,

    /// Query printer status
    Status,

    /// Print an image file as a label
    Print {
        /// Path to the image file
        path: String,

        /// Black/white threshold (0-255)
        #[arg(short, long)]
        threshold: Option<u8>,

        /// Invert colors
        #[arg(short, long)]
        invert: bool,
    },

    /// Send raw hex bytes to the printer
    Raw {
        /// Hex string to send (e.g. "1B 69 53")
        hex: String,
    },
}

fn main() -> anyhow::Result<()> {
    let cli = Cli::parse();

    match &cli.command {
        None => {
            // Default: launch TUI
            run_tui(&cli.config)?;
        }
        _ => {
            // Initialize logging for non-TUI modes
            let log_level = if cli.verbose { "debug" } else { "info" };
            env_logger::Builder::from_env(env_logger::Env::default().default_filter_or(log_level))
                .format_timestamp_secs()
                .init();

            match cli.command {
                Some(Commands::Discover) => {
                    cmd_discover()?;
                }
                Some(Commands::Status) => {
                    let config = load_or_default(&cli.config);
                    cmd_status(&config.printer)?;
                }
                Some(Commands::Print {
                    ref path,
                    threshold,
                    invert,
                }) => {
                    let config = load_or_default(&cli.config);
                    let threshold = threshold.unwrap_or(config.printer.threshold);
                    cmd_print(&config.printer, path, threshold, invert)?;
                }
                Some(Commands::Raw { ref hex }) => {
                    let config = load_or_default(&cli.config);
                    cmd_raw(&config.printer, hex)?;
                }
                None => unreachable!(),
            }
        }
    }

    Ok(())
}

fn load_or_default(path: &str) -> Config {
    match load_config(path) {
        Ok(config) => config,
        Err(e) => {
            log::warn!("Could not load config '{}': {}. Using defaults.", path, e);
            Config {
                printer: PrinterConfig::default(),
            }
        }
    }
}

fn cmd_discover() -> anyhow::Result<()> {
    println!("Scanning for Brother USB devices...");
    println!();

    let devices = UsbPrinter::discover()?;

    if devices.is_empty() {
        println!("No Brother USB devices found.");
        println!();
        println!("Troubleshooting:");
        println!("  - Is the printer powered on and connected via USB?");
        println!("  - On Linux, you may need udev rules or run as root");
        println!("  - On macOS, check System Preferences > Security & Privacy");
        return Ok(());
    }

    for (i, dev) in devices.iter().enumerate() {
        println!("Device {}:", i + 1);
        println!("  Vendor:  {:04X} ({})", dev.vendor_id, dev.manufacturer);
        println!("  Product: {:04X} ({})", dev.product_id, dev.product);
        println!("  Serial:  {}", dev.serial);
        println!("  Bus:     {} Address: {}", dev.bus, dev.address);
        println!();
    }

    Ok(())
}

fn cmd_status(printer_config: &PrinterConfig) -> anyhow::Result<()> {
    let timeout = Duration::from_millis(printer_config.timeout_ms);
    let printer = UsbPrinter::open(printer_config.vendor_id, printer_config.product_id, timeout)?;
    let proto = PrinterProtocol::new(printer);

    proto.initialize()?;
    let status = proto.get_status()?;

    println!("Printer Status");
    println!("==============");
    print!("{}", status);
    println!();
    println!("Raw bytes:");
    for (i, chunk) in status.raw.chunks(16).enumerate() {
        let hex: Vec<String> = chunk.iter().map(|b| format!("{:02X}", b)).collect();
        let ascii: String = chunk
            .iter()
            .map(|&b| if (0x20..=0x7E).contains(&b) { b as char } else { '.' })
            .collect();
        println!("  {:04X}: {}  {}", i * 16, hex.join(" "), ascii);
    }

    Ok(())
}

fn cmd_print(
    printer_config: &PrinterConfig,
    path: &str,
    threshold: u8,
    invert: bool,
) -> anyhow::Result<()> {
    let timeout = Duration::from_millis(printer_config.timeout_ms);
    let printer = UsbPrinter::open(printer_config.vendor_id, printer_config.product_id, timeout)?;
    let proto = PrinterProtocol::new(printer);

    // Query printer for actual tape width
    proto.initialize()?;
    let status = proto.get_status()?;
    let tape_width = if status.media_width_mm > 0 {
        println!("Detected tape: {} ({}mm)", status.media_type, status.media_width_mm);
        status.media_width_mm
    } else {
        println!("Could not detect tape, using config: {}mm", printer_config.tape_width_mm);
        printer_config.tape_width_mm
    };

    println!("Loading image: {}", path);
    let bitmap = image_to_raster(path, tape_width, threshold, invert)?;
    println!(
        "Raster: {} lines x {} bytes/line",
        bitmap.lines.len(),
        bitmap.bytes_per_line
    );

    let media_type = status.raw[11]; // Use actual media type byte from printer
    let job = encode_print_job(&bitmap, media_type, tape_width, true);
    println!("Print job: {} bytes total", job.len());

    println!("Sending to printer...");
    let result = proto.print_raster(&job)?;

    println!("Print completed!");
    print!("{}", result);

    Ok(())
}

fn cmd_raw(printer_config: &PrinterConfig, hex_input: &str) -> anyhow::Result<()> {
    let hex_str: String = hex_input.chars().filter(|c| !c.is_whitespace()).collect();
    let bytes = hex::decode(&hex_str)?;

    println!("Sending {} bytes: {}", bytes.len(), hex_input);

    let timeout = Duration::from_millis(printer_config.timeout_ms);
    let printer = UsbPrinter::open(printer_config.vendor_id, printer_config.product_id, timeout)?;
    let proto = PrinterProtocol::new(printer);

    proto.send_raw(&bytes)?;

    let response = proto.read_raw()?;
    if response.is_empty() {
        println!("No response received.");
    } else {
        println!("Response ({} bytes):", response.len());
        for (i, chunk) in response.chunks(16).enumerate() {
            let hex: Vec<String> = chunk.iter().map(|b| format!("{:02X}", b)).collect();
            let ascii: String = chunk
                .iter()
                .map(|&b| if (0x20..=0x7E).contains(&b) { b as char } else { '.' })
                .collect();
            println!("  {:04X}: {}  {}", i * 16, hex.join(" "), ascii);
        }
    }

    Ok(())
}

fn run_tui(config_path: &str) -> anyhow::Result<()> {
    let config = load_or_default(config_path);

    // Setup terminal
    enable_raw_mode()?;
    let mut stdout = io::stdout();
    execute!(stdout, EnterAlternateScreen, EnableMouseCapture)?;
    let backend = CrosstermBackend::new(stdout);
    let mut terminal = Terminal::new(backend)?;

    // Create and run app
    let mut app = TuiApp::new(config);

    app.add_log(log::Level::Info, "RS-Label TUI started".to_string());
    app.add_log(
        log::Level::Info,
        format!("Config: {}", config_path),
    );

    let result = app.run(&mut terminal);

    // Restore terminal
    disable_raw_mode()?;
    execute!(
        terminal.backend_mut(),
        LeaveAlternateScreen,
        DisableMouseCapture
    )?;
    terminal.show_cursor()?;

    result
}

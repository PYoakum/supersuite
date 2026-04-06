use std::collections::VecDeque;
use std::path::PathBuf;
use std::time::{Duration, Instant};

use chrono::{DateTime, Local};
use crossterm::event::{self, Event, KeyCode, KeyModifiers};
use ratatui::backend::Backend;
use ratatui::Terminal;

use crate::config::Config;
use crate::printer::protocol::PrinterProtocol;
use crate::printer::status::PrinterStatus;

use super::ui;

const TICK_RATE: Duration = Duration::from_millis(250);
const MAX_LOG_ENTRIES: usize = 1000;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Tab {
    Dashboard,
    Print,
    RawCommand,
    Templates,
    Logs,
}

impl Tab {
    pub fn next(self) -> Self {
        match self {
            Tab::Dashboard => Tab::Print,
            Tab::Print => Tab::RawCommand,
            Tab::RawCommand => Tab::Templates,
            Tab::Templates => Tab::Logs,
            Tab::Logs => Tab::Dashboard,
        }
    }

    pub fn prev(self) -> Self {
        match self {
            Tab::Dashboard => Tab::Logs,
            Tab::Print => Tab::Dashboard,
            Tab::RawCommand => Tab::Print,
            Tab::Templates => Tab::RawCommand,
            Tab::Logs => Tab::Templates,
        }
    }

    pub fn index(self) -> usize {
        match self {
            Tab::Dashboard => 0,
            Tab::Print => 1,
            Tab::RawCommand => 2,
            Tab::Templates => 3,
            Tab::Logs => 4,
        }
    }

    pub fn from_index(i: usize) -> Self {
        match i {
            0 => Tab::Dashboard,
            1 => Tab::Print,
            2 => Tab::RawCommand,
            3 => Tab::Templates,
            _ => Tab::Logs,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InputMode {
    Normal,
    Editing,
}

#[derive(Debug, Clone)]
pub struct LogEntry {
    pub timestamp: DateTime<Local>,
    pub level: log::Level,
    pub message: String,
}

pub struct LogsState {
    pub entries: VecDeque<LogEntry>,
    pub scroll_offset: usize,
    pub auto_scroll: bool,
}

impl Default for LogsState {
    fn default() -> Self {
        Self {
            entries: VecDeque::new(),
            scroll_offset: 0,
            auto_scroll: true,
        }
    }
}

impl LogsState {
    pub fn push(&mut self, entry: LogEntry) {
        self.entries.push_back(entry);
        if self.entries.len() > MAX_LOG_ENTRIES {
            self.entries.pop_front();
            if self.scroll_offset > 0 {
                self.scroll_offset = self.scroll_offset.saturating_sub(1);
            }
        }
        if self.auto_scroll {
            self.scroll_to_bottom();
        }
    }

    pub fn scroll_to_bottom(&mut self) {
        self.scroll_offset = self.entries.len().saturating_sub(1);
    }

    pub fn clear(&mut self) {
        self.entries.clear();
        self.scroll_offset = 0;
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConnectionState {
    Disconnected,
    Connected,
    Error,
}

pub struct DashboardState {
    pub connection_state: ConnectionState,
    pub last_status: Option<PrinterStatus>,
    pub model: String,
}

impl Default for DashboardState {
    fn default() -> Self {
        Self {
            connection_state: ConnectionState::Disconnected,
            last_status: None,
            model: "PT-D600".to_string(),
        }
    }
}

pub struct FileBrowserState {
    pub current_dir: PathBuf,
    pub entries: Vec<DirEntry>,
    pub selected: usize,
    pub preview_lines: Vec<String>,
    pub threshold: u8,
    pub invert: bool,
}

#[derive(Debug, Clone)]
pub struct DirEntry {
    pub name: String,
    pub is_dir: bool,
    pub size: u64,
}

impl FileBrowserState {
    pub fn new(image_dir: &str, threshold: u8) -> Self {
        // Resolve to absolute path so it works regardless of cwd
        let current_dir = std::fs::canonicalize(image_dir)
            .unwrap_or_else(|_| std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")));
        let mut state = Self {
            current_dir,
            entries: Vec::new(),
            selected: 0,
            preview_lines: Vec::new(),
            threshold,
            invert: false,
        };
        state.refresh_entries();
        state
    }

    pub fn refresh_entries(&mut self) {
        self.entries.clear();

        if let Ok(read_dir) = std::fs::read_dir(&self.current_dir) {
            let mut entries: Vec<DirEntry> = read_dir
                .filter_map(|e| e.ok())
                .map(|e| {
                    let meta = e.metadata().ok();
                    DirEntry {
                        name: e.file_name().to_string_lossy().to_string(),
                        is_dir: meta.as_ref().map(|m| m.is_dir()).unwrap_or(false),
                        size: meta.as_ref().map(|m| m.len()).unwrap_or(0),
                    }
                })
                .collect();

            // Sort: directories first, then alphabetical
            entries.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then(a.name.cmp(&b.name)));
            self.entries = entries;
        }

        self.selected = 0;
        self.preview_lines.clear();
    }

    pub fn selected_path(&self) -> Option<PathBuf> {
        self.entries
            .get(self.selected)
            .map(|e| self.current_dir.join(&e.name))
    }

    pub fn selected_is_image(&self) -> bool {
        self.entries.get(self.selected).map_or(false, |e| {
            if e.is_dir {
                return false;
            }
            let lower = e.name.to_lowercase();
            lower.ends_with(".png")
                || lower.ends_with(".jpg")
                || lower.ends_with(".jpeg")
                || lower.ends_with(".bmp")
                || lower.ends_with(".gif")
                || lower.ends_with(".tiff")
                || lower.ends_with(".tif")
        })
    }
}

pub struct RawCommandState {
    pub input: String,
    pub history: VecDeque<RawHistoryEntry>,
    pub input_mode: InputMode,
}

#[derive(Debug, Clone)]
pub struct RawHistoryEntry {
    pub timestamp: DateTime<Local>,
    pub direction: RawDirection,
    pub data: Vec<u8>,
}

#[derive(Debug, Clone, Copy)]
pub enum RawDirection {
    Sent,
    Received,
}

impl Default for RawCommandState {
    fn default() -> Self {
        Self {
            input: String::new(),
            history: VecDeque::new(),
            input_mode: InputMode::Normal,
        }
    }
}

pub struct TemplatesState {
    pub templates: Vec<String>,
    pub selected: usize,
}

impl Default for TemplatesState {
    fn default() -> Self {
        Self {
            templates: vec!["(No templates loaded — connect printer first)".to_string()],
            selected: 0,
        }
    }
}

pub struct TuiApp {
    pub active_tab: Tab,
    pub should_quit: bool,
    pub show_help: bool,
    pub input_mode: InputMode,

    pub config: Config,
    pub protocol: Option<PrinterProtocol>,

    pub dashboard_state: DashboardState,
    pub file_browser_state: FileBrowserState,
    pub raw_command_state: RawCommandState,
    pub templates_state: TemplatesState,
    pub logs_state: LogsState,
}

impl TuiApp {
    pub fn new(config: Config) -> Self {
        let file_browser_state = FileBrowserState::new(
            &config.printer.image_dir,
            config.printer.threshold,
        );

        Self {
            active_tab: Tab::Dashboard,
            should_quit: false,
            show_help: false,
            input_mode: InputMode::Normal,
            config,
            protocol: None,
            dashboard_state: DashboardState::default(),
            file_browser_state,
            raw_command_state: RawCommandState::default(),
            templates_state: TemplatesState::default(),
            logs_state: LogsState::default(),
        }
    }

    pub fn run<B: Backend>(&mut self, terminal: &mut Terminal<B>) -> anyhow::Result<()> {
        let mut last_tick = Instant::now();

        loop {
            terminal.draw(|f| ui::draw(f, self))?;

            let timeout = TICK_RATE.saturating_sub(last_tick.elapsed());

            if event::poll(timeout)? {
                if let Event::Key(key) = event::read()? {
                    self.handle_key(key.code, key.modifiers);
                }
            }

            if last_tick.elapsed() >= TICK_RATE {
                self.tick();
                last_tick = Instant::now();
            }

            if self.should_quit {
                break;
            }
        }

        Ok(())
    }

    fn tick(&mut self) {
        // Periodically refresh printer status if connected
        if self.protocol.is_some() && self.dashboard_state.connection_state == ConnectionState::Connected {
            if let Some(ref proto) = self.protocol {
                match proto.get_status() {
                    Ok(status) => {
                        self.dashboard_state.last_status = Some(status);
                    }
                    Err(_) => {
                        self.dashboard_state.connection_state = ConnectionState::Error;
                        self.add_log(log::Level::Error, "Lost connection to printer".to_string());
                    }
                }
            }
        }
    }

    fn handle_key(&mut self, code: KeyCode, modifiers: KeyModifiers) {
        // If in editing mode, delegate to the appropriate editor
        if self.input_mode == InputMode::Editing {
            self.handle_editing_key(code, modifiers);
            return;
        }

        // Global keys
        match code {
            KeyCode::Char('q') | KeyCode::Esc => {
                if self.show_help {
                    self.show_help = false;
                } else {
                    self.should_quit = true;
                }
                return;
            }
            KeyCode::Char('c') if modifiers.contains(KeyModifiers::CONTROL) => {
                self.should_quit = true;
                return;
            }
            KeyCode::Char('?') => {
                self.show_help = !self.show_help;
                return;
            }
            KeyCode::Tab => {
                self.active_tab = self.active_tab.next();
                return;
            }
            KeyCode::BackTab => {
                self.active_tab = self.active_tab.prev();
                return;
            }
            KeyCode::Char('1') => {
                self.active_tab = Tab::Dashboard;
                return;
            }
            KeyCode::Char('2') => {
                self.active_tab = Tab::Print;
                return;
            }
            KeyCode::Char('3') => {
                self.active_tab = Tab::RawCommand;
                return;
            }
            KeyCode::Char('4') => {
                self.active_tab = Tab::Templates;
                return;
            }
            KeyCode::Char('5') => {
                self.active_tab = Tab::Logs;
                return;
            }
            _ => {}
        }

        // Tab-specific keys
        match self.active_tab {
            Tab::Dashboard => self.handle_dashboard_key(code),
            Tab::Print => self.handle_file_browser_key(code),
            Tab::RawCommand => self.handle_raw_command_key(code),
            Tab::Templates => self.handle_templates_key(code),
            Tab::Logs => self.handle_logs_key(code),
        }
    }

    fn handle_editing_key(&mut self, code: KeyCode, _modifiers: KeyModifiers) {
        match code {
            KeyCode::Esc => {
                self.input_mode = InputMode::Normal;
            }
            KeyCode::Enter => {
                // Send the raw command
                self.send_raw_command();
                self.input_mode = InputMode::Normal;
            }
            KeyCode::Char(c) => {
                self.raw_command_state.input.push(c);
            }
            KeyCode::Backspace => {
                self.raw_command_state.input.pop();
            }
            _ => {}
        }
    }

    fn handle_dashboard_key(&mut self, code: KeyCode) {
        match code {
            KeyCode::Char('c') => {
                self.connect_printer();
            }
            KeyCode::Char('r') => {
                if self.protocol.is_some() {
                    self.refresh_status();
                }
            }
            KeyCode::Char('i') => {
                if let Some(ref proto) = self.protocol {
                    match proto.initialize() {
                        Ok(()) => self.add_log(log::Level::Info, "Printer initialized".to_string()),
                        Err(e) => self.add_log(log::Level::Error, format!("Init failed: {}", e)),
                    }
                }
            }
            _ => {}
        }
    }

    fn handle_file_browser_key(&mut self, code: KeyCode) {
        let len = self.file_browser_state.entries.len();

        match code {
            KeyCode::Char('j') | KeyCode::Down => {
                if len > 0 {
                    self.file_browser_state.selected =
                        (self.file_browser_state.selected + 1).min(len.saturating_sub(1));
                    self.update_preview();
                }
            }
            KeyCode::Char('k') | KeyCode::Up => {
                self.file_browser_state.selected =
                    self.file_browser_state.selected.saturating_sub(1);
                self.update_preview();
            }
            KeyCode::Enter => {
                if let Some(entry) = self.file_browser_state.entries.get(self.file_browser_state.selected).cloned() {
                    if entry.is_dir {
                        self.file_browser_state.current_dir =
                            self.file_browser_state.current_dir.join(&entry.name);
                        self.file_browser_state.refresh_entries();
                        self.update_preview();
                    } else if self.file_browser_state.selected_is_image() {
                        // Enter on image = preview (if not already shown) or print
                        if self.file_browser_state.preview_lines.is_empty() {
                            self.update_preview();
                        } else {
                            self.print_selected_file();
                        }
                    }
                }
            }
            KeyCode::Char('p') => {
                // Explicit print shortcut
                if self.file_browser_state.selected_is_image() {
                    self.print_selected_file();
                }
            }
            KeyCode::Backspace => {
                if let Some(parent) = self.file_browser_state.current_dir.parent() {
                    self.file_browser_state.current_dir = parent.to_path_buf();
                    self.file_browser_state.refresh_entries();
                    self.update_preview();
                }
            }
            KeyCode::Char('t') => {
                // Cycle threshold: 64 -> 96 -> 128 -> 160 -> 192 -> 64
                self.file_browser_state.threshold = match self.file_browser_state.threshold {
                    t if t < 96 => 96,
                    t if t < 128 => 128,
                    t if t < 160 => 160,
                    t if t < 192 => 192,
                    _ => 64,
                };
                self.update_preview();
                self.add_log(
                    log::Level::Info,
                    format!("Threshold set to {}", self.file_browser_state.threshold),
                );
            }
            KeyCode::Char('v') => {
                self.file_browser_state.invert = !self.file_browser_state.invert;
                self.update_preview();
                self.add_log(
                    log::Level::Info,
                    format!("Invert: {}", self.file_browser_state.invert),
                );
            }
            _ => {}
        }
    }

    fn handle_raw_command_key(&mut self, code: KeyCode) {
        match code {
            KeyCode::Char('i') | KeyCode::Enter => {
                self.input_mode = InputMode::Editing;
                self.raw_command_state.input_mode = InputMode::Editing;
            }
            _ => {}
        }
    }

    fn handle_templates_key(&mut self, code: KeyCode) {
        let len = self.templates_state.templates.len();
        match code {
            KeyCode::Char('j') | KeyCode::Down => {
                if len > 0 {
                    self.templates_state.selected =
                        (self.templates_state.selected + 1).min(len.saturating_sub(1));
                }
            }
            KeyCode::Char('k') | KeyCode::Up => {
                self.templates_state.selected =
                    self.templates_state.selected.saturating_sub(1);
            }
            _ => {}
        }
    }

    fn handle_logs_key(&mut self, code: KeyCode) {
        match code {
            KeyCode::Char('j') | KeyCode::Down => {
                let max = self.logs_state.entries.len().saturating_sub(1);
                self.logs_state.scroll_offset = (self.logs_state.scroll_offset + 1).min(max);
                self.logs_state.auto_scroll = false;
            }
            KeyCode::Char('k') | KeyCode::Up => {
                self.logs_state.scroll_offset = self.logs_state.scroll_offset.saturating_sub(1);
                self.logs_state.auto_scroll = false;
            }
            KeyCode::Char('g') => {
                self.logs_state.scroll_offset = 0;
                self.logs_state.auto_scroll = false;
            }
            KeyCode::Char('G') => {
                self.logs_state.scroll_to_bottom();
                self.logs_state.auto_scroll = true;
            }
            KeyCode::Char('p') => {
                self.logs_state.auto_scroll = !self.logs_state.auto_scroll;
            }
            KeyCode::Char('c') => {
                self.logs_state.clear();
            }
            _ => {}
        }
    }

    fn connect_printer(&mut self) {
        use crate::printer::usb::UsbPrinter;

        self.add_log(
            log::Level::Info,
            format!(
                "Connecting to {:04X}:{:04X}...",
                self.config.printer.vendor_id, self.config.printer.product_id
            ),
        );

        let timeout = Duration::from_millis(self.config.printer.timeout_ms);
        match UsbPrinter::open(
            self.config.printer.vendor_id,
            self.config.printer.product_id,
            timeout,
        ) {
            Ok(printer) => {
                let proto = PrinterProtocol::new(printer);
                match proto.initialize() {
                    Ok(()) => {
                        self.add_log(log::Level::Info, "Connected and initialized".to_string());
                        self.dashboard_state.connection_state = ConnectionState::Connected;
                        // Get initial status
                        match proto.get_status() {
                            Ok(status) => {
                                self.add_log(
                                    log::Level::Info,
                                    format!(
                                        "Media: {} ({}mm)",
                                        status.media_type, status.media_width_mm
                                    ),
                                );
                                self.dashboard_state.last_status = Some(status);
                            }
                            Err(e) => {
                                self.add_log(log::Level::Warn, format!("Status read failed: {}", e));
                            }
                        }
                        self.protocol = Some(proto);
                    }
                    Err(e) => {
                        self.add_log(log::Level::Error, format!("Init failed: {}", e));
                        self.dashboard_state.connection_state = ConnectionState::Error;
                    }
                }
            }
            Err(e) => {
                self.add_log(log::Level::Error, format!("Connection failed: {}", e));
                self.dashboard_state.connection_state = ConnectionState::Disconnected;
            }
        }
    }

    fn refresh_status(&mut self) {
        if let Some(ref proto) = self.protocol {
            match proto.get_status() {
                Ok(status) => {
                    self.dashboard_state.last_status = Some(status);
                    self.add_log(log::Level::Info, "Status refreshed".to_string());
                }
                Err(e) => {
                    self.add_log(log::Level::Error, format!("Status failed: {}", e));
                    self.dashboard_state.connection_state = ConnectionState::Error;
                }
            }
        }
    }

    fn update_preview(&mut self) {
        if !self.file_browser_state.selected_is_image() {
            self.file_browser_state.preview_lines.clear();
            return;
        }

        if let Some(path) = self.file_browser_state.selected_path() {
            let tape_width = self.detected_tape_width();
            match crate::raster::convert::image_to_raster(
                &path.to_string_lossy(),
                tape_width,
                self.file_browser_state.threshold,
                self.file_browser_state.invert,
            ) {
                Ok(bitmap) => {
                    self.file_browser_state.preview_lines =
                        crate::raster::convert::raster_preview(&bitmap, 60, 20);
                }
                Err(e) => {
                    self.file_browser_state.preview_lines =
                        vec![format!("Preview error: {}", e)];
                }
            }
        }
    }

    /// Get the actual tape width: from printer status if available, otherwise config fallback
    fn detected_tape_width(&self) -> u8 {
        self.dashboard_state
            .last_status
            .as_ref()
            .filter(|s| s.media_width_mm > 0)
            .map(|s| s.media_width_mm)
            .unwrap_or(self.config.printer.tape_width_mm)
    }

    /// Get the actual media type byte from printer status, or default to laminated
    fn detected_media_type(&self) -> u8 {
        self.dashboard_state
            .last_status
            .as_ref()
            .map(|s| s.raw[11])
            .unwrap_or(0x01)
    }

    fn print_selected_file(&mut self) {
        let path = match self.file_browser_state.selected_path() {
            Some(p) => p,
            None => return,
        };

        let tape_width = self.detected_tape_width();
        let media_type = self.detected_media_type();

        let path_str = path.to_string_lossy().to_string();
        self.add_log(log::Level::Info, format!("Printing: {} ({}mm tape)", path_str, tape_width));

        match crate::raster::convert::image_to_raster(
            &path_str,
            tape_width,
            self.file_browser_state.threshold,
            self.file_browser_state.invert,
        ) {
            Ok(bitmap) => {
                let job = crate::raster::encode::encode_print_job(
                    &bitmap,
                    media_type,
                    tape_width,
                    true, // auto-cut
                );

                self.add_log(
                    log::Level::Info,
                    format!(
                        "Raster: {} lines, {} bytes total",
                        bitmap.lines.len(),
                        job.len()
                    ),
                );

                if let Some(ref proto) = self.protocol {
                    match proto.print_raster(&job) {
                        Ok(status) => {
                            self.add_log(log::Level::Info, "Print completed".to_string());
                            self.dashboard_state.last_status = Some(status);
                        }
                        Err(e) => {
                            self.add_log(log::Level::Error, format!("Print failed: {}", e));
                        }
                    }
                } else {
                    self.add_log(log::Level::Warn, "No printer connected".to_string());
                }
            }
            Err(e) => {
                self.add_log(log::Level::Error, format!("Image conversion failed: {}", e));
            }
        }
    }

    fn send_raw_command(&mut self) {
        let input = self.raw_command_state.input.trim().to_string();
        if input.is_empty() {
            return;
        }

        // Parse hex input
        let hex_str: String = input.chars().filter(|c| !c.is_whitespace()).collect();
        let bytes = match hex::decode(&hex_str) {
            Ok(b) => b,
            Err(e) => {
                self.add_log(log::Level::Error, format!("Invalid hex: {}", e));
                self.raw_command_state.input.clear();
                return;
            }
        };

        self.raw_command_state.history.push_back(RawHistoryEntry {
            timestamp: Local::now(),
            direction: RawDirection::Sent,
            data: bytes.clone(),
        });

        // Perform USB I/O, collecting results to avoid borrow conflicts
        let result = if let Some(ref proto) = self.protocol {
            match proto.send_raw(&bytes) {
                Ok(_) => {
                    let response = proto.read_raw();
                    Ok((bytes.len(), response))
                }
                Err(e) => Err(format!("Send failed: {}", e)),
            }
        } else {
            Err("No printer connected".to_string())
        };

        // Now log results (no longer borrowing self.protocol)
        match result {
            Ok((sent_len, read_result)) => {
                self.add_log(log::Level::Info, format!("Sent {} bytes", sent_len));
                match read_result {
                    Ok(response) if !response.is_empty() => {
                        self.add_log(
                            log::Level::Info,
                            format!("Received {} bytes", response.len()),
                        );
                        self.raw_command_state.history.push_back(RawHistoryEntry {
                            timestamp: Local::now(),
                            direction: RawDirection::Received,
                            data: response,
                        });
                    }
                    Ok(_) => {
                        self.add_log(log::Level::Info, "No response".to_string());
                    }
                    Err(e) => {
                        self.add_log(log::Level::Warn, format!("Read error: {}", e));
                    }
                }
            }
            Err(msg) => {
                self.add_log(log::Level::Warn, msg);
            }
        }

        self.raw_command_state.input.clear();
    }

    pub fn add_log(&mut self, level: log::Level, message: String) {
        self.logs_state.push(LogEntry {
            timestamp: Local::now(),
            level,
            message,
        });
    }
}

use ratatui::layout::{Constraint, Direction, Layout, Rect};
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, Borders, Paragraph, Tabs};
use ratatui::Frame;

use super::app::{ConnectionState, InputMode, Tab, TuiApp};
use super::widgets;

pub fn draw(f: &mut Frame, app: &TuiApp) {
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(3), // Tabs
            Constraint::Min(0),    // Content
            Constraint::Length(1), // Status bar
        ])
        .split(f.area());

    draw_tabs(f, app, chunks[0]);
    draw_content(f, app, chunks[1]);
    draw_status_bar(f, app, chunks[2]);

    if app.show_help {
        draw_help_popup(f, app);
    }
}

fn draw_tabs(f: &mut Frame, app: &TuiApp, area: Rect) {
    let titles = vec!["Dashboard", "Print", "Raw Cmd", "Templates", "Logs"];
    let tabs = Tabs::new(titles)
        .block(Block::default().borders(Borders::ALL).title("RS-Label"))
        .select(app.active_tab.index())
        .style(Style::default().fg(Color::White))
        .highlight_style(
            Style::default()
                .fg(Color::Yellow)
                .add_modifier(Modifier::BOLD),
        );
    f.render_widget(tabs, area);
}

fn draw_content(f: &mut Frame, app: &TuiApp, area: Rect) {
    match app.active_tab {
        Tab::Dashboard => widgets::dashboard::draw(f, app, area),
        Tab::Print => widgets::file_browser::draw(f, app, area),
        Tab::RawCommand => widgets::raw_command::draw(f, app, area),
        Tab::Templates => widgets::templates::draw(f, app, area),
        Tab::Logs => widgets::logs::draw(f, app, area),
    }
}

fn draw_status_bar(f: &mut Frame, app: &TuiApp, area: Rect) {
    let (conn_text, conn_color) = match app.dashboard_state.connection_state {
        ConnectionState::Connected => ("Connected", Color::Green),
        ConnectionState::Disconnected => ("Disconnected", Color::Red),
        ConnectionState::Error => ("Error", Color::Red),
    };

    let mode_text = match app.input_mode {
        InputMode::Normal => "",
        InputMode::Editing => " | MODE: EDITING",
    };

    let status = Line::from(vec![
        Span::raw(" Printer: "),
        Span::styled(conn_text, Style::default().fg(conn_color)),
        Span::raw(mode_text),
        Span::raw(" | "),
        Span::styled("q", Style::default().fg(Color::Yellow)),
        Span::raw(":quit "),
        Span::styled("?", Style::default().fg(Color::Yellow)),
        Span::raw(":help "),
        Span::styled("1-5", Style::default().fg(Color::Yellow)),
        Span::raw(":tabs"),
    ]);

    let paragraph = Paragraph::new(status).style(Style::default().bg(Color::DarkGray));
    f.render_widget(paragraph, area);
}

fn draw_help_popup(f: &mut Frame, _app: &TuiApp) {
    let area = centered_rect(60, 80, f.area());

    let help_text = vec![
        Line::from(Span::styled(
            "Keyboard Shortcuts",
            Style::default()
                .fg(Color::Yellow)
                .add_modifier(Modifier::BOLD),
        )),
        Line::from(""),
        Line::from(Span::styled("Global:", Style::default().fg(Color::Cyan))),
        Line::from("  1-5        Switch to tab"),
        Line::from("  Tab        Next tab"),
        Line::from("  Shift+Tab  Previous tab"),
        Line::from("  q / Esc    Quit"),
        Line::from("  ?          Toggle help"),
        Line::from(""),
        Line::from(Span::styled("Dashboard:", Style::default().fg(Color::Cyan))),
        Line::from("  c          Connect to printer"),
        Line::from("  r          Refresh status"),
        Line::from("  i          Initialize printer"),
        Line::from(""),
        Line::from(Span::styled("Print:", Style::default().fg(Color::Cyan))),
        Line::from("  j/k        Navigate files"),
        Line::from("  Enter      Open dir / Preview / Print"),
        Line::from("  p          Print selected file"),
        Line::from("  Backspace  Parent directory"),
        Line::from("  t          Cycle threshold"),
        Line::from("  v          Toggle invert"),
        Line::from(""),
        Line::from(Span::styled("Raw Command:", Style::default().fg(Color::Cyan))),
        Line::from("  i/Enter    Start editing hex"),
        Line::from("  Enter      Send command (in edit)"),
        Line::from("  Esc        Stop editing"),
        Line::from(""),
        Line::from(Span::styled("Templates:", Style::default().fg(Color::Cyan))),
        Line::from("  j/k        Navigate"),
        Line::from(""),
        Line::from(Span::styled("Logs:", Style::default().fg(Color::Cyan))),
        Line::from("  j/k        Scroll up/down"),
        Line::from("  g/G        Go to top/bottom"),
        Line::from("  p          Pause/resume auto-scroll"),
        Line::from("  c          Clear logs"),
    ];

    let block = Block::default()
        .title("Help")
        .borders(Borders::ALL)
        .style(Style::default().bg(Color::Black));

    let paragraph = Paragraph::new(help_text).block(block);

    f.render_widget(ratatui::widgets::Clear, area);
    f.render_widget(paragraph, area);
}

fn centered_rect(percent_x: u16, percent_y: u16, r: Rect) -> Rect {
    let popup_layout = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Percentage((100 - percent_y) / 2),
            Constraint::Percentage(percent_y),
            Constraint::Percentage((100 - percent_y) / 2),
        ])
        .split(r);

    Layout::default()
        .direction(Direction::Horizontal)
        .constraints([
            Constraint::Percentage((100 - percent_x) / 2),
            Constraint::Percentage(percent_x),
            Constraint::Percentage((100 - percent_x) / 2),
        ])
        .split(popup_layout[1])[1]
}

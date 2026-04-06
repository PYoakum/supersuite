use ratatui::layout::{Constraint, Direction, Layout, Rect};
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, Borders, Paragraph};
use ratatui::Frame;

use crate::tui::app::{ConnectionState, TuiApp};

pub fn draw(f: &mut Frame, app: &TuiApp, area: Rect) {
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(9),  // Connection & Printer Status
            Constraint::Length(7),  // Media Info
            Constraint::Min(0),     // Actions
        ])
        .margin(1)
        .split(area);

    draw_connection_status(f, app, chunks[0]);
    draw_media_info(f, app, chunks[1]);
    draw_actions(f, app, chunks[2]);
}

fn draw_connection_status(f: &mut Frame, app: &TuiApp, area: Rect) {
    let (status_text, status_color) = match app.dashboard_state.connection_state {
        ConnectionState::Connected => ("CONNECTED", Color::Green),
        ConnectionState::Disconnected => ("DISCONNECTED", Color::Red),
        ConnectionState::Error => ("ERROR", Color::Red),
    };

    let mut lines = vec![
        Line::from(vec![
            Span::raw("  Status:    "),
            Span::styled(
                format!("[●] {}", status_text),
                Style::default()
                    .fg(status_color)
                    .add_modifier(Modifier::BOLD),
            ),
        ]),
        Line::from(vec![
            Span::raw("  Model:     "),
            Span::styled(
                &app.dashboard_state.model,
                Style::default().fg(Color::Cyan),
            ),
        ]),
        Line::from(vec![
            Span::raw("  USB ID:    "),
            Span::styled(
                format!(
                    "{:04X}:{:04X}",
                    app.config.printer.vendor_id, app.config.printer.product_id
                ),
                Style::default().fg(Color::White),
            ),
        ]),
    ];

    if let Some(ref status) = app.dashboard_state.last_status {
        if status.has_error() {
            let errors = status.error_messages().join(", ");
            lines.push(Line::from(vec![
                Span::raw("  Errors:    "),
                Span::styled(errors, Style::default().fg(Color::Red)),
            ]));
        } else {
            lines.push(Line::from(vec![
                Span::raw("  Errors:    "),
                Span::styled("None", Style::default().fg(Color::Green)),
            ]));
        }
    }

    let block = Block::default()
        .title(" Printer Status ")
        .borders(Borders::ALL);

    let paragraph = Paragraph::new(lines).block(block);
    f.render_widget(paragraph, area);
}

fn draw_media_info(f: &mut Frame, app: &TuiApp, area: Rect) {
    let lines = if let Some(ref status) = app.dashboard_state.last_status {
        vec![
            Line::from(vec![
                Span::raw("  Media Type:   "),
                Span::styled(
                    status.media_type.to_string(),
                    Style::default().fg(Color::Cyan),
                ),
            ]),
            Line::from(vec![
                Span::raw("  Width:        "),
                Span::styled(
                    format!("{}mm", status.media_width_mm),
                    Style::default().fg(Color::Cyan),
                ),
            ]),
            Line::from(vec![
                Span::raw("  Status Type:  "),
                Span::styled(
                    status.status_type.to_string(),
                    Style::default().fg(Color::White),
                ),
            ]),
        ]
    } else {
        vec![Line::from(Span::styled(
            "  No status available — connect printer first",
            Style::default().fg(Color::DarkGray),
        ))]
    };

    let block = Block::default()
        .title(" Media Info ")
        .borders(Borders::ALL);

    let paragraph = Paragraph::new(lines).block(block);
    f.render_widget(paragraph, area);
}

fn draw_actions(f: &mut Frame, app: &TuiApp, area: Rect) {
    let connected = app.dashboard_state.connection_state == ConnectionState::Connected;

    let mut lines = vec![Line::from(vec![
        Span::styled("  [c] ", Style::default().fg(Color::Yellow)),
        Span::raw(if connected {
            "Reconnect"
        } else {
            "Connect to printer"
        }),
    ])];

    if connected {
        lines.push(Line::from(vec![
            Span::styled("  [r] ", Style::default().fg(Color::Yellow)),
            Span::raw("Refresh status"),
        ]));
        lines.push(Line::from(vec![
            Span::styled("  [i] ", Style::default().fg(Color::Yellow)),
            Span::raw("Initialize printer"),
        ]));
    }

    let block = Block::default()
        .title(" Actions ")
        .borders(Borders::ALL);

    let paragraph = Paragraph::new(lines).block(block);
    f.render_widget(paragraph, area);
}

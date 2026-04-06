use ratatui::layout::{Constraint, Direction, Layout, Rect};
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, Borders, Paragraph, Wrap};
use ratatui::Frame;

use crate::tui::app::{InputMode, RawDirection, TuiApp};

pub fn draw(f: &mut Frame, app: &TuiApp, area: Rect) {
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(3), // Input
            Constraint::Min(0),    // History
        ])
        .split(area);

    draw_input(f, app, chunks[0]);
    draw_history(f, app, chunks[1]);
}

fn draw_input(f: &mut Frame, app: &TuiApp, area: Rect) {
    let raw = &app.raw_command_state;
    let editing = app.input_mode == InputMode::Editing;

    let border_style = if editing {
        Style::default().fg(Color::Yellow)
    } else {
        Style::default()
    };

    let title = if editing {
        " Hex Input (Enter=send, Esc=cancel) "
    } else {
        " Hex Input (i/Enter to edit) "
    };

    let display_text = if editing {
        format!(" > {}_", raw.input)
    } else if raw.input.is_empty() {
        " Type hex bytes, e.g.: 1B 69 53".to_string()
    } else {
        format!(" > {}", raw.input)
    };

    let style = if editing {
        Style::default().fg(Color::White)
    } else {
        Style::default().fg(Color::DarkGray)
    };

    let block = Block::default()
        .title(title)
        .borders(Borders::ALL)
        .border_style(border_style);

    let paragraph = Paragraph::new(Line::from(Span::styled(display_text, style))).block(block);
    f.render_widget(paragraph, area);
}

fn draw_history(f: &mut Frame, app: &TuiApp, area: Rect) {
    let raw = &app.raw_command_state;

    let lines: Vec<Line> = raw
        .history
        .iter()
        .map(|entry| {
            let (prefix, color) = match entry.direction {
                RawDirection::Sent => ("TX", Color::Yellow),
                RawDirection::Received => ("RX", Color::Green),
            };

            let hex_str = entry
                .data
                .iter()
                .map(|b| format!("{:02X}", b))
                .collect::<Vec<_>>()
                .join(" ");

            let ascii_str: String = entry
                .data
                .iter()
                .map(|&b| if (0x20..=0x7E).contains(&b) { b as char } else { '.' })
                .collect();

            Line::from(vec![
                Span::styled(
                    entry.timestamp.format("%H:%M:%S ").to_string(),
                    Style::default().fg(Color::DarkGray),
                ),
                Span::styled(
                    format!("{} ", prefix),
                    Style::default().fg(color).add_modifier(Modifier::BOLD),
                ),
                Span::raw(format!("{} ", hex_str)),
                Span::styled(
                    format!("[{}]", ascii_str),
                    Style::default().fg(Color::DarkGray),
                ),
            ])
        })
        .collect();

    let title = format!(" History ({} entries) ", raw.history.len());
    let block = Block::default().title(title).borders(Borders::ALL);

    let paragraph = Paragraph::new(lines).block(block).wrap(Wrap { trim: false });
    f.render_widget(paragraph, area);
}

use ratatui::layout::Rect;
use ratatui::style::{Color, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, Borders, Paragraph, Wrap};
use ratatui::Frame;

use crate::tui::app::TuiApp;

pub fn draw(f: &mut Frame, app: &TuiApp, area: Rect) {
    let logs = &app.logs_state;
    let visible_height = area.height.saturating_sub(3) as usize;

    let lines: Vec<Line> = logs
        .entries
        .iter()
        .skip(logs.scroll_offset.saturating_sub(visible_height))
        .take(visible_height + 1)
        .map(|entry| {
            let level_style = match entry.level {
                log::Level::Error => Style::default().fg(Color::Red),
                log::Level::Warn => Style::default().fg(Color::Yellow),
                log::Level::Info => Style::default().fg(Color::Green),
                log::Level::Debug => Style::default().fg(Color::Cyan),
                log::Level::Trace => Style::default().fg(Color::DarkGray),
            };

            let level_str = match entry.level {
                log::Level::Error => "ERROR",
                log::Level::Warn => "WARN ",
                log::Level::Info => "INFO ",
                log::Level::Debug => "DEBUG",
                log::Level::Trace => "TRACE",
            };

            Line::from(vec![
                Span::styled(
                    entry.timestamp.format("%H:%M:%S ").to_string(),
                    Style::default().fg(Color::DarkGray),
                ),
                Span::styled(level_str, level_style),
                Span::raw(" "),
                Span::raw(&entry.message),
            ])
        })
        .collect();

    let auto_scroll_indicator = if logs.auto_scroll { "▼" } else { "◆" };
    let title = format!(
        " Logs ({} entries) {} ",
        logs.entries.len(),
        auto_scroll_indicator
    );

    let block = Block::default().title(title).borders(Borders::ALL);

    let paragraph = Paragraph::new(lines).block(block).wrap(Wrap { trim: false });
    f.render_widget(paragraph, area);

    // Footer
    let footer_area = Rect {
        y: area.y + area.height.saturating_sub(1),
        height: 1,
        ..area
    };
    let footer = Paragraph::new(" [j/k] Scroll  [g/G] Top/Bottom  [p] Pause  [c] Clear")
        .style(Style::default().fg(Color::DarkGray));
    f.render_widget(footer, footer_area);
}

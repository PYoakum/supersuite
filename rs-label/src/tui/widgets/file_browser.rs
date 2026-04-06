use ratatui::layout::{Constraint, Direction, Layout, Rect};
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, Borders, List, ListItem, Paragraph};
use ratatui::Frame;

use crate::tui::app::TuiApp;

pub fn draw(f: &mut Frame, app: &TuiApp, area: Rect) {
    let chunks = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([
            Constraint::Percentage(40), // File list
            Constraint::Percentage(60), // Preview + options
        ])
        .split(area);

    draw_file_list(f, app, chunks[0]);
    draw_preview_panel(f, app, chunks[1]);
}

fn draw_file_list(f: &mut Frame, app: &TuiApp, area: Rect) {
    let fb = &app.file_browser_state;
    let dir_display = fb.current_dir.to_string_lossy();

    let items: Vec<ListItem> = fb
        .entries
        .iter()
        .enumerate()
        .map(|(i, entry)| {
            let prefix = if entry.is_dir { " " } else { "  " };
            let name = if entry.is_dir {
                format!("{}{}/", prefix, entry.name)
            } else {
                let size = format_size(entry.size);
                format!("{}{:<30} {}", prefix, entry.name, size)
            };

            let style = if i == fb.selected {
                Style::default()
                    .bg(Color::DarkGray)
                    .add_modifier(Modifier::BOLD)
            } else if entry.is_dir {
                Style::default().fg(Color::Cyan)
            } else if is_image_name(&entry.name) {
                Style::default().fg(Color::White)
            } else {
                Style::default().fg(Color::DarkGray)
            };

            ListItem::new(Line::from(Span::styled(name, style)))
        })
        .collect();

    let title = format!(" {} ", dir_display);
    let block = Block::default().title(title).borders(Borders::ALL);

    let list = List::new(items).block(block);
    f.render_widget(list, area);

    // Footer
    let footer_area = Rect {
        y: area.y + area.height.saturating_sub(1),
        height: 1,
        ..area
    };
    let footer =
        Paragraph::new(" [j/k] Navigate  [Enter] Preview/Print  [p] Print  [BS] Up  [t] Threshold  [v] Invert")
            .style(Style::default().fg(Color::DarkGray));
    f.render_widget(footer, footer_area);
}

fn draw_preview_panel(f: &mut Frame, app: &TuiApp, area: Rect) {
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(4), // Print options
            Constraint::Min(0),    // Preview
        ])
        .split(area);

    draw_options(f, app, chunks[0]);
    draw_preview(f, app, chunks[1]);
}

fn draw_options(f: &mut Frame, app: &TuiApp, area: Rect) {
    let fb = &app.file_browser_state;

    let lines = vec![
        Line::from(vec![
            Span::raw("  Threshold: "),
            Span::styled(
                fb.threshold.to_string(),
                Style::default().fg(Color::Cyan),
            ),
            Span::raw("  |  Invert: "),
            Span::styled(
                if fb.invert { "Yes" } else { "No" },
                Style::default().fg(if fb.invert {
                    Color::Yellow
                } else {
                    Color::White
                }),
            ),
            Span::raw("  |  Tape: "),
            Span::styled(
                format!("{}mm", app.config.printer.tape_width_mm),
                Style::default().fg(Color::Cyan),
            ),
        ]),
    ];

    let block = Block::default()
        .title(" Print Options ")
        .borders(Borders::ALL);

    let paragraph = Paragraph::new(lines).block(block);
    f.render_widget(paragraph, area);
}

fn draw_preview(f: &mut Frame, app: &TuiApp, area: Rect) {
    let fb = &app.file_browser_state;

    let lines: Vec<Line> = if fb.preview_lines.is_empty() {
        if fb.selected_is_image() {
            vec![Line::from(Span::styled(
                "  Press Enter to preview, p to print",
                Style::default().fg(Color::DarkGray),
            ))]
        } else {
            vec![Line::from(Span::styled(
                "  Navigate to an image file (j/k)",
                Style::default().fg(Color::DarkGray),
            ))]
        }
    } else {
        let mut lines: Vec<Line> = fb.preview_lines
            .iter()
            .map(|line| Line::from(Span::raw(format!("  {}", line))))
            .collect();
        lines.push(Line::from(""));
        lines.push(Line::from(Span::styled(
            "  Press Enter or p to print",
            Style::default().fg(Color::Yellow),
        )));
        lines
    };

    let block = Block::default()
        .title(" Preview ")
        .borders(Borders::ALL);

    let paragraph = Paragraph::new(lines).block(block);
    f.render_widget(paragraph, area);
}

fn is_image_name(name: &str) -> bool {
    let lower = name.to_lowercase();
    lower.ends_with(".png")
        || lower.ends_with(".jpg")
        || lower.ends_with(".jpeg")
        || lower.ends_with(".bmp")
        || lower.ends_with(".gif")
        || lower.ends_with(".tiff")
        || lower.ends_with(".tif")
}

fn format_size(bytes: u64) -> String {
    if bytes < 1024 {
        format!("{}B", bytes)
    } else if bytes < 1024 * 1024 {
        format!("{:.1}K", bytes as f64 / 1024.0)
    } else {
        format!("{:.1}M", bytes as f64 / (1024.0 * 1024.0))
    }
}

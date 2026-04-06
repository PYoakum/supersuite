use ratatui::layout::Rect;
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, Borders, List, ListItem, Paragraph};
use ratatui::Frame;

use crate::tui::app::TuiApp;

pub fn draw(f: &mut Frame, app: &TuiApp, area: Rect) {
    let ts = &app.templates_state;

    let items: Vec<ListItem> = ts
        .templates
        .iter()
        .enumerate()
        .map(|(i, name)| {
            let style = if i == ts.selected {
                Style::default()
                    .bg(Color::DarkGray)
                    .add_modifier(Modifier::BOLD)
            } else {
                Style::default().fg(Color::White)
            };

            ListItem::new(Line::from(Span::styled(format!("  {}", name), style)))
        })
        .collect();

    let block = Block::default()
        .title(" Templates (read-only) ")
        .borders(Borders::ALL);

    let list = List::new(items).block(block);
    f.render_widget(list, area);

    // Footer
    let footer_area = Rect {
        y: area.y + area.height.saturating_sub(1),
        height: 1,
        ..area
    };
    let footer = Paragraph::new(" [j/k] Navigate")
        .style(Style::default().fg(Color::DarkGray));
    f.render_widget(footer, footer_area);
}

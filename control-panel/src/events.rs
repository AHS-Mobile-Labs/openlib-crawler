use crate::error::Result;
use crossterm::event::{self, Event as CrosstermEvent, KeyEvent, MouseEvent};
use std::time::Duration;

#[derive(Clone, Copy, Debug)]
pub enum InputEvent {
    Key(KeyEvent),
    Mouse(MouseEvent),
    Resize(u16, u16),
}

pub fn poll_events() -> Result<Vec<InputEvent>> {
    let mut events = Vec::new();
    while event::poll(Duration::from_millis(0))? {
        match event::read()? {
            CrosstermEvent::Key(key) => events.push(InputEvent::Key(key)),
            CrosstermEvent::Mouse(mouse) => events.push(InputEvent::Mouse(mouse)),
            CrosstermEvent::Resize(width, height) => events.push(InputEvent::Resize(width, height)),
            CrosstermEvent::FocusGained | CrosstermEvent::FocusLost | CrosstermEvent::Paste(_) => {}
        }
    }
    Ok(events)
}

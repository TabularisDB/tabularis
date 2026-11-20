mod i18n;
mod shell;
#[cfg(test)]
mod tests;
mod theme;

use crate::runtime::RuntimeContext;
use gpui::{App, AppContext as _, WindowOptions};
use gpui_component::{Root, Theme};

/// Blocks on the main thread until the last window closes.
pub fn run(context: RuntimeContext) {
    let colors = theme::load(&context);
    gpui_platform::application().run(move |cx: &mut App| {
        gpui_component::init(cx);
        Theme::update(cx, |t| theme::apply(&colors, &mut t.colors));
        cx.on_window_closed(|cx, _| {
            if cx.windows().is_empty() {
                cx.quit();
            }
        })
        .detach();
        let options = WindowOptions {
            titlebar: Some(gpui::TitlebarOptions {
                title: Some("Tabularis".into()),
                ..Default::default()
            }),
            ..Default::default()
        };
        cx.open_window(options, |window, cx| {
            let view = cx.new(|_| shell::Shell::new(colors));
            cx.new(|cx| Root::new(view, window, cx))
        })
        .expect("Failed to open window");
        cx.activate(true);
    });
}

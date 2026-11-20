use super::i18n::t;
use super::theme::hsla;
use super::theme::Colors;
use gpui::{div, px, Context, IntoElement, ParentElement as _, Render, Styled as _, Window};

pub struct Shell {
    colors: Colors,
}

impl Shell {
    pub fn new(colors: Colors) -> Self {
        Self { colors }
    }
}

impl Render for Shell {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        let c = &self.colors;
        let sidebar = div()
            .w(px(240.))
            .h_full()
            .p_3()
            .bg(hsla(&c.surface.primary))
            .border_r_1()
            .border_color(hsla(&c.border.subtle))
            .text_color(hsla(&c.text.primary))
            .child(t("sidebar.connections"));
        let input = div()
            .h(px(96.))
            .w_full()
            .bg(hsla(&c.bg.elevated))
            .border_b_1()
            .border_color(hsla(&c.border.default));
        let grid = div().flex_1().w_full().bg(hsla(&c.bg.base));
        div()
            .size_full()
            .flex()
            .bg(hsla(&c.bg.base))
            .text_color(hsla(&c.text.primary))
            .child(sidebar)
            .child(
                div()
                    .flex()
                    .flex_col()
                    .flex_1()
                    .h_full()
                    .child(input)
                    .child(grid),
            )
    }
}

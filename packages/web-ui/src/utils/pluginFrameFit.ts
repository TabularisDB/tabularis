const SCROLLS = /^(auto|scroll)$/;

/** Scroll containers around an inline plugin frame's anchor, nearest first. */
export function frameScrollports(anchor: HTMLElement): HTMLElement[] {
    const scrollports: HTMLElement[] = [];
    for (
        let parent = anchor.parentElement;
        parent && parent !== document.body;
        parent = parent.parentElement
    ) {
        const style = getComputedStyle(parent);
        if (SCROLLS.test(style.overflowY || style.overflow)) scrollports.push(parent);
    }
    return scrollports;
}

/**
 * Height an inline plugin frame may take: its content, capped to one page of
 * every scrollport around it, so a long form scrolls inside the frame instead
 * of being cut off.
 *
 * The cap comes from the host layout alone. The anchor is laid out at the full
 * content height while measuring, so a scrollport that only grows with its
 * content (auto height, `max-height`) reports the room it can give rather than
 * the height the frame happens to have right now.
 */
export function fitFrameHeight(anchor: HTMLElement, contentHeight: number): number {
    if (!(contentHeight > 0)) return 0;
    const scrollports = frameScrollports(anchor);
    if (scrollports.length === 0) return contentHeight;
    const previous = anchor.style.height;
    anchor.style.height = `${contentHeight}px`;
    let fitted = contentHeight;
    for (const scrollport of scrollports) {
        const style = getComputedStyle(scrollport);
        const page =
            scrollport.clientHeight -
            (Number.parseFloat(style.paddingTop) || 0) -
            (Number.parseFloat(style.paddingBottom) || 0);
        // A collapsed or unrendered scrollport says nothing about the room.
        if (page > 0) fitted = Math.min(fitted, page);
    }
    anchor.style.height = previous;
    return fitted;
}

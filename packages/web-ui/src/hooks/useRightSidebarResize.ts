import { useCallback, useRef } from "react";
import { useUiState } from "./useUiState";
import { UI_STATE_KEYS } from "../utils/uiStateStore";

const MIN_WIDTH = 320;
const DEFAULT_WIDTH = 384;
/** Coalesces writes while the handle is being dragged. */
const PERSIST_DEBOUNCE_MS = 300;

const computeMaxWidth = () =>
	typeof window === "undefined"
		? 800
		: Math.max(MIN_WIDTH, Math.floor(window.innerWidth * 0.5));

export const useRightSidebarResize = () => {
	const [stored, setWidth] = useUiState(
		UI_STATE_KEYS.rowEditorSidebarWidth,
		DEFAULT_WIDTH,
		{ debounceMs: PERSIST_DEBOUNCE_MS },
	);
	const width =
		typeof stored === "number" && Number.isFinite(stored)
			? Math.max(MIN_WIDTH, Math.min(stored, computeMaxWidth()))
			: DEFAULT_WIDTH;
	const isDragging = useRef(false);

	const startResize = useCallback((e: React.MouseEvent) => {
		e.preventDefault();
		isDragging.current = true;
		document.body.style.cursor = "col-resize";
		document.body.style.userSelect = "none";

		const handleMove = (ev: MouseEvent) => {
			if (!isDragging.current) return;
			const maxWidth = computeMaxWidth();
			const next = window.innerWidth - ev.clientX;
			if (next < MIN_WIDTH) {
				setWidth(MIN_WIDTH);
			} else if (next > maxWidth) {
				setWidth(maxWidth);
			} else {
				setWidth(next);
			}
		};

		const stop = () => {
			isDragging.current = false;
			document.body.style.cursor = "";
			document.body.style.userSelect = "";
			document.removeEventListener("mousemove", handleMove);
			document.removeEventListener("mouseup", stop);
		};

		document.addEventListener("mousemove", handleMove);
		document.addEventListener("mouseup", stop);
	}, [setWidth]);

	return { width, startResize };
};

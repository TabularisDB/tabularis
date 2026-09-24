import { useContext } from "react";
import {
	RightSidebarContext,
	type RightSidebarContextValue,
} from "../contexts/RightSidebarContext";

export const useRightSidebar = (): RightSidebarContextValue => {
	const ctx = useContext(RightSidebarContext);
	if (!ctx) {
		throw new Error(
			"useRightSidebar must be used within a RightSidebarProvider",
		);
	}
	return ctx;
};

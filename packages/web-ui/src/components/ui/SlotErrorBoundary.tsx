import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";

interface SlotErrorBoundaryProps {
  pluginId: string;
  slotName: string;
  children: ReactNode;
}

interface SlotErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class SlotErrorBoundary extends Component<SlotErrorBoundaryProps, SlotErrorBoundaryState> {
  state: SlotErrorBoundaryState = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): SlotErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(
      `[PluginSlot] Plugin "${this.props.pluginId}" crashed in slot "${this.props.slotName}":`,
      error,
      info.componentStack,
    );
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          className="text-[10px] text-red-400 bg-red-900/10 border border-red-900/30 rounded px-2 py-1"
          title={this.state.error?.message}
        >
          Plugin error: {this.props.pluginId}
        </div>
      );
    }

    return this.props.children;
  }
}

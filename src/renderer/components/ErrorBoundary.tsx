import { Component, type ErrorInfo, type ReactNode } from "react";

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("renderer error", error, info.componentStack);
  }

  override render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-3 bg-bg p-8 text-center text-ink">
          <h1 className="text-lg font-semibold text-red-400">The interface hit an unexpected error</h1>
          <pre className="max-w-xl overflow-auto rounded-lg border border-edge bg-panel p-3 text-xs text-muted">
            {this.state.error.message}
          </pre>
          <button className="btn-primary" onClick={() => window.location.reload()}>
            Reload utcode
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

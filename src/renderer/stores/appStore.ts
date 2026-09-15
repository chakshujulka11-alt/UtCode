import { useUiStore } from "./uiStore";

/**
 * appStore — spec-facing name for the global UI state that owns the sidebar
 * toggle (`isSidebarOpen`, default false) and panel layout. The single real
 * store lives in uiStore; this module re-exports it so components can import
 * the app-level store by name without creating a second source of truth.
 */
export const appStore = useUiStore;
export type AppState = ReturnType<typeof useUiStore.getState>;

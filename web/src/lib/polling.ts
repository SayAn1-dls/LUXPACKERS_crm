/** refetchInterval for live-ish data: every minute while the tab is visible, paused while hidden. */
export const pollWhileVisible = () => (document.visibilityState === "visible" ? 60_000 : false);

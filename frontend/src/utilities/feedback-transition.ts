export function openFeedback(navigate: () => void) {
  if (
    !document.startViewTransition ||
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  ) {
    navigate();
    return;
  }
  const transition = document.startViewTransition(
    () =>
      new Promise<void>((resolve) => {
        window.addEventListener("chartroom:feedback-ready", () => resolve(), {
          once: true,
        });
        navigate();
      }),
  );
  // Browsers can skip a transition when the tab is hidden; navigation still completes.
  void transition.finished.catch(() => {});
}

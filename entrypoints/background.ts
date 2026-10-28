// The side panel does the work; the background only opens it.
export default defineBackground(() => {
  browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

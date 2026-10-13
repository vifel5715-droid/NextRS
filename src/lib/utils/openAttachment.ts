const STATUS_MESSAGES: Record<number, string> = {
  400: "The attachment link is invalid.",
  401: "Your session has expired. Please log in again.",
  403: "You do not have permission to open this attachment.",
  404: "The attachment could not be found. It may have been removed — please upload it again.",
};

/**
 * Opens a stored PDF attachment in a new tab.
 *
 * The tab is opened synchronously inside the click (so popup blockers allow
 * it), the URL is checked with a HEAD request, and only then is the tab
 * pointed at the PDF — a missing file or denied access closes the tab and
 * shows a specific message instead of a raw JSON error page.
 */
export async function openAttachment(url: string): Promise<void> {
  const tab = window.open("about:blank", "_blank");
  try {
    const response = await fetch(url, { method: "HEAD", credentials: "same-origin", cache: "no-store" });
    if (!response.ok) {
      throw new Error(STATUS_MESSAGES[response.status] ?? `The attachment could not be opened (HTTP ${response.status}).`);
    }
    if (tab) {
      tab.opener = null;
      tab.location.href = url;
    } else {
      // Popup blocked — fall back to navigating this tab to the download.
      window.location.assign(`${url}${url.includes("?") ? "&" : "?"}download=1`);
    }
  } catch (error) {
    tab?.close();
    alert(error instanceof Error && error.message !== "Failed to fetch" ? error.message : "Could not reach the server to open the attachment. Check your connection and try again.");
  }
}

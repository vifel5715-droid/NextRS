/**
 * Copy text to the clipboard.
 *
 * `navigator.clipboard` only exists in a secure context, and this app is served
 * over plain http on the LAN, so it is undefined for every user except on
 * localhost. The hidden-textarea fallback is what actually runs in practice.
 */
export const copyToClipboard = async (text: string): Promise<boolean> => {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through — permission denied or blocked, try the legacy path.
    }
  }

  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    // Keep it out of view and away from the scroll position.
    textarea.style.position = "fixed";
    textarea.style.top = "-1000px";
    textarea.setAttribute("readonly", "");
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
};

/**
 * Item Name / Quantity / UoM / Machine Code as tab-separated rows — the
 * format spreadsheets (and grid-based external systems, e.g. an SAP-style
 * contents grid: Item No. / Item Description / Quantity / UoM Code / Info
 * Price / Total / Whse / In Stock / Machine Code / ...) split into columns
 * on paste. Four blank columns sit between UoM and Machine Code so pasting
 * from the "Item Description" cell lands Machine Code in that system's own
 * Machine Code column instead of one column early — those four (Info Price,
 * Total, Whse, In Stock) have no equivalent on our side, so they're left for
 * the target system to fill in itself. Column count corrected 2026-09-12
 * after a real paste landed Machine Code's value in "In Stock" instead (the
 * previous count of three blanks was one short) — verify against a real
 * paste again before changing this, rather than guessing from a screenshot
 * alone.
 */
interface ClipboardItem {
  item_name?: string;
  quantity?: number | string;
  uom?: string;
  machine_code?: string;
}

export const formatItemsForClipboard = (items: ClipboardItem[]): string =>
  items
    .map((item) => [item.item_name ?? "", item.quantity ?? "", item.uom ?? "", "", "", "", "", item.machine_code ?? ""].join("\t"))
    .join("\n");

/**
 * Item Description / Serial No. / Required Qty. / UoM Code / Project as
 * tab-separated rows — the format a different external grid ("Item No. /
 * Item Description / Serial No. / Required Date / Required Qty. / UoM Code
 * / Project") splits into columns on paste. Item No. and Required Date have
 * no equivalent on our side and are left blank for the target system to
 * fill in; our own request serial fills that grid's Serial No. column, and
 * Machine Code fills its Project column — that's the slot it lands in on
 * this particular grid. Column count taken from a screenshot of the target
 * grid — verify against a real paste before changing this.
 */
export const formatItemsForProjectGrid = (items: ClipboardItem[], serial: string): string =>
  items
    .map((item) => ["", item.item_name ?? "", serial, "", item.quantity ?? "", item.uom ?? "", item.machine_code ?? ""].join("\t"))
    .join("\n");

/**
 * Description / Item Type / Item Group / UoM Group as a single tab-separated
 * row — for registering a catalog entry as a new item on the external
 * accounting system's Item Master Data screen (Item No. / Description /
 * Foreign Name / Item Type / Item Group / UoM Group / Bar Code / Price List /
 * Unit Price). Item No., Foreign Name, Bar Code, Price List, and Unit Price
 * have no equivalent on our side and are left blank. UNLIKE
 * formatItemsForClipboard/formatItemsForProjectGrid above, the target here is
 * a single-record data-entry form, not a spreadsheet-style grid — those two
 * were confirmed to support landing a multi-column paste across cells; this
 * one has NOT been confirmed the same way, since a plain form field doesn't
 * necessarily distribute a pasted tab-separated value across the fields that
 * follow it the way a grid cell does. One item only (this screen registers
 * one item at a time). Field order guessed from the screen's visual layout
 * (top-to-bottom, left column before its paired right-column field) —
 * verify against a real paste before relying on this.
 */
interface RegistrationItem {
  item_name?: string;
  item_type?: string | null;
  item_group?: string | null;
  uom?: string;
}

export const formatItemForRegistration = (item: RegistrationItem): string =>
  [item.item_name ?? "", "", item.item_type ?? "", item.item_group ?? "", item.uom ?? "", "", "", ""].join("\t");

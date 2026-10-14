import React from "react";
import { getItemStatusBadgeClass, getItemStatusText } from "@/lib/utils/status";
import { sanitizeUserInput } from "@/lib/utils/sanitize";
import type { ItemRow } from "@/types";

/**
 * Read-only item status badge, plus the Cancel/Close reason underneath when
 * the item has one — used wherever an item's status is shown but not edited.
 */
const ItemStatusBadge: React.FC<{ item: ItemRow }> = ({ item }) => (
  <>
    <span className={`badge ${getItemStatusBadgeClass(item)}`}>{getItemStatusText(item)}</span>
    {item.status_reason && (
      <div className="text-muted mt-1" style={{ fontSize: "0.75rem", whiteSpace: "normal" }}>
        Reason: {sanitizeUserInput(item.status_reason)}
      </div>
    )}
  </>
);

export default ItemStatusBadge;

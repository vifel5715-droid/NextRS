import React from "react";
import { itemStatusNeedsReason } from "@/lib/utils/status";

interface ItemStatusReasonRowProps {
  status?: string | null;
  reason?: string | null;
  disabled?: boolean;
  /** Cell padding — the Pending Requests and Complete Requests detail tables differ. */
  padding?: string;
  /** Label above the input in one full-width cell — for narrow Details columns. */
  stacked?: boolean;
  onChange: (reason: string) => void;
}

/**
 * The required "Reason" input shown in an item's detail table while its
 * status is HOLD or CLOSE. Renders nothing for any other status.
 */
const ItemStatusReasonRow: React.FC<ItemStatusReasonRowProps> = ({
  status,
  reason,
  disabled,
  padding = "12px 16px",
  stacked = false,
  onChange,
}) => {
  if (!itemStatusNeedsReason(status)) return null;
  const isHold = status?.toUpperCase() === "HOLD";
  const missing = !reason?.trim();
  const label = (
    <>
      Reason <span className="text-danger">*</span>
    </>
  );
  return (
    <tr style={{ borderBottom: "1px solid #dee2e6" }}>
      {!stacked && (
        <td style={{ width: "110px", padding, border: "none", backgroundColor: "#f8f9fa", fontWeight: "500", color: "#6c757d" }}>
          {label}
        </td>
      )}
      <td colSpan={stacked ? 2 : undefined} style={{ padding, border: "none" }}>
        {stacked && (
          <div className="mb-1" style={{ fontWeight: "500", color: "#6c757d", fontSize: "0.85rem" }}>{label}</div>
        )}
        <textarea
          className={`form-control form-control-sm ${missing && !disabled ? "is-invalid" : ""}`}
          rows={stacked ? 3 : 2}
          style={{ minWidth: "180px", resize: "vertical" }}
          maxLength={1000}
          placeholder={isHold ? "Why is this item being put on hold?" : "Why is this item being closed?"}
          value={reason ?? ""}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        />
        {missing && !disabled && (
          <div className="invalid-feedback">
            A reason is required to {isHold ? "put this item on hold" : "close this item"}.
          </div>
        )}
      </td>
    </tr>
  );
};

export default ItemStatusReasonRow;

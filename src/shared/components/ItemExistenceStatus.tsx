import React from "react";
import { EXISTENCE_STATUS_META, type ExistenceStatus } from "@shared/utils/itemExistenceStatus";

const Dot: React.FC<{ color: string }> = ({ color }) => (
  <span
    style={{
      width: "8px",
      height: "8px",
      borderRadius: "50%",
      background: color,
      display: "inline-block",
      flexShrink: 0,
    }}
  />
);

/** Tint pairs (background/text) per status, keyed off the same color used for the dot. */
const PILL_TINTS: Record<ExistenceStatus, { bg: string; text: string }> = {
  existing: { bg: "#dcfce7", text: "#15803d" },
  not_found: { bg: "#fee2e2", text: "#b91c1c" },
};

/** Colored pill for one item row's catalog-match result — sized up from a plain
 * dot+label so it reads as a status at a glance, not fine print. Renders
 * nothing until a name is typed. */
export const ItemExistenceBadge: React.FC<{ status: ExistenceStatus | null }> = ({ status }) => {
  if (!status) return null;
  const meta = EXISTENCE_STATUS_META[status];
  const tint = PILL_TINTS[status];
  return (
    <span
      className="text-nowrap"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "6px",
        fontSize: "0.78rem",
        fontWeight: 600,
        color: tint.text,
        background: tint.bg,
        borderRadius: "999px",
        padding: "4px 10px",
      }}
    >
      <Dot color={meta.color} />
      {meta.label}
    </span>
  );
};

/** The small color key explaining what the badges above mean — shown once per form. */
export const ItemExistenceLegend: React.FC = () => (
  <div style={{ fontSize: "0.72rem", color: "#495057", border: "1px solid #e9ecef", borderRadius: "6px", padding: "8px 10px", display: "inline-block" }}>
    <div style={{ fontWeight: 700, marginBottom: "4px" }}>Item Existence Status</div>
    {(Object.keys(EXISTENCE_STATUS_META) as ExistenceStatus[]).map((status) => (
      <div key={status} style={{ display: "flex", alignItems: "center", gap: "6px", marginTop: "2px" }}>
        <Dot color={EXISTENCE_STATUS_META[status].color} />
        {EXISTENCE_STATUS_META[status].label}
      </div>
    ))}
  </div>
);

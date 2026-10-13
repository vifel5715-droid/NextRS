import React from "react";
import { useDateRangeContext } from "@/components/providers/DateRangeProvider";
import { getTodayDateString } from "@/lib/utils/dateRange";

/**
 * Start Date / End Date filter shared by every list page — narrows both the
 * page's own table and every sidebar badge count (see DateRangeContext and
 * Sidebar.tsx). Changing either input applies immediately; "Reset Date" only
 * appears once the range differs from the defaults (no Start Date, End Date
 * = today — End Date is never actually empty, so a plain truthiness check
 * would leave the button showing permanently).
 */
const DateRangeFilter: React.FC = () => {
  const { startDate, endDate, setStartDate, setEndDate, reset } = useDateRangeContext();
  const isDefault = startDate === "" && endDate === getTodayDateString();

  return (
    <div className="d-flex align-items-end gap-2 flex-wrap">
      <div>
        <label htmlFor="date-range-start" className="form-label small mb-1">
          Start Date
        </label>
        <input
          id="date-range-start"
          type="date"
          className="form-control form-control-sm"
          value={startDate}
          max={endDate || undefined}
          onChange={(e) => setStartDate(e.target.value)}
        />
      </div>
      <div>
        <label htmlFor="date-range-end" className="form-label small mb-1">
          End Date
        </label>
        <input
          id="date-range-end"
          type="date"
          className="form-control form-control-sm"
          value={endDate}
          min={startDate || undefined}
          onChange={(e) => setEndDate(e.target.value)}
        />
      </div>
      {!isDefault && (
        <button type="button" className="btn btn-outline-secondary btn-sm" onClick={reset}>
          Reset Date
        </button>
      )}
    </div>
  );
};

export default DateRangeFilter;

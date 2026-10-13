import { useRef, useState } from "react";
import { useAuth } from "@/components/providers/AuthProvider";
import { reimbursementRequestAPI } from "@/lib/api";
import { formatBytes } from "@/lib/utils/formatBytes";
import { getErrorMessage } from "@/lib/utils/errorMessage";
import { openAttachment } from "@/lib/utils/openAttachment";
import type { ReimbursementRequest } from "@/types";

interface ReimbursementAttachmentLinkProps {
  readonly requestId: number;
  readonly attachmentName?: string;
  readonly attachmentSize?: number;
  /** Pass the request to offer "Update Supporting Document" to whoever may replace it. */
  readonly request?: ReimbursementRequest;
  readonly onReplaced?: () => void;
}

const MAX_BYTES = 10 * 1024 * 1024;

/**
 * Mirrors replaceReimbursementAttachmentAction: the requester (Staff on
 * their own request; Secretary/Supervisor/Manager in the same department;
 * admin) until AP has approved, and never on a declined request. The
 * server re-checks all of this.
 */
function canReplaceAttachment(
  request: ReimbursementRequest | undefined,
  user: { id: string; name: string; role: string; department: string; permissions: string[] } | null
): boolean {
  if (!request || !user || !user.permissions.includes("create_request")) return false;
  const statuses = [request.supervisor_status, request.purchaser_status, request.ap_status];
  if (statuses.includes("rejected") || request.ap_status === "approved" || request.ap_status === "closed") return false;
  const role = user.role.trim().toLowerCase();
  if (role === "admin") return true;
  const sameDepartment = request.department.trim().toUpperCase() === user.department.trim().toUpperCase();
  if (!sameDepartment) return false;
  if (["secretary", "supervisor", "manager"].includes(role)) return true;
  return (request.requested_by ?? "").trim().toUpperCase() === user.name.trim().toUpperCase();
}

export default function ReimbursementAttachmentLink({
  requestId,
  attachmentName,
  attachmentSize,
  request,
  onReplaced,
}: ReimbursementAttachmentLinkProps) {
  const { user } = useAuth();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const canReplace = canReplaceAttachment(request, user);

  if (!attachmentName && !canReplace) return null;

  const handleFile = async (file: File | undefined) => {
    if (inputRef.current) inputRef.current.value = "";
    if (!file) return;
    if (file.type !== "application/pdf" || !file.name.toLowerCase().endsWith(".pdf")) {
      alert("Only PDF files can be uploaded as a supporting document.");
      return;
    }
    if (file.size > MAX_BYTES) {
      alert("The supporting document cannot exceed 10 MB.");
      return;
    }
    if (attachmentName && !confirm(`Replace "${attachmentName}" with "${file.name}"?`)) return;
    setUploading(true);
    try {
      await reimbursementRequestAPI.replaceAttachment(requestId, file);
      onReplaced?.();
    } catch (error: unknown) {
      // The previous document is kept on any failure.
      alert("Failed to update the supporting document: " + getErrorMessage(error));
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="mb-2 small d-flex flex-wrap align-items-center gap-2">
      <span className="text-muted">Supporting document: </span>
      {attachmentName ? (
        <>
          <a
            href={reimbursementRequestAPI.attachmentUrl(requestId)}
            onClick={(event) => {
              event.preventDefault();
              void openAttachment(reimbursementRequestAPI.attachmentUrl(requestId));
            }}
          >
            {attachmentName}
          </a>
          {typeof attachmentSize === "number" && (
            <span className="text-muted">({formatBytes(attachmentSize)})</span>
          )}
          <a href={reimbursementRequestAPI.attachmentUrl(requestId, true)} className="text-muted" title="Download">
            <i className="bi bi-download"></i>
          </a>
        </>
      ) : (
        <span className="text-muted">None</span>
      )}
      {canReplace && (
        <>
          <button
            type="button"
            className="btn btn-sm btn-outline-primary py-0"
            disabled={uploading}
            onClick={() => inputRef.current?.click()}
          >
            <i className="bi bi-upload me-1"></i>
            {uploading ? "Uploading…" : attachmentName ? "Update Supporting Document" : "Add Supporting Document"}
          </button>
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf,.pdf"
            className="d-none"
            onChange={(event) => void handleFile(event.target.files?.[0])}
          />
        </>
      )}
    </div>
  );
}

import { formatBytes } from "@shared/utils/formatBytes";

interface ReimbursementAttachmentLinkProps {
  readonly requestId: number;
  readonly attachmentName?: string;
  readonly attachmentSize?: number;
}

export default function ReimbursementAttachmentLink({
  requestId,
  attachmentName,
  attachmentSize,
}: ReimbursementAttachmentLinkProps) {
  if (!attachmentName) return null;

  return (
    <div className="mb-2 small">
      <span className="text-muted">Supporting document: </span>
      <a href={`/api/reimbursement-request/${requestId}/attachment`}>
        {attachmentName}
      </a>
      {typeof attachmentSize === "number" && (
        <span className="text-muted"> ({formatBytes(attachmentSize)})</span>
      )}
    </div>
  );
}

import React, { useRef, useState } from "react";
import { formatBytes } from "@shared/utils/formatBytes";
import styles from "./AttachmentDropzone.module.css";

interface AttachmentDropzoneProps {
  id: string;
  accept?: string;
  label?: string;
  /** Smaller padding/text — for use inside a narrow detail-panel column. */
  compact?: boolean;
  /** Rejected client-side (before it ever reaches the server) if exceeded. */
  maxSizeMB?: number;
  onFileSelected: (file: File) => void;
}

const AttachmentDropzone: React.FC<AttachmentDropzoneProps> = ({
  id,
  accept = "application/pdf",
  label = "Drag & Drop your file here",
  compact = false,
  maxSizeMB = 10.5,
  onFileSelected,
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFiles = (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    const maxBytes = maxSizeMB * 1024 * 1024;
    if (file.size > maxBytes) {
      // 1-decimal formatBytes() can round a file that's only marginally over
      // the limit down to the same digits as the limit itself (e.g. "10.0 MB
      // — the limit is 10 MB"), which reads as a contradiction. More
      // precision here makes the actual overage visible.
      setError(`"${file.name}" is ${formatBytes(file.size, 2)} — the limit is ${maxSizeMB} MB.`);
      return;
    }
    setError(null);
    onFileSelected(file);
  };

  return (
    <div>
      <div
        className={`${styles.dropzone} ${compact ? styles.dropzoneCompact : ""} ${isDragOver ? styles.dropzoneActive : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragOver(true);
        }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragOver(false);
          handleFiles(e.dataTransfer.files);
        }}
      >
        <i className={`bi bi-cloud-arrow-up-fill ${styles.dropzoneIcon}`}></i>
        <div className={styles.dropzoneText}>{label}</div>
        <div className={styles.dropzoneOr}>OR</div>
        <button
          type="button"
          className={styles.browseButton}
          onClick={(e) => {
            e.stopPropagation();
            inputRef.current?.click();
          }}
        >
          Browse Files
        </button>
        <input
          ref={inputRef}
          id={id}
          type="file"
          accept={accept}
          className={styles.hiddenInput}
          onChange={(e) => {
            handleFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>
      {error && (
        <div className={styles.dropzoneError} role="alert">
          {error}
        </div>
      )}
    </div>
  );
};

interface SelectedFileChipProps {
  file: File;
  onRemove: () => void;
}

/** A not-yet-uploaded file picked in a create-request form, with an × to clear it. */
export const SelectedFileChip: React.FC<SelectedFileChipProps> = ({ file, onRemove }) => (
  <div className={styles.fileBadge}>
    <i className="bi bi-file-earmark-pdf-fill" style={{ color: "#dc2626" }}></i>
    <span className={styles.fileBadgeName}>{file.name}</span>
    <span className={styles.fileBadgeSize}>({formatBytes(file.size)})</span>
    <button type="button" className={styles.fileBadgeRemove} onClick={onRemove} title="Remove file" aria-label="Remove file">
      ×
    </button>
  </div>
);

export default AttachmentDropzone;

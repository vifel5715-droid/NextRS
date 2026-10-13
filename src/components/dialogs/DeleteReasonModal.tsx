import React, { useState } from "react";
import Modal from "@/components/dialogs/Modal";

interface DeleteReasonModalProps {
  isOpen: boolean;
  title: string;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}

/** Required-reason confirmation for a destructive delete — see StaffDashboard.tsx's Reject Modal for the same shape. */
const DeleteReasonModal: React.FC<DeleteReasonModalProps> = ({ isOpen, title, onClose, onConfirm }) => {
  const [reason, setReason] = useState("");

  const handleClose = () => {
    setReason("");
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title={title}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onConfirm(reason);
          setReason("");
        }}
      >
        <div className="mb-3">
          <label className="form-label">
            Reason for deletion <span className="text-danger">*</span>
          </label>
          <textarea
            className="form-control text-uppercase"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            required
            rows={3}
            placeholder="Enter reason for deletion..."
          />
        </div>
        <div className="modal-actions">
          <button type="button" className="btn btn-secondary" onClick={handleClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-danger">
            Delete
          </button>
        </div>
      </form>
    </Modal>
  );
};

export default DeleteReasonModal;

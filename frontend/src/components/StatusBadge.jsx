import { ESCROW_STATUS_LABEL, MILESTONE_STATUS_LABEL } from "../config";

function getEscrowBadgeClass(status) {
  if (status === 0) return "badge badge--active";
  if (status === 1) return "badge badge--completed";
  if (status === 2) return "badge badge--disputed";
  if (status === 3) return "badge badge--refunded";
  return "badge";
}

function getMilestoneBadgeClass(status) {
  if (status === 0) return "badge badge--pending";
  if (status === 1) return "badge badge--submitted";
  if (status === 2) return "badge badge--approved";
  return "badge";
}

export function EscrowStatusBadge({ status }) {
  return (
    <span className={getEscrowBadgeClass(status)}>
      {ESCROW_STATUS_LABEL[status] || "Unknown"}
    </span>
  );
}

export function MilestoneStatusBadge({ status }) {
  return (
    <span className={getMilestoneBadgeClass(status)}>
      {MILESTONE_STATUS_LABEL[status] || "Unknown"}
    </span>
  );
}

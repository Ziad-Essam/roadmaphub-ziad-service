// The public roadmap has exactly four statuses (four board columns).
// "Merged" is NOT a status: a merged request leaves the board and points to its canonical request.
const STATUSES = ['under_review', 'planned', 'in_progress', 'shipped'];

const LABELS = { declined: 'Declined', under_review: 'Under Review', planned: 'Planned', in_progress: 'In Progress', shipped: 'Shipped' };

// Allowed moves (admin only). Anything else -> 409 INVALID_TRANSITION.
const TRANSITIONS = {
  under_review: ['planned', 'declined'],
  planned: ['in_progress', 'under_review'],
  in_progress: ['shipped', 'planned'],
  shipped: [] // released: final
};

function canMove(currentStatus, nextStatus) {
  const allowedStatuses = TRANSITIONS[currentStatus] || [];
  return allowedStatuses.includes(nextStatus);
}

module.exports = { STATUSES, LABELS, TRANSITIONS, canMove };

/**
 * Flag reasons, mirrored from server/src/models/orgFlags.js.
 *
 * Duplicated rather than fetched from /api/meta because the picker has to render
 * as soon as a card does, and a failed flag must still be submittable.
 */
export const FLAG_REASON_LABELS = {
  wrong_number: 'Wrong number',
  permanently_closed: 'Permanently closed',
  other: 'Something else',
};

export const FLAG_REASONS = Object.keys(FLAG_REASON_LABELS);

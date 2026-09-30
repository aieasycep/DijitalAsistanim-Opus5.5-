/** Sheet keys of the approval surfaces (M-APPR-04 inline sheet, M-APPR-05 typed editor). */
export const APPROVAL_SHEET = 'approval_sheet';
export const APPROVAL_EDITOR_SHEET = 'approval_editor';

export interface ApprovalEditorParams {
  readonly approvalId: string;
  /** `edit` patches the pending approval; `repropose` creates a new one from a failed approval. */
  readonly mode: 'edit' | 'repropose';
}

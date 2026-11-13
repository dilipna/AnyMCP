// Approval binding. An approval is valid for ONE execution of ONE tool version,
// against ONE resolved target with ONE set of arguments and ONE set of visible page values.
// Change any of them and the hash differs, so the approval no longer applies.

import { hashCanonical } from "./canonical";

export interface ApprovalBindingInput {
  executionId: string;
  toolId: string;
  toolVersion: number;
  definitionHash: string;
  origin: string;
  /** Fingerprint of the exact element that will be clicked (role, name, tag, ordinal among same-role siblings). */
  targetFingerprint: string;
  args: Record<string, unknown>;
  /** The declared page values (approval.stateFields), as read from the live page. */
  state: Record<string, string>;
}

export function computeBindingHash(input: ApprovalBindingInput): Promise<string> {
  return hashCanonical({ v: 1, ...input });
}

export interface ApprovalRequest {
  executionId: string;
  toolId: string;
  toolTitle: string;
  toolVersion: number;
  origin: string;
  /** Exact action text, rendered by code from the reviewed template + the run's arguments. */
  actionText: string;
  args: Record<string, unknown>;
  /** Page values bound into the approval, shown to the user. */
  state: { id: string; label: string; value: string }[];
  bindingHash: string;
  requestedAt: string;
  expiresAt: string;
}

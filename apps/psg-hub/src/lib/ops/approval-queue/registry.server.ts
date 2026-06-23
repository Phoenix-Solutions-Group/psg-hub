// PSG-248 — server publisher registry for the generic approval queue (PSG-245).
//
// The pure gate (./gate.ts) ships an EMPTY defaultPublishers registry: with no
// publisher for an action_type, approve records the decision and stops. This
// server-only module is where the autonomy capabilities (G-a/b/c/…) register the
// real publishers that actually act on approve. The approve route passes
// `serverPublishers` to approveApproval so a queued action publishes through its
// registered publisher.
//
// Today it wires the review_solicitation publisher (G-c). Future capabilities add
// their action_type → publisher entry here; the route stays generic.

import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
import { defaultPublishers, type PublisherRegistry } from "./gate";
import { createSolicitationPublisher } from "../solicitation/publisher";
import { supabaseSolicitationStore } from "../solicitation/store";
import { SOLICITATION_ACTION_TYPE } from "../solicitation/types";

/**
 * Build the live server publisher registry (lazy — constructs the service client
 * only when a publish actually runs, not at import). Starts from the gate's
 * defaults so an action_type with no registered publisher still behaves correctly.
 */
export function buildServerPublishers(): PublisherRegistry {
  const store = supabaseSolicitationStore(createServiceClient());
  return {
    ...defaultPublishers,
    [SOLICITATION_ACTION_TYPE]: createSolicitationPublisher({ store }),
  };
}

// PSG-245 / Wave 2 (G-d) — generic agent→approve→publish approval queue.
// Pure gate (state machine + orchestration + publisher contract) in ./gate.ts;
// server-only supabase store in ./store.ts.
export * from "./gate";
export { supabaseApprovalQueueStore } from "./store";

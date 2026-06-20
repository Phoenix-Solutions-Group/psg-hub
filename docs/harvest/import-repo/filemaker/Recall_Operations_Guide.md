# Recall Operations Guide

## When to Recall

Use the recall script when:
- **Bad data imported:** Wrong file uploaded, wrong shop assigned, corrupted source data
- **Duplicate batch:** Same file imported twice by mistake (different batch IDs but same data)
- **Post-import review:** User discovers issues while reviewing in FileMaker
- **Testing cleanup:** Remove test batches from local or production environment

## How to Trigger a Recall

### Option A: Via Data API (recommended for automation)

**Step 1: Authenticate**
```bash
# Get session token
curl -X POST https://YOUR_SERVER/fmi/data/v1/databases/PhoenixSolutions_Advantage_06.1/sessions \
  -H "Content-Type: application/json" \
  -H "Authorization: Basic $(echo -n 'psg:YOUR_PASSWORD' | base64)" \
  -d '{}'
```
Save the token from the response.

**Step 2: Run the recall script**
```bash
# Trigger recall for a specific batch
curl -X GET "https://YOUR_SERVER/fmi/data/v1/databases/PhoenixSolutions_Advantage_06.1/layouts/API_Import_Staging/script/API%20-%20Recall%20Import%20Batch?script.param=BATCH-0001" \
  -H "Authorization: Bearer SESSION_TOKEN"
```

The response includes the script result:
```json
{
  "response": {
    "scriptResult": "Recall complete. Batch: BATCH-0001 | RC deleted: 5 | Staging updated: 5",
    "scriptError": "0"
  }
}
```

**Step 3: Log out**
```bash
curl -X DELETE https://YOUR_SERVER/fmi/data/v1/databases/PhoenixSolutions_Advantage_06.1/sessions/SESSION_TOKEN
```

### Option B: From FileMaker directly

1. Open PhoenixSolutions_Advantage_06.1.fmp12
2. Open Script Workspace (Ctrl+Shift+S / Cmd+Shift+S)
3. Find "API - Recall Import Batch"
4. Click the gear icon or right-click > "Run Script"
5. Enter the batch ID as the script parameter: `BATCH-0001`
6. Check the script result in Data Viewer (or the result dialog)

## How to Verify Recall Completed

### Verify RC records are gone

```bash
# Search for RC records with the recalled batch ID — should return 0
curl -X POST https://YOUR_SERVER/fmi/data/v1/databases/PhoenixSolutions_Advantage_06.1/layouts/API_RC_Write/_find \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer SESSION_TOKEN" \
  -d '{"query": [{"RC_ImportBatchID": "BATCH-0001"}]}'
```

Expected: Error 401 (no records found) or empty result set.

### Verify staging records are marked "Recalled"

```bash
# Search for staging records with the recalled batch ID
curl -X POST https://YOUR_SERVER/fmi/data/v1/databases/PhoenixSolutions_Advantage_06.1/layouts/API_Import_Staging/_find \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer SESSION_TOKEN" \
  -d '{"query": [{"IS_BatchID": "BATCH-0001"}]}'
```

Expected: All records have IS_Status = "Recalled" and IS_ErrorMessage contains the recall timestamp and delete count.

## Audit Trail

Staging records are **never deleted**. After a recall:

| Field | Before Recall | After Recall |
|-------|--------------|--------------|
| IS_Status | Complete | Recalled |
| IS_ErrorMessage | RC_SerialNum: 12345 | Recalled at 04/12/2026 1:45:00 PM \| 5 RC records deleted |
| IS_ProcessedTimestamp | (original processing time) | (recall timestamp) |
| IS_RawPayload | {original JSON} | {original JSON} (unchanged) |
| IS_BatchID | BATCH-0001 | BATCH-0001 (unchanged) |

This means:
- Every import attempt is permanently traceable
- You can see what data was in the original payload (IS_RawPayload)
- You can see when it was first processed and when it was recalled
- You can re-import the same data by POSTing it again with a new batch ID

## Re-Import After Recall

If you need to re-import the data after fixing the source issue:

1. Fix the source data in the browser utility
2. Re-process and send with a **new batch ID** (e.g., BATCH-0002)
3. The original staging records stay with IS_Status = "Recalled"
4. New staging records are created with the new batch ID
5. New RC records are created with RC_ImportBatchID = "BATCH-0002"

Do NOT reuse the old batch ID. Each import attempt gets a unique sequential batch ID.

## Testing Procedure (Local)

### Test 1: Recall a valid batch

1. Create 3 test staging records via curl with IS_BatchID = "BATCH-TEST-001"
2. Run the processing script to create RC records
3. Verify 3 RC records exist with RC_ImportBatchID = "BATCH-TEST-001"
4. Run the recall script with parameter "BATCH-TEST-001"
5. Verify:
   - [ ] Script result says "RC deleted: 3 | Staging updated: 3"
   - [ ] No RC records found with RC_ImportBatchID = "BATCH-TEST-001"
   - [ ] All 3 staging records have IS_Status = "Recalled"
   - [ ] IS_ErrorMessage contains recall timestamp and "3 RC records deleted"

### Test 2: Recall a non-existent batch

1. Run the recall script with parameter "BATCH-DOES-NOT-EXIST"
2. Verify:
   - [ ] Script result says "No RC records found for batch BATCH-DOES-NOT-EXIST"
   - [ ] No records were deleted or modified anywhere

### Test 3: Recall with mixed staging statuses

1. Create 5 staging records with IS_BatchID = "BATCH-TEST-002"
2. Run the processing script (some may become Complete, some Duplicate)
3. Run the recall script with parameter "BATCH-TEST-002"
4. Verify:
   - [ ] Only RC records are deleted (not staging records)
   - [ ] ALL staging records for the batch get IS_Status = "Recalled" (including ones that were "Duplicate")
   - [ ] Staging records that were "Duplicate" now show "Recalled" with the recall message

### Test 4: Verify audit trail preservation

1. After Test 1 recall, check the staging records
2. Verify:
   - [ ] Staging records still exist (not deleted)
   - [ ] IS_RawPayload still contains the original JSON
   - [ ] IS_ReceivedDate and IS_ReceivedTimestamp are unchanged
   - [ ] IS_BatchID is unchanged
   - [ ] Only IS_Status, IS_ErrorMessage, and IS_ProcessedTimestamp were modified

### Test 5: Re-import after recall

1. After Test 1 recall, POST the same test data again with IS_BatchID = "BATCH-TEST-003"
2. Run the processing script
3. Verify:
   - [ ] New staging records created with IS_BatchID = "BATCH-TEST-003"
   - [ ] New RC records created with RC_ImportBatchID = "BATCH-TEST-003"
   - [ ] Original recalled staging records (BATCH-TEST-001) are unchanged
   - [ ] No duplicate detection triggered against the recalled batch (those RC records are gone)

## Important Warnings

- **Recall is permanent.** Deleted RC records cannot be recovered from FileMaker. The original data is preserved in IS_RawPayload for re-import if needed.
- **Always verify the batch ID** before triggering recall. There is no "undo recall."
- **Recall only affects the specified batch.** Other batches and non-API records are never touched.
- **Pre-API records are safe.** Records imported before the API system have empty RC_ImportBatchID. The recall script's parameter validation rejects empty strings, so these records can never be accidentally recalled.
- **Recall during active processing:** If the processing script is currently creating records for the batch you're recalling, the recall may miss records created after the recall's Find step. Wait for processing to complete before recalling.

## Script Result Reference

| Result | Meaning |
|--------|---------|
| "Recall complete. Batch: X \| RC deleted: N \| Staging updated: M" | Success. N records removed, M staging records marked. |
| "Recall complete with warning. ... Staging records: 0" | RC records deleted but no staging records found for this batch. Unusual but not an error. |
| "No RC records found for batch X. Nothing to recall." | Batch ID not found or already recalled. No action taken. |
| "Error: No batch ID provided." | Script called without a parameter. No action taken. |
| "Error: Invalid batch ID format." | Parameter doesn't start with "BATCH-". No action taken. |
| "Error: Delete failed. FM Error: N" | FileMaker error during deletion. Staging NOT updated. Investigate. |

---
*Operations guide for FileMaker batch recall*
*Depends on: API_Recall_Batch_Script.md, Import_Staging_Schema.md, RC_ImportBatchID_Field.md*

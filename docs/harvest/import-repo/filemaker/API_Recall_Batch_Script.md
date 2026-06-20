# Script: API - Recall Import Batch

## Script Configuration

| Setting | Value |
|---------|-------|
| Script Name | API - Recall Import Batch |
| Run with Full Access Privileges | Yes |
| Script Parameter | Batch ID (e.g., "BATCH-0001") |
| Callable Via | Script Workspace (manual), Perform Script on Server, Data API |
| Access | Any user with FM access (no additional privilege required) |

## Script Steps

```
// ═══════════════════════════════════════════════════════════
// API - Recall Import Batch
// ═══════════════════════════════════════════════════════════
// Purpose: Completely removes all Repair Customer records
// created by a specific import batch, and marks the
// corresponding Import_Staging records as "Recalled".
//
// This is the safety net for bad imports. Provide a batch ID,
// and everything that batch created is undone. The staging
// records stay for audit — they are never deleted.
//
// Parameter: Batch ID string (e.g., "BATCH-0001")
// Returns: Result string describing what happened
// ═══════════════════════════════════════════════════════════

Set Error Capture [On]

// ═══════════════════════════════════════════════════════════
// STEP 1: VALIDATE PARAMETER
// ═══════════════════════════════════════════════════════════
// WHY this runs first: If someone triggers the script without
// a batch ID (empty parameter), we must exit immediately.
// Without this check, an empty Find on RC_ImportBatchID could
// match records with empty batch IDs (pre-API records), causing
// catastrophic unintended deletion of non-API records.
// ═══════════════════════════════════════════════════════════

Set Variable [$batchID; Value: Get(ScriptParameter)]

If [IsEmpty($batchID)]
  Exit Script [Result: "Error: No batch ID provided. Usage: pass batch ID as script parameter (e.g., BATCH-0001)"]
End If

// Validate format — batch ID should start with "BATCH-"
If [Left($batchID; 6) ≠ "BATCH-"]
  Exit Script [Result: "Error: Invalid batch ID format. Expected BATCH-NNNN, got: " & $batchID]
End If

// ═══════════════════════════════════════════════════════════
// STEP 2: FIND RC RECORDS FOR THIS BATCH
// ═══════════════════════════════════════════════════════════
// WHY we Find before Delete: Safety. We need to confirm that
// records actually exist for this batch ID before deleting
// anything. This also gives us the count for the audit trail.
// If no records are found, we exit cleanly without touching
// the database.
// ═══════════════════════════════════════════════════════════

Go to Layout ["API_RC_Write" (Repair Customer)]
Enter Find Mode []
Set Field [Repair Customer::RC_ImportBatchID; $batchID]
Perform Find []

Set Variable [$findError; Value: Get(LastError)]
Set Variable [$rcCount;   Value: Get(FoundCount)]

If [$findError ≠ 0 or $rcCount = 0]
  // No RC records found for this batch ID.
  // This could mean:
  //   - Batch ID doesn't exist
  //   - Batch was already recalled
  //   - Processing hasn't run yet (records still in staging)
  // Exit cleanly without deleting anything.
  Exit Script [Result: "No RC records found for batch " & $batchID & ". Nothing to recall."]
End If

// ═══════════════════════════════════════════════════════════
// STEP 3: DELETE ALL RC RECORDS IN THE FOUND SET
// ═══════════════════════════════════════════════════════════
// WHY Delete All Records (not a loop): We already have exactly
// the right found set from the Find in Step 2. Delete All Records
// removes every record in the current found set in a single
// atomic operation. This is:
//   - Faster than looping (one operation vs N operations)
//   - Safer: if it fails, no records are deleted (atomic)
//   - Simpler: no loop counter or exit-after-last logic
//
// "No dialog" prevents the confirmation popup when running on server.
// ═══════════════════════════════════════════════════════════

Delete All Records [No dialog]

Set Variable [$deleteError; Value: Get(LastError)]

If [$deleteError ≠ 0]
  // Delete failed. Do NOT update staging records.
  // WHY: If RC records weren't actually deleted, marking staging
  // as "Recalled" would create a false audit trail — staging says
  // recalled but RC records still exist.
  Exit Script [Result: "Error: Delete failed. FM Error: " & $deleteError & " | Batch: " & $batchID & " | RC records NOT deleted. Staging NOT updated."]
End If

// ═══════════════════════════════════════════════════════════
// STEP 4: UPDATE STAGING RECORDS TO "RECALLED"
// ═══════════════════════════════════════════════════════════
// WHY this runs AFTER RC deletion (not before): The staging
// update is the audit record of what happened. If we updated
// staging first and the RC delete then failed, the audit trail
// would be wrong — it would say "recalled" but records would
// still exist. By updating staging only after confirmed deletion,
// the audit trail is always accurate.
//
// Staging records are NEVER deleted. They stay permanently as
// the audit trail for every import attempt, successful or recalled.
// ═══════════════════════════════════════════════════════════

Go to Layout ["API_Import_Staging" (Import_Staging)]
Enter Find Mode []
Set Field [Import_Staging::IS_BatchID; $batchID]
Perform Find []

Set Variable [$stagingError; Value: Get(LastError)]
Set Variable [$stagingCount; Value: 0]

If [$stagingError = 0 and Get(FoundCount) > 0]
  Set Variable [$stagingCount; Value: Get(FoundCount)]
  Go to Record/Request/Page [First]
  Loop
    Set Field [Import_Staging::IS_Status;             "Recalled"]
    Set Field [Import_Staging::IS_ErrorMessage;       "Recalled at " & Get(CurrentTimestamp) & " | " & $rcCount & " RC records deleted"]
    Set Field [Import_Staging::IS_ProcessedTimestamp;  Get(CurrentTimestamp)]
    Commit Records/Requests [No dialog]
    Go to Record/Request/Page [Next; Exit after last]
  End Loop
End If

// Note: If no staging records are found for this batch ID, that's
// unusual but not an error. RC records may have been created by a
// source other than the staging pipeline. The RC deletion still
// succeeded, so we report success with a warning.

// ═══════════════════════════════════════════════════════════
// STEP 5: RETURN RESULT
// ═══════════════════════════════════════════════════════════
// WHY the script returns a result string: When triggered via
// the Data API, the caller receives this string in the response.
// This lets the browser utility or monitoring tools confirm
// the recall completed without querying staging separately.
// ═══════════════════════════════════════════════════════════

If [$stagingCount = 0]
  Exit Script [Result: "Recall complete with warning. Batch: " & $batchID & " | RC deleted: " & $rcCount & " | Staging records: 0 (no staging records found for this batch — RC records may have been created outside staging pipeline)"]
Else
  Exit Script [Result: "Recall complete. Batch: " & $batchID & " | RC deleted: " & $rcCount & " | Staging updated: " & $stagingCount]
End If
```

## Script Flow Summary

```
START
  │
  ├─ Validate parameter
  │   ├─ Empty → EXIT "No batch ID provided"
  │   └─ Invalid format → EXIT "Invalid batch ID format"
  │
  ├─ Find RC records (RC_ImportBatchID = $batchID)
  │   └─ None found → EXIT "No RC records found"
  │
  ├─ Delete All Records [No dialog]
  │   └─ Error → EXIT "Delete failed" (staging NOT updated)
  │
  ├─ Find staging records (IS_BatchID = $batchID)
  │   ├─ Found → Loop: set IS_Status = "Recalled", update message
  │   └─ Not found → Warning in result (not a failure)
  │
  └─ EXIT with result string
```

## Variable Reference

| Variable | Source | Purpose |
|----------|--------|---------|
| $batchID | Get(ScriptParameter) | The batch to recall |
| $findError | Get(LastError) after RC Find | Detect no-records-found |
| $rcCount | Get(FoundCount) after RC Find | Count of RC records to delete (used in audit message) |
| $deleteError | Get(LastError) after Delete All | Detect delete failure |
| $stagingError | Get(LastError) after staging Find | Detect no staging records |
| $stagingCount | Get(FoundCount) after staging Find | Count of staging records updated |

## Safety Guarantees

| Concern | How Addressed |
|---------|---------------|
| Empty parameter deletes wrong records | Parameter validation exits immediately if empty |
| Invalid batch ID format | Format check requires "BATCH-" prefix |
| Batch doesn't exist | Find returns 0, script exits without deleting |
| Delete fails mid-operation | Delete All Records is atomic — all or nothing |
| Staging shows "Recalled" but RC still exists | Staging updated only AFTER confirmed RC deletion |
| Audit trail lost | Staging records are never deleted, only status-updated |
| Pre-API records accidentally deleted | Pre-API records have empty RC_ImportBatchID; parameter validation rejects empty strings |

---
*Script reference for FileMaker implementation*
*Depends on: Import_Staging_Schema.md (IS_BatchID, IS_Status), RC_ImportBatchID_Field.md, API_RC_Write_Layout.md*

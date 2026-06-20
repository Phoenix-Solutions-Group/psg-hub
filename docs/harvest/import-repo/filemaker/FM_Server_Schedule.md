# FileMaker Server Schedule: API Import Processor

## Schedule Configuration

| Setting | Value |
|---------|-------|
| Name | API Import Processor |
| Script | API - Process Import Staging |
| File | PhoenixSolutions_Advantage_06.1.fmp12 |
| Account | psg (Full Access) |
| Frequency | Every 5 minutes |
| Run as | Perform Script on Server (PSoS) |
| Start Time | 00:00 |
| End Time | 23:59 (runs 24/7) |
| Enable | On |

## Setup Instructions

### Step 1: Open FileMaker Server Admin Console
- Navigate to https://localhost:16000 (local) or https://YOUR_PRODUCTION_SERVER:16000 (production)
- Log in with admin credentials

### Step 2: Create the Schedule
1. Go to **Schedules** in the left sidebar
2. Click **Create Schedule** (or **+** button)
3. Select **FileMaker Script**
4. Configure:
   - **Schedule Name:** API Import Processor
   - **Database:** PhoenixSolutions_Advantage_06.1
   - **Script:** API - Process Import Staging
   - **Account Name:** psg
   - **Account Password:** (enter the psg account password)
   - **Repeat:** Every 5 minutes
   - **Start Date:** Today
   - **End Date:** No end date
   - **Start Time:** 12:00 AM
   - **End Time:** 11:59 PM
5. Click **Save**
6. Ensure the schedule shows **Enabled** status

### Step 3: Verify the Schedule
- Check the **Last Run** column in the Schedules list
- After 5 minutes, confirm "Last Run" shows a recent timestamp
- Check the **Result** column shows "OK"
- If Result shows an error, check the FileMaker Server Event Log

## Monitoring

### Daily Health Check

Run these Data API queries to check for any records that need attention:

**Check for Error records:**
```bash
curl -X POST https://YOUR_SERVER/fmi/data/v1/databases/PhoenixSolutions_Advantage_06.1/layouts/API_Import_Staging/_find \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer SESSION_TOKEN" \
  -d '{"query": [{"IS_Status": "Error"}]}'
```

**Check for records stuck in Review Required:**
```bash
curl -X POST https://YOUR_SERVER/fmi/data/v1/databases/PhoenixSolutions_Advantage_06.1/layouts/API_Import_Staging/_find \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer SESSION_TOKEN" \
  -d '{"query": [{"IS_Status": "Duplicate - Multiple Match"}]}'
```

**Check for stale Processing records (should be zero if recovery preamble is working):**
```bash
curl -X POST https://YOUR_SERVER/fmi/data/v1/databases/PhoenixSolutions_Advantage_06.1/layouts/API_Import_Staging/_find \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer SESSION_TOKEN" \
  -d '{"query": [{"IS_Status": "Processing"}]}'
```

### Alert Conditions

| Condition | Severity | Action |
|-----------|----------|--------|
| Any "Error" status records | High | Check IS_ErrorMessage for FM error code, fix root cause |
| "Processing" records older than 30 minutes | High | Recovery preamble should have caught these. Check if schedule is running. |
| "Pending" records accumulating (>50 unprocessed) | Medium | Schedule may have stopped. Check FM Server Admin Console. |
| "Duplicate - Multiple Match" records | Low | Expected behavior. Review periodically for data quality. |

## Recovery Scenarios

| Scenario | Symptom | How Detected | Resolution |
|----------|---------|--------------|------------|
| Server crash mid-processing | IS_Status = "Processing" on records older than 10 min | Monitoring query or recovery preamble auto-detects | **Automatic:** Recovery preamble in script resets stale records to "Pending" on next run. No manual action needed. |
| Schedule stops running | "Pending" records accumulate without being processed | Monitoring query shows growing "Pending" count | **Manual:** Open FM Server Admin Console > Schedules. Check if "API Import Processor" is enabled and "Last Run" is recent. Re-enable or recreate if needed. |
| Script errors repeatedly | Multiple "Error" status records with same FM error code | Monitoring query for "Error" status | **Manual:** Read IS_ErrorMessage for the FM error code. Common causes: field validation failure, privilege issue, layout missing. Fix root cause, then reset affected records to "Pending" for re-processing. |
| Double-processing | Same staging record processed twice, creating duplicate RC records | Two RC records with same RC_ImportBatchID and matching data | **Prevented by design:** IS_Status = "Processing" lock + immediate Commit before switching context. If it somehow occurs, use recall script (06-03) to remove the batch and re-process. |
| psg account password changed | Schedule fails with auth error | FM Server Event Log shows authentication failure | **Manual:** Update the schedule with the new password in FM Server Admin Console > Schedules > Edit. |
| Database file closed | Schedule cannot run script | FM Server Event Log shows file not available | **Manual:** Reopen PhoenixSolutions_Advantage_06.1.fmp12 in FM Server Admin Console > Databases. |

### Manual Recovery: Resetting Error Records

If records are stuck in "Error" and the root cause has been fixed:

```bash
# Find all Error records
curl -X POST https://YOUR_SERVER/fmi/data/v1/databases/PhoenixSolutions_Advantage_06.1/layouts/API_Import_Staging/_find \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer SESSION_TOKEN" \
  -d '{"query": [{"IS_Status": "Error"}]}'

# For each record, reset to Pending (replace RECORD_ID with actual recordId)
curl -X PATCH https://YOUR_SERVER/fmi/data/v1/databases/PhoenixSolutions_Advantage_06.1/layouts/API_Import_Staging/records/RECORD_ID \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer SESSION_TOKEN" \
  -d '{"fieldData": {"IS_Status": "Pending", "IS_ErrorMessage": "Reset for re-processing after fix"}}'
```

## Local Testing Procedure

Run these tests against your local FileMaker Server before deploying to production.

### Test 1: Clean new record (happy path)

1. Create a test staging record via curl (use the example from FM_Setup_Checklist.md)
2. Open FileMaker Script Workspace
3. Run "API - Process Import Staging" manually (not via schedule)
4. Verify:
   - [ ] Staging record IS_Status changed from "Pending" to "Complete"
   - [ ] IS_ProcessedTimestamp is populated
   - [ ] IS_ErrorMessage contains "RC_SerialNum: {number}"
   - [ ] New Repair Customer record exists with matching field values
   - [ ] RC_ImportBatchID = "BATCH-0001" (matches IS_BatchID)
   - [ ] RC_Input_Style = "API"
   - [ ] RC_Input_ByFlushDB = "API"
   - [ ] RC_SerialNum is not empty (serial auto-generated)
   - [ ] RC_Sex is populated (from RC_Cust_Mr_Ms auto-calc)
   - [ ] RC_Phone1 is formatted (PhoneFilter auto-calc)

### Test 2: Exact duplicate (Pass 1)

1. POST the same staging record again (same date_in, date_out, vehicle_model, shop_id) with IS_BatchID = "BATCH-0002"
2. Run the script manually
3. Verify:
   - [ ] Staging record IS_Status = "Duplicate - Exact Match"
   - [ ] IS_ErrorMessage contains the original RC_SerialNum
   - [ ] No new Repair Customer record was created
   - [ ] The original RC record is unchanged

### Test 3: Repeat customer (Pass 2)

1. POST a NEW staging record with the same customer name and zip but DIFFERENT dates and vehicle
   - Same IS_Cust_First, IS_Cust_Last, IS_Cust_Zip
   - Different IS_Date_In, IS_Date_Out, IS_Vehicle_Model
   - IS_BatchID = "BATCH-0003"
2. Run the script manually
3. Verify:
   - [ ] Staging record IS_Status = "Complete" (not Duplicate — new repair event is valid)
   - [ ] IS_LinkedSerialNum contains the original RC_SerialNum
   - [ ] New RC record has RC_Repeat_Yes_No = "Yes"
   - [ ] New RC record has RC_ImportBatchID = "BATCH-0003"

### Test 4: RO duplicate (Pass 3)

1. POST a staging record with the same IS_RONumber and IS_Shop_ID as an existing record but different customer/dates
2. Run the script manually
3. Verify:
   - [ ] Staging record IS_Status = "Duplicate - RO Match"
   - [ ] IS_ErrorMessage contains the RO number and existing RC_SerialNum
   - [ ] No new Repair Customer record was created

### Test 5: Recovery preamble

1. Manually set a staging record's IS_Status to "Processing" (simulating a crash)
2. Wait 11 minutes (or temporarily change the 600-second threshold in the script to a shorter value for testing)
3. Run the script manually
4. Verify:
   - [ ] The stale record was reset to IS_Status = "Pending"
   - [ ] IS_ErrorMessage notes it was reset from Processing
   - [ ] The record is then processed normally in the same run

### Test 6: Error handling

1. Create a staging record with data that will cause a commit error (e.g., invalid date format if validation is on)
2. Run the script manually
3. Verify:
   - [ ] Staging record IS_Status = "Error"
   - [ ] IS_ErrorMessage contains the FM error code
   - [ ] IS_ProcessedTimestamp is populated
   - [ ] No orphaned Repair Customer record was created

### Test 7: Schedule execution

1. Create the server schedule per the configuration above
2. Create a test staging record via curl
3. Wait 5 minutes
4. Verify:
   - [ ] Record was processed without manual script execution
   - [ ] FM Server Admin Console shows successful schedule run

---
*Server schedule and operations reference for FileMaker implementation*
*Source: PRD_PSG_Advantage_RC_Import_API.md sections 4.6 and 7*

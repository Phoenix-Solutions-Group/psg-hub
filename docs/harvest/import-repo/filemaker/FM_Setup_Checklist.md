# FileMaker API Import Setup Checklist

## What "The API" Actually Is

There is no API to build or deploy. The FileMaker Data API is **built into FileMaker Server**. It's already there at `https://your-server/fmi/data/v1/`. You just need to:

1. **Enable it** in FileMaker Server Admin Console
2. **Grant access** by giving the `psg` account the `fmrest` privilege
3. **Create layouts** that the API will read/write through
4. **Create scripts** that run server-side to process the data

That's it. The "API" is the combination of: Data API enabled + layouts + fmrest privilege + the URL. External systems (the browser utility) POST JSON to the URL, and FileMaker creates records.

## Where Everything Goes

**Everything goes in PhoenixSolutions_Advantage_06.1.fmp12 (the Advantage database).**

Do NOT put anything in Import Flush.fmp12. The processing script needs direct table access to Repair Customer. If the Import_Staging table were in Import Flush, every Find against Repair Customer would be a cross-file operation (slower and more fragile).

| What | Where | Why |
|------|-------|-----|
| Import_Staging table | Advantage file | Direct access to Repair Customer table |
| RC_ImportBatchID field | Advantage file (Repair Customer table) | Same file as the table it belongs to |
| API_Import_Staging layout | Advantage file | Based on Import_Staging table |
| API_RC_Write layout | Advantage file | Based on Repair Customer table |
| Processing script | Advantage file | Needs both tables in same file |
| Recall script | Advantage file | Needs both tables in same file |
| Server schedule | FileMaker Server Admin Console | Runs the script on a timer |

## Environment Strategy

**Local first, then production.** Build and validate everything on a local FileMaker Server instance before deploying to the Hetzner cloud production server.

---

## Phase A: Pre-Flight Checks (before building anything)

Confirm all of the following before starting implementation:

- [ ] **psg account has fmrest extended privilege enabled**
  - FileMaker > File > Manage > Security > psg account > Privilege Set
  - The privilege set must have "Access via FileMaker Data API (fmrest)" checked
  - Note: There are multiple [Full Access] privilege sets across files. Confirm the one assigned to `psg` in the Advantage file specifically.

- [ ] **psg account password is set (not empty)**
  - The Data API rejects accounts with empty passwords
  - DDR shows empty_pw = False for psg, but confirm in the Advantage file

- [ ] **Identify which [Full Access] privilege set psg maps to**
  - FileMaker > File > Manage > Security > psg account > Privilege Set column
  - Record the privilege set name for documentation

- [ ] **RC_Duplicate_Key_glob is indexed**
  - FileMaker > File > Manage > Database > Repair Customer table > RC_Duplicate_Key_glob field
  - Field Options > Storage > Indexing: must be set to "All"
  - Critical: Without this index, Pass 1 duplicate Find on 281k records will be unacceptably slow
  - If not indexed, set to "All" and let FileMaker rebuild the index (may take a few minutes on 281k records)

- [ ] **Local FileMaker Server is available for dev/test**
  - Confirm FileMaker Server is running locally
  - Confirm you can access the Admin Console at https://localhost:16000
  - Confirm PhoenixSolutions_Advantage_06.1.fmp12 is hosted (or a dev copy of it)

- [ ] **Data API is enabled on FileMaker Server**
  - FileMaker Server Admin Console > Connectors > FM Data API: must be enabled
  - Test: `curl -s https://localhost/fmi/data/v1/productInfo` should return version info
  - Note: If using a self-signed certificate locally, add `-k` flag to curl commands

---

## Phase A: Local Implementation (dev/test)

Complete these steps in order on your local FileMaker Server:

### Step 1: Add RC_ImportBatchID to Repair Customer
- [ ] Open PhoenixSolutions_Advantage_06.1.fmp12 > File > Manage > Database
- [ ] Navigate to Repair Customer table
- [ ] Add field: RC_ImportBatchID, Type: Text
- [ ] Field Options: No auto-entry, Storage: Stored, Indexing: All
- [ ] Confirm: Existing records are unaffected (field is empty on all existing records)

### Step 2: Create Import_Staging table
- [ ] File > Manage > Database > Tables tab > New
- [ ] Table name: Import_Staging
- [ ] Add all 40 fields per Import_Staging_Schema.md
- [ ] Configure auto-entry settings:
  - IS_ID: Serial (next value: 1, increment: 1)
  - IS_Status: Constant Data = "Pending" (allow override during data entry: Yes)
  - IS_ReceivedDate: Creation Date
  - IS_ReceivedTimestamp: Creation Timestamp
- [ ] Configure indexes:
  - IS_ID: Unique, All
  - IS_Status: All
  - IS_BatchID: All

### Step 3: Create Import_Staging table occurrence
- [ ] File > Manage > Database > Relationships tab
- [ ] Add Import_Staging as a table occurrence (TO)
- [ ] No relationships needed -- processing script navigates by layout

### Step 4: Create API_Import_Staging layout
- [ ] Layouts > New Layout/Report
- [ ] Layout name: API_Import_Staging
- [ ] Show records from: Import_Staging
- [ ] Add all 40 Import_Staging fields to the layout
- [ ] Layout Setup: no script triggers
- [ ] Confirm: Layout is accessible via Data API

### Step 5: Create API_RC_Write layout
- [ ] Layouts > New Layout/Report
- [ ] Layout name: API_RC_Write
- [ ] Show records from: Repair Customer
- [ ] Add fields per API_RC_Write_Layout.md (31 writable + 7 readable = 38 fields)
- [ ] Do NOT include Summary or unstored Calculation fields
- [ ] Layout Setup: no script triggers

### Step 6: Create the processing script
- [ ] Scripts > Script Workspace (Cmd+Shift+S / Ctrl+Shift+S)
- [ ] New Script > name it: `API - Process Import Staging`
- [ ] Script Options: check "Run script with full access privileges"
- [ ] Build the script step-by-step from `API_Process_Import_Staging_Script.md`
  - The doc lists every script step in order (Set Error Capture, Go to Layout, Enter Find Mode, Set Variable, Set Field, etc.)
  - Copy each step into Script Workspace one at a time
  - Start with the Recovery Preamble section
  - Then the Find Pending Records section
  - Then the main Loop with all 3 duplicate passes
  - Then the Record Creation section (field write order matters -- follow Groups 1-8 exactly)
  - Then the Status Update section
- [ ] Save the script
- [ ] Test: Run manually from Script Workspace (create a test staging record first via curl)

### Step 7: Create the recall script
- [ ] Scripts > Script Workspace
- [ ] New Script > name it: `API - Recall Import Batch`
- [ ] Script Options: check "Run script with full access privileges"
- [ ] Build the script step-by-step from `API_Recall_Batch_Script.md`
  - Step 1: Parameter validation (Get(ScriptParameter), empty check, format check)
  - Step 2: Find RC records by RC_ImportBatchID
  - Step 3: Delete All Records [No dialog]
  - Step 4: Find and update staging records to "Recalled"
  - Step 5: Exit Script with result string
- [ ] Save the script
- [ ] Test: Run manually with script parameter "BATCH-0001" (after processing script has created test RC records)

### Step 8: Create the server schedule
- [ ] FileMaker Server Admin Console > Schedules > Create Schedule
- [ ] Type: FileMaker Script
- [ ] Name: API Import Processor
- [ ] Database: PhoenixSolutions_Advantage_06.1
- [ ] Script: API - Process Import Staging
- [ ] Account: psg (enter password)
- [ ] Repeat: Every 5 minutes
- [ ] Start: 12:00 AM, End: 11:59 PM
- [ ] Enable: On
- [ ] See `FM_Server_Schedule.md` for full configuration details

---

## Phase A: Local Validation

Run all tests against your local FileMaker Server.

### Test 1: Authenticate with Data API

```bash
# Get session token (use -k for self-signed certs locally)
curl -k -X POST https://localhost/fmi/data/v1/databases/PhoenixSolutions_Advantage_06.1/sessions \
  -H "Content-Type: application/json" \
  -H "Authorization: Basic $(echo -n 'psg:YOUR_PASSWORD' | base64)" \
  -d '{}'
```

Expected: `200 OK` with `{"response":{"token":"SESSION_TOKEN_HERE"}}`

### Test 2: POST a staging record

```bash
# Replace SESSION_TOKEN with token from Test 1
curl -k -X POST https://localhost/fmi/data/v1/databases/PhoenixSolutions_Advantage_06.1/layouts/API_Import_Staging/records \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer SESSION_TOKEN" \
  -d '{
    "fieldData": {
      "IS_Cust_First": "Test",
      "IS_Cust_Last": "User",
      "IS_Cust_Mr_Ms": "Mr.",
      "IS_Cust_Address1": "123 Test St",
      "IS_Cust_City": "Chicago",
      "IS_Cust_State": "IL",
      "IS_Cust_Zip": "60601",
      "IS_Phone1": "3125551234",
      "IS_EmailAddress": "test@example.com",
      "IS_RONumber": "RO-TEST-001",
      "IS_Date_In": "04/12/2026",
      "IS_Date_Out": "04/15/2026",
      "IS_Vehicle_Yr": "2023",
      "IS_Vehicle_Make": "Honda",
      "IS_Vehicle_Model": "Civic",
      "IS_Vehicle_Style": "Sedan",
      "IS_PayType": "Insurance",
      "IS_Shop_ID": "PS181",
      "IS_Source": "API",
      "IS_BatchID": "BATCH-0001",
      "IS_RawPayload": "{\"test\": true}"
    }
  }'
```

Expected: `200 OK` with `{"response":{"recordId":"1","modId":"0"}}`

### Test 3: Verify auto-entry fields

```bash
# Get the record we just created
curl -k -X GET https://localhost/fmi/data/v1/databases/PhoenixSolutions_Advantage_06.1/layouts/API_Import_Staging/records/1 \
  -H "Authorization: Bearer SESSION_TOKEN"
```

Verify in the response:
- [ ] IS_ID has serial value (e.g., "1")
- [ ] IS_Status = "Pending"
- [ ] IS_ReceivedDate is today's date
- [ ] IS_ReceivedTimestamp has current timestamp
- [ ] IS_BatchID = "BATCH-0001"
- [ ] All other fields match what was POSTed

### Test 4: Verify RC_ImportBatchID on API_RC_Write layout

```bash
# Query Repair Customer layout to confirm field exists
curl -k -X GET "https://localhost/fmi/data/v1/databases/PhoenixSolutions_Advantage_06.1/layouts/API_RC_Write/records?_limit=1" \
  -H "Authorization: Bearer SESSION_TOKEN"
```

Verify: Response includes `RC_ImportBatchID` in fieldData (value will be empty on existing records).

### Test 5: Log out

```bash
curl -k -X DELETE https://localhost/fmi/data/v1/databases/PhoenixSolutions_Advantage_06.1/sessions/SESSION_TOKEN
```

Expected: `200 OK`

### Validation Checklist (Local)

- [ ] Data API returns 200 on POST to API_Import_Staging
- [ ] Created record has IS_ID serial populated
- [ ] Created record has IS_ReceivedDate and IS_ReceivedTimestamp populated
- [ ] Created record has IS_Status = "Pending"
- [ ] IS_BatchID is writable and stores the value sent in the POST
- [ ] RC_ImportBatchID field is visible on API_RC_Write layout
- [ ] Existing Repair Customer records are unaffected (RC_ImportBatchID is empty)
- [ ] FileMaker Server schedule can be created (needed for 06-02)

---

## Phase B: Production Deployment (Hetzner cloud)

After local validation passes, apply the same changes to production.

### Pre-deployment

- [ ] Confirm production FileMaker Server URL: `https://YOUR_PRODUCTION_SERVER`
- [ ] Confirm Data API is enabled on production server
- [ ] Confirm psg account credentials on production
- [ ] Schedule a maintenance window (schema changes are non-destructive but should be coordinated)

### Deployment Steps

1. [ ] Add RC_ImportBatchID field to Repair Customer table (production)
2. [ ] Create Import_Staging table with all 40 fields (production)
3. [ ] Create Import_Staging table occurrence (production)
4. [ ] Create API_Import_Staging layout (production)
5. [ ] Create API_RC_Write layout (production)
6. [ ] Create "API - Process Import Staging" script (production) -- same as local, from API_Process_Import_Staging_Script.md
7. [ ] Create "API - Recall Import Batch" script (production) -- same as local, from API_Recall_Batch_Script.md
8. [ ] Create server schedule "API Import Processor" in FM Server Admin Console (production)

### Production Validation

Run the same curl tests as local, replacing `localhost` with the production server URL and removing the `-k` flag (production should have a valid SSL certificate):

```bash
# Production auth test
curl -X POST https://YOUR_PRODUCTION_SERVER/fmi/data/v1/databases/PhoenixSolutions_Advantage_06.1/sessions \
  -H "Content-Type: application/json" \
  -H "Authorization: Basic $(echo -n 'psg:YOUR_PASSWORD' | base64)" \
  -d '{}'
```

### Validation Checklist (Production)

- [ ] Data API returns 200 on POST to API_Import_Staging
- [ ] Created record has IS_ID serial populated
- [ ] Created record has IS_ReceivedDate and IS_ReceivedTimestamp populated
- [ ] Created record has IS_Status = "Pending"
- [ ] IS_BatchID is writable from external POST
- [ ] RC_ImportBatchID field is visible on API_RC_Write layout
- [ ] Existing Repair Customer records are unaffected
- [ ] FileMaker Server schedule can be created (for 06-02)
- [ ] Delete test staging records after validation

---

## Post-Deployment Notes

- The Import_Staging table will accumulate records over time. It serves as the audit log. Do not truncate it.
- The processing script (plan 06-02) and recall script (plan 06-03) depend on this schema being in place.
- The browser utility integration (plan 06-04) depends on knowing the production FM Server URL and the psg account credentials.

---
*Setup checklist for FileMaker API Import system*
*Source: PRD_PSG_Advantage_RC_Import_API.md*

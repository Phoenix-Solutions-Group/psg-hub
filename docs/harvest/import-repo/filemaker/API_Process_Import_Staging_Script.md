# Script: API - Process Import Staging

## Script Configuration

| Setting | Value |
|---------|-------|
| Script Name | API - Process Import Staging |
| Run with Full Access Privileges | Yes |
| Run on Server (PSoS) | Yes |
| File | PhoenixSolutions_Advantage_06.1.fmp12 |

## Script Steps

```
// ═══════════════════════════════════════════════════════════
// API - Process Import Staging
// ═══════════════════════════════════════════════════════════
// Purpose: Reads pending Import_Staging records, runs three-pass
// duplicate detection against Repair Customer, creates new RC
// records for clean imports, and stamps batch IDs for recall.
//
// Called by: FileMaker Server Schedule (every 5 minutes, PSoS)
// Layouts used: API_Import_Staging, API_RC_Write
// ═══════════════════════════════════════════════════════════

Set Error Capture [On]

// ═══════════════════════════════════════════════════════════
// RECOVERY PREAMBLE
// ═══════════════════════════════════════════════════════════
// WHY: If the server crashes or the script is killed mid-run,
// records will be left with IS_Status = "Processing" forever.
// This preamble finds any such records older than 10 minutes
// and resets them to "Pending" so they get re-processed.
// This runs BEFORE the main processing loop every time.
// ═══════════════════════════════════════════════════════════

Go to Layout ["API_Import_Staging" (Import_Staging)]
Enter Find Mode []
Set Field [Import_Staging::IS_Status; "Processing"]
Perform Find []

If [Get(LastError) = 0 and Get(FoundCount) > 0]
  // Found "Processing" records — check if any are stale (>10 min old)
  Go to Record/Request/Page [First]
  Loop
    // 600 seconds = 10 minutes
    If [Get(CurrentTimestamp) - Import_Staging::IS_ReceivedTimestamp > 600]
      // Stale record — reset to Pending for re-processing
      Set Field [Import_Staging::IS_Status; "Pending"]
      Set Field [Import_Staging::IS_ErrorMessage; "Reset from Processing (stale >10min) at " & Get(CurrentTimestamp)]
      Commit Records/Requests [No dialog]
    End If
    Go to Record/Request/Page [Next; Exit after last]
  End Loop
End If

// ═══════════════════════════════════════════════════════════
// FIND PENDING RECORDS
// ═══════════════════════════════════════════════════════════

Go to Layout ["API_Import_Staging" (Import_Staging)]
Show All Records
Enter Find Mode []
Set Field [Import_Staging::IS_Status; "Pending"]
Perform Find []

If [Get(LastError) ≠ 0 or Get(FoundCount) = 0]
  // No pending records — nothing to process
  Exit Script []
End If

Set Variable [$totalFound; Value: Get(FoundCount)]
Go to Record/Request/Page [First]

// ═══════════════════════════════════════════════════════════
// MAIN PROCESSING LOOP
// ═══════════════════════════════════════════════════════════

Loop

  // ─────────────────────────────────────────────────────────
  // CAPTURE STAGING VALUES INTO VARIABLES
  // ─────────────────────────────────────────────────────────
  // WHY: We must capture ALL values before switching layout
  // context to Repair Customer. Once we leave the staging
  // layout, we lose access to these field values.
  // ─────────────────────────────────────────────────────────

  Set Variable [$stagingID;    Value: Import_Staging::IS_ID]
  Set Variable [$batchID;      Value: Import_Staging::IS_BatchID]
  Set Variable [$first;        Value: Import_Staging::IS_Cust_First]
  Set Variable [$last;         Value: Import_Staging::IS_Cust_Last]
  Set Variable [$middle;       Value: Import_Staging::IS_Cust_Middle]
  Set Variable [$mrMs;         Value: Import_Staging::IS_Cust_Mr_Ms]
  Set Variable [$suffix;       Value: Import_Staging::IS_Cust_Suffix]
  Set Variable [$addr1;        Value: Import_Staging::IS_Cust_Address1]
  Set Variable [$addr2;        Value: Import_Staging::IS_Cust_Address2]
  Set Variable [$city;         Value: Import_Staging::IS_Cust_City]
  Set Variable [$state;        Value: Import_Staging::IS_Cust_State]
  Set Variable [$zip;          Value: Import_Staging::IS_Cust_Zip]
  Set Variable [$email;        Value: Import_Staging::IS_EmailAddress]
  Set Variable [$phone1;       Value: Import_Staging::IS_Phone1]
  Set Variable [$phone2;       Value: Import_Staging::IS_Phone2]
  Set Variable [$phone3;       Value: Import_Staging::IS_Phone3]
  Set Variable [$birthdate;    Value: Import_Staging::IS_Birthdate]
  Set Variable [$roNumber;     Value: Import_Staging::IS_RONumber]
  Set Variable [$dateIn;       Value: Import_Staging::IS_Date_In]
  Set Variable [$dateOut;      Value: Import_Staging::IS_Date_Out]
  Set Variable [$vehicleYr;    Value: Import_Staging::IS_Vehicle_Yr]
  Set Variable [$vehicleMake;  Value: Import_Staging::IS_Vehicle_Make]
  Set Variable [$vehicleModel; Value: Import_Staging::IS_Vehicle_Model]
  Set Variable [$vehicleStyle; Value: Import_Staging::IS_Vehicle_Style]
  Set Variable [$claimNum;     Value: Import_Staging::IS_ClaimNum]
  Set Variable [$payType;      Value: Import_Staging::IS_PayType]
  Set Variable [$shopID;       Value: Import_Staging::IS_Shop_ID]
  Set Variable [$matchIns;     Value: Import_Staging::IS_MatchField_Insurance]
  Set Variable [$matchAgent;   Value: Import_Staging::IS_MatchField_Agent]
  Set Variable [$corpName;     Value: Import_Staging::IS_CorporateName]
  Set Variable [$corpYes;      Value: Import_Staging::IS_CorporateName_yes]
  Set Variable [$notes;        Value: Import_Staging::IS_Notes]

  // Initialize linked serial (populated by Pass 2 if repeat customer found)
  Set Variable [$linkedSerial; Value: ""]

  // ─────────────────────────────────────────────────────────
  // LOCK STAGING RECORD
  // ─────────────────────────────────────────────────────────
  // WHY: Setting IS_Status to "Processing" immediately prevents
  // another schedule run from picking up the same record. The
  // commit must happen BEFORE switching layout context.
  // ─────────────────────────────────────────────────────────

  Set Field [Import_Staging::IS_Status; "Processing"]
  Commit Records/Requests [No dialog]

  // ═════════════════════════════════════════════════════════
  // PASS 1: EXACT REPAIR EVENT DUPLICATE CHECK
  // ═════════════════════════════════════════════════════════
  // Uses RC_Duplicate_Key_glob (indexed auto-entry text field)
  // which stores: DateIn & DateOut & VehicleModel & Shop
  //
  // WHY this field and not RC_Duplicate_Key: RC_Duplicate_Key
  // is an unstored calculation, so it cannot be indexed and
  // a Find against 281k records would be unacceptably slow.
  // RC_Duplicate_Key_glob stores the same value as indexed text.
  // ═════════════════════════════════════════════════════════

  Set Variable [$dupKey; Value: $dateIn & "" & $dateOut & "" & $vehicleModel & "" & $shopID]

  Go to Layout ["API_RC_Write" (Repair Customer)]
  Enter Find Mode []
  Set Field [Repair Customer::RC_Duplicate_Key_glob; $dupKey]
  Perform Find []

  Set Variable [$pass1Count; Value: Get(FoundCount)]
  Set Variable [$pass1Error; Value: Get(LastError)]

  // ── Pass 1 Result: Exact single match ──
  If [$pass1Error = 0 and $pass1Count = 1]
    // This payload is a re-import of an already-known repair event.
    // Do NOT create a new record.
    Set Variable [$existingSerial; Value: Repair Customer::RC_SerialNum]
    Go to Layout ["API_Import_Staging" (Import_Staging)]
    Enter Find Mode []
    Set Field [Import_Staging::IS_ID; $stagingID]
    Perform Find []
    Set Field [Import_Staging::IS_Status; "Duplicate - Exact Match"]
    Set Field [Import_Staging::IS_ErrorMessage; "Matched RC_SerialNum: " & $existingSerial & " | Staging IS_ID: " & $stagingID]
    Set Field [Import_Staging::IS_ProcessedTimestamp; Get(CurrentTimestamp)]
    Commit Records/Requests [No dialog]
    Go to Record/Request/Page [Next; Exit after last]
    Continue
  End If

  // ── Pass 1 Result: Multiple matches ──
  If [$pass1Error = 0 and $pass1Count > 1]
    // Multiple existing records match the same repair key.
    // This means there are already duplicates in the database.
    // Queue for manual review — do not add another.
    Go to Layout ["API_Import_Staging" (Import_Staging)]
    Enter Find Mode []
    Set Field [Import_Staging::IS_ID; $stagingID]
    Perform Find []
    Set Field [Import_Staging::IS_Status; "Duplicate - Multiple Match"]
    Set Field [Import_Staging::IS_ErrorMessage; $pass1Count & " existing records matched on repair key | Staging IS_ID: " & $stagingID]
    Set Field [Import_Staging::IS_ProcessedTimestamp; Get(CurrentTimestamp)]
    Commit Records/Requests [No dialog]
    Go to Record/Request/Page [Next; Exit after last]
    Continue
  End If

  // Pass 1 returned 0 matches or error 401 (no records found) — proceed to Pass 2

  // ═════════════════════════════════════════════════════════
  // PASS 2: CUSTOMER IDENTITY CHECK
  // ═════════════════════════════════════════════════════════
  // Checks if this customer already exists in Repair Customer
  // using last name + first name + zip code compound Find.
  //
  // WHY we cannot use RC_Duplicate_Removal: It is an unstored
  // calculation field, so it cannot be indexed or searched via Find.
  // Instead we perform a compound Find on the indexed component fields.
  //
  // WHY this does NOT exit the loop: Each repair event is a
  // separate Repair Customer record, even for the same person.
  // A repeat customer gets a new record with RC_Repeat_Yes_No = "Yes"
  // and IS_LinkedSerialNum pointing to the existing record.
  // ═════════════════════════════════════════════════════════

  // Stay on API_RC_Write layout (already there from Pass 1 no-match path)
  Enter Find Mode []
  Set Field [Repair Customer::RC_Cust_Last;  $last]
  Set Field [Repair Customer::RC_Cust_First; $first]
  Set Field [Repair Customer::RC_Cust_Zip;   $zip]
  Perform Find []

  Set Variable [$pass2Count; Value: Get(FoundCount)]
  Set Variable [$pass2Error; Value: Get(LastError)]

  If [$pass2Error = 0 and $pass2Count > 0]
    // Customer exists. Capture their serial for linking.
    // We will still create a new RC record (new repair event),
    // but flag it as a repeat customer.
    Set Variable [$linkedSerial; Value: Repair Customer::RC_SerialNum]
  End If

  // Proceed to Pass 3 regardless of Pass 2 result

  // ═════════════════════════════════════════════════════════
  // PASS 3: RO NUMBER CHECK
  // ═════════════════════════════════════════════════════════
  // Checks if this RO number already exists at the same shop.
  // Only runs if RO number was provided in the payload.
  //
  // WHY we also check Shop_ID: Different shops can use the same
  // RO numbering scheme. RO-001 at Shop A is not the same repair
  // as RO-001 at Shop B.
  // ═════════════════════════════════════════════════════════

  If [not IsEmpty($roNumber)]
    Enter Find Mode []
    Set Field [Repair Customer::RC_RONumber; $roNumber]
    Set Field [Repair Customer::RC_Shop_ID;  $shopID]
    Perform Find []

    If [Get(LastError) = 0 and Get(FoundCount) > 0]
      // Same RO at same shop — definitive duplicate
      Set Variable [$existingSerial; Value: Repair Customer::RC_SerialNum]
      Go to Layout ["API_Import_Staging" (Import_Staging)]
      Enter Find Mode []
      Set Field [Import_Staging::IS_ID; $stagingID]
      Perform Find []
      Set Field [Import_Staging::IS_Status; "Duplicate - RO Match"]
      Set Field [Import_Staging::IS_ErrorMessage; "RO " & $roNumber & " exists as RC_SerialNum: " & $existingSerial & " | Staging IS_ID: " & $stagingID]
      Set Field [Import_Staging::IS_ProcessedTimestamp; Get(CurrentTimestamp)]
      Commit Records/Requests [No dialog]
      Go to Record/Request/Page [Next; Exit after last]
      Continue
    End If
  End If

  // ═════════════════════════════════════════════════════════
  // ALL PASSES CLEAR — CREATE REPAIR CUSTOMER RECORD
  // ═════════════════════════════════════════════════════════

  Go to Layout ["API_RC_Write" (Repair Customer)]
  New Record/Request

  // ─────────────────────────────────────────────────────────
  // FIELD WRITE ORDER
  // ─────────────────────────────────────────────────────────
  // WHY this order matters: Auto-entry calculations fire on
  // Commit, but they read the values of OTHER fields. If a
  // source field is not set before commit, the dependent calc
  // will evaluate with empty data and produce wrong results.
  //
  // Example: RC_Sex reads RC_Cust_Mr_Ms. If Mr_Ms is not set
  // before commit, RC_Sex will be empty.
  //
  // Example: RC_Duplicate_Key_glob reads RC_Date_In, RC_Date_Out,
  // RC_Vehicle_Model, and RC_Shop (via lookup from RC_Shop_ID).
  // All four must be set before commit.
  // ─────────────────────────────────────────────────────────

  // Group 1: Identity fields that drive auto-calcs
  Set Field [Repair Customer::RC_CorporateName_yes;    $corpYes]
  Set Field [Repair Customer::RC_CorporateName;        $corpName]
  Set Field [Repair Customer::RC_Cust_Mr_Ms;           $mrMs]        // RC_Sex reads this on commit
  Set Field [Repair Customer::RC_Cust_First;           $first]
  // RC_Cust_Last auto-calc reads RC_CorporateName_yes; that field is already set above
  Set Field [Repair Customer::RC_Cust_Middle;          $middle]
  Set Field [Repair Customer::RC_Cust_Suffix;          $suffix]

  // Group 2: Address
  Set Field [Repair Customer::RC_Cust_Address1;        $addr1]
  Set Field [Repair Customer::RC_Cust_Address2;        $addr2]
  Set Field [Repair Customer::RC_Cust_City;            $city]        // Titlecase auto-calc fires on commit
  Set Field [Repair Customer::RC_Cust_Zip;             $zip]

  // Group 3: Contact
  Set Field [Repair Customer::RC_EmailAddress;         $email]
  Set Field [Repair Customer::RC_Phone1;               $phone1]      // PhoneFilter auto-calc fires on commit
  Set Field [Repair Customer::RC_Phone2;               $phone2]
  Set Field [Repair Customer::RC_Phone3;               $phone3]

  // Group 4: Birthdate
  Set Field [Repair Customer::RC_Birthdate;            $birthdate]   // RC_Birthdate_month/day/year read this

  // Group 5: Repair event
  Set Field [Repair Customer::RC_RONumber;             $roNumber]
  Set Field [Repair Customer::RC_Date_In;              $dateIn]      // RC_Duplicate_Key_glob reads this
  Set Field [Repair Customer::RC_Date_Out;             $dateOut]
  Set Field [Repair Customer::RC_Vehicle_Yr;           $vehicleYr]
  Set Field [Repair Customer::RC_Vehicle_Make;         $vehicleMake]
  Set Field [Repair Customer::RC_Vehicle_Model;        $vehicleModel] // RC_Duplicate_Key_glob reads this
  Set Field [Repair Customer::RC_Vehicle_Style;        $vehicleStyle]
  Set Field [Repair Customer::RC_ClaimNum;             $claimNum]
  Set Field [Repair Customer::RC_PayType;              $payType]      // auto-calc sets "Unknown" if empty

  // Group 6: Shop and match fields
  Set Field [Repair Customer::RC_Shop_ID;              $shopID]       // RC_Duplicate_Key_glob reads RC_Shop via lookup
  Set Field [Repair Customer::RC_MatchField_Insurance; $matchIns]
  Set Field [Repair Customer::RC_MatchField_Agent;     $matchAgent]

  // Group 7: Source tracking
  Set Field [Repair Customer::RC_Input_ByFlushDB;      "API"]
  Set Field [Repair Customer::RC_Input_Style;          "API"]         // RC_Input_By calc reads this
  Set Field [Repair Customer::RC_Notes;                $notes]

  // Group 8: Batch tracking and repeat customer
  Set Field [Repair Customer::RC_ImportBatchID;        $batchID]      // Links to import batch for recall

  If [not IsEmpty($linkedSerial)]
    // Pass 2 found this customer already exists — flag as repeat
    Set Field [Repair Customer::RC_Repeat_Yes_No;      "Yes"]
  End If

  // ─────────────────────────────────────────────────────────
  // COMMIT AND VERIFY
  // ─────────────────────────────────────────────────────────

  Commit Records/Requests [No dialog]

  Set Variable [$commitError; Value: Get(LastError)]
  Set Variable [$newSerial;   Value: Repair Customer::RC_SerialNum]

  // ─────────────────────────────────────────────────────────
  // UPDATE STAGING RECORD WITH RESULT
  // ─────────────────────────────────────────────────────────

  Go to Layout ["API_Import_Staging" (Import_Staging)]
  Enter Find Mode []
  Set Field [Import_Staging::IS_ID; $stagingID]
  Perform Find []

  If [$commitError = 0 and not IsEmpty($newSerial)]
    // Success — record created
    Set Field [Import_Staging::IS_Status;             "Complete"]
    Set Field [Import_Staging::IS_ErrorMessage;       "RC_SerialNum: " & $newSerial]
    Set Field [Import_Staging::IS_LinkedSerialNum;    $linkedSerial]  // From Pass 2 if repeat customer
    Set Field [Import_Staging::IS_ProcessedTimestamp; Get(CurrentTimestamp)]
  Else
    // Failure — commit error or empty serial
    Set Field [Import_Staging::IS_Status;             "Error"]
    Set Field [Import_Staging::IS_ErrorMessage;       "Commit failed on RC creation. FM Error: " & $commitError & " | RC_SerialNum empty: " & IsEmpty($newSerial) & " | Staging IS_ID: " & $stagingID]
    Set Field [Import_Staging::IS_ProcessedTimestamp; Get(CurrentTimestamp)]
  End If

  Commit Records/Requests [No dialog]
  Go to Record/Request/Page [Next; Exit after last]

End Loop
```

## Script Flow Summary

```
START
  │
  ├─ Recovery preamble: reset stale "Processing" records (>10 min)
  │
  ├─ Find "Pending" records
  │   └─ If none: EXIT
  │
  └─ LOOP (each pending record)
      │
      ├─ Capture all 32 variables (including $batchID)
      ├─ Lock: IS_Status → "Processing", Commit
      │
      ├─ PASS 1: RC_Duplicate_Key_glob Find
      │   ├─ 1 match → "Duplicate - Exact Match" → CONTINUE
      │   ├─ >1 match → "Duplicate - Multiple Match" → CONTINUE
      │   └─ 0 matches → proceed
      │
      ├─ PASS 2: Customer identity compound Find
      │   ├─ Found → capture $linkedSerial (will flag repeat)
      │   └─ Not found → proceed
      │   (Does NOT exit — creates new record either way)
      │
      ├─ PASS 3: RO Number + Shop_ID Find (if RO provided)
      │   ├─ Found at same shop → "Duplicate - RO Match" → CONTINUE
      │   └─ Not found → proceed
      │
      ├─ CREATE RC RECORD
      │   ├─ Groups 1-7: Field write order (dependency-safe)
      │   ├─ Group 8: RC_ImportBatchID + RC_Repeat_Yes_No
      │   └─ Commit
      │
      └─ UPDATE STAGING
          ├─ Success → IS_Status = "Complete"
          └─ Error → IS_Status = "Error" with FM error code
```

## Variable Reference

| Variable | Source Field | Used In |
|----------|-------------|---------|
| $stagingID | IS_ID | Navigate back to staging record |
| $batchID | IS_BatchID | Written to RC_ImportBatchID |
| $first | IS_Cust_First | Pass 2 Find, RC write |
| $last | IS_Cust_Last | Pass 2 Find, RC write |
| $middle | IS_Cust_Middle | RC write |
| $mrMs | IS_Cust_Mr_Ms | RC write (drives RC_Sex) |
| $suffix | IS_Cust_Suffix | RC write |
| $addr1 | IS_Cust_Address1 | RC write |
| $addr2 | IS_Cust_Address2 | RC write |
| $city | IS_Cust_City | RC write (Titlecase on commit) |
| $state | IS_Cust_State | Captured but not written to RC (handled by browser utility) |
| $zip | IS_Cust_Zip | Pass 2 Find, RC write |
| $email | IS_EmailAddress | RC write |
| $phone1 | IS_Phone1 | RC write (PhoneFilter on commit) |
| $phone2 | IS_Phone2 | RC write |
| $phone3 | IS_Phone3 | RC write |
| $birthdate | IS_Birthdate | RC write (date splits on commit) |
| $roNumber | IS_RONumber | Pass 3 Find, RC write |
| $dateIn | IS_Date_In | Pass 1 key, RC write |
| $dateOut | IS_Date_Out | Pass 1 key, RC write |
| $vehicleYr | IS_Vehicle_Yr | RC write |
| $vehicleMake | IS_Vehicle_Make | RC write |
| $vehicleModel | IS_Vehicle_Model | Pass 1 key, RC write |
| $vehicleStyle | IS_Vehicle_Style | RC write |
| $claimNum | IS_ClaimNum | RC write |
| $payType | IS_PayType | RC write |
| $shopID | IS_Shop_ID | Pass 1 key, Pass 3 Find, RC write |
| $matchIns | IS_MatchField_Insurance | RC write |
| $matchAgent | IS_MatchField_Agent | RC write |
| $corpName | IS_CorporateName | RC write |
| $corpYes | IS_CorporateName_yes | RC write (drives RC_Cust_Last) |
| $notes | IS_Notes | RC write |
| $linkedSerial | (set by Pass 2) | Written to IS_LinkedSerialNum, triggers RC_Repeat_Yes_No |
| $dupKey | (computed) | Pass 1 Find value |
| $existingSerial | (from RC Find) | Written to IS_ErrorMessage for duplicate references |
| $pass1Count | (from Find) | Pass 1 branching |
| $pass1Error | (from Find) | Pass 1 error handling |
| $pass2Count | (from Find) | Pass 2 branching |
| $pass2Error | (from Find) | Pass 2 error handling |
| $commitError | (from Commit) | Error detection after RC creation |
| $newSerial | (from RC) | Stored in IS_ErrorMessage on success |

---
*Script reference for FileMaker implementation*
*Source: PRD_PSG_Advantage_RC_Import_API.md sections 4.4, 4.5*
*Extensions: Recovery preamble, IS_BatchID capture, RC_ImportBatchID write, RC_Repeat_Yes_No flagging, improved error messages*

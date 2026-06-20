# Import_Staging Table Schema

## Table Options

| Setting | Value |
|---------|-------|
| Table Name | Import_Staging |
| File | PhoenixSolutions_Advantage_06.1.fmp12 |
| Allow Creation via Data API | Yes |
| Reason for Placement | Processing script needs direct table access to Repair Customer without crossing file boundaries. Do NOT create in Import Flush.fmp12. |

## Fields (40 total)

> **Note:** The PRD states "35 fields" but actually defines 39. Adding IS_BatchID brings the total to 40.

### System Fields

| # | Field Name | Type | Auto-Entry | Index | Validation | Notes |
|---|-----------|------|------------|-------|------------|-------|
| 1 | IS_ID | Text | Serial (next: 1, increment: 1) | Unique, All | Unique, Not Empty | Primary key |
| 2 | IS_Status | Text | Constant: "Pending" | All | None | Status values: Pending, Processing, Complete, Error, Duplicate - Exact Match, Duplicate - RO Match, Duplicate - Multiple Match, Review Required, Recalled |
| 3 | IS_ReceivedDate | Date | Creation Date | None | None | Auto-set on record creation |
| 4 | IS_ReceivedTimestamp | Timestamp | Creation Timestamp | None | None | Auto-set on record creation |
| 5 | IS_ProcessedTimestamp | Timestamp | None | None | None | Set by processing script on completion |
| 6 | IS_Source | Text | None | None | None | Values: API, CSV, Manual |
| 7 | IS_ErrorMessage | Text | None | None | None | Populated by processing script on error or duplicate. Contains existing RC_SerialNum for duplicate matches. |
| 8 | IS_LinkedSerialNum | Text | None | None | None | Existing RC_SerialNum if repeat customer found in Pass 2 |
| 9 | IS_BatchID | Text | None | All | None | Sequential batch identifier (e.g., BATCH-0001). Groups all records from a single import for batch recall. Set by calling system when POSTing. Required for API-originated records. |

### Customer Identity Fields

| # | Field Name | Type | Auto-Entry | Index | Validation | Notes |
|---|-----------|------|------------|-------|------------|-------|
| 10 | IS_Cust_First | Text | None | None | None | |
| 11 | IS_Cust_Last | Text | None | None | None | |
| 12 | IS_Cust_Middle | Text | None | None | None | |
| 13 | IS_Cust_Mr_Ms | Text | None | None | None | Required for RC_Sex auto-calc on Repair Customer |
| 14 | IS_Cust_Suffix | Text | None | None | None | |

### Address Fields

| # | Field Name | Type | Auto-Entry | Index | Validation | Notes |
|---|-----------|------|------------|-------|------------|-------|
| 15 | IS_Cust_Address1 | Text | None | None | None | |
| 16 | IS_Cust_Address2 | Text | None | None | None | |
| 17 | IS_Cust_City | Text | None | None | None | |
| 18 | IS_Cust_State | Text | None | None | None | |
| 19 | IS_Cust_Zip | Text | None | None | None | Required for duplicate detection Pass 2 |

### Contact Fields

| # | Field Name | Type | Auto-Entry | Index | Validation | Notes |
|---|-----------|------|------------|-------|------------|-------|
| 20 | IS_EmailAddress | Text | None | None | None | |
| 21 | IS_Phone1 | Text | None | None | None | Send raw digits. PhoneFilter auto-calc fires on RC write, not here. |
| 22 | IS_Phone2 | Text | None | None | None | Send raw digits |
| 23 | IS_Phone3 | Text | None | None | None | Send raw digits |
| 24 | IS_Birthdate | Date | None | None | None | MM/DD/YYYY format required (FM server locale is US English) |

### Repair Event Fields

| # | Field Name | Type | Auto-Entry | Index | Validation | Notes |
|---|-----------|------|------------|-------|------------|-------|
| 25 | IS_RONumber | Text | None | None | None | Required for duplicate detection Pass 3 |
| 26 | IS_Date_In | Date | None | None | None | MM/DD/YYYY. Required for duplicate detection Pass 1. |
| 27 | IS_Date_Out | Date | None | None | None | MM/DD/YYYY. Required for duplicate detection Pass 1. |
| 28 | IS_Vehicle_Yr | Text | None | None | None | |
| 29 | IS_Vehicle_Make | Text | None | None | None | |
| 30 | IS_Vehicle_Model | Text | None | None | None | Required for duplicate detection Pass 1 |
| 31 | IS_Vehicle_Style | Text | None | None | None | |
| 32 | IS_ClaimNum | Text | None | None | None | |
| 33 | IS_PayType | Text | None | None | None | |

### Shop and Match Fields

| # | Field Name | Type | Auto-Entry | Index | Validation | Notes |
|---|-----------|------|------------|-------|------------|-------|
| 34 | IS_Shop_ID | Text | None | None | None | Required for duplicate detection Pass 1 and Pass 3. Must match RC_MatchField_Master format. |
| 35 | IS_MatchField_Insurance | Text | None | None | None | |
| 36 | IS_MatchField_Agent | Text | None | None | None | |

### Corporate Fields

| # | Field Name | Type | Auto-Entry | Index | Validation | Notes |
|---|-----------|------|------------|-------|------------|-------|
| 37 | IS_CorporateName | Text | None | None | None | |
| 38 | IS_CorporateName_yes | Text | None | None | None | "Yes" or blank. Affects RC_Cust_Last auto-calc on Repair Customer. |

### Misc Fields

| # | Field Name | Type | Auto-Entry | Index | Validation | Notes |
|---|-----------|------|------------|-------|------------|-------|
| 39 | IS_Notes | Text | None | None | None | |
| 40 | IS_RawPayload | Text | None | None | None | Store full JSON payload string for debugging and audit |

## Batch ID Specification

| Property | Value |
|----------|-------|
| Field | IS_BatchID |
| Format | Sequential: BATCH-0001, BATCH-0002, BATCH-0003, ... |
| Generated By | Calling system (browser utility or API client) |
| Zero-Padded | 4 digits minimum (BATCH-0001 through BATCH-9999) |
| Uniqueness | One batch ID per import session. All records from the same file upload share the same IS_BatchID. |
| Required | Yes for API-originated records |
| Purpose | Groups records for batch recall, audit trail, and status monitoring |

## Index Requirements Summary

| Field | Index Type | Reason |
|-------|-----------|--------|
| IS_ID | Unique, All | Primary key lookups |
| IS_Status | All | Processing script Finds all "Pending" records every 5 minutes |
| IS_BatchID | All | Recall script Finds all records in a batch for status updates |

## Table Occurrence

Add Import_Staging as a table occurrence (TO) in the relationship graph of PhoenixSolutions_Advantage_06.1.fmp12. No relationships required for initial build. The processing script navigates by layout, not by portal or relationship.

---
*Schema reference for FileMaker implementation*
*Source: PRD_PSG_Advantage_RC_Import_API.md section 4.1*

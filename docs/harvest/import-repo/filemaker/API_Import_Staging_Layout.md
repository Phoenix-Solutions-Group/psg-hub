# Layout: API_Import_Staging

## Layout Configuration

| Setting | Value |
|---------|-------|
| Layout Name | API_Import_Staging |
| Based On | Import_Staging (table occurrence) |
| Purpose | Data API write target for external systems |
| Allow Creation via This Layout | Yes |
| Script Triggers | None |

## Purpose

This layout is the single entry point for all external systems posting data via the FileMaker Data API. External systems authenticate, POST a JSON payload to this layout, and FileMaker creates a staging record.

## Fields on Layout (all 40 Import_Staging fields)

All fields from the Import_Staging table must be present on this layout for Data API access:

### System Fields
1. IS_ID
2. IS_Status
3. IS_ReceivedDate
4. IS_ReceivedTimestamp
5. IS_ProcessedTimestamp
6. IS_Source
7. IS_ErrorMessage
8. IS_LinkedSerialNum
9. IS_BatchID

### Customer Identity Fields
10. IS_Cust_First
11. IS_Cust_Last
12. IS_Cust_Middle
13. IS_Cust_Mr_Ms
14. IS_Cust_Suffix

### Address Fields
15. IS_Cust_Address1
16. IS_Cust_Address2
17. IS_Cust_City
18. IS_Cust_State
19. IS_Cust_Zip

### Contact Fields
20. IS_EmailAddress
21. IS_Phone1
22. IS_Phone2
23. IS_Phone3
24. IS_Birthdate

### Repair Event Fields
25. IS_RONumber
26. IS_Date_In
27. IS_Date_Out
28. IS_Vehicle_Yr
29. IS_Vehicle_Make
30. IS_Vehicle_Model
31. IS_Vehicle_Style
32. IS_ClaimNum
33. IS_PayType

### Shop and Match Fields
34. IS_Shop_ID
35. IS_MatchField_Insurance
36. IS_MatchField_Agent

### Corporate Fields
37. IS_CorporateName
38. IS_CorporateName_yes

### Misc Fields
39. IS_Notes
40. IS_RawPayload

## Data API Behavior

- External systems POST to: `POST /fmi/data/v1/databases/PhoenixSolutions_Advantage_06.1/layouts/API_Import_Staging/records`
- IS_ID auto-generates via serial auto-entry
- IS_Status auto-sets to "Pending" via constant auto-entry
- IS_ReceivedDate and IS_ReceivedTimestamp auto-set via creation auto-entry
- All other fields are writable from the POST payload
- IS_BatchID should be included in every API POST to group records by import session

## Notes

- This layout does not need a polished UI. It exists solely as a Data API surface.
- No portals, no related fields, no script triggers.
- The processing script reads from this layout but writes status updates back to it via Find on IS_ID.

---
*Layout reference for FileMaker implementation*
*Source: PRD_PSG_Advantage_RC_Import_API.md section 4.3*

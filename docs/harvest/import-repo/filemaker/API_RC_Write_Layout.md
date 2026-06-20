# Layout: API_RC_Write

## Layout Configuration

| Setting | Value |
|---------|-------|
| Layout Name | API_RC_Write |
| Based On | Repair Customer (table occurrence) |
| Purpose | Restricted write surface for the processing script |
| Allow Creation via This Layout | Yes (script creates new records here) |
| Script Triggers | None |

## Purpose

This layout provides a controlled write surface for the processing script. It includes only the fields the script needs to read (for duplicate detection) and write (for new record creation). Auto-entry calculations fire on commit regardless of which layout is active.

## Fields on Layout

### Fields Written by Processing Script (in dependency order)

These fields are set by the processing script when creating a new Repair Customer record. The order listed here matches the required write order from the PRD (section 4.4).

**Group 1: Identity fields (drive auto-calcs)**
1. RC_CorporateName_yes
2. RC_CorporateName
3. RC_Cust_Mr_Ms (RC_Sex reads this on commit)
4. RC_Cust_First
5. RC_Cust_Middle
6. RC_Cust_Suffix

**Group 2: Address**
7. RC_Cust_Address1
8. RC_Cust_Address2
9. RC_Cust_City (Titlecase auto-calc fires on commit)
10. RC_Cust_Zip

**Group 3: Contact**
11. RC_EmailAddress
12. RC_Phone1 (PhoneFilter auto-calc fires on commit)
13. RC_Phone2
14. RC_Phone3

**Group 4: Birthdate**
15. RC_Birthdate (RC_Birthdate_month/day/year auto-calcs read this)

**Group 5: Repair event**
16. RC_RONumber
17. RC_Date_In (RC_Duplicate_Key_glob reads this)
18. RC_Date_Out
19. RC_Vehicle_Yr
20. RC_Vehicle_Make
21. RC_Vehicle_Model (RC_Duplicate_Key_glob reads this)
22. RC_Vehicle_Style
23. RC_ClaimNum
24. RC_PayType (auto-calc sets "Unknown" if empty)

**Group 6: Shop and match fields**
25. RC_Shop_ID (RC_Duplicate_Key_glob reads RC_Shop via lookup)
26. RC_MatchField_Insurance
27. RC_MatchField_Agent

**Group 7: Source tracking**
28. RC_Input_ByFlushDB (set to "API")
29. RC_Input_Style (set to "API"; RC_Input_By calc reads this)
30. RC_Notes

**Group 8: Batch tracking (new field)**
31. RC_ImportBatchID (links record to import batch for recall)

### Fields Read by Processing Script (for duplicate detection)

These fields are used in Find operations during the three duplicate detection passes but are NOT written by the processing script on existing records:

32. RC_Duplicate_Key_glob (Pass 1: indexed composite key Find)
33. RC_Cust_Last (Pass 2: customer identity compound Find)
34. RC_Cust_First (Pass 2)
35. RC_Cust_Zip (Pass 2)
36. RC_RONumber (Pass 3: already in write list, used for Find)
37. RC_Shop_ID (Pass 3: already in write list, used for constrain)
38. RC_SerialNum (read after Find to reference existing records)

### Fields Excluded from This Layout

Do NOT include on this layout:
- Summary fields (any aggregate calculations)
- Unstored Calculation fields (they compute on demand regardless of layout)
- RC_Duplicate_Key (unstored calc -- use RC_Duplicate_Key_glob instead for Finds)
- RC_Duplicate_Removal (unstored calc -- use compound Find instead)
- RC_Sex (auto-calc, reads RC_Cust_Mr_Ms on commit)
- RC_Cust_Last when auto-calc (fires from RC_CorporateName_yes on commit)
- RC_Birthdate_month, RC_Birthdate_day, RC_Birthdate_year (auto-calcs from RC_Birthdate)
- RC_Input_By (auto-calc, reads RC_Input_Style on commit)
- Any field the processing script does not explicitly set or read

## Notes

- Auto-entry calculations fire on Commit Records regardless of layout. The script does not need to set calculated fields directly.
- The field write order in the processing script matters because some auto-entry calcs depend on source fields being present before commit. Write identity fields before address, address before contact, etc.
- RC_Cust_State is intentionally NOT in the write list. The PRD section 4.4 does not include it in the field write order. State is handled by address validation in the browser utility before POST.

---
*Layout reference for FileMaker implementation*
*Source: PRD_PSG_Advantage_RC_Import_API.md sections 4.3 and 4.4*

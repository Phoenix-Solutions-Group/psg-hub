# Local Falcon First-Batch Verification

Bottom line: use manual CSV import for the first Local Falcon batch. This gets
map-ranking visibility into Body Shop Marketer without adding production Local
Falcon credentials or touching customer secrets.

## Import Path

1. Export the client scan from Local Falcon as CSV.
2. Import the CSV through the service-role import path using the target shop ID,
   scan timestamp, and source file name.
3. Confirm the import writes one row to `local_falcon_visibility_snapshots`.
4. Re-import the same file with the same shop ID, timestamp, and file name. The
   row should update in place, not duplicate.

## Customer-Safe Checks

1. Log in as a user assigned to the imported shop and open the analytics page.
   The Local Falcon section should show Share of Local Voice, average map rank,
   scan date, and priority notes.
2. Log in as a user assigned to a different shop. The imported shop's Local
   Falcon row must not be visible.
3. Render a monthly report for the imported shop. The report should include the
   latest Local Falcon block with keyword/location notes.

## Future Upgrade

The storage table is intentionally source-agnostic. A scheduled export or Local
Falcon API connector can reuse the same upsert key:
`shop_id + captured_at + source_file_name`.

# Corpus Extension Performance Verification

## Goal
Use this checklist to validate that local-first sync keeps editing responsive while still converging to Drive state safely.

## Setup
Open the extension editor, load a CV type with multiple entries, and open DevTools Network throttling controls so you can switch between online and throttled conditions.

## Scenarios
Type continuously in multiple fields for at least thirty seconds and confirm there is no visible keystroke lag or UI freeze. Watch sync status transitions move from pending to saving and then saved.

Enable network throttling and continue editing. Confirm typing remains smooth and status eventually shows an error only when remote sync fails, while edited values remain visible in the form.

Reload the editor tab after a failed sync and confirm unsynced local edits are restored from draft storage.

Reconnect normal network conditions and wait for idle sync. Confirm status returns to saved and Drive-backed state matches local edits.

Create a version and export a PDF after making edits. Confirm the action waits for sync completion and exported content reflects the latest changes.

Switch tabs and close/reopen the editor during active editing. Confirm lifecycle-triggered flushes reduce unsynced work without losing local drafts.

## Evidence to Capture
Record approximate input responsiveness before and after the local-first change, capture observed sync status transitions, and note any state mismatch between local form values and exported Drive output.

# Marker Deselection Fix

## Problem Description

There were two issues with marker selection/deselection:

1. **First click issue still existed**: When clicking on a marker for the first time, sometimes the selection would be cleared but markers would stay hidden.

2. **Second click issue**: When clicking on a marker a second time to remove the filter (deselect), the other markers would stay hidden instead of showing all markers again.

## Root Cause

The issue was in the deselection logic. When a marker was clicked a second time:

- The selection manager would return an empty array `[]`
- The code was treating this as "show only this marker" instead of "show all markers in current context"
- There was no proper tracking of the previous selection state

## Fix Applied

### 1. **Selection State Tracking**

- Added `currentSelection: ISelectionId[]` property to track the current selection state
- Added logic to compare previous vs current selection to detect deselection

### 2. **Improved Deselection Logic**

```typescript
// Before: Always showed only the clicked marker when selection was empty
if (ids.length === 0) {
  this.updateMarkersVisibility([this.selectionIds[i]]);
}

// After: Detects deselection and shows all current context markers
const wasPreviouslySelected = this.currentSelection.some((selectedId) =>
  this.compareSelectionIds(this.selectionIds[i], selectedId)
);
const isCurrentlySelected = ids.some((selectedId) =>
  this.compareSelectionIds(this.selectionIds[i], selectedId)
);

if (ids.length === 0 || !isCurrentlySelected) {
  // This is a deselection - show all current context markers
  this.handleMarkerDeselection(i);
}
```

### 3. **Deselection Handler**

- Added `handleMarkerDeselection()` method to properly handle marker deselection
- Ensures all markers in the current filtered context are shown when a marker is deselected

### 4. **State Management**

- Selection state is properly reset when clearing selections
- Selection state is reset when visual is destroyed

## Test Scenarios

### Test 1: First Click Selection

1. Click on any marker for the first time
2. **Expected**: Only the clicked marker should be visible
3. **Before Fix**: Sometimes all markers would become visible

### Test 2: Second Click Deselection

1. Click on a marker to select it
2. Click on the same marker again to deselect it
3. **Expected**: All markers in the current context should be visible
4. **Before Fix**: Only the clicked marker would remain visible

### Test 3: Multiple Selections and Deselections

1. Click on multiple markers (Ctrl/Cmd+click)
2. Click on one of the selected markers to deselect it
3. **Expected**: Only the remaining selected markers should be visible
4. **Before Fix**: All markers would become visible

### Test 4: Filtered Context Deselection

1. Apply a filter in Power BI
2. Click on a marker in the filtered data
3. Click on the same marker again to deselect it
4. **Expected**: All markers in the current filtered context should be visible
5. **Before Fix**: Only the clicked marker would remain visible

### Test 5: Clear Selection

1. Click on a marker to select it
2. Click on empty map area to clear selection
3. **Expected**: All markers in the current context should be visible
4. **Before Fix**: This worked correctly

## Console Logs to Monitor

Look for these log messages in the browser console:

```
"Marker clicked: index X, selectionId: [object]"
"Selection result: [array of selection IDs]"
"Current data context: [array of selection IDs]"
"Previous selection: [array of selection IDs]"
"Marker deselected in current context - showing all current markers"
"Handling deselection for marker X"
"Showing only markers in current filtered context"
"Updating markers visibility: {totalMarkers: X, selectedIdsCount: Y, selectedIds: [...]}"
```

## Key Methods Added/Modified

### 1. `currentSelection: ISelectionId[]`

Tracks the current selection state to detect deselection.

### 2. `handleMarkerDeselection(clickedMarkerIndex: number)`

Handles marker deselection by showing all markers in the current context.

### 3. Enhanced marker click handler

Detects deselection and calls appropriate handler.

### 4. State reset in `clearSelection()` and `destroy()`

Ensures selection state is properly reset.

## Verification Checklist

- [ ] First click on marker shows only that marker
- [ ] Second click on same marker shows all current context markers
- [ ] Multiple selections work correctly
- [ ] Deselection in filtered context works correctly
- [ ] Clear selection shows all current context markers
- [ ] Selection state is properly tracked
- [ ] No JavaScript errors in console
- [ ] Debug messages appear as expected

## Performance Impact

- Minimal performance impact
- Additional selection state tracking is lightweight
- Deselection detection is optimized
- No additional network requests

## Future Improvements

1. **Visual Feedback**: Add visual indication of selected vs deselected state
2. **Selection History**: Track selection history for undo/redo functionality
3. **Bulk Operations**: Add ability to select/deselect multiple markers at once
4. **Selection Persistence**: Remember selections across visual updates

# Marker Selection Bug Fix Test Guide

## Problem Description

When clicking on a marker for the very first time, the filter would apply to Power BI but the map would show all markers again instead of just the selected one. Subsequent clicks worked as expected.

## Root Cause

The issue was in the marker click handler logic. When `selectionManager.select()` returned an empty array (which can happen on the first click due to timing issues), the code was calling `updateMarkersVisibility(this.selectionIds)` which showed ALL markers instead of just the clicked one.

## Fix Applied

1. **Improved Selection Logic**: When no selection is returned, show only the clicked marker instead of all markers
2. **Better Error Handling**: Added try-catch blocks and fallback behavior
3. **Enhanced Logging**: Added console logs to track selection behavior
4. **Robust Comparison**: Improved selection ID comparison to handle different types
5. **Map Click Handler**: Added ability to clear selections by clicking on empty map areas

## Test Scenarios

### Test 1: First Click Behavior

1. Load the visual with multiple markers
2. Click on any marker for the first time
3. **Expected**: Only the clicked marker should remain visible, others should be hidden
4. **Before Fix**: All markers would become visible again

### Test 2: Subsequent Clicks

1. After the first click, click on a different marker
2. **Expected**: Only the newly clicked marker should be visible
3. **Before Fix**: This worked correctly

### Test 3: Multiple Selections

1. Hold Ctrl/Cmd and click multiple markers
2. **Expected**: All clicked markers should remain visible
3. **Before Fix**: This worked correctly

### Test 4: Clear Selection

1. Click on an empty area of the map
2. **Expected**: All markers should become visible again
3. **Before Fix**: This functionality was not available

### Test 5: Power BI Integration

1. Click on a marker
2. Check if the Power BI filter is applied correctly
3. **Expected**: Power BI should filter to show only the selected data
4. **Before Fix**: Filter worked but map showed wrong markers

## Console Logs to Monitor

Look for these log messages in the browser console:

```
"Marker clicked: index X, selectionId: [object]"
"Selection result: [array of selection IDs]"
"Updating markers visibility: {totalMarkers: X, selectedIdsCount: Y, selectedIds: [...]}"
"Hidden marker X"
"Shown marker X"
"Markers visibility update complete: {visibleMarkers: X, hiddenMarkers: Y}"
"Map clicked - clearing selections"
"Clearing all selections"
```

## Verification Checklist

- [ ] First click on marker shows only that marker
- [ ] Subsequent clicks work correctly
- [ ] Multiple selections work with Ctrl/Cmd+click
- [ ] Clicking on empty map area clears selection
- [ ] Power BI filter integration works correctly
- [ ] No JavaScript errors in console
- [ ] Debug messages appear as expected

## Key Code Changes

### 1. Marker Click Handler

```typescript
// Before
if (ids.length === 0) {
  this.updateMarkersVisibility(this.selectionIds); // Showed ALL markers
} else {
  this.updateMarkersVisibility(ids);
}

// After
if (ids.length === 0) {
  this.updateMarkersVisibility([this.selectionIds[i]]); // Show only clicked marker
} else {
  this.updateMarkersVisibility(ids);
}
```

### 2. Enhanced Selection Comparison

```typescript
// More robust comparison that handles different selection ID types
const isSelected = selectedIds.some((id) => {
  if (id.getKey && markerSelectionId.getKey) {
    return id.getKey() === markerSelectionId.getKey();
  }
  if (id.toString && markerSelectionId.toString) {
    return id.toString() === markerSelectionId.toString();
  }
  return id === markerSelectionId;
});
```

### 3. Map Click Handler

```typescript
// Added ability to clear selections by clicking on empty map areas
this.map.on("click", (event) => {
  if (
    event.originalEvent &&
    event.originalEvent.target === this.map.getContainer()
  ) {
    this.clearSelection();
  }
});
```

## Performance Impact

- Minimal performance impact
- Additional logging only helps with debugging
- Selection comparison is optimized
- No additional network requests

## Future Improvements

1. **Visual Feedback**: Add visual indication of selected markers
2. **Keyboard Shortcuts**: Add keyboard shortcuts for selection operations
3. **Selection Persistence**: Remember selections across visual updates
4. **Bulk Operations**: Add ability to select/deselect multiple markers at once

// Debug script for empty state functionality
// This script can be run to test the empty state logic

console.log("=== Empty State Debug Script ===");

// Simulate different scenarios
const testScenarios = [
  {
    name: "No data at all",
    data: null,
    expectedEmptyState: true
  },
  {
    name: "Empty data table",
    data: { table: { columns: [], rows: [] } },
    expectedEmptyState: true
  },
  {
    name: "Data with no valid coordinates",
    data: {
      table: {
        columns: [
          { displayName: "Latitude", roles: { latitude: true } },
          { displayName: "Longitude", roles: { longitude: true } },
          { displayName: "Admin Code", roles: { adminCode: true } }
        ],
        rows: [
          [null, null, null],
          [undefined, undefined, undefined],
          ["invalid", "invalid", "NA"]
        ]
      }
    },
    expectedEmptyState: true
  },
  {
    name: "Data with valid coordinates but no admin codes",
    data: {
      table: {
        columns: [
          { displayName: "Latitude", roles: { latitude: true } },
          { displayName: "Longitude", roles: { longitude: true } },
          { displayName: "Admin Code", roles: { adminCode: true } }
        ],
        rows: [
          [40.7128, -74.0060, null],
          [51.5074, -0.1278, undefined],
          [48.8566, 2.3522, "NA"]
        ]
      }
    },
    expectedEmptyState: false // Should show markers
  },
  {
    name: "Data with valid admin codes",
    data: {
      table: {
        columns: [
          { displayName: "Latitude", roles: { latitude: true } },
          { displayName: "Longitude", roles: { longitude: true } },
          { displayName: "Admin Code", roles: { adminCode: true } }
        ],
        rows: [
          [40.7128, -74.0060, 840], // USA
          [51.5074, -0.1278, 826], // UK
          [48.8566, 2.3522, 250]  // France
        ]
      }
    },
    expectedEmptyState: false // Should show markers and choropleth
  }
];

// Test each scenario
testScenarios.forEach((scenario, index) => {
  console.log(`\n--- Test ${index + 1}: ${scenario.name} ---`);
  console.log("Input data:", scenario.data);
  console.log("Expected empty state:", scenario.expectedEmptyState);
  console.log("---");
});

console.log("\n=== Debug Instructions ===");
console.log("1. Run this script to see the test scenarios");
console.log("2. Check the browser console when testing the visual");
console.log("3. Look for the following log messages:");
console.log("   - 'Comprehensive empty state check:'");
console.log("   - 'Empty state shown - no distribution data available'");
console.log("   - 'Empty state hidden - distribution data available'");
console.log("4. If empty state is not showing, check:");
console.log("   - Is the emptyStateDiv properly created?");
console.log("   - Is it positioned correctly?");
console.log("   - Is the z-index high enough?");
console.log("   - Are there any JavaScript errors?");

console.log("\n=== Common Issues ===");
console.log("1. Timing issues: Empty state check runs before data is loaded");
console.log("2. DOM issues: Empty state div not properly positioned");
console.log("3. Z-index issues: Empty state hidden behind other elements");
console.log("4. State issues: Choropleth layer not properly initialized");
console.log("5. Packaging issues: Different behavior in production vs development");

console.log("\n=== Debug Complete ==="); 
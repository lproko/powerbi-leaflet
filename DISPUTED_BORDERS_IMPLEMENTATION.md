# Disputed Borders Implementation Guide

## Problem Statement

Need to display dotted/dashed borders for disputed territories:

- Serbia-Kosovo border
- Israel-Palestine border

## Recommended Solution: Custom GeoJSON Layer

### **Approach Overview**

1. Create a separate GeoJSON layer for disputed borders
2. Style with dashed/dotted lines
3. Overlay on top of the main choropleth layer
4. Ensure proper z-index management

## Implementation Steps

### **Step 1: Create Disputed Borders Data**

Create a new file `disputed-borders.ts` with the border coordinates:

```typescript
// src/disputed-borders.ts
export const disputedBorders = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: {
        name: "Serbia-Kosovo Border",
        dispute_type: "territorial",
        line_style: "dashed",
      },
      geometry: {
        type: "LineString",
        coordinates: [
          // Serbia-Kosovo border coordinates
          [20.0, 43.0],
          [20.1, 43.1],
          [20.2, 43.2],
          // ... more coordinates
        ],
      },
    },
    {
      type: "Feature",
      properties: {
        name: "Israel-Palestine Border",
        dispute_type: "territorial",
        line_style: "dotted",
      },
      geometry: {
        type: "LineString",
        coordinates: [
          // Israel-Palestine border coordinates
          [34.0, 31.0],
          [34.1, 31.1],
          [34.2, 31.2],
          // ... more coordinates
        ],
      },
    },
  ],
};
```

### **Step 2: Add Border Layer to Visual Class**

Add properties and methods to the Visual class:

```typescript
// Add to class properties
private disputedBordersLayer: L.GeoJSON;

// Add to constructor after choropleth layer initialization
this.disputedBordersLayer = L.geoJSON(null, {
  style: (feature) => this.getDisputedBorderStyle(feature),
  onEachFeature: (feature, layer) => this.onEachDisputedBorderFeature(feature, layer)
});

// Add to map
this.disputedBordersLayer.addTo(this.map);
```

### **Step 3: Implement Border Styling**

```typescript
private getDisputedBorderStyle(feature: any) {
  const lineStyle = feature.properties?.line_style || "dashed";

  return {
    color: "#FF6B35", // Orange-red color for disputed borders
    weight: 3,
    opacity: 0.8,
    fillOpacity: 0,
    dashArray: lineStyle === "dotted" ? "1, 3" : "10, 5", // Dotted vs Dashed
    lineCap: "round",
    lineJoin: "round"
  };
}

private onEachDisputedBorderFeature(feature: any, layer: L.Layer) {
  // Add tooltip for disputed borders
  const name = feature.properties?.name || "Disputed Border";

  layer.on({
    click: (e) => {
      const tooltipContent = `
        <div class="tooltip-row">
          <span class="field-name">Border</span>
          <span class="field-value">${name}</span>
        </div>
        <div class="tooltip-row">
          <span class="field-name">Status</span>
          <span class="field-value">Disputed Territory</span>
        </div>
      `;

      this.showTooltip(tooltipContent, e.latlng);
    }
  });
}
```

### **Step 4: Load Disputed Borders Data**

```typescript
private loadDisputedBorders() {
  try {
    // Load the disputed borders GeoJSON
    const bordersData = disputedBorders;

    // Clear existing borders
    if (this.disputedBordersLayer) {
      this.disputedBordersLayer.clearLayers();
    }

    // Add new borders
    this.disputedBordersLayer.addData(bordersData);

    console.log("Disputed borders loaded successfully");
  } catch (error) {
    console.error("Error loading disputed borders:", error);
  }
}
```

### **Step 5: Call in Constructor**

```typescript
// Add to constructor after loadDefaultGeoJson()
this.loadDisputedBorders();
```

## Alternative Solutions

### **Option 2: CSS-based Approach**

Modify existing choropleth features to detect border regions:

```typescript
private getChoroplethStyle(feature: any) {
  const featureGaulCode = feature.properties?.gaul_code;
  const isDisputedBorder = this.isDisputedBorderRegion(featureGaulCode);

  if (isDisputedBorder) {
    return {
      fillColor: "transparent",
      weight: 3,
      opacity: 0.8,
      color: "#FF6B35",
      fillOpacity: 0,
      dashArray: "10, 5" // Dashed border
    };
  }

  // ... existing choropleth styling
}

private isDisputedBorderRegion(gaulCode: number): boolean {
  // Define disputed border regions
  const disputedRegions = [
    // Serbia and Kosovo GAUL codes
    251, // Serbia
    252, // Kosovo
    // Israel and Palestine GAUL codes
    115, // Israel
    116  // Palestine
  ];

  return disputedRegions.includes(gaulCode);
}
```

### **Option 3: Overlay Line Layer**

Create simple polyline overlays:

```typescript
private addDisputedBorderLines() {
  // Serbia-Kosovo border
  const serbiaKosovoBorder = L.polyline([
    [43.0, 20.0],
    [43.1, 20.1],
    [43.2, 20.2]
  ], {
    color: "#FF6B35",
    weight: 3,
    opacity: 0.8,
    dashArray: "10, 5"
  }).addTo(this.map);

  // Israel-Palestine border
  const israelPalestineBorder = L.polyline([
    [31.0, 34.0],
    [31.1, 34.1],
    [31.2, 34.2]
  ], {
    color: "#FF6B35",
    weight: 3,
    opacity: 0.8,
    dashArray: "1, 3" // Dotted
  }).addTo(this.map);
}
```

## Recommended Implementation

### **Why Option 1 (Custom GeoJSON) is Best:**

1. **Scalable**: Easy to add more disputed borders
2. **Maintainable**: Separate data structure
3. **Flexible**: Different styles for different disputes
4. **Interactive**: Can add tooltips and click handlers
5. **Professional**: Clean separation of concerns

### **Data Sources for Border Coordinates:**

1. **Natural Earth Data**: High-quality border datasets
2. **OpenStreetMap**: Community-maintained borders
3. **UN Cartographic Section**: Official disputed border data
4. **Academic Sources**: Research papers with precise coordinates

### **Styling Considerations:**

- **Color**: Orange-red (#FF6B35) to indicate disputes
- **Weight**: 3px for visibility
- **Opacity**: 0.8 for subtle but visible appearance
- **Dash Pattern**:
  - Dashed: "10, 5" for Serbia-Kosovo
  - Dotted: "1, 3" for Israel-Palestine

### **Z-Index Management:**

- **Choropleth Layer**: z-index: 100
- **Disputed Borders**: z-index: 200 (above choropleth)
- **Markers**: z-index: 300 (above borders)
- **Tooltips**: z-index: 1000 (top layer)

## Implementation Priority

1. **Phase 1**: Implement basic disputed borders layer
2. **Phase 2**: Add interactive tooltips
3. **Phase 3**: Add configuration options
4. **Phase 4**: Add more disputed territories

Would you like me to implement the custom GeoJSON approach, or would you prefer one of the alternative solutions?

# Basemap Options with Disputed Borders

## Current Basemap

You're currently using: `https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png`

## Alternative Basemaps with Disputed Borders

### **Option 1: Natural Earth Physical (Recommended)**

```typescript
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: "© OpenStreetMap contributors",
  maxZoom: 19,
});
```

**Features:**

- ✅ Includes disputed borders
- ✅ High detail
- ✅ Free to use
- ✅ Good for political boundaries

### **Option 2: CartoDB Positron with Labels**

```typescript
L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
  attribution: "© OpenStreetMap contributors © CARTO",
  subdomains: "abcd",
  maxZoom: 20,
});
```

**Features:**

- ✅ Includes country labels and borders
- ✅ Clean, professional look
- ✅ May show disputed territories

### **Option 3: Stamen Terrain**

```typescript
L.tileLayer(
  "https://stamen-tiles-{s}.a.ssl.fastly.net/terrain/{z}/{x}/{y}{r}.png",
  {
    attribution: 'Map tiles by <a href="http://stamen.com">Stamen Design</a>',
    subdomains: "abcd",
    maxZoom: 18,
  }
);
```

**Features:**

- ✅ Shows terrain and political boundaries
- ✅ Good for disputed regions
- ✅ High quality

### **Option 4: Esri World Physical**

```typescript
L.tileLayer(
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Physical_Map/MapServer/tile/{z}/{y}/{x}",
  {
    attribution: "Tiles © Esri",
    maxZoom: 8,
  }
);
```

**Features:**

- ✅ Shows physical features and borders
- ✅ Good for disputed territories
- ✅ Professional quality

### **Option 5: OpenTopoMap**

```typescript
L.tileLayer("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", {
  attribution:
    "Map data: © OpenStreetMap contributors, SRTM | Map style: © OpenTopoMap",
  maxZoom: 17,
});
```

**Features:**

- ✅ Topographic with political boundaries
- ✅ Shows disputed regions
- ✅ Good detail

## Recommended Implementation

### **Best Option: OpenStreetMap (Option 1)**

This is the most reliable for showing disputed borders because:

1. **Community-maintained**: Updated regularly with current political situations
2. **Comprehensive**: Includes most disputed territories
3. **Free**: No usage limits
4. **High detail**: Good zoom levels

### **Alternative: CartoDB with Labels (Option 2)**

If you want to keep the clean look but add borders:

1. **Similar style**: Close to your current basemap
2. **Includes labels**: Country names and borders
3. **Professional**: Good for business presentations

## Implementation Steps

### **Step 1: Replace Current Basemap**

Replace this line in your constructor:

```typescript
// Current (line ~150 in visual.ts)
L.tileLayer(
  "https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png",
  {
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: "abcd",
    maxZoom: 20,
  }
).addTo(this.map);

// Replace with OpenStreetMap
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: "© OpenStreetMap contributors",
  maxZoom: 19,
}).addTo(this.map);
```

### **Step 2: Remove Custom Disputed Borders**

Since the basemap will include disputed borders, we can remove our custom implementation:

1. Remove `disputedBordersLayer` property
2. Remove `loadDisputedBorders()` call
3. Remove disputed borders import

### **Step 3: Test Different Options**

Try each basemap to see which shows the disputed borders best for your use case.

## Testing Instructions

1. **Replace the basemap URL** in `visual.ts`
2. **Run the development server**
3. **Navigate to Serbia-Kosovo region** (around 20°E, 42°N)
4. **Navigate to Israel-Palestine region** (around 34°E, 31°N)
5. **Look for disputed border indicators** (dashed lines, different colors, etc.)

## Expected Results

With OpenStreetMap, you should see:

- **Serbia-Kosovo**: Dashed or differently styled border
- **Israel-Palestine**: Dotted or differently styled border
- **Other disputed regions**: Similar visual indicators

Would you like me to implement the OpenStreetMap basemap option first?

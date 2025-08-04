# Basemap Test Instructions - OpenStreetMap

## ✅ **Step 1: Test the New Basemap**

### **What We Changed:**

- **From**: CARTO Light (no labels) → **To**: OpenStreetMap (with labels and borders)
- **URL**: `https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png` → `https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png`

### **How to Test:**

1. **Run your development server:**

   ```bash
   npm start
   ```

2. **Check the map appearance:**

   - You should see country names and borders
   - The map should look more detailed than before
   - Colors should be slightly different (more colorful)

3. **Navigate to Serbia-Kosovo region:**

   - **Coordinates**: Around 20°E, 42°N
   - **Zoom level**: 8-10 for best view
   - **Look for**: Dashed or differently styled borders between Serbia and Kosovo

4. **Navigate to Israel-Palestine region:**
   - **Coordinates**: Around 34°E, 31°N
   - **Zoom level**: 8-10 for best view
   - **Look for**: Dotted or differently styled borders (Green Line)

## 🎯 **Expected Results**

### **With OpenStreetMap, you should see:**

1. **Country Labels**: Country names visible on the map
2. **Political Borders**: Clear border lines between countries
3. **Disputed Borders**:
   - **Serbia-Kosovo**: Dashed or differently colored border
   - **Israel-Palestine**: Dotted or differently colored border
4. **More Detail**: Cities, roads, and geographic features

### **Visual Differences:**

- **Before**: Clean, minimal, no labels
- **After**: More detailed, with labels and borders

## 🔍 **What to Look For**

### **Serbia-Kosovo Region:**

- Look for a dashed or differently styled border
- Should be visible around Pristina, Mitrovica areas
- May appear as a dotted line or different color

### **Israel-Palestine Region:**

- Look for the "Green Line" (1967 borders)
- Should be visible around Gaza Strip and West Bank
- May appear as a dotted or dashed line

## 📝 **If You Don't See Disputed Borders**

If the OpenStreetMap doesn't show disputed borders clearly, we can try:

### **Option 2: CartoDB with Labels**

```typescript
L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
  attribution: "© OpenStreetMap contributors © CARTO",
  subdomains: "abcd",
  maxZoom: 20,
}).addTo(this.map);
```

### **Option 3: Stamen Terrain**

```typescript
L.tileLayer(
  "https://stamen-tiles-{s}.a.ssl.fastly.net/terrain/{z}/{x}/{y}{r}.png",
  {
    attribution: 'Map tiles by <a href="http://stamen.com">Stamen Design</a>',
    subdomains: "abcd",
    maxZoom: 18,
  }
).addTo(this.map);
```

## 🚀 **Next Steps**

1. **Test the current OpenStreetMap basemap**
2. **Let me know if you can see disputed borders**
3. **If not, we can try other basemap options**
4. **Once we find the right basemap, we can remove our custom disputed borders code**

**Please test this and let me know:**

- Can you see country names and borders on the map?
- Can you see any disputed border indicators in Serbia-Kosovo or Israel-Palestine regions?
- How does the overall map appearance look compared to before?

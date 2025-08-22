const fs = require('fs');

function createImprovedSplitRowsJSON() {
  try {
    console.log('🔍 Creating improved split-rows JSON for Power BI...');
    
    // Read the original JSON file
    const jsonContent = fs.readFileSync('./choropleth-data.json', 'utf8');
    const data = JSON.parse(jsonContent);
    
    const maxTextLength = 30000; // Well under Power BI's 32,767 limit
    const splitData = [];
    
    data.features.forEach((feature, featureIndex) => {
      const geometryString = JSON.stringify(feature.geometry);
      
      if (geometryString.length <= maxTextLength) {
        // Single row for short geometries
        splitData.push({
          rowId: `${featureIndex}_0`,
          featureIndex: featureIndex,
          adminCode: feature.adminCode,
          countryName: feature.countryName,
          continent: feature.continent,
          isoCode: feature.isoCode,
          geometryPart: 1,
          totalParts: 1,
          geometryString: geometryString,
          geometryType: feature.geometry.type
        });
      } else {
        // For long geometries, we need to split the coordinates array intelligently
        // Instead of splitting the JSON string, we'll split the actual coordinate data
        const geometry = feature.geometry;
        
        if (geometry.type === 'MultiPolygon') {
          const coordinates = geometry.coordinates;
          const parts = [];
          let currentPart = [];
          let currentLength = 0;
          
          // Split the MultiPolygon coordinates
          for (let i = 0; i < coordinates.length; i++) {
            const polygon = coordinates[i];
            const polygonString = JSON.stringify(polygon);
            
            if (currentLength + polygonString.length > maxTextLength && currentPart.length > 0) {
              // Current part is getting too long, save it and start a new part
              const partGeometry = {
                type: 'MultiPolygon',
                coordinates: currentPart
              };
              parts.push(JSON.stringify(partGeometry));
              currentPart = [polygon];
              currentLength = polygonString.length;
            } else {
              currentPart.push(polygon);
              currentLength += polygonString.length;
            }
          }
          
          // Add the last part
          if (currentPart.length > 0) {
            const partGeometry = {
              type: 'MultiPolygon',
              coordinates: currentPart
            };
            parts.push(JSON.stringify(partGeometry));
          }
          
          // Create a row for each part
          parts.forEach((part, partIndex) => {
            splitData.push({
              rowId: `${featureIndex}_${partIndex}`,
              featureIndex: featureIndex,
              adminCode: feature.adminCode,
              countryName: feature.countryName,
              continent: feature.continent,
              isoCode: feature.isoCode,
              geometryPart: partIndex + 1,
              totalParts: parts.length,
              geometryString: part,
              geometryType: 'MultiPolygon'
            });
          });
        } else if (geometry.type === 'Polygon') {
          // For single polygons, split the coordinates array
          const coordinates = geometry.coordinates;
          const parts = [];
          let currentPart = [];
          let currentLength = 0;
          
          for (let i = 0; i < coordinates.length; i++) {
            const ring = coordinates[i];
            const ringString = JSON.stringify(ring);
            
            if (currentLength + ringString.length > maxTextLength && currentPart.length > 0) {
              // Current part is getting too long, save it and start a new part
              const partGeometry = {
                type: 'Polygon',
                coordinates: currentPart
              };
              parts.push(JSON.stringify(partGeometry));
              currentPart = [ring];
              currentLength = ringString.length;
            } else {
              currentPart.push(ring);
              currentLength += ringString.length;
            }
          }
          
          // Add the last part
          if (currentPart.length > 0) {
            const partGeometry = {
              type: 'Polygon',
              coordinates: currentPart
            };
            parts.push(JSON.stringify(partGeometry));
          }
          
          // Create a row for each part
          parts.forEach((part, partIndex) => {
            splitData.push({
              rowId: `${featureIndex}_${partIndex}`,
              featureIndex: featureIndex,
              adminCode: feature.adminCode,
              countryName: feature.countryName,
              continent: feature.continent,
              isoCode: feature.isoCode,
              geometryPart: partIndex + 1,
              totalParts: parts.length,
              geometryString: part,
              geometryType: 'Polygon'
            });
          });
        } else {
          // For other geometry types, just use the original
          splitData.push({
            rowId: `${featureIndex}_0`,
            featureIndex: featureIndex,
            adminCode: feature.adminCode,
            countryName: feature.countryName,
            continent: feature.continent,
            isoCode: feature.isoCode,
            geometryPart: 1,
            totalParts: 1,
            geometryString: geometryString,
            geometryType: feature.geometry.type
          });
        }
      }
    });
    
    // Create the output file
    const outputData = {
      metadata: {
        source: 'Improved split-rows choropleth data for Power BI',
        generatedAt: new Date().toISOString(),
        originalFeatures: data.features.length,
        totalRows: splitData.length,
        maxTextLength: maxTextLength,
        description: 'Long geometries intelligently split into multiple valid GeoJSON parts to avoid Power BI text limits'
      },
      data: splitData
    };
    
    // Write the improved split-rows JSON
    const outputPath = './choropleth-split-rows-improved.json';
    fs.writeFileSync(outputPath, JSON.stringify(outputData, null, 2), 'utf8');
    
    console.log('✅ Improved split-rows JSON created successfully:');
    console.log(`- Output path: ${outputPath}`);
    console.log(`- File size: ${(fs.statSync(outputPath).size / 1024 / 1024).toFixed(2)} MB`);
    console.log(`- Original features: ${data.features.length}`);
    console.log(`- Total rows: ${splitData.length}`);
    
    // Show statistics
    const singleRowFeatures = splitData.filter(row => row.totalParts === 1).length;
    const multiRowFeatures = splitData.filter(row => row.totalParts > 1).length;
    const maxParts = Math.max(...splitData.map(row => row.totalParts));
    
    console.log('\n📊 Split Statistics:');
    console.log(`- Single-row features: ${singleRowFeatures}`);
    console.log(`- Multi-row features: ${multiRowFeatures}`);
    console.log(`- Maximum parts per feature: ${maxParts}`);
    
    // Test the first few entries
    console.log('\n🔍 First 5 entries:');
    splitData.slice(0, 5).forEach((entry, index) => {
      console.log(`\n  Entry ${index}:`);
      console.log(`  - Row ID: ${entry.rowId}`);
      console.log(`  - Country: ${entry.countryName}`);
      console.log(`  - Admin Code: ${entry.adminCode}`);
      console.log(`  - Part: ${entry.geometryPart}/${entry.totalParts}`);
      console.log(`  - Geometry Length: ${entry.geometryString.length} chars`);
      console.log(`  - Geometry Type: ${entry.geometryType}`);
      
      // Validate that the geometry string is valid JSON
      try {
        const parsed = JSON.parse(entry.geometryString);
        console.log(`  - ✅ Valid JSON: ${parsed.type} with ${parsed.coordinates.length} coordinate arrays`);
      } catch (error) {
        console.log(`  - ❌ Invalid JSON: ${error.message}`);
      }
    });
    
    // Show some split examples
    const splitExamples = splitData.filter(row => row.totalParts > 1).slice(0, 3);
    console.log('\n🔍 Split Examples:');
    splitExamples.forEach(example => {
      console.log(`\n  ${example.countryName}:`);
      console.log(`  - Total parts: ${example.totalParts}`);
      console.log(`  - Part ${example.geometryPart}: ${example.geometryString.length} chars`);
      
      // Validate the split part
      try {
        const parsed = JSON.parse(example.geometryString);
        console.log(`  - ✅ Valid part: ${parsed.type} with ${parsed.coordinates.length} coordinate arrays`);
      } catch (error) {
        console.log(`  - ❌ Invalid part: ${error.message}`);
      }
    });
    
    // Validate all geometry strings
    console.log('\n🔍 Validating all geometry strings...');
    let validCount = 0;
    let invalidCount = 0;
    
    splitData.forEach((row, index) => {
      try {
        JSON.parse(row.geometryString);
        validCount++;
      } catch (error) {
        invalidCount++;
        if (invalidCount <= 5) { // Only show first 5 errors
          console.log(`❌ Row ${index} (${row.countryName}): Invalid JSON - ${error.message}`);
        }
      }
    });
    
    console.log(`\n📊 Validation Results:`);
    console.log(`- Valid geometry strings: ${validCount}`);
    console.log(`- Invalid geometry strings: ${invalidCount}`);
    console.log(`- Success rate: ${((validCount / splitData.length) * 100).toFixed(2)}%`);
    
    console.log('\n💡 Usage in Power BI:');
    console.log('1. Import this improved split-rows JSON file');
    console.log('2. Expand the "data" table');
    console.log('3. The visual will automatically reconstruct geometries from multiple rows');
    console.log('4. Use featureIndex to group related rows together');
    console.log('5. Each part contains valid GeoJSON that can be parsed individually');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
  }
}

createImprovedSplitRowsJSON();

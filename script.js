// Global person image - loaded once at startup
let personImage = null;
let personImageLoaded = false;

// Load person image on page load
window.addEventListener('DOMContentLoaded', function() {
    const img = new Image();
    img.onload = function() {
        personImage = img;
        personImageLoaded = true;
        console.log('Person image loaded successfully');
    };
    img.onerror = function() {
        console.warn('Person image failed to load');
        personImageLoaded = true; // Still set to true so we don't wait forever
    };
    img.src = './images/person_AdobeStock_1239257467.png';
});

document.getElementById('file-input').addEventListener('change', handleFileSelect);

function handleFileSelect(event) {
    const files = event.target.files;
    const gallery = document.getElementById('image-gallery');
    gallery.innerHTML = ''; // Clear previous images

    const processedIdentifiedTrees = new Set(); // Track unique identified tree sets
    const fileResults = []; // Store file processing results

    // First pass: collect all file data
    let filesProcessed = 0;
    const totalFiles = files.length;

    for (const file of files) {
        if (!file.name.endsWith('.json')) {
            console.warn(`Skipping non-JSON file: ${file.name}`);
            continue;
        }

        const reader = new FileReader();
        
        reader.onload = function(e) {
            try {
                const fileContent = e.target.result;
                const data = JSON.parse(fileContent);
                
                const treeInfo = JSON.parse(data.scenario.trees);
                const fileNameStem = file.name.replace(/\.json$/, '');
                const identifiedTrees = data.result?.identifiedTrees || '';
                
                fileResults.push({
                    treeInfo,
                    fileNameStem,
                    identifiedTrees,
                    originalFile: file.name
                });

            } catch (error) {
                console.error(`Error processing file ${file.name}:`, error);
                alert(`Could not process ${file.name}. Is it a valid JSON file?`);
            }

            filesProcessed++;
            if (filesProcessed === totalFiles) {
                // All files processed, now optionally validate that all files model the same park
                const checkSameParkEl = document.getElementById('check-same-park');
                const shouldCheckSamePark = checkSameParkEl ? checkSameParkEl.checked : true;

                if (shouldCheckSamePark) {
                    if (!validateSamePark(fileResults, gallery)) {
                        // Validation failed — do not proceed to generate images
                        return;
                    }
                }

                // Proceed to generate images
                processFileResults(fileResults, processedIdentifiedTrees, gallery);
            }
        };

        reader.readAsText(file);
    }
}

function processFileResults(fileResults, processedIdentifiedTrees, gallery) {
    for (const result of fileResults) {
        const { treeInfo, fileNameStem, identifiedTrees, originalFile } = result;
        
        // Normalize identified trees for comparison
        const identifiedTreesKey = normalizeIdentifiedTrees(identifiedTrees);
        
        if (processedIdentifiedTrees.has(identifiedTreesKey)) {
            // Skip duplicate - add to skipped list
            addSkippedFileNotice(gallery, fileNameStem, identifiedTrees);
        } else {
            // Process unique file
            processedIdentifiedTrees.add(identifiedTreesKey);
            createImageFromData(treeInfo, fileNameStem, identifiedTrees);
        }
    }
}

function normalizeIdentifiedTrees(identifiedTrees) {
    if (!identifiedTrees || identifiedTrees.trim() === '') {
        return '[]';
    }
    
    // Parse and sort the tree IDs to create a normalized key
    const treeIds = identifiedTrees.split(',')
        .map(id => parseInt(id.trim()))
        .filter(id => !isNaN(id))
        .sort((a, b) => a - b);
    
    return JSON.stringify(treeIds);
}

// Validate that all uploaded files model the same park layout.
// Returns true if all files match; otherwise appends an error notice to the gallery and returns false.
function validateSamePark(fileResults, gallery) {
    if (!fileResults || fileResults.length === 0) return true;

    // Create a canonical signature for a park: width, height, treeRadius, and sorted tree coordinate list
    function parkSignature(treeInfo) {
        const w = treeInfo.width || treeInfo.parkWidth || 30;
        const h = treeInfo.height || treeInfo.parkHeight || 30;
        const r = treeInfo.treeRadius || 0;

        const coords = (treeInfo.trees || []).map(t => `${t.treeId}:${Number(t.x).toFixed(6)},${Number(t.y).toFixed(6)}`);
        coords.sort();

        return `${w}x${h}|r=${r}|${coords.join('|')}`;
    }

    const signatures = fileResults.map(fr => {
        try {
            return parkSignature(fr.treeInfo);
        } catch (e) {
            return null;
        }
    });

    const unique = Array.from(new Set(signatures.filter(s => s !== null)));

    if (unique.length <= 1) return true;

    // Mismatch detected — show a single clear failure notice in the gallery
    const galleryItem = document.createElement('div');
    galleryItem.className = 'gallery-item';
    galleryItem.style.backgroundColor = '#fff3f3';
    galleryItem.style.border = '2px solid #dc3545';

    const notice = document.createElement('div');
    notice.style.padding = '1.5rem';
    notice.style.textAlign = 'left';

    const title = document.createElement('h3');
    title.textContent = `Park model mismatch — processing aborted`;
    title.style.margin = '0 0 0.5rem 0';
    title.style.color = '#a71d2a';

    const msg = document.createElement('p');
    msg.textContent = 'The selected files do not all model the same park (dimensions or tree layout differ). Please select files representing the same park.';
    msg.style.margin = '0 0 0.75rem 0';

    const details = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = 'View detected park signatures';
    details.appendChild(summary);

    const list = document.createElement('ul');
    for (let i = 0; i < fileResults.length; i++) {
        const li = document.createElement('li');
        li.textContent = `${fileResults[i].originalFile}: ${signatures[i] || 'invalid'} `;
        list.appendChild(li);
    }
    details.appendChild(list);

    notice.appendChild(title);
    notice.appendChild(msg);
    notice.appendChild(details);
    galleryItem.appendChild(notice);
    gallery.appendChild(galleryItem);

    return false;
}

function addSkippedFileNotice(gallery, fileNameStem, identifiedTrees) {
    const galleryItem = document.createElement('div');
    galleryItem.className = 'gallery-item';
    galleryItem.style.backgroundColor = '#f8f9fa';
    galleryItem.style.border = '2px dashed #6c757d';
    
    const notice = document.createElement('div');
    notice.style.padding = '2rem';
    notice.style.textAlign = 'center';
    notice.style.color = '#6c757d';
    
    const title = document.createElement('h3');
    title.textContent = `${fileNameStem} - SKIPPED`;
    title.style.margin = '0 0 1rem 0';
    title.style.color = '#6c757d';
    
    const reason = document.createElement('p');
    reason.textContent = `Duplicate identified trees: ${identifiedTrees || 'none'}`;
    reason.style.margin = '0';
    reason.style.fontSize = '0.9rem';
    
    notice.appendChild(title);
    notice.appendChild(reason);
    galleryItem.appendChild(notice);
    gallery.appendChild(galleryItem);
}


function createImageFromData(treeData, fileNameStem, identifiedTrees) {
    const gallery = document.getElementById('image-gallery');

    const parkDim = { width: 30, height: 30 };
    const border = 2;
    const totalDim = {
        width: parkDim.width + border * 2,
        height: parkDim.height + border * 2
    };

    // Parse identified trees to remove
    const treesToRemove = new Set();
    if (identifiedTrees && identifiedTrees.trim() !== '') {
        identifiedTrees.split(',')
            .map(id => parseInt(id.trim()))
            .filter(id => !isNaN(id))
            .forEach(id => treesToRemove.add(id));
    }

    // Filter out identified trees
    const remainingTrees = treeData.trees.filter(tree => !treesToRemove.has(tree.treeId));

    const canvas = document.createElement('canvas');
    canvas.width = 1360;
    canvas.height = 1360;
    const ctx = canvas.getContext('2d');
    const scale = canvas.width / totalDim.width;
    const border_px = border * scale;
    
    // Check if person image is ready, if not wait a bit
    if (!personImageLoaded) {
        setTimeout(() => createImageFromData(treeData, fileNameStem, identifiedTrees), 100);
        return;
    }
    
    // Draw everything immediately since person image is already loaded
    drawCompleteImage(ctx, canvas, parkDim, border, border_px, scale, totalDim, remainingTrees, treeData, personImage, gallery, fileNameStem, identifiedTrees, treesToRemove);
}


function drawCompleteImage(ctx, canvas, parkDim, border, border_px, scale, totalDim, remainingTrees, treeData, personImg, gallery, fileNameStem, identifiedTrees, treesToRemove) {
    // 1. Draw base grey background
    ctx.fillStyle = 'grey';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // 2. Draw the scale bands
    const meterInPixels = 1 * scale;
    const darkBandColor = '#888888';
    const lightBandColor = '#AAAAAA';
    
    for (let i = 0; i < totalDim.width; i++) {
        // Use Math.floor(i / 2) to create 2-meter bands
        const color = (Math.floor(i / 2) % 2 === 0) ? darkBandColor : lightBandColor;
        ctx.fillStyle = color;
        const currentPos = i * meterInPixels;

        // Top, Bottom, Left, Right bands
        ctx.fillRect(currentPos, 0, meterInPixels, border_px);
        ctx.fillRect(currentPos, canvas.height - border_px, meterInPixels, border_px);
        ctx.fillRect(0, currentPos, border_px, meterInPixels);
        ctx.fillRect(canvas.width - border_px, currentPos, border_px, meterInPixels);
    }

    // Draw labels every 2 meters along the bottom
    ctx.font = `${Math.round(scale * 0.75)}px sans-serif`;
    ctx.fillStyle = 'white';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (let i = 0; i <= parkDim.width; i += 2) {
        const label = `${i}m`;
        const pos_on_axis = (i + border) * scale;

        if ((i > 10 && i < 20) || (i > 20 && i < 30)) {
            continue; // Skip labels between 10-20m and 20-30m
        }

        // Bottom labels only
        ctx.fillText(label, pos_on_axis, canvas.height - (border_px / 2));
    }

    // Draw person for scale if image loaded
    if (personImg) {
        drawPersonImageForScale(ctx, canvas.width / 2, canvas.height - (border_px / 2), scale, personImg);
    }

    // 3. Draw light green park area on top of the bands
    ctx.fillStyle = 'lightgreen';
    ctx.fillRect(
        border_px,
        border_px,
        parkDim.width * scale,
        parkDim.height * scale
    );

    // 4. Draw remaining trees and shadows
    const treeRadius = treeData.treeRadius * scale;
    remainingTrees.forEach(tree => {
        const cx = (tree.x + border) * scale;
        const cy = canvas.height - ((tree.y + border) * scale);

        const shadowRadius = treeRadius * 1.6;
        const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, shadowRadius);
        gradient.addColorStop(0.3, 'rgba(0, 0, 0, 0.4)');
        gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(cx, cy, shadowRadius, 0, 2 * Math.PI, false);
        ctx.fill();

        ctx.fillStyle = 'darkgreen';
        ctx.beginPath();
        ctx.arc(cx, cy, treeRadius, 0, 2 * Math.PI, false);
        ctx.fill();
    });

    // 5. Append the final image to the gallery
    const galleryItem = document.createElement('div');
    galleryItem.className = 'gallery-item';
    
    const title = document.createElement('h3');
    title.style.margin = '0 0 1rem 0';
    title.style.fontSize = '1.1rem';
    title.textContent = fileNameStem;
    
    const info = document.createElement('p');
    info.style.margin = '0 0 1rem 0';
    info.style.fontSize = '0.9rem';
    info.style.color = '#666';
    
    const totalTrees = treeData.trees.length;
    const removedCount = treesToRemove.size;
    const remainingCount = remainingTrees.length;
    
    if (removedCount > 0) {
        info.innerHTML = `Trees removed: ${Array.from(treesToRemove).sort((a,b) => a-b).join(', ')}<br>` +
                        `${remainingCount} of ${totalTrees} trees remaining`;
    } else {
        info.textContent = `All ${totalTrees} trees shown (none removed)`;
    }
    
    const img = document.createElement('img');
    img.src = canvas.toDataURL('png');
    img.alt = `Park layout for ${fileNameStem}`;
    
    const downloadLink = document.createElement('a');
    downloadLink.href = img.src;
    downloadLink.download = `${fileNameStem}.png`;
    downloadLink.textContent = `Download ${fileNameStem}.png`;
    
    galleryItem.appendChild(title);
    galleryItem.appendChild(info);
    galleryItem.appendChild(img);
    galleryItem.appendChild(downloadLink);
    gallery.appendChild(galleryItem);
}



function drawPersonImageForScale(ctx, centerX, centerY, scale, personImg) {
    // Image (per person size) is approximately 2m tall, drawn to scale
    const imageHeight = 2 * scale;
    
    // Calculate width to maintain aspect ratio
    const aspectRatio = personImg.width / personImg.height;
    const imageWidth = imageHeight * aspectRatio;
    
    // Position person centered horizontally, standing on bottom border
    const x = centerX - imageWidth / 2;
    // const y = centerY - imageHeight + (scale * 0.2); // Slightly above border line
    const y = centerY - imageHeight / 2; // Slightly above border line
    
    ctx.drawImage(personImg, x, y, imageWidth, imageHeight);
}


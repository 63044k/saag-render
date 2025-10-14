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
                    originalFile: file.name,
                    rawData: data
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
                const checkSameMetaEl = document.getElementById('check-same-meta');
                const shouldCheckSameMeta = checkSameMetaEl ? checkSameMetaEl.checked : true;

                let parkOk = true;
                let metaOk = true;

                if (shouldCheckSamePark) {
                    parkOk = validateSamePark(fileResults, gallery);
                    if (!parkOk) {
                        // Validation failed — do not proceed to generate images
                        return;
                    }
                }

                if (shouldCheckSameMeta) {
                    metaOk = validateSameMeta(fileResults, gallery);
                    if (!metaOk) {
                        // Validation failed — do not proceed to generate images
                        return;
                    }
                }

                // If both checks were requested and both passed, render the original (no-removal) park image
                if (shouldCheckSamePark && shouldCheckSameMeta && parkOk && metaOk && fileResults.length > 0) {
                    // Derive a concise filename stem from the first file
                    function deriveOriginalStem(stem) {
                        if (!stem) return stem;
                        // find the position of the second closing bracket ]
                        const firstIdx = stem.indexOf(']');
                        if (firstIdx === -1) return stem;
                        const secondIdx = stem.indexOf(']', firstIdx + 1);
                        if (secondIdx === -1) return stem;
                        // include up to secondIdx
                        return stem.substring(0, secondIdx + 1);
                    }

                    const first = fileResults[0];
                    const originalStem = deriveOriginalStem(first.fileNameStem) || first.fileNameStem;
                    // Render the original park (no trees removed)
                    createImageFromData(first.treeInfo, originalStem, '', { modelTag: 'ORIGINAL' });
                }

                // Proceed to generate images (process all files; duplicates will be tagged)
                processFileResults(fileResults, gallery);
            }
        };

        reader.readAsText(file);
    }
}

// Global array to hold generated images for zipping
const generatedImages = [];
// Store last run fileResults for building metadata
let lastFileResults = [];

// Wire up Download All button
window.addEventListener('DOMContentLoaded', function() {
    const btn = document.getElementById('download-all');
    if (btn) {
        async function ensureJSZip() {
            if (typeof JSZip !== 'undefined') return JSZip;
            // Dynamically load fallback script (no integrity) and wait for it
            return new Promise((resolve, reject) => {
                const s = document.createElement('script');
                s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.7.1/jszip.min.js';
                s.onload = () => {
                    if (typeof JSZip !== 'undefined') resolve(JSZip);
                    else reject(new Error('JSZip did not initialize'));
                };
                s.onerror = () => reject(new Error('Failed to load JSZip'));
                document.head.appendChild(s);
            });
        }

        btn.addEventListener('click', async function() {
            if (generatedImages.length === 0) return;

            try {
                await ensureJSZip();
            } catch (err) {
                alert('Could not load JSZip library. Please check your network or try again later.');
                console.error('JSZip load error', err);
                return;
            }

            const zip = new JSZip();
            for (const item of generatedImages) {
                // item.data is a data URL like 'data:image/png;base64,...'
                const base64 = item.data.split(',')[1];
                zip.file(item.filename, base64, {base64: true});
            }
            // Build metadata manifest and add to zip
            try {
                const manifest = {
                    generatedAt: new Date().toISOString(),
                    images: generatedImages.map(g => ({
                        filename: g.filename,
                        originalFile: g.originalFile,
                        model: g.model,
                        hintMode: g.hintMode,
                        normalizedKey: g.normalizedKey,
                        modelTag: g.modelTag,
                        modelHintTag: g.modelHintTag
                    })),
                    duplicates: {}
                };

                // include duplicate sets from lastFileResults
                if (lastFileResults && lastFileResults.length > 0) {
                    const modelGroups = {};
                    const modelHintGroups = {};
                    const mapping = {};
                    lastFileResults.forEach(fr => {
                        const m = fr._model || '<<unknown>>';
                        const key = fr._normalizedKey || fr.identifiedTrees || '';
                        if (!modelGroups[m]) modelGroups[m] = {};
                        if (!modelGroups[m][key]) modelGroups[m][key] = [];
                        modelGroups[m][key].push(fr.originalFile);

                        const mh = fr._hintMode || '';
                        if (!modelHintGroups[m]) modelHintGroups[m] = {};
                        if (!modelHintGroups[m][mh]) modelHintGroups[m][mh] = {};
                        if (!modelHintGroups[m][mh][key]) modelHintGroups[m][mh][key] = [];
                        modelHintGroups[m][mh][key].push(fr.originalFile);
                        // find produced filename(s) matching this originalFile in generatedImages
                        const produced = generatedImages.filter(g => g.originalFile === fr.originalFile).map(g => g.filename);
                        mapping[fr.originalFile] = produced;
                    });

                    manifest.duplicates.modelGroups = modelGroups;
                    manifest.duplicates.modelHintGroups = modelHintGroups;
                    manifest.mapping = mapping;
                }

                zip.file('metadata.json', JSON.stringify(manifest, null, 2));
            } catch (me) {
                console.warn('Could not create metadata manifest', me);
            }

            const content = await zip.generateAsync({type: 'blob'});
            const url = URL.createObjectURL(content);
            const a = document.createElement('a');
            a.href = url;
            // generate timestamp YYYYMMDD-HHMMSS
            const d = new Date();
            const pad = (n) => String(n).padStart(2, '0');
            const ts = `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
            a.download = `${ts}_park_images.zip`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
        });
    }
});

function processFileResults(fileResults, gallery) {
    // Build grouping maps to detect duplicates
    // modelMap: model -> Map<identifiedKey, [indices]>
    const modelMap = new Map();
    // modelHintMap: model -> Map<hintMode -> Map<identifiedKey, [indices]>>
    const modelHintMap = new Map();

    fileResults.forEach((fr, idx) => {
        const key = normalizeIdentifiedTrees(fr.identifiedTrees);
        fr._normalizedKey = key;

        const model = (fr.rawData && fr.rawData.llm && fr.rawData.llm.model) ? fr.rawData.llm.model : '<<unknown>>';
        fr._model = model;

        const hintMode = (fr.rawData && fr.rawData.scenario && fr.rawData.scenario.hintMode) ? fr.rawData.scenario.hintMode : '';
        fr._hintMode = hintMode;

        if (!modelMap.has(model)) modelMap.set(model, new Map());
        const mm = modelMap.get(model);
        if (!mm.has(key)) mm.set(key, []);
        mm.get(key).push(idx);

        if (!modelHintMap.has(model)) modelHintMap.set(model, new Map());
        const mh = modelHintMap.get(model);
        if (!mh.has(hintMode)) mh.set(hintMode, new Map());
        const mhmap = mh.get(hintMode);
        if (!mhmap.has(key)) mhmap.set(key, []);
        mhmap.get(key).push(idx);
    });

    // helper: convert 0 -> A, 1 -> B, ... 25 -> Z, 26 -> AA, etc.
    function indexToLetters(n) {
        let s = '';
        n++; // make 1-based
        while (n > 0) {
            const rem = (n - 1) % 26;
            s = String.fromCharCode(65 + rem) + s;
            n = Math.floor((n - 1) / 26);
        }
        return s;
    }

    // Assign M.* tags per model groups
    for (const [model, mm] of modelMap.entries()) {
        let counter = 0;
        for (const [key, arr] of mm.entries()) {
            if (arr.length > 1) {
                const tag = `M.${indexToLetters(counter)}`;
                arr.forEach(i => fileResults[i].modelTag = tag);
                counter++;
            }
        }
    }

    // Assign MH.* tags per model+hintMode groups
    for (const [model, mh] of modelHintMap.entries()) {
        for (const [hintMode, mhmap] of mh.entries()) {
            let counter = 0;
            for (const [key, arr] of mhmap.entries()) {
                if (arr.length > 1) {
                    const tag = `MH.${indexToLetters(counter)}`;
                    arr.forEach(i => fileResults[i].modelHintTag = tag);
                    counter++;
                }
            }
        }
    }

    // Save last results for metadata
    lastFileResults = fileResults;

    // Finally, render an image for every file, including any assigned tags and metadata
    for (const fr of fileResults) {
        createImageFromData(fr.treeInfo, fr.fileNameStem, fr.identifiedTrees, {
            modelTag: fr.modelTag,
            modelHintTag: fr.modelHintTag,
            sourceOriginal: fr.originalFile,
            model: fr._model,
            hintMode: fr._hintMode,
            normalizedKey: fr._normalizedKey
        });
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

// Validate that all uploaded files share the same meta tag value.
// Returns true if all files match; otherwise appends an error notice to the gallery and returns false.
function validateSameMeta(fileResults, gallery) {
    if (!fileResults || fileResults.length === 0) return true;

    // Extract meta tag value from parsed rawData
    function metaValue(rawData) {
        if (!rawData) return null;
        // Use explicit meta.tag as per provided sample JSON
        if (rawData.meta && typeof rawData.meta.tag !== 'undefined' && rawData.meta.tag !== null) {
            return String(rawData.meta.tag).trim();
        }
        return null;
    }

    const metas = fileResults.map(fr => {
        try {
            const v = metaValue(fr.rawData);
            return v === null ? null : v; // case-sensitive comparison
        } catch (e) {
            return null;
        }
    });

    const unique = Array.from(new Set(metas.filter(m => m !== null)));

    // If no meta present across files, consider them matching (nothing to compare)
    if (unique.length <= 1) return true;

    // Mismatch detected — show a clear failure notice in the gallery
    const galleryItem = document.createElement('div');
    galleryItem.className = 'gallery-item';
    galleryItem.style.backgroundColor = '#fff3f3';
    galleryItem.style.border = '2px solid #dc3545';

    const notice = document.createElement('div');
    notice.style.padding = '1.5rem';
    notice.style.textAlign = 'left';

    const title = document.createElement('h3');
    title.textContent = `Meta tag mismatch — processing aborted`;
    title.style.margin = '0 0 0.5rem 0';
    title.style.color = '#a71d2a';

    const msg = document.createElement('p');
    msg.textContent = 'The selected files do not all contain the same meta tag. Please select files with the same meta value.';
    msg.style.margin = '0 0 0.75rem 0';

    const details = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = 'View detected meta values';
    details.appendChild(summary);

    const list = document.createElement('ul');
    for (let i = 0; i < fileResults.length; i++) {
        const li = document.createElement('li');
        // show original meta value (not lowercased) if present
        const raw = (fileResults[i].rawData && fileResults[i].rawData.meta && fileResults[i].rawData.meta.tag) ? String(fileResults[i].rawData.meta.tag) : 'none';
        li.textContent = `${fileResults[i].originalFile}: ${raw}`;
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


function createImageFromData(treeData, fileNameStem, identifiedTrees, tags = {}) {
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
    drawCompleteImage(ctx, canvas, parkDim, border, border_px, scale, totalDim, remainingTrees, treeData, personImage, gallery, fileNameStem, identifiedTrees, treesToRemove, tags);
}


function drawCompleteImage(ctx, canvas, parkDim, border, border_px, scale, totalDim, remainingTrees, treeData, personImg, gallery, fileNameStem, identifiedTrees, treesToRemove, tags = {}) {
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
    // Append tags if present
    if (tags && (tags.modelTag || tags.modelHintTag)) {
        const tagSpan = document.createElement('span');
        tagSpan.style.marginLeft = '0.5rem';
        tagSpan.style.fontSize = '0.9rem';
        tagSpan.style.color = '#0056b3';
        tagSpan.textContent = ` ${tags.modelTag ? '[' + tags.modelTag + ']' : ''}${tags.modelHintTag ? ' ' + '[' + tags.modelHintTag + ']' : ''}`;
        title.appendChild(tagSpan);
    }
    
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
    
    // Register generated image for bulk download (no per-image download link shown)
    try {
        // Build filename with appended tags if present
        let downloadStem = fileNameStem;
        if (tags && tags.modelTag) downloadStem += `_[${tags.modelTag}]`;
        if (tags && tags.modelHintTag) downloadStem += `_[${tags.modelHintTag}]`;
        generatedImages.push({ 
            filename: `${downloadStem}.png`, 
            data: img.src,
            originalFile: tags && tags.sourceOriginal ? tags.sourceOriginal : null,
            model: tags && tags.model ? tags.model : (tags && tags.sourceModel ? tags.sourceModel : null),
            hintMode: tags && tags.hintMode ? tags.hintMode : (tags && tags.sourceHintMode ? tags.sourceHintMode : null),
            normalizedKey: tags && tags.normalizedKey ? tags.normalizedKey : null,
            modelTag: tags && tags.modelTag ? tags.modelTag : null,
            modelHintTag: tags && tags.modelHintTag ? tags.modelHintTag : null
        });
        const btn = document.getElementById('download-all');
        if (btn) btn.disabled = false;
    } catch (e) {
        console.warn('Could not register generated image for bulk download', e);
    }
    
    galleryItem.appendChild(title);
    galleryItem.appendChild(info);
    galleryItem.appendChild(img);
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


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
                
                // extract timestamp if present under data.meta.timestamp
                const timestamp = data.meta && data.meta.timestamp ? String(data.meta.timestamp) : null;

                fileResults.push({
                    treeInfo,
                    fileNameStem,
                    identifiedTrees,
                    originalFile: file.name,
                    rawData: data,
                    _timestamp: timestamp
                });

            } catch (error) {
                console.error(`Error processing file ${file.name}:`, error);
                alert(`Could not process ${file.name}. Is it a valid JSON file?`);
            }

            filesProcessed++;
            if (filesProcessed === totalFiles) {
                // All files processed — always proceed to grouping/rendering.
                // Any differences simply form separate groups (no aborts).
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
// Store last grouping info for metadata
let lastGroups = [];

// Helper: derive concise original stem from a filename stem (up to second ])
function deriveOriginalStem(stem) {
    if (!stem) return stem;
    const firstIdx = stem.indexOf(']');
    if (firstIdx === -1) return stem;
    const secondIdx = stem.indexOf(']', firstIdx + 1);
    if (secondIdx === -1) return stem;
    return stem.substring(0, secondIdx + 1);
}

// Helper: create canonical park signature string from treeInfo (same as validateSamePark uses)
function getParkSignature(treeInfo) {
    const w = treeInfo.width || treeInfo.parkWidth || 30;
    const h = treeInfo.height || treeInfo.parkHeight || 30;
    const r = treeInfo.treeRadius || 0;
    const coords = (treeInfo.trees || []).map(t => `${t.treeId}:${Number(t.x).toFixed(6)},${Number(t.y).toFixed(6)}`);
    coords.sort();
    return `${w}x${h}|r=${r}|${coords.join('|')}`;
}

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
                        timestamp: g.timestamp,
                        modelTag: g.modelTag,
                        modelHintTag: g.modelHintTag,
                        groupTag: g.groupTag || null
                    })),
                    groups: lastGroups || [],
                    duplicates: {}
                };

                // include duplicate sets and mapping from lastFileResults for compatibility
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
    // Group files by park signature + meta.tag + meta.timestamp
    lastFileResults = fileResults;
    generatedImages.length = 0;
    lastGroups = [];

    // Build groups map
    const groups = new Map();
    fileResults.forEach(fr => {
        const sig = getParkSignature(fr.treeInfo);
        const tag = fr.rawData && fr.rawData.meta && fr.rawData.meta.tag ? String(fr.rawData.meta.tag) : '';
        const ts = fr._timestamp || '';
        const csvHash = fr.rawData && fr.rawData.scenario && fr.rawData.scenario.csvHash ? String(fr.rawData.scenario.csvHash) : '';
        const gkey = `${sig}||${tag}||${ts}`;
        if (!groups.has(gkey)) groups.set(gkey, { sig, tag, ts, csvHash, members: [] });
        groups.get(gkey).members.push(fr);
    });

    // Order groups by the first file appearance in original selection
    const orderedGroups = Array.from(groups.values());
    orderedGroups.sort((a, b) => {
        const aIdx = fileResults.indexOf(a.members[0]);
        const bIdx = fileResults.indexOf(b.members[0]);
        return aIdx - bIdx;
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

    // Render each group as its own section, assign tags locally within group
    orderedGroups.forEach((group, gi) => {
        const section = document.createElement('div');
        section.className = 'group-section';
        const header = document.createElement('h3');
        // Display order: timestamp first, csvHash second (named "park layout"), tag last (named "run tag")
        header.textContent = `Group ${gi + 1}: timestamp="${group.ts}" park layout="${group.csvHash}" run tag="${group.tag}" members=${group.members.length}`;
        section.appendChild(header);
        // create an original box (single row) and a grid for solution images
        const originalBox = document.createElement('div');
        originalBox.className = 'original-box';
        const solutionsGrid = document.createElement('div');
        solutionsGrid.className = 'group-grid';
        section.appendChild(originalBox);
        section.appendChild(solutionsGrid);
        gallery.appendChild(section);

        // build duplicate maps local to group
        const modelMap = new Map();
        const modelHintMap = new Map();

        group.members.forEach((fr, idx) => {
            const key = normalizeIdentifiedTrees(fr.identifiedTrees);
            fr._normalizedKey = key;
            const model = (fr.rawData && fr.rawData.llm && fr.rawData.llm.model) ? fr.rawData.llm.model : '<<unknown>>';
            fr._model = model;
            const hintMode = (fr.rawData && fr.rawData.scenario && fr.rawData.scenario.hintMode) ? fr.rawData.scenario.hintMode : '';
            fr._hintMode = hintMode;

            if (!modelMap.has(model)) modelMap.set(model, new Map());
            const mm = modelMap.get(model);
            if (!mm.has(key)) mm.set(key, []);
            mm.get(key).push(fr);

            const mhKey = model + '|' + hintMode;
            if (!modelHintMap.has(mhKey)) modelHintMap.set(mhKey, new Map());
            const mhmap = modelHintMap.get(mhKey);
            if (!mhmap.has(key)) mhmap.set(key, []);
            mhmap.get(key).push(fr);
        });

        // assign M.* within group
        for (const [model, mm] of modelMap.entries()) {
            let counter = 0;
            for (const [k, arr] of mm.entries()) {
                if (arr.length > 1) {
                    const tag = `M.${indexToLetters(counter)}`;
                    arr.forEach(fr => {
                        fr.modelTag = fr.modelTag || tag;
                    });
                    counter++;
                }
            }
        }

        // assign MH.* within group
        for (const [mhKey, mhmap] of modelHintMap.entries()) {
            let counter = 0;
            for (const [k, arr] of mhmap.entries()) {
                if (arr.length > 1) {
                    const tag = `MH.${indexToLetters(counter)}`;
                    arr.forEach(fr => {
                        fr.modelHintTag = fr.modelHintTag || tag;
                    });
                    counter++;
                }
            }
        }

        // create ORIGINAL from first member (displayed full-width in originalBox)
        const first = group.members[0];
        const originalStem = deriveOriginalStem(first.fileNameStem) || first.fileNameStem;
        createImageFromData(first.treeInfo, originalStem, '', { modelTag: 'ORIGINAL', sourceOriginal: first.originalFile, model: first._model, hintMode: first._hintMode, normalizedKey: first._normalizedKey, timestamp: first._timestamp, csvHash: group.csvHash }, originalBox);

        // render member solution images in the solutionsGrid (include the first so ORIGINAL and solution both show)
        group.members.forEach((fr, idx) => {
            const stem = fr.fileNameStem;
            createImageFromData(fr.treeInfo, stem, fr.identifiedTrees, {
                modelTag: fr.modelTag,
                modelHintTag: fr.modelHintTag,
                sourceOriginal: fr.originalFile,
                model: fr._model,
                hintMode: fr._hintMode,
                normalizedKey: fr._normalizedKey,
                timestamp: fr._timestamp,
                csvHash: group.csvHash
            }, solutionsGrid);
        });

        // record for manifest
        lastGroups.push({
            tag: group.tag,
            timestamp: group.ts,
            csvHash: group.csvHash,
            // friendly aliases for external consumption
            parkLayout: group.csvHash,
            runTag: group.tag,
            members: group.members.map(m => ({ file: m.originalFile, tags: [m.modelTag, m.modelHintTag].filter(Boolean) }))
        });
    });
}

// Validate that all uploaded files share the same meta.timestamp value.
// Returns true if all files match; otherwise appends an error notice to the gallery and returns false.
function validateSameTimestamp(fileResults, gallery) {
    if (!fileResults || fileResults.length === 0) return true;

    const timestamps = fileResults.map(fr => fr._timestamp || null);
    const unique = Array.from(new Set(timestamps.filter(t => t !== null)));

    // If no timestamps present across files, consider them matching
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
    title.textContent = `Timestamp mismatch — processing aborted`;
    title.style.margin = '0 0 0.5rem 0';
    title.style.color = '#a71d2a';

    const msg = document.createElement('p');
    msg.textContent = 'The selected files do not all contain the same meta.timestamp. Please select files with the same timestamp.';
    msg.style.margin = '0 0 0.75rem 0';

    const details = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = 'View detected timestamps';
    details.appendChild(summary);

    const list = document.createElement('ul');
    for (let i = 0; i < fileResults.length; i++) {
        const li = document.createElement('li');
        const raw = fileResults[i]._timestamp || 'none';
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


function createImageFromData(treeData, fileNameStem, identifiedTrees, tags = {}, galleryOverride) {
    const gallery = galleryOverride || document.getElementById('image-gallery');

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
        setTimeout(() => createImageFromData(treeData, fileNameStem, identifiedTrees, tags, galleryOverride), 100);
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
    // Tag line: show tags on their own line (or an empty placeholder line)
    const tagLine = document.createElement('span');
    tagLine.className = 'tag-line';
    if (tags && (tags.modelTag || tags.modelHintTag)) {
        const parts = [];
        if (tags.modelTag) parts.push('[' + tags.modelTag + ']');
        if (tags.modelHintTag) parts.push('[' + tags.modelHintTag + ']');
        // If any tag is a duplicate-set tag (starts with M. or MH.), prefix the line
        const isDuplicateTag = (t) => typeof t === 'string' && (t.startsWith('M.') || t.startsWith('MH.'));
        const shouldPrefix = isDuplicateTag(tags.modelTag) || isDuplicateTag(tags.modelHintTag);
        tagLine.textContent = (shouldPrefix ? 'Duplicate sets: ' : '') + parts.join(' ');
    } else {
        tagLine.textContent = '';
    }
    
    const info = document.createElement('p');
    info.style.margin = '0 0 1rem 0';
    info.style.fontSize = '0.9rem';
    info.style.color = '#666';
    
    const totalTrees = treeData.trees.length;
    const removedCount = treesToRemove.size;
    const remainingCount = remainingTrees.length;
    
    // For ORIGINAL images we do not display tree counts
    if (tags && tags.modelTag === 'ORIGINAL') {
        info.textContent = '';
    } else {
        // If any trees were removed, show their IDs on the first line, then remaining on second line.
        if (removedCount > 0) {
            const removedList = Array.from(treesToRemove).sort((a,b)=>a-b).join(', ');
            info.innerHTML = `Tree ids removed: ${removedList}<br>Trees remaining: ${remainingCount} (of ${totalTrees})`;
        } else {
            info.textContent = `Trees remaining: ${remainingCount} (of ${totalTrees})`;
        }
    }
    
    const img = document.createElement('img');
    img.src = canvas.toDataURL('png');
    img.alt = `Park layout for ${fileNameStem}`;
    
    // append image first, then an info container below the image
    galleryItem.appendChild(img);
    const infoBox = document.createElement('div');
    infoBox.style.marginTop = '0.5rem';
    infoBox.style.textAlign = 'left';
    // filename (small, non-bold)
    title.style.margin = '0 0 0.25rem 0';
    title.style.fontSize = '0.78rem';
    title.style.fontWeight = 'normal';
    infoBox.appendChild(title);
    // info paragraph
    infoBox.appendChild(info);
    // tags as a line inside the info paragraph so spacing matches intra-paragraph lines
    info.appendChild(tagLine);
    galleryItem.appendChild(infoBox);
    
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
            timestamp: tags && tags.timestamp ? tags.timestamp : null,
            csvHash: tags && tags.csvHash ? tags.csvHash : (treeData && treeData.csvHash ? treeData.csvHash : null),
            modelTag: tags && tags.modelTag ? tags.modelTag : null,
            modelHintTag: tags && tags.modelHintTag ? tags.modelHintTag : null,
            groupTag: tags && tags.groupTag ? tags.groupTag : null
        });
        const btn = document.getElementById('download-all');
        if (btn) btn.disabled = false;
    } catch (e) {
        console.warn('Could not register generated image for bulk download', e);
    }
    
    // add the gallery item into the provided gallery container
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


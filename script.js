// Global person image - loaded once at startup
let personImage = null;
let personImageLoaded = false;
// Image size (px) used for generated canvases. Default 400, range 100-2000.
let imageSize = 400;
// In-memory map from tag value -> Set of gallery-item elements (for fast highlight lookup)
const tagToElements = new Map();

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

// Initialize image size from localStorage if present
window.addEventListener('DOMContentLoaded', () => {
    try {
        const saved = localStorage.getItem('imageSize');
        const n = saved ? Number(saved) : null;
        if (n && !isNaN(n)) {
            imageSize = Math.max(100, Math.min(2000, n));
        }
    } catch (e) {
        // ignore
    }
});

document.getElementById('file-input').addEventListener('change', handleFileSelect);

function handleFileSelect(event) {
    const files = event.target.files || [];
    const gallery = document.getElementById('image-gallery');
    gallery.innerHTML = ''; // Clear previous images

    const fileResults = []; // Store file processing results

    // Only consider files that end with .json (case-insensitive)
    const fileArray = Array.from(files);
    const jsonFiles = fileArray.filter(f => typeof f.name === 'string' && f.name.toLowerCase().endsWith('.json'));

    if (jsonFiles.length === 0) {
        alert('No JSON files selected. Please select one or more .json files.');
        return;
    }

    // First pass: collect all file data (count only JSON files)
    let filesProcessed = 0;
    const totalFiles = jsonFiles.length;

    for (const file of jsonFiles) {
        const reader = new FileReader();

        reader.onload = function(e) {
            try {
                const fileContent = e.target.result;
                const data = JSON.parse(fileContent);

                // scenario.trees may already be an object or a JSON string; handle both
                let treeInfo = null;
                try {
                    treeInfo = typeof data.scenario?.trees === 'string' ? JSON.parse(data.scenario.trees) : data.scenario?.trees;
                } catch (inner) {
                    // fallback to the raw value if parsing fails
                    treeInfo = data.scenario?.trees;
                }

                const fileNameStem = file.name.replace(/\.json$/i, '');
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
                // Notify but continue processing remaining JSON files
                alert(`Could not process ${file.name}. Is it a valid JSON file?`);
            }

            filesProcessed++;
            if (filesProcessed === totalFiles) {
                // All JSON files processed — proceed to grouping/rendering.
                processFileResults(fileResults, gallery);
            }
        };

        reader.onerror = function(e) {
            console.error(`Failed to read file ${file.name}`, e);
            filesProcessed++;
            if (filesProcessed === totalFiles) {
                processFileResults(fileResults, gallery);
            }
        };

        reader.readAsText(file);
    }
}

// Download composites button handler (build zip with folders per scenario and per model)
window.addEventListener('DOMContentLoaded', () => {
    const btn = document.getElementById('download-composites');
    if (!btn) return;
    btn.addEventListener('click', async () => {
        // find composite images
        const composites = generatedImages.filter(g => g.modelTag && String(g.modelTag).toUpperCase() === 'COMPOSITE');
        if (!composites.length) {
            alert('No composite images found. Generate composites first.');
            return;
        }

        // ensure JSZip
        async function ensureJSZip() {
            if (typeof JSZip !== 'undefined') return JSZip;
            return new Promise((resolve, reject) => {
                const s = document.createElement('script');
                s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.7.1/jszip.min.js';
                s.onload = () => {
                    if (typeof JSZip !== 'undefined') resolve(JSZip);
                    else reject(new Error('JSZip failed to initialize'));
                };
                s.onerror = () => reject(new Error('Failed to load JSZip'));
                document.head.appendChild(s);
            });
        }

        try {
            await ensureJSZip();
        } catch (e) {
            alert('Could not load JSZip library.');
            return;
        }

        const zip = new JSZip();

    // Allow tilde (~) characters in model names (e.g. mistralai~mistral-7b-instruct-v0.3)
    // Allow commas in hintMode names (don't replace ',' with underscore) so pair-folder names keep commas intact
    const sanitize = (s) => (s ? String(s).replace(/[^a-zA-Z0-9._\-\[\], ~]+/g, '_').replace(/\s+/g, '_') : '');

        // Map scenarios encountered while adding composite images so we can add the ORIGINAL per-scenario
        const scenarioMap = new Map();

        // Group composites by scenarioKey -> model -> hintMode -> array(items)
        const grouped = new Map();

        composites.forEach(item => {
            const ts = item.timestamp || '';
            const csv = item.csvHash || '';
            const groupTag = item.groupTag || item.metaTag || '';
            const scenarioKey = `${ts}||${csv}||${groupTag}`;

            // record scenario info for later original lookup
            const scenarioFolder = `${sanitize(ts)}_[${sanitize(csv)}]_[${sanitize(groupTag)}]`;
            if (!scenarioMap.has(scenarioKey)) {
                scenarioMap.set(scenarioKey, { ts, csv, groupTag, scenarioFolder });
            }

            const modelName = item.model || 'unknown_model';
            const modelKey = modelName;
            const hint = (item.hintMode || 'none');

            if (!grouped.has(scenarioKey)) grouped.set(scenarioKey, new Map());
            const modelMap = grouped.get(scenarioKey);
            if (!modelMap.has(modelKey)) modelMap.set(modelKey, new Map());
            const hintMap = modelMap.get(modelKey);
            if (!hintMap.has(hint)) hintMap.set(hint, []);
            hintMap.get(hint).push(item);
        });

        // For each scenario and model, create pairwise subfolders A-B and include both composite images
        for (const [scenarioKey, modelMap] of grouped.entries()) {
            const scenarioInfo = scenarioMap.get(scenarioKey) || { scenarioFolder: '' };
            const scenarioFolder = scenarioInfo.scenarioFolder || '';

            for (const [modelName, hintMap] of modelMap.entries()) {
                const modelFolder = `[${sanitize(modelName)}]`;

                // list of hint modes present
                const hintModes = Array.from(hintMap.keys()).map(h => h || 'none');
                // sort alphabetically to produce canonical pair names
                hintModes.sort((a,b) => String(a).localeCompare(String(b), undefined, {sensitivity: 'base'}));

                // generate unordered pairs
                for (let i = 0; i < hintModes.length; i++) {
                    for (let j = i + 1; j < hintModes.length; j++) {
                        const a = hintModes[i];
                        const b = hintModes[j];
                        // include all composites for hint a and hint b inside the pair folder
                        const itemsA = hintMap.get(a) || [];
                        const itemsB = hintMap.get(b) || [];

                        // detect whether the two hint-mode composite sets have identical normalizedKey sets
                        // (folder is marked duplicate only when ALL keys match)
                        const keysA = new Set((itemsA || []).map(it => String(it.normalizedKey || '')));
                        const keysB = new Set((itemsB || []).map(it => String(it.normalizedKey || '')));

                        // helper: check set equality (order-independent)
                        const setsEqual = (s1, s2) => {
                            if (s1.size !== s2.size) return false;
                            for (const v of s1) if (!s2.has(v)) return false;
                            return true;
                        };

                        const bothEqual = setsEqual(keysA, keysB);
                        const dupSuffix = bothEqual ? '_DUPLICATE' : '';
                        const pairFolder = `${sanitize(a)}-vs-${sanitize(b)}${dupSuffix}`;

                        const addItems = (arr, hintLabel) => {
                            arr.forEach((item, idx) => {
                                try {
                                    const base64 = item.data.split(',')[1];
                                    // create filename preserving hint label for clarity
                                    const hintPart = hintLabel ? `[${sanitize(hintLabel)}]` : '[none]';
                                    const filename = `${scenarioFolder}_[${sanitize(modelName)}]_${hintPart}_composite.png`;
                                    const path = `${scenarioFolder}/${modelFolder}/${pairFolder}/${filename}`;
                                    zip.file(path, base64, { base64: true });
                                } catch (e) {
                                    console.warn('Skipping invalid composite image in pair', item);
                                }
                            });
                        };

                        addItems(itemsA, a);
                        addItems(itemsB, b);
                    }
                }
            }
        }

        // For each scenario we added composites for, include the group's ORIGINAL image at the scenario root (if present)
        // Use the exact filename stored in generatedImages (so we preserve the filename shown in the gallery h3)
        for (const [, info] of scenarioMap.entries()) {
            // Match originals by csvHash (tolerant) and prefer timestamp match when available
            const originals = generatedImages.filter(g => g.modelTag === 'ORIGINAL' && (g.csvHash || '') === (info.csv || ''));
            originals.forEach(orig => {
                try {
                    const base64 = orig.data.split(',')[1];
                    // Prefer using the already-generated filename recorded in generatedImages so we don't reconstruct it incorrectly
                    const origName = orig.filename || `ORIGINAL_${sanitize(orig.csvHash || '')}_[UNSPECIFIED].png`;
                    const origPath = `${info.scenarioFolder}/${origName}`;
                    zip.file(origPath, base64, { base64: true });
                } catch (e) {
                    console.warn('Skipping invalid original image for scenario', orig);
                }
            });
        }

        const blob = await zip.generateAsync({ type: 'blob' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const now = new Date();
        const pad = n => String(n).padStart(2, '0');
        const ts = `${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
        a.download = `${ts}_composites.zip`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    });
});

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

    // Wire filename toggle checkbox (default: filenames hidden)
    const toggle = document.getElementById('toggle-filenames');
    try {
        const saved = localStorage.getItem('showFilenames');
        const show = saved === 'true';
        if (toggle) {
            toggle.checked = show;
            if (!show) document.body.classList.add('hide-filenames');
            toggle.addEventListener('change', () => {
                const on = !!toggle.checked;
                if (on) document.body.classList.remove('hide-filenames');
                else document.body.classList.add('hide-filenames');
                try { localStorage.setItem('showFilenames', String(on)); } catch (e) {}
            });
        }
    } catch (e) {
        if (toggle) toggle.checked = false;
        document.body.classList.add('hide-filenames');
    }

    // Debug: dump registered tags
    const dumpBtn = document.getElementById('dump-tags');
    if (dumpBtn) {
        dumpBtn.addEventListener('click', () => {
            console.log('[tag-map] dump start');
            for (const [k, set] of tagToElements.entries()) {
                console.log('  tag=', k, 'count=', set.size);
            }
            console.log('[tag-map] dump end');
        });
    }
});

// Composite controls helpers
function getCompositeSettings() {
    try {
        const enabled = !!document.getElementById('enable-composite')?.checked;
        const raw = document.getElementById('composite-threshold')?.value;
        const pct = raw ? Number(raw) : 50;
        const thr = Math.max(0, Math.min(100, pct)) / 100.0;
        return { enabled, threshold: thr };
    } catch (e) {
        return { enabled: true, threshold: 0.5 };
    }
}

// Hook up threshold display update
window.addEventListener('DOMContentLoaded', () => {
    const slider = document.getElementById('composite-threshold');
    const out = document.getElementById('composite-threshold-val');
    if (slider && out) {
        slider.addEventListener('input', () => { out.textContent = `${slider.value}%`; });
        out.textContent = `${slider.value}%`;
    }
});

// Wire up image size controls (range + number input)
window.addEventListener('DOMContentLoaded', () => {
    const slider = document.getElementById('image-size');
    const num = document.getElementById('image-size-val');
    const display = document.getElementById('current-image-size');

    const setDisplay = (v) => {
        if (display) display.textContent = `(current: ${v}px)`;
    };

    if (slider) {
        slider.value = String(imageSize);
        slider.addEventListener('input', () => {
            const v = Math.max(100, Math.min(2000, Number(slider.value)));
            imageSize = v;
            try { localStorage.setItem('imageSize', String(v)); } catch (e) {}
            if (num) num.value = String(v);
            setDisplay(v);
        });
    }
    if (num) {
        num.value = String(imageSize);
        num.addEventListener('change', () => {
            let v = Number(num.value);
            if (isNaN(v)) v = 400;
            v = Math.max(100, Math.min(2000, v));
            imageSize = v;
            try { localStorage.setItem('imageSize', String(v)); } catch (e) {}
            if (slider) slider.value = String(v);
            setDisplay(v);
        });
    }

    // initial display
    setDisplay(imageSize);
});

// Given an array of members (fileResults) in a hint-section, compute a Set of treeIds to remove
// when proportion of members voting for removal >= threshold
function computeCompositeRemovals(members, threshold) {
    // Build counts per treeId
    const counts = new Map();
    const total = members.length || 0;
    members.forEach(fr => {
        // Use the canonical normalizer used elsewhere to ensure consistent parsing/ordering
        try {
            const norm = normalizeIdentifiedTrees(fr.identifiedTrees || ''); // returns JSON string like '[1,2]'
            if (!norm) return;
            const ids = JSON.parse(norm);
            ids.forEach(id => {
                const n = counts.get(id) || 0;
                counts.set(id, n + 1);
            });
        } catch (e) {
            // ignore parse errors and treat as no ids
        }
    });

    const removals = new Set();
    if (total === 0) return removals;
    for (const [id, cnt] of counts.entries()) {
        if ((cnt / total) >= threshold) removals.add(id);
    }
    return removals;
}

// Create a composite gallery item and insert as the first card in the hintGrid
function insertCompositeCard(hintGrid, treeData, members, groupMeta, modelName, hintMode) {
    const settings = getCompositeSettings();
    if (!settings.enabled) return;
    const removals = computeCompositeRemovals(members, settings.threshold);

    // Build a pseudo-identifiedTrees string from removals
    const removedList = Array.from(removals).sort((a,b)=>a-b);
    const identifiedTrees = removedList.join(',');

    // Use a filename stem indicating composite and threshold
    const stem = `COMPOSITE_${Math.round(settings.threshold*100)}%`;

    // tags: mark modelTag as COMPOSITE
    const tags = {
        modelTag: 'COMPOSITE',
        modelHintTag: null,
        sourceOriginal: null,
        // attribute composite images to the real model name so ZIP folders are correct
        model: modelName || 'COMPOSITE',
        hintMode: hintMode || '',
        normalizedKey: JSON.stringify(removedList),
        timestamp: groupMeta.timestamp || '',
        csvHash: groupMeta.csvHash || '',
        metaTag: groupMeta.tag || '',
        groupTag: groupMeta.tag || ''
    };

    // Insert composite as the first child (so it appears at the start of the row)
    // createImageFromData will append to the provided gallery container, so we create a temporary container
    // and then move its produced node to the front of hintGrid.
    const tempContainer = document.createElement('div');
    createImageFromData(treeData, stem, identifiedTrees, tags, tempContainer);
    console.log('[composite] created composite card', stem, 'removedCount=', removedList.length, 'threshold=', Math.round(getCompositeSettings().threshold*100)+'%');
    // move any created gallery-items into the hintGrid at the front
    while (tempContainer.firstChild) {
        hintGrid.insertBefore(tempContainer.firstChild, hintGrid.firstChild);
    }
}

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
    // create an original box (single row) and a container that will hold per-model sections
    const originalBox = document.createElement('div');
    originalBox.className = 'original-box';

    // modelRow will contain one model-section per llm.model in this group
    const modelRow = document.createElement('div');
    modelRow.className = 'model-row';

    section.appendChild(originalBox);
    section.appendChild(modelRow);
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

        // create ORIGINAL from first member (displayed in originalBox)
        const first = group.members[0];
        const originalStem = deriveOriginalStem(first.fileNameStem) || first.fileNameStem;
    createImageFromData(first.treeInfo, originalStem, '', { modelTag: 'ORIGINAL', sourceOriginal: first.originalFile, model: first._model, hintMode: first._hintMode, normalizedKey: first._normalizedKey, timestamp: first._timestamp, csvHash: group.csvHash, metaTag: group.tag }, originalBox);

        // For each model in this group, create a model-section container (row layout) and render that model's images inside a grid
        for (const [model, mm] of modelMap.entries()) {
            const modelSection = document.createElement('div');
            modelSection.className = 'model-section';

            // optional header for the model
            const modelHeader = document.createElement('h4');
            modelHeader.textContent = model;
            modelHeader.style.margin = '0 0 0.5rem 0';
            modelHeader.style.fontSize = '0.95rem';
            modelHeader.style.color = '#333';
            modelSection.appendChild(modelHeader);

            // Partition this model's members by hintMode and render a hint-section per hintMode
            const hintRow = document.createElement('div');
            hintRow.className = 'hint-row';

            // Build a map hintMode => array of fileResults for this model
            const hintMap = new Map();
            for (const arr of mm.values()) {
                arr.forEach(fr => {
                    const hm = fr._hintMode || '';
                    if (!hintMap.has(hm)) hintMap.set(hm, []);
                    hintMap.get(hm).push(fr);
                });
            }

            // Render hint-sections in a specific preferred order then any remaining hintModes
            const preferredOrder = ['none', 'clusters', 'densities', 'clusters,densities'];
            const orderedKeys = [];
            // Add preferred keys that exist
            for (const k of preferredOrder) {
                if (hintMap.has(k)) orderedKeys.push(k);
            }
            // Add any other keys found in hintMap that weren't in preferredOrder
            for (const k of hintMap.keys()) {
                if (!orderedKeys.includes(k)) orderedKeys.push(k);
            }

            for (const hintMode of orderedKeys) {
                const members = hintMap.get(hintMode) || [];
                const hintSection = document.createElement('div');
                hintSection.className = 'hint-section';

                const hintHeader = document.createElement('h5');
                hintHeader.textContent = (hintMode === '' ? 'none' : hintMode);
                hintHeader.style.margin = '0 0 0.4rem 0';
                hintHeader.style.fontSize = '0.9rem';
                hintHeader.style.color = '#444';
                hintSection.appendChild(hintHeader);

                const hintGrid = document.createElement('div');
                hintGrid.className = 'group-grid';
                hintSection.appendChild(hintGrid);

                // Insert composite card at the start of the hintGrid (uses the group's tree layout and member votes)
                // Use the group's tree layout from the first member in the group
                const groupTreeData = group.members && group.members[0] ? group.members[0].treeInfo : treeData;
                // Pass the model name so the composite is attributed to the correct model folder
                insertCompositeCard(hintGrid, groupTreeData, members, { timestamp: group.ts, csvHash: group.csvHash, tag: group.tag }, model, hintMode);

                // Sort members by number of trees removed (least -> most), then by normalized id string as tiebreaker
                members.sort((a, b) => {
                    try {
                        const na = normalizeIdentifiedTrees(a.identifiedTrees || '');
                        const nb = normalizeIdentifiedTrees(b.identifiedTrees || '');
                        const arrA = JSON.parse(na || '[]');
                        const arrB = JSON.parse(nb || '[]');
                        if (arrA.length !== arrB.length) return arrA.length - arrB.length;
                        const sa = arrA.join(',');
                        const sb = arrB.join(',');
                        // numeric-aware locale compare (fallback to simple compare)
                        return sa.localeCompare(sb, undefined, {numeric: true});
                    } catch (e) {
                        return 0;
                    }
                });

                members.forEach(fr => {
                    createImageFromData(fr.treeInfo, fr.fileNameStem, fr.identifiedTrees, {
                        modelTag: fr.modelTag,
                        modelHintTag: fr.modelHintTag,
                        sourceOriginal: fr.originalFile,
                        model: fr._model,
                        hintMode: fr._hintMode,
                        normalizedKey: fr._normalizedKey,
                        timestamp: fr._timestamp,
                        csvHash: group.csvHash,
                        metaTag: group.tag
                    }, hintGrid);
                });

                hintRow.appendChild(hintSection);
            }

            modelSection.appendChild(hintRow);

            modelRow.appendChild(modelSection);
        }

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
    // Use configurable imageSize (px)
    canvas.width = imageSize;
    canvas.height = imageSize;
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

    // Use integer pixel math for band positions/sizes to avoid sub-pixel gaps that
    // appear as dividing lines at smaller canvas sizes. Compute rounded border width.
    const intBorderPx = Math.max(1, Math.round(border * scale));

    // Draw bands by rounding cumulative positions so each pixel column/row is filled
    // and there are no 1px gaps due to fractional widths.
    for (let i = 0; i < totalDim.width; i++) {
        const color = (Math.floor(i / 2) % 2 === 0) ? darkBandColor : lightBandColor;
        ctx.fillStyle = color;

        const start = Math.round(i * meterInPixels);
        const end = Math.round((i + 1) * meterInPixels);
        const w = end - start;
        if (w <= 0) continue;

        // Top and bottom bands
        ctx.fillRect(start, 0, w, intBorderPx);
        ctx.fillRect(start, canvas.height - intBorderPx, w, intBorderPx);

        // Left and right bands (use same computed segment length)
        ctx.fillRect(0, start, intBorderPx, w);
        ctx.fillRect(canvas.width - intBorderPx, start, intBorderPx, w);
    }

    // Draw labels every 2 meters along the bottom
    ctx.font = `${Math.round(scale * 1.05)}px sans-serif`;
    ctx.fillStyle = 'white';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (let i = 0; i <= parkDim.width; i += 2) {
        const label = `${i}m`;
        const pos_on_axis = (i + border) * scale;

        if ((i > 10 && i < 20) || (i > 20 && i < 30)) {
            continue; // Skip labels between 10-20m and 20-30m
        }

        // Bottom labels only (use half of integer border for vertical placement)
        ctx.fillText(label, pos_on_axis, canvas.height - (intBorderPx / 2));
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

    // 4. Draw remaining trees: first shadows for all trees, then the tree bodies so trees appear on top of shadows
    const treeRadius = treeData.treeRadius * scale;

    // First: draw shadows for each tree
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
    });

    // Second: draw tree bodies on top of shadows
    remainingTrees.forEach(tree => {
        const cx = (tree.x + border) * scale;
        const cy = canvas.height - ((tree.y + border) * scale);

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
    // Tag line: render each tag as its own badge so we can attach hover handlers
    const tagLine = document.createElement('span');
    tagLine.className = 'tag-line';
    if (tags && (tags.modelTag || tags.modelHintTag)) {
        const parts = [];
        if (tags.modelTag) parts.push(tags.modelTag);
        if (tags.modelHintTag) parts.push(tags.modelHintTag);
        // If any tag is a duplicate-set tag (starts with M. or MH.), prefix the line
        const isDuplicateTag = (t) => typeof t === 'string' && (t.startsWith('M.') || t.startsWith('MH.'));
        const shouldPrefix = isDuplicateTag(tags.modelTag) || isDuplicateTag(tags.modelHintTag);
        if (shouldPrefix) {
            const prefix = document.createElement('span');
            prefix.textContent = 'Duplicate sets: ';
            tagLine.appendChild(prefix);
        }

        // create badge spans for each tag
        parts.forEach(t => {
            const badge = document.createElement('span');
            badge.className = 'tag-badge';
            badge.textContent = `[${t}]`;
            badge.dataset.tag = t;

            // compute decorated subgroup-qualified tag keys for duplicate-sets
            // Format for model-level duplicates: [meta.timestamp].[scenario.csvHash].[meta.tag].[llm.model].[M.A]
            // Format for model+hint-level duplicates: [meta.timestamp].[scenario.csvHash].[meta.tag].[llm.model][scenario.hintMode].[MH.A]
            let decoratedKey = null;
            try {
                const ts = (tags && tags.timestamp) ? String(tags.timestamp) : '';
                const csv = (tags && tags.csvHash) ? String(tags.csvHash) : '';
                const metaTag = (tags && tags.metaTag) ? String(tags.metaTag) : '';
                const modelName = (tags && tags.model) ? String(tags.model) : '';
                const hint = (tags && tags.hintMode) ? String(tags.hintMode) : '';

                if (t && t.startsWith('M.')) {
                    decoratedKey = `${ts}.${csv}.${metaTag}.${modelName}.${t}`;
                } else if (t && t.startsWith('MH.')) {
                    decoratedKey = `${ts}.${csv}.${metaTag}.${modelName}[${hint}].${t}`;
                }
            } catch (e) {
                // ignore
            }

            // only attach hover handlers for duplicate-set tags (M. / MH.)
            if (isDuplicateTag(t)) {
                badge.style.cursor = 'pointer';
                // make badge keyboard-focusable
                badge.tabIndex = 0;

                // if we have a decoratedKey, store it for the badge to use when matching
                if (decoratedKey) badge.dataset.tagKey = decoratedKey;

                const addHighlight = (badgeEl) => {
                    const lookupKey = badgeEl.dataset.tagKey || badgeEl.dataset.tag;
                    const keys = Array.from(tagToElements.keys());
                    console.log('[highlight] trying to add for', lookupKey, 'registeredKeys=', keys);
                    // try exact decorated key first
                    let set = tagToElements.get(lookupKey);
                    let matches = set ? Array.from(set) : [];
                    // fallback: try raw tag label if no decorated matches
                    if (matches.length === 0 && badgeEl.dataset.tag) {
                        const raw = badgeEl.dataset.tag;
                        set = tagToElements.get(raw);
                        matches = set ? Array.from(set) : [];
                    }
                    console.log('[highlight] add', lookupKey, 'matches=', matches.length);
                    if (matches.length > 0) {
                        matches.forEach(el => el.classList.add('highlighted-solution'));
                        return;
                    }

                    // Fallback: scan DOM and match datasets loosely (trimmed, case-insensitive)
                    const fallback = [];
                    document.querySelectorAll('.gallery-item').forEach(el => {
                        const mt = (el.getAttribute('data-model-tag') || '').trim();
                        const mht = (el.getAttribute('data-model-hint-tag') || '').trim();
                        if (mt === lookupKey || mht === lookupKey || mt.toLowerCase() === lookupKey.toLowerCase() || mht.toLowerCase() === lookupKey.toLowerCase() || mt === badgeEl.dataset.tag || mht === badgeEl.dataset.tag) {
                            fallback.push(el);
                        }
                    });
                    console.log('[highlight] fallback matches=', fallback.length);
                    fallback.forEach(el => el.classList.add('highlighted-solution'));
                };

                const removeHighlight = (badgeEl) => {
                    const lookupKey = badgeEl.dataset.tagKey || badgeEl.dataset.tag;
                    const keys = Array.from(tagToElements.keys());
                    console.log('[highlight] trying to remove for', lookupKey, 'registeredKeys=', keys);
                    let set = tagToElements.get(lookupKey);
                    let matches = set ? Array.from(set) : [];
                    if (matches.length === 0 && badgeEl.dataset.tag) {
                        const raw = badgeEl.dataset.tag;
                        set = tagToElements.get(raw);
                        matches = set ? Array.from(set) : [];
                    }
                    console.log('[highlight] remove', lookupKey, 'matches=', matches.length);
                    if (matches.length > 0) {
                        matches.forEach(el => el.classList.remove('highlighted-solution'));
                        return;
                    }

                    const fallback = [];
                    document.querySelectorAll('.gallery-item').forEach(el => {
                        const mt = (el.getAttribute('data-model-tag') || '').trim();
                        const mht = (el.getAttribute('data-model-hint-tag') || '').trim();
                        if (mt === lookupKey || mht === lookupKey || mt.toLowerCase() === lookupKey.toLowerCase() || mht.toLowerCase() === lookupKey.toLowerCase() || mt === badgeEl.dataset.tag || mht === badgeEl.dataset.tag) {
                            fallback.push(el);
                        }
                    });
                    console.log('[highlight] fallback remove matches=', fallback.length);
                    fallback.forEach(el => el.classList.remove('highlighted-solution'));
                };

                console.log('[tag-badge] created', t, 'decoratedKey=', decoratedKey);
                badge.addEventListener('mouseenter', (e) => addHighlight(e.currentTarget));
                badge.addEventListener('mouseleave', (e) => removeHighlight(e.currentTarget));
                badge.addEventListener('focus', (e) => addHighlight(e.currentTarget));
                badge.addEventListener('blur', (e) => removeHighlight(e.currentTarget));
            }

            tagLine.appendChild(badge);
            tagLine.appendChild(document.createTextNode(' '));
        });
    } else {
        tagLine.textContent = '';
    }
    
    const info = document.createElement('p');
    info.style.margin = '0 0 0rem 0';
    info.style.fontSize = '0.8rem';
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
    
    // set data attributes for quick DOM-lookups and register tags into tagToElements for fast highlighting
    try {
        if (tags && tags.modelTag) galleryItem.setAttribute('data-model-tag', String(tags.modelTag));
        if (tags && tags.modelHintTag) galleryItem.setAttribute('data-model-hint-tag', String(tags.modelHintTag));

        // helper: produce decorated subgroup-qualified key for a given duplicate tag
        const makeDecoratedKey = (t) => {
            if (!t) return null;
            try {
                const ts = (tags && tags.timestamp) ? String(tags.timestamp) : '';
                const csv = (tags && tags.csvHash) ? String(tags.csvHash) : '';
                const metaTag = (tags && tags.metaTag) ? String(tags.metaTag) : '';
                const modelName = (tags && tags.model) ? String(tags.model) : '';
                const hint = (tags && tags.hintMode) ? String(tags.hintMode) : '';

                if (t.startsWith('M.')) {
                    return `${ts}.${csv}.${metaTag}.${modelName}.${t}`;
                }
                if (t.startsWith('MH.')) {
                    return `${ts}.${csv}.${metaTag}.${modelName}[${hint}].${t}`;
                }
                return null;
            } catch (e) {
                return null;
            }
        };

        // register element under each tag in the global tagToElements map; include decorated key when available
        const registerTag = (t) => {
            if (!t) return;
            try {
                // raw tag registration (backwards-compatible)
                let set = tagToElements.get(t);
                if (!set) {
                    set = new Set();
                    tagToElements.set(t, set);
                }
                set.add(galleryItem);

                // decorated tag registration
                const dk = makeDecoratedKey(t);
                if (dk) {
                    let dset = tagToElements.get(dk);
                    if (!dset) {
                        dset = new Set();
                        tagToElements.set(dk, dset);
                    }
                    dset.add(galleryItem);
                }
            } catch (e) {
                console.warn('Could not register tag in tagToElements', t, e);
            }
        };

        if (tags && tags.modelTag) registerTag(tags.modelTag);
        if (tags && tags.modelHintTag) registerTag(tags.modelHintTag);
    } catch (e) {
        console.warn('Error while setting data attributes / registering tags', e);
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


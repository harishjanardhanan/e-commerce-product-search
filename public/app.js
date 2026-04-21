/* ─────────────────────────────────────────────────────────────────────────
   Amazon Scanner — app.js
   ─────────────────────────────────────────────────────────────────────── */

// ── State ──────────────────────────────────────────────────────────────────
let allProducts = [];       // All scraped products
let filteredProducts = [];  // After text filter
let sortCol = null;
let sortDir = 'asc';
let totalExpected = 0;
let es = null;              // EventSource reference
let specColumns = new Set(); // Dynamic spec column keys

// Core columns always shown first
const CORE_COLS = ['#', 'Image', 'Title', 'Brand', 'Price', 'Rating', 'Reviews', 'Availability'];

// ── DOM refs ───────────────────────────────────────────────────────────────
const scanForm = document.getElementById('scanForm');
const urlInput = document.getElementById('urlInput');
const clearBtn = document.getElementById('clearBtn');
const limitInput = document.getElementById('limitInput');
const scanBtn = document.getElementById('scanBtn');
const progressSection = document.getElementById('progressSection');
const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const progressBar = document.getElementById('progressBar');
const progressCount = document.getElementById('progressCount');
const progressPct = document.getElementById('progressPct');
const stopBtn = document.getElementById('stopBtn');
const toolbar = document.getElementById('toolbar');
const filterInput = document.getElementById('filterInput');
const statPill = document.getElementById('statPill');
const exportCsvBtn = document.getElementById('exportCsvBtn');
const clearTableBtn = document.getElementById('clearTableBtn');
const sortColSelect = document.getElementById('sortColSelect');
const sortDirBtn = document.getElementById('sortDirBtn');
const filterColSelect = document.getElementById('filterColSelect');
const filterColValue = document.getElementById('filterColValue');
const clearFiltersBtn = document.getElementById('clearFiltersBtn');
const resultsSection = document.getElementById('resultsSection');
const tableHead = document.getElementById('tableHead');
const tableBody = document.getElementById('tableBody');
const emptyState = document.getElementById('emptyState');
const detailModal = document.getElementById('detailModal');
const modalBackdrop = document.getElementById('modalBackdrop');
const modalTitle = document.getElementById('modalTitle');
const modalBody = document.getElementById('modalBody');
const modalClose = document.getElementById('modalClose');
const toastContainer = document.getElementById('toastContainer');

// ── Toast ──────────────────────────────────────────────────────────────────
function toast(msg, type = 'info') {
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = msg;
    toastContainer.appendChild(el);
    setTimeout(() => el.remove(), 4200);
}

// ── Clear btn ──────────────────────────────────────────────────────────────
clearBtn.addEventListener('click', () => { urlInput.value = ''; urlInput.focus(); });

// ── Form submit ────────────────────────────────────────────────────────────
scanForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const url = urlInput.value.trim();
    if (!url) return;
    const isValidUrl = url.includes('amazon') || url.includes('flipkart.com');
    if (!isValidUrl) { toast('Please enter a valid Amazon or Flipkart search URL', 'error'); return; }

    startScan(url, parseInt(limitInput.value) || 20);
});

async function startScan(url, limit) {
    // Reset state
    allProducts = [];
    filteredProducts = [];
    specColumns = new Set();
    totalExpected = 0;
    sortCol = null;
    sortDir = 'asc';

    // Reset controls
    filterInput.value = '';
    sortColSelect.value = '';
    sortDirBtn.textContent = '↑ Asc';
    sortDirBtn.classList.remove('desc');
    filterColSelect.value = '__all__';
    filterColValue.innerHTML = '<option value="">— All —</option>';
    filterColValue.disabled = true;
    syncSortDropdownToSpec();

    if (es) { es.close(); es = null; }

    // UI reset
    tableHead.innerHTML = '';
    tableBody.innerHTML = '';
    updateStatPill();
    scanBtn.disabled = true;
    scanBtn.querySelector('.btn-text').textContent = 'Scanning…';
    progressSection.classList.remove('hidden');
    toolbar.classList.remove('hidden');
    resultsSection.classList.remove('hidden');
    emptyState.classList.add('hidden');
    statusDot.className = 'status-dot pulsing';
    setProgress(0, 0, 'Starting scan…');
    addSkeletonRows(6);

    try {
        // Initiate scan — backend returns sessionId
        const res = await fetch('/api/scan', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url, limit }),
        });

        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || 'Server error');
        }

        const { sessionId } = await res.json();
        connectStream(sessionId);
    } catch (err) {
        toast(err.message, 'error');
        resetScanBtn();
    }
}

// ── SSE Stream ─────────────────────────────────────────────────────────────
function connectStream(sessionId) {
    es = new EventSource(`/api/stream/${sessionId}`);

    es.onmessage = (event) => {
        const msg = JSON.parse(event.data);

        switch (msg.type) {
            case 'status':
                statusText.textContent = msg.message;
                break;

            case 'total':
                totalExpected = msg.total;
                statusText.textContent = msg.message;
                setProgress(0, totalExpected, msg.message);
                // Clear skeleton once real data starts
                clearSkeletons();
                break;

            case 'product':
                clearSkeletons();
                addProduct(msg.data);
                setProgress(msg.progress.completed, msg.progress.total,
                    `Scraping product ${msg.progress.completed} of ${msg.progress.total}…`);
                break;

            case 'done':
                statusText.textContent = msg.message;
                statusDot.className = 'status-dot done';
                setProgress(allProducts.length, allProducts.length, msg.message);
                resetScanBtn();
                toast(`✅ ${msg.message}`, 'success');
                es.close(); es = null;
                break;

            case 'error':
                statusText.textContent = '⚠ ' + msg.message;
                statusDot.className = 'status-dot error';
                toast(msg.message, 'error');
                resetScanBtn();
                es.close(); es = null;
                break;
        }
    };

    es.onerror = () => {
        if (es) { es.close(); es = null; }
        resetScanBtn();
    };
}

stopBtn.addEventListener('click', () => {
    if (es) { es.close(); es = null; }
    statusDot.className = 'status-dot error';
    statusText.textContent = 'Scan stopped by user.';
    resetScanBtn();
    toast('Scan stopped', 'info');
});

function resetScanBtn() {
    scanBtn.disabled = false;
    scanBtn.querySelector('.btn-text').textContent = 'Start Scan';
}

function setProgress(done, total, msg) {
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    progressBar.style.width = pct + '%';
    progressCount.textContent = `${done} / ${total || '?'} products scraped`;
    progressPct.textContent = pct + '%';
    if (msg) statusText.textContent = msg;
}

// ── Skeleton rows ──────────────────────────────────────────────────────────
function addSkeletonRows(n) {
    for (let i = 0; i < n; i++) {
        const tr = document.createElement('tr');
        tr.className = 'skeleton';
        tr.innerHTML = `<td><div class="shimmer" style="width:24px"></div></td>
      <td><div class="shimmer" style="width:52px;height:52px;border-radius:6px"></div></td>
      <td><div class="shimmer" style="width:220px"></div></td>
      <td><div class="shimmer" style="width:80px"></div></td>
      <td><div class="shimmer" style="width:70px"></div></td>
      <td><div class="shimmer" style="width:90px"></div></td>
      <td><div class="shimmer" style="width:60px"></div></td>
      <td><div class="shimmer" style="width:80px"></div></td>`;
        tableBody.appendChild(tr);
    }
}

function clearSkeletons() {
    tableBody.querySelectorAll('.skeleton').forEach((r) => r.remove());
}

// ── Add product to table ───────────────────────────────────────────────────
function addProduct(product) {
    allProducts.push(product);

    // Collect new spec keys
    const newKeys = Object.keys(product.specs || {});
    const hadNew = newKeys.some((k) => !specColumns.has(k));
    newKeys.forEach((k) => specColumns.add(k));

    if (hadNew) {
        syncSortDropdownToSpec();
        rebuildHeader();
        rebuildAllRows();
    } else {
        appendRow(product, allProducts.length);
    }

    // Keep filter-value dropdown in sync as new products arrive
    const activeCol = filterColSelect.value;
    if (activeCol && activeCol !== '__all__') {
        populateFilterValues(activeCol);
    }

    applyFilter();
}

// ── Header ─────────────────────────────────────────────────────────────────
function rebuildHeader() {
    const specKeys = Array.from(specColumns);
    const allCols = [...CORE_COLS, ...specKeys, 'Details'];

    tableHead.innerHTML = '';
    const tr = document.createElement('tr');
    allCols.forEach((col) => {
        const th = document.createElement('th');
        th.textContent = col;
        if (col !== 'Image' && col !== '#' && col !== 'Details') {
            th.addEventListener('click', () => handleSort(col));
            if (sortCol === col) th.className = `sorted-${sortDir}`;
        }
        tr.appendChild(th);
    });
    tableHead.appendChild(tr);
}

// ── Row builder ────────────────────────────────────────────────────────────
function buildRow(product, index) {
    const specKeys = Array.from(specColumns);
    const tr = document.createElement('tr');
    tr.dataset.idx = index - 1;
    tr.classList.add('row-enter');
    tr.style.cursor = 'pointer';
    tr.title = 'Click to view full details';

    // Click anywhere on the row → open detail page
    tr.addEventListener('click', (e) => {
        // Don't navigate if they clicked the Details button itself
        if (e.target.closest('.btn-detail')) return;
        openProductPage(product);
    });

    // #
    td(tr, index, 'col-num');
    // Image
    const imgTd = document.createElement('td');
    imgTd.className = 'col-img';
    if (product.image) {
        const img = document.createElement('img');
        img.src = product.image;
        img.alt = product.title || '';
        img.loading = 'lazy';
        imgTd.appendChild(img);
    }
    tr.appendChild(imgTd);

    // Core text cols
    td(tr, product.title || '—', 'col-title');
    td(tr, product.brand || '—');
    td(tr, product.price || '—', 'col-price');

    // Rating stars
    const ratingTd = document.createElement('td');
    ratingTd.className = 'col-rating';
    if (product.rating && product.rating !== 'N/A') {
        const num = parseFloat(product.rating);
        if (!isNaN(num)) {
            const stars = '★'.repeat(Math.round(num)) + '☆'.repeat(5 - Math.round(num));
            ratingTd.innerHTML = `<span class="stars">${stars}</span><span class="rating-val">${num.toFixed(1)}</span>`;
        } else {
            ratingTd.textContent = product.rating;
        }
    } else {
        ratingTd.textContent = '—';
    }
    tr.appendChild(ratingTd);

    td(tr, product.reviews || '—');
    td(tr, product.availability || '—');

    // Spec columns
    specKeys.forEach((key) => {
        td(tr, (product.specs && product.specs[key]) ? product.specs[key] : '—');
    });

    // Details button
    const detailTd = document.createElement('td');
    const btn = document.createElement('button');
    btn.className = 'btn-detail';
    btn.textContent = '↗ Open';
    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        openProductPage(product);
    });
    detailTd.appendChild(btn);
    tr.appendChild(detailTd);

    return tr;
}

function td(tr, text, cls) {
    const cell = document.createElement('td');
    if (cls) cell.className = cls;
    cell.textContent = text;
    cell.title = text; // tooltip on overflow
    tr.appendChild(cell);
    return cell;
}

function appendRow(product, index) {
    const tr = buildRow(product, index);
    tableBody.appendChild(tr);
}

function rebuildAllRows() {
    tableBody.innerHTML = '';
    allProducts.forEach((p, i) => {
        tableBody.appendChild(buildRow(p, i + 1));
    });
}

// ── Multi-column filter ────────────────────────────────────────────────────
let activeFilters = []; // [{ col, value }]

const addFilterBtn = document.getElementById('addFilterBtn');
const filterChipsRow = document.getElementById('filterChipsRow');

// Global search
filterInput.addEventListener('input', applyFilter);

// Column select → repopulate values, enable Add when a value is chosen
filterColSelect.addEventListener('change', () => {
    populateFilterValues(filterColSelect.value);
    addFilterBtn.disabled = true;
});

// Value select → enable Add button when a real value is selected
filterColValue.addEventListener('change', () => {
    addFilterBtn.disabled = !filterColSelect.value || !filterColValue.value;
});

// Add a new filter chip
addFilterBtn.addEventListener('click', () => {
    const col = filterColSelect.value;
    const val = filterColValue.value;
    if (!col || !val) return;

    // Avoid exact duplicate
    const isDupe = activeFilters.some(f => f.col === col && f.value === val);
    if (!isDupe) {
        activeFilters.push({ col, val });
        renderChips();
        applyFilter();
    }

    // Reset builder
    filterColSelect.value = '';
    filterColValue.innerHTML = '<option value="">— Value —</option>';
    filterColValue.disabled = true;
    addFilterBtn.disabled = true;
});

function removeFilter(idx) {
    activeFilters.splice(idx, 1);
    renderChips();
    applyFilter();
}

function renderChips() {
    filterChipsRow.innerHTML = '';
    if (activeFilters.length === 0) {
        filterChipsRow.classList.add('hidden');
        return;
    }
    filterChipsRow.classList.remove('hidden');

    const lbl = document.createElement('span');
    lbl.className = 'chips-label';
    lbl.textContent = 'Active:';
    filterChipsRow.appendChild(lbl);

    activeFilters.forEach(({ col, val }, idx) => {
        const chip = document.createElement('span');
        chip.className = 'filter-chip';
        chip.innerHTML = `
            <span class="chip-col">${escText(col)}</span>
            <span>is</span>
            <span class="chip-val" title="${escText(val)}">${escText(val)}</span>
            <button class="chip-remove" title="Remove">✕</button>`;
        chip.querySelector('.chip-remove').addEventListener('click', () => removeFilter(idx));
        filterChipsRow.appendChild(chip);
    });
}

function escText(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function applyFilter() {
    const globalQ = filterInput.value.toLowerCase().trim();

    filteredProducts = allProducts.filter((p) => {
        // 1. Global text search across all fields
        if (globalQ) {
            const inCore = [p.title, p.brand, p.price, p.rating, p.reviews, p.availability]
                .some(v => (v || '').toLowerCase().includes(globalQ));
            const inSpecs = Object.values(p.specs || {})
                .some(v => v.toLowerCase().includes(globalQ));
            if (!inCore && !inSpecs) return false;
        }

        // 2. All active chip filters must match (AND)
        for (const { col, val } of activeFilters) {
            const cellVal = getColValue(p, col);
            if (cellVal !== val) return false;
        }

        return true;
    });

    if (sortCol) applySortToFiltered();
    renderFiltered();
}

function getColValue(p, col) {
    if (!col) return '';
    if (col === 'Title') return p.title || '';
    if (col === 'Brand') return p.brand || '';
    if (col === 'Price') return p.price || '';
    if (col === 'Rating') return p.rating || '';
    if (col === 'Reviews') return p.reviews || '';
    if (col === 'Availability') return p.availability || '';
    return (p.specs && p.specs[col]) ? p.specs[col] : '';
}

// Populate value dropdown with distinct values for the chosen column
function populateFilterValues(col) {
    filterColValue.innerHTML = '<option value="">— Value —</option>';
    if (!col) { filterColValue.disabled = true; return; }

    const seen = new Set();
    allProducts.forEach(p => {
        const v = getColValue(p, col).trim();
        if (v) seen.add(v);
    });
    const sorted = Array.from(seen).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    sorted.forEach(v => {
        const opt = document.createElement('option');
        opt.value = v;
        opt.textContent = v.length > 60 ? v.slice(0, 57) + '…' : v;
        filterColValue.appendChild(opt);
    });
    filterColValue.disabled = sorted.length === 0;
}

function renderFiltered() {
    tableBody.innerHTML = '';
    if (filteredProducts.length === 0 && allProducts.length > 0) {
        emptyState.classList.remove('hidden');
    } else {
        emptyState.classList.add('hidden');
        filteredProducts.forEach((p, i) => tableBody.appendChild(buildRow(p, i + 1)));
    }
    updateStatPill();
}

function updateStatPill() {
    const shown = filteredProducts.length;
    const total = allProducts.length;
    statPill.textContent = shown === total ? `${total} products` : `${shown} / ${total} products`;
}


// ── Sort ───────────────────────────────────────────────────────────────────

// Dropdown-based sort
sortColSelect.addEventListener('change', () => {
    sortCol = sortColSelect.value || null;
    sortDir = 'asc';
    sortDirBtn.textContent = '↑ Asc';
    sortDirBtn.classList.remove('desc');
    if (sortCol) { applySortToFiltered(); syncHeaderClasses(); renderFiltered(); }
    else { applyFilter(); }
});

sortDirBtn.addEventListener('click', () => {
    sortDir = sortDir === 'asc' ? 'desc' : 'asc';
    sortDirBtn.textContent = sortDir === 'asc' ? '↑ Asc' : '↓ Desc';
    sortDirBtn.classList.toggle('desc', sortDir === 'desc');
    if (sortCol) { applySortToFiltered(); syncHeaderClasses(); renderFiltered(); }
});

clearFiltersBtn.addEventListener('click', () => {
    // Clear all chips
    activeFilters = [];
    renderChips();
    // Clear global search
    filterInput.value = '';
    // Reset builder UI
    filterColSelect.value = '';
    filterColValue.innerHTML = '<option value="">— Value —</option>';
    filterColValue.disabled = true;
    addFilterBtn.disabled = true;
    // Clear sort
    sortColSelect.value = '';
    sortCol = null;
    sortDir = 'asc';
    sortDirBtn.textContent = '↑ Asc';
    sortDirBtn.classList.remove('desc');
    syncHeaderClasses();
    applyFilter();
    toast('Filters cleared', 'info');
});

// Called when a table header is clicked (column-header sort)
function handleSort(col) {
    if (sortCol === col) {
        sortDir = sortDir === 'asc' ? 'desc' : 'asc';
    } else {
        sortCol = col;
        sortDir = 'asc';
    }
    // Sync the dropdown with the header click
    const opt = sortColSelect.querySelector(`option[value="${col}"]`);
    sortColSelect.value = opt ? col : '';
    sortDirBtn.textContent = sortDir === 'asc' ? '↑ Asc' : '↓ Desc';
    sortDirBtn.classList.toggle('desc', sortDir === 'desc');

    applySortToFiltered();
    syncHeaderClasses();
    renderFiltered();
}

function applySortToFiltered() {
    if (!sortCol) return;
    const getSortVal = (p) => {
        if (sortCol === 'Title') return p.title || '';
        if (sortCol === 'Brand') return p.brand || '';
        if (sortCol === 'Price') return parseFloat((p.price || '0').replace(/[^0-9.]/g, '')) || 0;
        if (sortCol === 'Rating') return parseFloat(p.rating) || 0;
        if (sortCol === 'Reviews') return parseInt((p.reviews || '0').replace(/[^0-9]/g, '')) || 0;
        if (sortCol === 'Availability') return p.availability || '';
        return (p.specs && p.specs[sortCol]) ? p.specs[sortCol] : '';
    };
    filteredProducts.sort((a, b) => {
        const va = getSortVal(a), vb = getSortVal(b);
        if (typeof va === 'number') return sortDir === 'asc' ? va - vb : vb - va;
        return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
    });
}

function syncHeaderClasses() {
    const specKeys = Array.from(specColumns);
    const allCols = [...CORE_COLS, ...specKeys, 'Details'];
    tableHead.querySelectorAll('th').forEach((th, i) => {
        th.className = (allCols[i] === sortCol) ? `sorted-${sortDir}` : '';
    });
}

// Keep Sort By dropdown populated with spec columns as they are discovered
function syncSortDropdownToSpec() {
    // Remove old spec options
    sortColSelect.querySelectorAll('option[data-spec]').forEach(o => o.remove());
    filterColSelect.querySelectorAll('option[data-spec]').forEach(o => o.remove());
    // Add current spec columns
    Array.from(specColumns).forEach(key => {
        [sortColSelect, filterColSelect].forEach(sel => {
            const opt = document.createElement('option');
            opt.value = key;
            opt.textContent = key;
            opt.dataset.spec = '1';
            sel.appendChild(opt);
        });
    });
}

// ── CSV Export ─────────────────────────────────────────────────────────────
exportCsvBtn.addEventListener('click', exportCsv);

function exportCsv() {
    if (allProducts.length === 0) { toast('No products to export', 'info'); return; }

    const specKeys = Array.from(specColumns);
    const headers = [...CORE_COLS.filter((c) => c !== '#' && c !== 'Image'), ...specKeys];

    const rows = [headers.join(',')];

    (filteredProducts.length > 0 ? filteredProducts : allProducts).forEach((p) => {
        const row = [
            csv(p.title),
            csv(p.brand),
            csv(p.price),
            csv(p.rating),
            csv(p.reviews),
            csv(p.availability),
            ...specKeys.map((k) => csv((p.specs && p.specs[k]) || '')),
        ];
        rows.push(row.join(','));
    });

    const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `amazon-scan-${Date.now()}.csv`;
    a.click();
    toast('CSV exported!', 'success');
}

function csv(val) {
    const s = (val || '').toString().replace(/"/g, '""');
    return `"${s}"`;
}

// ── Clear table ────────────────────────────────────────────────────────────
clearTableBtn.addEventListener('click', () => {
    allProducts = [];
    filteredProducts = [];
    activeFilters = [];
    renderChips();
    specColumns = new Set();
    tableHead.innerHTML = '';
    tableBody.innerHTML = '';
    updateStatPill();
    filterInput.value = '';
    filterColSelect.value = '';
    filterColValue.innerHTML = '<option value="">— Value —</option>';
    filterColValue.disabled = true;
    addFilterBtn.disabled = true;
    sortColSelect.value = '';
    sortDirBtn.textContent = '↑ Asc';
    sortDirBtn.classList.remove('desc');
    sortCol = null; sortDir = 'asc';
    syncSortDropdownToSpec();
    toast('Results cleared', 'info');
});

// ── Open product detail page ──────────────────────────────────────────────
function openProductPage(product) {
    const key = 'scanner_product_' + (product.asin || product.title);
    localStorage.setItem(key, JSON.stringify(product));
    const url = `/product.html?asin=${encodeURIComponent(product.asin || product.title)}`;
    window.open(url, '_blank');
}

function openModal(product) {
    modalTitle.textContent = product.title || 'Product Details';
    modalBody.innerHTML = '';

    // Meta chips
    const meta = document.createElement('div');
    meta.className = 'modal-meta';
    const chips = [
        { label: 'Price', val: product.price || 'N/A' },
        { label: 'Rating', val: product.rating || 'N/A' },
        { label: 'Reviews', val: product.reviews || 'N/A' },
        { label: 'Availability', val: product.availability || 'N/A' },
        { label: 'Brand', val: product.brand || 'N/A' },
    ];
    chips.forEach(({ label, val }) => {
        const chip = document.createElement('div');
        chip.className = 'meta-chip';
        chip.innerHTML = `<span class="chip-label">${label}</span><span class="chip-val">${val}</span>`;
        meta.appendChild(chip);
    });

    // Amazon link
    if (product.url) {
        const chip = document.createElement('div');
        chip.className = 'meta-chip';
        chip.innerHTML = `<a href="${product.url}" target="_blank" style="color:var(--blue);text-decoration:none;font-size:13px">🔗 View on Amazon</a>`;
        meta.appendChild(chip);
    }

    modalBody.appendChild(meta);

    // Features
    if (product.features && product.features.length > 0) {
        const sec = section('Key Features');
        const ul = document.createElement('ul');
        ul.className = 'feature-list';
        product.features.slice(0, 10).forEach((f) => {
            const li = document.createElement('li');
            li.textContent = f;
            ul.appendChild(li);
        });
        sec.appendChild(ul);
        modalBody.appendChild(sec);
    }

    // Specs table
    const specsSec = section('Technical Specifications');
    const specEntries = Object.entries(product.specs || {});
    if (specEntries.length > 0) {
        const tbl = document.createElement('table');
        tbl.className = 'specs-table';
        specEntries.forEach(([k, v]) => {
            const tr = document.createElement('tr');
            tr.innerHTML = `<td>${k}</td><td>${v}</td>`;
            tbl.appendChild(tr);
        });
        specsSec.appendChild(tbl);
    } else {
        const p = document.createElement('p');
        p.className = 'specs-empty';
        p.textContent = product.error ? `Could not scrape: ${product.error}` : 'No specifications found for this product.';
        specsSec.appendChild(p);
    }
    modalBody.appendChild(specsSec);

    detailModal.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
}

function section(title) {
    const el = document.createElement('div');
    el.className = 'modal-section';
    const h = document.createElement('div');
    h.className = 'modal-section-title';
    h.textContent = title;
    el.appendChild(h);
    return el;
}

modalClose.addEventListener('click', closeModal);
modalBackdrop.addEventListener('click', closeModal);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

function closeModal() {
    detailModal.classList.add('hidden');
    document.body.style.overflow = '';
}

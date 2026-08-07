// Lunch budget - products with tag LUNCH from product database

const LUNCH_TAG = 'LUNCH';
const LUNCH_STORAGE_KEY = 'nrd-pedidos-lunch-config';

// Ofertas precargadas (5, 10, 15) - nombres iguales a tu lista de productos con tag LUNCH
const LUNCH_OFFERS = {
  5: [
    { productName: 'SANDWICH COPETIN - JAMON Y QUESO', quantity: 24 },
    { productName: 'SANDWICH COPETIN - ATUN Y TOMATE', quantity: 16 },
    { productName: 'SANDWICH COPETIN - POLLO Y JARDINERA', quantity: 16 },
    { productName: 'SANDWICH COPETIN - LOMITO Y MANTECA', quantity: 16 },
    { productName: 'BOCADITO COPETIN DE PIZZA', quantity: 15 },
    { productName: 'MEDIALUNITAS COPETIN - JAMON Y QUESO', quantity: 8 },
    { productName: 'ALEMANITAS COPETIN RELLENAS', quantity: 8 }
  ],
  10: [
    { productName: 'SANDWICH COPETIN - JAMON Y CHOCLO', quantity: 32 },
    { productName: 'SANDWICH COPETIN - OLIMPICO', quantity: 32 },
    { productName: 'SANDWICH COPETIN - BONDIOLA Y MANTECA', quantity: 32 },
    { productName: 'SANDWICH COPETIN - JAMON Y PALMITO', quantity: 32 },
    { productName: 'BOCADITO COPETIN DE PIZZA', quantity: 20 },
    { productName: 'EMPANADITAS COPETIN - CARNE', quantity: 20 },
    { productName: 'MEDIALUNITAS COPETIN - JAMON Y QUESO', quantity: 20 },
    { productName: 'JESUITAS', quantity: 12 }
  ],
  15: [
    { productName: 'SANDWICH COPETIN - JAMON Y QUESO', quantity: 48 },
    { productName: 'SANDWICH COPETIN - ATUN Y TOMATE', quantity: 48 },
    { productName: 'SANDWICH COPETIN - JAMON Y HUEVO', quantity: 48 },
    { productName: 'SANDWICH COPETIN - LOMITO Y MANTECA', quantity: 48 },
    { productName: 'BOCADITO COPETIN DE PIZZA', quantity: 30 },
    { productName: 'MEDIALUNITAS COPETIN - JAMON Y QUESO', quantity: 24 },
    { productName: 'ALEMANITAS COPETIN RELLENAS', quantity: 24 }
  ]
};

function normalizeName(s) {
  if (s == null) return '';
  let t = String(s).toLowerCase().replace(/\s+/g, ' ').trim();
  const accents = { á: 'a', é: 'e', í: 'i', ó: 'o', ú: 'u', ñ: 'n', ü: 'u' };
  Object.keys(accents).forEach((k) => { t = t.replace(new RegExp(k, 'g'), accents[k]); });
  return t;
}

let lunchProducts = []; // { id, name, price, ... } filtered by LUNCH tag

function getLunchConfigFromStorage() {
  try {
    const raw = localStorage.getItem(LUNCH_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

function saveLunchConfigToStorage(config) {
  try {
    localStorage.setItem(LUNCH_STORAGE_KEY, JSON.stringify(config));
  } catch (e) {
    logger.warn('Could not save lunch config to localStorage', e);
  }
}

function getLunchConfigFromDOM() {
  const tbody = document.getElementById('lunch-budget-tbody');
  const cantPersonasEl = document.getElementById('lunch-cant-personas');
  const filterCheckbox = document.getElementById('lunch-filter-rows-with-qty');
  if (!tbody || !cantPersonasEl) return null;
  const quantities = {};
  tbody.querySelectorAll('tr').forEach(tr => {
    const input = tr.querySelector('.lunch-qty-input');
    const id = input?.dataset?.productId;
    if (id) {
      const qty = Math.max(0, parseInt(input?.value || '0', 10) || 0);
      quantities[id] = qty;
    }
  });
  return {
    cantPersonas: Math.max(1, parseInt(cantPersonasEl.value || '1', 10) || 1),
    quantities,
    filterRowsWithQty: filterCheckbox ? filterCheckbox.checked : false
  };
}

function applyLunchRowFilter() {
  const tbody = document.getElementById('lunch-budget-tbody');
  const filterCheckbox = document.getElementById('lunch-filter-rows-with-qty');
  if (!tbody || !filterCheckbox) return;
  const filterOn = filterCheckbox.checked;
  tbody.querySelectorAll('tr').forEach(tr => {
    const input = tr.querySelector('.lunch-qty-input');
    const qty = Math.max(0, parseInt(input?.value || '0', 10) || 0);
    tr.style.display = filterOn && qty <= 0 ? 'none' : '';
  });
}

/**
 * Format number as currency (integer rounded). Uses NRDCommon if available.
 */
function formatLunchCurrency(value) {
  if (value == null || Number.isNaN(value)) return '$ -';
  const n = Math.round(Number(value));
  if (window.formatCurrency) {
    return window.formatCurrency(n);
  }
  const parts = n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.').split('.');
  return '$ ' + parts.join('.') + ',00';
}

/**
 * Check if product or variant has LUNCH tag (tags can be on product or variant).
 * Supports tags as array or object (Firebase may store arrays as object with numeric keys).
 */
function hasLunchTag(item) {
  const raw = item.tags;
  if (!raw) return false;
  const tags = Array.isArray(raw) ? raw : (typeof raw === 'object' ? Object.values(raw) : []);
  return tags.some(t => String(t).toUpperCase() === LUNCH_TAG);
}

/**
 * Load products with tag LUNCH (from base products + variants).
 */
async function loadLunchProducts() {
  const nrd = window.nrd;
  if (!nrd || !nrd.products) {
    logger.error('NRD products service not available');
    return [];
  }
  try {
    const [withVariants, withoutVariants] = await Promise.all([
      nrd.products.getAll({ withVariants: true }),
      nrd.products.getAll({ withVariants: false })
    ]);
    const allItems = [...(withVariants || []), ...(withoutVariants || [])];
    const result = [];
    for (const item of allItems) {
      if (item.active === false) continue;
      if (!hasLunchTag(item)) continue;
      const id = item.variantId ? `${item.productId}_${item.variantId}` : (item.id || item.productId);
      // La API (withVariants) ya entrega name = "Padre - Variante"; no volver a concatenar.
      const parent = String(item.productName || '').trim();
      const rawName = String(item.name || '').trim();
      let name = rawName || parent;
      if (item.variantId && parent && rawName && rawName !== parent && !rawName.startsWith(parent + ' - ')) {
        name = parent + ' - ' + rawName;
      }
      result.push({
        id,
        name,
        price: Number(item.price) || 0
      });
    }
    lunchProducts = result;
    logger.debug('Lunch products loaded', { count: result.length });
    return result;
  } catch (error) {
    logger.error('Error loading lunch products', error);
    lunchProducts = [];
    return [];
  }
}

/**
 * Aplica una oferta precargada (5, 10 o 15 personas): setea cantidades por producto y cant. personas.
 */
function applyLunchOffer(personas) {
  const items = LUNCH_OFFERS[personas];
  if (!items || !items.length) return;
  const tbody = document.getElementById('lunch-budget-tbody');
  const cantPersonasEl = document.getElementById('lunch-cant-personas');
  if (!tbody || !cantPersonasEl) return;
  const mapByNormalizedName = {};
  items.forEach((item) => {
    const key = normalizeName(item.productName);
    mapByNormalizedName[key] = item.quantity || 0;
  });
  tbody.querySelectorAll('tr').forEach((tr) => {
    const nameCell = tr.querySelector('td:first-child');
    const input = tr.querySelector('.lunch-qty-input');
    if (!nameCell || !input) return;
    const rowName = normalizeName(nameCell.textContent || '');
    let qty = 0;
    if (rowName && mapByNormalizedName[rowName] != null) {
      qty = mapByNormalizedName[rowName];
    } else if (rowName) {
      for (const [templateName, templateQty] of Object.entries(mapByNormalizedName)) {
        if (rowName.includes(templateName) || templateName.includes(rowName)) {
          qty = templateQty;
          break;
        }
      }
    }
    input.value = Math.max(0, qty);
  });
  cantPersonasEl.value = Math.max(1, personas);
  updateLunchTotals();
}

/**
 * Recalculate row total and global summary (total bocaditos, bocaditos x persona, importe total).
 */
function updateLunchTotals() {
  const tbody = document.getElementById('lunch-budget-tbody');
  const cantPersonasEl = document.getElementById('lunch-cant-personas');
  const totalBocaditosEl = document.getElementById('lunch-total-bocaditos');
  const bocaditosXPersonaEl = document.getElementById('lunch-bocaditos-x-persona');
  const importeTotalEl = document.getElementById('lunch-importe-total');
  if (!tbody || !cantPersonasEl) return;

  let totalBocaditos = 0;
  let importeTotal = 0;

  tbody.querySelectorAll('tr').forEach(tr => {
    const qtyInput = tr.querySelector('.lunch-qty-input');
    const price = Number(tr.dataset.price) || 0;
    const qty = Math.max(0, parseInt(qtyInput?.value || '0', 10) || 0);
    totalBocaditos += qty;
    const rowTotal = price * qty;
    importeTotal += rowTotal;
    const totalCell = tr.querySelector('.lunch-row-total');
    if (totalCell) {
      totalCell.textContent = qty > 0 ? formatLunchCurrency(rowTotal) : '-';
    }
  });

  const cantPersonas = Math.max(1, parseInt(cantPersonasEl.value || '1', 10) || 1);
  const bocaditosXPersona = cantPersonas > 0 ? Math.round((totalBocaditos / cantPersonas) * 100) / 100 : 0;

  if (totalBocaditosEl) totalBocaditosEl.textContent = totalBocaditos;
  if (bocaditosXPersonaEl) bocaditosXPersonaEl.textContent = bocaditosXPersona;
  if (importeTotalEl) importeTotalEl.textContent = importeTotal > 0 ? formatLunchCurrency(importeTotal) : '$ -';

  const config = getLunchConfigFromDOM();
  if (config) saveLunchConfigToStorage(config);
  applyLunchRowFilter();
}

/**
 * Render lunch table from lunchProducts and bind quantity inputs.
 */
function renderLunchTable() {
  const tbody = document.getElementById('lunch-budget-tbody');
  if (!tbody) return;

  tbody.innerHTML = '';
  if (lunchProducts.length === 0) {
    const tr = document.createElement('tr');
    tr.innerHTML = '<td colspan="4" class="border border-gray-300 px-3 py-4 text-center text-gray-600">No hay productos con etiqueta LUNCH. Agregue la etiqueta "LUNCH" a los productos en la gestión de productos.</td>';
    tbody.appendChild(tr);
    updateLunchTotals();
    return;
  }

  lunchProducts.forEach(p => {
    const tr = document.createElement('tr');
    tr.dataset.price = p.price;
    tr.innerHTML = `
      <td class="border border-gray-300 px-2 py-1.5 sm:px-3 sm:py-2 font-light text-gray-800">${escapeHtml(p.name)}</td>
      <td class="border border-gray-300 px-1 py-1">
        <input type="number" class="lunch-qty-input w-full px-2 py-1 border-0 bg-transparent text-sm text-center focus:outline-none focus:ring-0 focus:bg-gray-50 rounded-none" min="0" value="0" data-product-id="${escapeHtml(p.id)}">
      </td>
      <td class="border border-gray-300 px-2 py-1.5 sm:px-3 sm:py-2 text-right font-light text-gray-800">${formatLunchCurrency(p.price)}</td>
      <td class="lunch-row-total border border-gray-300 px-2 py-1.5 sm:px-3 sm:py-2 text-right font-light text-gray-800">-</td>
    `;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll('.lunch-qty-input').forEach(input => {
    input.addEventListener('input', updateLunchTotals);
    input.addEventListener('change', updateLunchTotals);
    // Al hacer clic en la celda, limpiar el contenido para ingresar el nuevo número (no al tabular)
    input.addEventListener('mousedown', function () {
      this.value = '';
      updateLunchTotals();
    });
  });

  const cantPersonasEl = document.getElementById('lunch-cant-personas');
  if (cantPersonasEl) {
    cantPersonasEl.removeEventListener('input', updateLunchTotals);
    cantPersonasEl.removeEventListener('change', updateLunchTotals);
    cantPersonasEl.addEventListener('input', updateLunchTotals);
    cantPersonasEl.addEventListener('change', updateLunchTotals);
  }

  // Restaurar desde localStorage
  const saved = getLunchConfigFromStorage();
  if (saved) {
    if (saved.cantPersonas != null) {
      const cp = document.getElementById('lunch-cant-personas');
      if (cp) cp.value = Math.max(1, saved.cantPersonas);
    }
    if (saved.quantities && typeof saved.quantities === 'object') {
      tbody.querySelectorAll('.lunch-qty-input').forEach(input => {
        const id = input.dataset.productId;
        if (id && saved.quantities[id] != null) {
          const q = Math.max(0, parseInt(saved.quantities[id], 10) || 0);
          input.value = q;
        }
      });
    }
    const filterCb = document.getElementById('lunch-filter-rows-with-qty');
    if (filterCb && typeof saved.filterRowsWithQty === 'boolean') filterCb.checked = saved.filterRowsWithQty;
  }

  updateLunchTotals();
}

function escapeHtml(text) {
  if (text == null) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

let lunchTopActionsSetup = false;

function setupLunchTopActions() {
  if (lunchTopActionsSetup) return;
  lunchTopActionsSetup = true;
  const clearBtn = document.getElementById('lunch-clear-btn');
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      const tbody = document.getElementById('lunch-budget-tbody');
      if (tbody) {
        tbody.querySelectorAll('.lunch-qty-input').forEach(input => {
          input.value = '0';
        });
      }
      const cp = document.getElementById('lunch-cant-personas');
      if (cp) cp.value = '10';
      updateLunchTotals();
    });
  }
  [5, 10, 15].forEach((personas) => {
    const btn = document.getElementById(`lunch-offer-${personas}-btn`);
    if (btn) {
      btn.addEventListener('click', () => applyLunchOffer(personas));
    }
  });
  const filterCb = document.getElementById('lunch-filter-rows-with-qty');
  if (filterCb) {
    filterCb.addEventListener('change', () => {
      applyLunchRowFilter();
      const config = getLunchConfigFromDOM();
      if (config) saveLunchConfigToStorage(config);
    });
  }
}

/**
 * Load lunch view: fetch LUNCH products and render table.
 */
function loadLunch() {
  logger.debug('Loading lunch view');
  setupLunchTopActions();
  loadLunchProducts().then(() => {
    renderLunchTable();
  });
}

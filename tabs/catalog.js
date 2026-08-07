/**
 * Tab Catálogo: gestión del catálogo para la app cliente (nrd-catalogo).
 * Arquitectura: pestañas Productos | Opcionales; dos columnas (secciones/grupos a la izquierda, contenido a la derecha).
 * Enlace obligatorio: cada producto del catálogo y cada ítem de opcional debe vincularse a un producto o variante del sistema.
 *
 * Configuración del catálogo:
 * - products: { [sku]: { name, category, image?, price?, options?: [{ optionId, variantSkus }], ... } }
 *   Las opciones son por producto: cada producto tiene su propio array "options" (ninguna, una o varias).
 * - optionsCatalog: definiciones de grupos de opcionales (label, choices); los productos referencian grupos por optionId.
 */

const DEFAULT_PAYMENT_METHODS = {
  efectivo: true,
  pos: true,
  mercadopago: true
};

const PAYMENT_METHOD_LABELS = {
  efectivo: 'Efectivo',
  pos: 'Tarjeta',
  mercadopago: 'Mercado Pago'
};

const DEFAULT_CONFIG = {
  products: {},
  categories: [{ id: 'todos', name: 'Todos' }],
  optionsCatalog: {},
  storeOpenTime: '08:00',
  storeCloseTime: '20:00',
  storeManualOverride: null,
  paymentMethods: { ...DEFAULT_PAYMENT_METHODS }
};

let catalogConfig = { ...DEFAULT_CONFIG, paymentMethods: { ...DEFAULT_PAYMENT_METHODS } };
/** Lista de productos/variantes del sistema: { sku, productId, variantId, name, price } */
let allProducts = [];
let selectedSectionId = 'todos';
let selectedOptionGroupId = null;

const FALLBACK_IMAGE = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 80 80"><rect fill="#f3f4f6" width="80" height="80"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="#9ca3af" font-size="10">Sin imagen</text></svg>');

function escapeHtml(s) {
  if (s == null) return '';
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

/** Icono papelera (eliminar) 20x20. */
const ICON_TRASH = '<svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';
/** Icono lápiz (editar) 20x20. */
const ICON_PENCIL = '<svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>';

async function loadCatalogConfig() {
  try {
    if (!window.nrd || !window.nrd.catalogConfig) {
      catalogConfig = { ...DEFAULT_CONFIG, paymentMethods: { ...DEFAULT_PAYMENT_METHODS } };
      return catalogConfig;
    }
    const data = await window.nrd.catalogConfig.get();
    if (data) {
      const pm = data.paymentMethods && typeof data.paymentMethods === 'object' ? data.paymentMethods : {};
      catalogConfig = {
        products: data.products || {},
        categories: Array.isArray(data.categories) && data.categories.length > 0 ? data.categories : DEFAULT_CONFIG.categories,
        optionsCatalog: data.optionsCatalog || {},
        storeOpenTime: data.storeOpenTime != null ? String(data.storeOpenTime).trim() : DEFAULT_CONFIG.storeOpenTime,
        storeCloseTime: data.storeCloseTime != null ? String(data.storeCloseTime).trim() : DEFAULT_CONFIG.storeCloseTime,
        storeManualOverride: data.storeManualOverride === 'open' || data.storeManualOverride === 'closed' ? data.storeManualOverride : null,
        paymentMethods: {
          efectivo: pm.efectivo !== false,
          pos: pm.pos !== false,
          mercadopago: pm.mercadopago !== false
        },
        shippingCost: data.shippingCost,
        minimumForShipping: data.minimumForShipping,
        estimatedMinutes: data.estimatedMinutes,
        brandName: data.brandName,
        tagline: data.tagline
      };
    } else {
      catalogConfig = { ...DEFAULT_CONFIG, paymentMethods: { ...DEFAULT_PAYMENT_METHODS } };
    }
    return catalogConfig;
  } catch (e) {
    (window.logger || console).warn('Error loading catalog config', e);
    catalogConfig = { ...DEFAULT_CONFIG, paymentMethods: { ...DEFAULT_PAYMENT_METHODS } };
    return catalogConfig;
  }
}

/** Quita propiedades undefined de un objeto (Firebase no acepta undefined). */
function stripUndefined(obj) {
  if (obj == null || typeof obj !== 'object') return obj;
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    out[k] = Array.isArray(v) ? v.map(stripUndefined) : (v && typeof v === 'object' && !Array.isArray(v) ? stripUndefined(v) : v);
  }
  return out;
}

async function saveCatalogConfig() {
  if (!window.nrd || !window.nrd.catalogConfig) throw new Error('Catalog config service not available');
  const payload = stripUndefined({
    products: catalogConfig.products,
    categories: catalogConfig.categories,
    optionsCatalog: catalogConfig.optionsCatalog,
    storeOpenTime: catalogConfig.storeOpenTime,
    storeCloseTime: catalogConfig.storeCloseTime,
    storeManualOverride: catalogConfig.storeManualOverride,
    paymentMethods: catalogConfig.paymentMethods || { ...DEFAULT_PAYMENT_METHODS },
    shippingCost: catalogConfig.shippingCost,
    minimumForShipping: catalogConfig.minimumForShipping,
    estimatedMinutes: catalogConfig.estimatedMinutes,
    brandName: catalogConfig.brandName,
    tagline: catalogConfig.tagline
  });
  await window.nrd.catalogConfig.set(payload);
  (window.logger || console).debug('Catalog config saved');
}

function switchCatalogSub(sub) {
  document.querySelectorAll('.catalog-sub-panel').forEach((el) => el.classList.add('hidden'));
  document.querySelectorAll('.catalog-sub-nav').forEach((btn) => {
    btn.classList.remove('bg-red-600', 'text-white');
    btn.classList.add('text-gray-600');
  });
  const panel = document.getElementById('catalog-sub-' + sub);
  const btn = document.querySelector('.catalog-sub-nav[data-sub="' + sub + '"]');
  if (panel) panel.classList.remove('hidden');
  if (btn) {
    btn.classList.remove('text-gray-600');
    btn.classList.add('bg-red-600', 'text-white');
  }
  if (sub === 'products') renderProductsPanel();
  else if (sub === 'options') renderOptionsPanel();
}

// ——— Productos: secciones (izq) y lista por categoría (der) ———

function renderSectionsList() {
  const list = document.getElementById('catalog-sections-list');
  if (!list) return;
  const categories = catalogConfig.categories || [];
  const products = catalogConfig.products || {};
  list.innerHTML = '';
  [{ id: 'todos', name: 'Todos' }, ...categories.filter((c) => c.id !== 'todos')].forEach((cat) => {
    const count = cat.id === 'todos'
      ? Object.keys(products).length
      : Object.values(products).filter((p) => p.category === cat.id).length;
    const isSelected = selectedSectionId === cat.id;
    const isTodos = cat.id === 'todos';
    const canDeleteSection = !isTodos && count === 0;

    const row = document.createElement('div');
    row.className = 'flex items-center gap-1 border border-gray-200 bg-white text-sm font-light ' + (isSelected ? 'border-l-4 border-l-red-600 text-red-600' : '');
    row.dataset.sectionId = cat.id;

    const selectBtn = document.createElement('button');
    selectBtn.type = 'button';
    selectBtn.className = 'flex-1 min-w-0 text-left px-3 py-2 flex items-center gap-2';
    const badgeClass = isSelected ? 'bg-red-100 text-red-600' : 'bg-gray-100 text-gray-600';
    selectBtn.innerHTML = `<span class="truncate min-w-0 flex-1">${escapeHtml(cat.name)}</span><span class="shrink-0 rounded-full ${badgeClass} text-xs font-medium min-w-[1.5rem] h-6 px-1.5 flex items-center justify-center">${count}</span>`;
    selectBtn.addEventListener('click', () => {
      selectedSectionId = cat.id;
      renderProductsPanel();
    });
    row.appendChild(selectBtn);

    if (!isTodos) {
      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.className = 'shrink-0 p-1.5 text-red-600 hover:bg-red-50 hover:text-red-700' + (canDeleteSection ? '' : ' opacity-50 cursor-not-allowed');
      deleteBtn.title = canDeleteSection ? 'Eliminar sección' : 'No se puede eliminar: tiene productos vinculados';
      deleteBtn.setAttribute('aria-label', 'Eliminar');
      deleteBtn.innerHTML = ICON_TRASH;
      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!canDeleteSection) {
          (window.showError || alert)('No se puede eliminar: esta sección tiene productos. Mueva o elimine los productos antes.');
          return;
        }
        confirmDeleteSection(cat.id, cat.name);
      });
      row.appendChild(deleteBtn);
    }

    list.appendChild(row);
  });
}

async function editSectionName(sectionId, currentName) {
  const newName = typeof window.showPrompt === 'function'
    ? await window.showPrompt('Editar sección', 'Nuevo nombre de la sección:', currentName || '', 'Aceptar', 'Cancelar')
    : (window.prompt ? window.prompt('Nuevo nombre de la sección:', currentName || '') : '');
  const trimmed = (newName || '').trim();
  if (!trimmed || trimmed === (currentName || '').trim()) return;
  const cat = (catalogConfig.categories || []).find((c) => c.id === sectionId);
  if (!cat) return;
  cat.name = trimmed;
  try {
    await saveCatalogConfig();
    renderSectionsList();
    (window.showSuccess || (() => {}))('Sección actualizada');
  } catch (e) {
    (window.showError || alert)(e.message || 'Error al guardar');
  }
}

async function confirmDeleteSection(sectionId, displayName) {
  const ok = await (window.showConfirm || ((t, m) => Promise.resolve(confirm(m))))('Eliminar sección', '¿Eliminar la sección «' + (displayName || sectionId) + '»? Esta acción no se puede deshacer.');
  if (!ok) return;
  try {
    catalogConfig.categories = (catalogConfig.categories || []).filter((c) => c.id !== sectionId);
    await saveCatalogConfig();
    if (selectedSectionId === sectionId) selectedSectionId = 'todos';
    renderSectionsList();
    renderProductsPanel();
    (window.showSuccess || (() => {}))('Sección eliminada');
  } catch (e) {
    (window.showError || alert)(e.message || 'Error al eliminar');
  }
}

/**
 * @param {string|null} sku - SKU del artículo a editar, o null para crear uno nuevo.
 */
function openEditProductModal(sku) {
  const modal = document.getElementById('catalog-edit-product-modal');
  const systemInput = document.getElementById('catalog-edit-product-system-input');
  const systemSku = document.getElementById('catalog-edit-product-system-sku');
  const systemResults = document.getElementById('catalog-edit-product-system-results');
  if (!modal || !systemInput || !systemSku) return;
  const products = catalogConfig.products || {};
  const categories = catalogConfig.categories || [];
  const cfg = sku ? products[sku] : null;

  const selectedSku = (cfg && sku) ? sku : '';
  const selectedProduct = selectedSku ? allProducts.find((p) => p.sku === selectedSku) : null;
  systemSku.value = selectedSku;
  systemInput.value = selectedProduct ? `${selectedProduct.name} — ${selectedProduct.sku}` : '';
  if (systemResults) systemResults.classList.add('hidden');

  document.getElementById('catalog-edit-product-category').innerHTML =
    '<option value="">Sin categoría</option>' +
    (categories.filter((c) => c.id !== 'todos').map((c) => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`).join(''));

  if (cfg) {
    document.getElementById('catalog-edit-product-name').value = cfg.name || '';
    document.getElementById('catalog-edit-product-desc').value = cfg.description || '';
    document.getElementById('catalog-edit-product-category').value = cfg.category || '';
    document.getElementById('catalog-edit-product-price').value = cfg.price != null ? String(cfg.price) : '';
    document.getElementById('catalog-edit-product-image-path').value = cfg.image || '';
    const imgEl = document.getElementById('catalog-edit-product-image');
    const placeholder = document.getElementById('catalog-edit-product-image-placeholder');
    if (cfg.image) {
      imgEl.src = cfg.image;
      imgEl.onerror = () => { imgEl.classList.add('hidden'); placeholder.classList.remove('hidden'); };
      imgEl.classList.remove('hidden');
      placeholder.classList.add('hidden');
    } else {
      imgEl.classList.add('hidden');
      placeholder.classList.remove('hidden');
    }
    modal.dataset.editSku = sku;
    document.getElementById('catalog-edit-product-delete').classList.remove('hidden');
  } else {
    document.getElementById('catalog-edit-product-name').value = '';
    document.getElementById('catalog-edit-product-desc').value = '';
    document.getElementById('catalog-edit-product-category').value = selectedSectionId === 'todos' ? '' : selectedSectionId;
    document.getElementById('catalog-edit-product-price').value = '';
    document.getElementById('catalog-edit-product-image-path').value = '';
    document.getElementById('catalog-edit-product-image').classList.add('hidden');
    document.getElementById('catalog-edit-product-image-placeholder').classList.remove('hidden');
    delete modal.dataset.editSku;
    document.getElementById('catalog-edit-product-delete').classList.add('hidden');
  }
  renderProductOptionsInModal(selectedSku || (systemSku && systemSku.value ? systemSku.value.trim() : ''));
  updateProductModalSaveState();
  document.getElementById('catalog-edit-product-image-form')?.classList.add('hidden');
  document.getElementById('catalog-edit-product-image-link-wrap')?.classList.remove('hidden');
  modal.classList.remove('hidden');
}

/** Habilita/deshabilita Guardar en modal producto: obligatorio producto/variante + nombre. */
function updateProductModalSaveState() {
  const saveBtn = document.getElementById('catalog-edit-product-save');
  const systemSku = document.getElementById('catalog-edit-product-system-sku');
  const nameEl = document.getElementById('catalog-edit-product-name');
  if (!saveBtn || !systemSku || !nameEl) return;
  const hasSku = (systemSku.value || '').trim().length > 0;
  const hasName = (nameEl.value || '').trim().length > 0;
  saveBtn.disabled = !hasSku || !hasName;
}

function getProductOptionsListFromCfg(cfg) {
  if (!cfg) return [];
  if (Array.isArray(cfg.options) && cfg.options.length > 0) return cfg.options;
  if (cfg.optionId && cfg.variantSkus && typeof cfg.variantSkus === 'object') return [{ optionId: cfg.optionId, variantSkus: cfg.variantSkus }];
  return [];
}

/** SKUs de productos del catálogo que usan este grupo de opcionales (optionId). */
function getProductSkusLinkedToOptionGroup(optionId) {
  if (!optionId || !catalogConfig.products) return [];
  const skus = [];
  Object.keys(catalogConfig.products).forEach((sku) => {
    const opts = getProductOptionsListFromCfg(catalogConfig.products[sku] || {});
    if (opts.some((o) => o.optionId === optionId)) skus.push(sku);
  });
  return skus;
}

/** disabledChoiceIds por artículo: array de choice.id deshabilitados para este producto en esta opción. */
function getDisabledChoiceIds(opt) {
  if (!opt || !Array.isArray(opt.disabledChoiceIds)) return [];
  return opt.disabledChoiceIds;
}

function setChoiceEnabledForProduct(sku, optionIndex, choiceId, enabled) {
  catalogConfig.products[sku] = catalogConfig.products[sku] || {};
  const opts = getProductOptionsListFromCfg(catalogConfig.products[sku]);
  catalogConfig.products[sku].options = opts.length ? opts : [];
  const opt = catalogConfig.products[sku].options[optionIndex];
  if (!opt) return;
  opt.disabledChoiceIds = getDisabledChoiceIds(opt).filter((id) => id !== choiceId);
  if (!enabled) opt.disabledChoiceIds.push(choiceId);
}

function isChoiceEnabledForProduct(sku, optionIndex, choiceId) {
  const opt = (catalogConfig.products[sku] || {}).options && catalogConfig.products[sku].options[optionIndex];
  return !getDisabledChoiceIds(opt).includes(choiceId);
}

/** Enlaza los botones del modal Opciones del artículo (usado al crearlo dinámicamente). */
function bindProductOptionsModalButtons() {
  const modalProductOptions = document.getElementById('catalog-product-options-modal');
  const closeBtn = document.getElementById('catalog-product-options-modal-close');
  const closeBtn2 = document.getElementById('catalog-product-options-close-btn');
  const editArticleBtn = document.getElementById('catalog-product-options-edit-article');
  const editOptionalBtn = document.getElementById('catalog-product-options-edit-optional');
  if (!modalProductOptions) return;
  const hideModal = () => modalProductOptions.classList.add('hidden');
  if (closeBtn && !closeBtn.dataset.bound) {
    closeBtn.dataset.bound = '1';
    closeBtn.addEventListener('click', hideModal);
  }
  if (closeBtn2 && !closeBtn2.dataset.bound) {
    closeBtn2.dataset.bound = '1';
    closeBtn2.addEventListener('click', hideModal);
  }
  if (editArticleBtn && !editArticleBtn.dataset.bound) {
    editArticleBtn.dataset.bound = '1';
    editArticleBtn.addEventListener('click', () => {
      const sku = modalProductOptions.dataset.sku;
      if (sku) {
        hideModal();
        openEditProductModal(sku);
      }
    });
  }
  if (editOptionalBtn && !editOptionalBtn.dataset.bound) {
    editOptionalBtn.dataset.bound = '1';
    editOptionalBtn.addEventListener('click', () => {
      const sku = modalProductOptions.dataset.sku;
      if (!sku) return;
      const productOptions = getProductOptionsListFromCfg((catalogConfig.products || {})[sku] || {});
      const optionGroups = catalogConfig.optionsCatalog || {};
      for (let i = 0; i < productOptions.length; i++) {
        const opt = productOptions[i];
        const g = optionGroups[opt.optionId];
        const choices = (g && g.choices) ? g.choices : [];
        if (choices.length > 0) {
          hideModal();
          openEditOptionalModal(opt.optionId, 0);
          return;
        }
      }
      (window.showError || alert)('Este artículo no tiene opcionales. Vaya a la pestaña Opcionales para crear grupos y opcionales.');
    });
  }
}

/**
 * Asegura que el modal "Opciones del artículo" exista en el DOM (por si el HTML en caché no lo incluye).
 */
function ensureProductOptionsModalInDom() {
  if (document.getElementById('catalog-product-options-modal')) {
    bindProductOptionsModalButtons();
    return;
  }
  const modal = document.createElement('div');
  modal.id = 'catalog-product-options-modal';
  modal.className = 'fixed inset-0 bg-black/50 z-[60] hidden flex items-center justify-center p-4';
  modal.innerHTML =
    '<div class="bg-white border border-gray-200 shadow-lg max-w-lg w-full max-h-[85vh] overflow-hidden flex flex-col">' +
      '<div class="p-4 border-b border-gray-200 flex items-center justify-between shrink-0">' +
        '<h3 id="catalog-product-options-modal-title" class="text-lg font-light text-gray-800">Opciones del artículo</h3>' +
        '<button type="button" id="catalog-product-options-modal-close" class="text-gray-400 hover:text-red-600 text-xl font-light">×</button>' +
      '</div>' +
      '<div id="catalog-product-options-content" class="p-4 overflow-y-auto flex-1 space-y-4"></div>' +
      '<div class="p-4 border-t border-gray-200 flex flex-wrap gap-2 shrink-0">' +
        '<button type="button" id="catalog-product-options-edit-article" class="px-4 py-2 border border-gray-300 text-gray-700 hover:bg-gray-50 text-sm font-light">Editar artículo</button>' +
        '<button type="button" id="catalog-product-options-edit-optional" class="px-4 py-2 border border-gray-300 text-gray-700 hover:bg-gray-50 text-sm font-light">Editar opcional</button>' +
        '<button type="button" id="catalog-product-options-close-btn" class="px-4 py-2 bg-gray-600 text-white border border-gray-600 hover:bg-gray-700 text-sm font-light">Cerrar</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(modal);
  bindProductOptionsModalButtons();
}

/**
 * Abre el modal "Opciones del artículo": lista grupos del producto y sus elementos (choices) con toggle habilitar/deshabilitar.
 */
function openProductOptionsModal(sku) {
  if (!sku) return;
  ensureProductOptionsModalInDom();
  const modal = document.getElementById('catalog-product-options-modal');
  const titleEl = document.getElementById('catalog-product-options-modal-title');
  const contentEl = document.getElementById('catalog-product-options-content');
  if (!modal || !titleEl || !contentEl) return;
  const cfg = (catalogConfig.products || {})[sku];
  const productName = (cfg && cfg.name) ? cfg.name : sku;
  modal.dataset.sku = sku;
  titleEl.textContent = 'Opciones de ' + (productName || 'artículo');
  renderProductOptionsModalContent(sku);
  modal.classList.remove('hidden');
}

function renderProductOptionsModalContent(sku) {
  const contentEl = document.getElementById('catalog-product-options-content');
  if (!contentEl) return;
  const productOptions = getProductOptionsListFromCfg((catalogConfig.products || {})[sku] || {});
  const optionGroups = catalogConfig.optionsCatalog || {};

  let html = '';
  productOptions.forEach((opt, optionIndex) => {
    const g = optionGroups[opt.optionId];
    const label = (g && g.label) ? g.label : opt.optionId;
    const choices = (g && g.choices) ? g.choices : [];
    html += '<div class="border border-gray-200 rounded overflow-hidden" data-option-index="' + optionIndex + '">';
    html += '<div class="px-3 py-2 bg-gray-100 border-b border-gray-200">';
    html += '<span class="font-medium text-gray-800">' + escapeHtml(label) + '</span>';
    html += '</div>';
    html += '<div class="divide-y divide-gray-100">';
    choices.forEach((choice, choiceIdx) => {
      const choiceId = (choice.id || choice.sku || '').trim() || String(choice.name || '').trim();
      const enabled = isChoiceEnabledForProduct(sku, optionIndex, choiceId);
      const priceStr = choice.priceAdjustment != null ? (window.formatCurrency ? window.formatCurrency(choice.priceAdjustment) : choice.priceAdjustment + ' UYU') : '0';
      html += '<div class="flex items-center justify-between gap-3 px-3 py-2 hover:bg-gray-50">';
      html += '<div class="flex-1 min-w-0">';
      html += '<span class="text-sm text-gray-800">' + escapeHtml(choice.name || choiceId) + '</span>';
      html += '<span class="text-xs text-gray-500 ml-1">+' + priceStr + '</span>';
      html += '</div>';
      html += '<div class="shrink-0 flex items-center gap-2">';
      html += '<button type="button" class="product-option-choice-edit text-xs text-red-600 hover:text-red-700 hover:underline" data-option-id="' + escapeHtml(opt.optionId) + '" data-choice-index="' + choiceIdx + '">Editar</button>';
      html += '<label class="flex items-center cursor-pointer" title="' + (enabled ? 'Habilitado' : 'Deshabilitado') + '">';
      html += '<span class="product-option-choice-toggle w-11 h-6 rounded-full border-2 flex items-center px-0.5 cursor-pointer ' + (enabled ? 'bg-green-500 border-green-500 justify-end' : 'bg-gray-300 border-gray-300 justify-start') + '" data-option-index="' + optionIndex + '" data-choice-id="' + escapeHtml(choiceId) + '" role="button" tabindex="0"><span class="w-4 h-4 rounded-full bg-white shadow-sm shrink-0"></span></span>';
      html += '</label>';
      html += '</div></div>';
    });
    html += '</div></div>';
  });

  if (productOptions.length === 0) {
    html = '<p class="text-sm text-gray-500">Este artículo no tiene grupos de opcionales. Use "Editar artículo" para agregar o quitar grupos desde el detalle del producto.</p>';
  }

  contentEl.innerHTML = html;

  contentEl.querySelectorAll('.product-option-choice-toggle').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const currentSku = document.getElementById('catalog-product-options-modal')?.dataset.sku;
      if (!currentSku) return;
      const optionIndex = parseInt(el.dataset.optionIndex, 10);
      const choiceId = (el.dataset.choiceId || '').trim();
      if (isNaN(optionIndex) || !choiceId) return;
      const enabled = !isChoiceEnabledForProduct(currentSku, optionIndex, choiceId);
      setChoiceEnabledForProduct(currentSku, optionIndex, choiceId, enabled);
      saveCatalogConfig().then(() => renderProductOptionsModalContent(currentSku)).catch((err) => (window.showError && window.showError(err.message)) || alert(err.message));
    });
  });

  contentEl.querySelectorAll('.product-option-choice-edit').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const optionId = (el.dataset.optionId || '').trim();
      const choiceIndex = parseInt(el.dataset.choiceIndex, 10);
      if (!optionId || isNaN(choiceIndex) || choiceIndex < 0) return;
      document.getElementById('catalog-product-options-modal')?.classList.add('hidden');
      openEditOptionalModal(optionId, choiceIndex);
    });
  });
}

function fillProductOptionSelect(currentSku) {
  const selectEl = document.getElementById('catalog-edit-product-option-select');
  if (!selectEl) return;
  const optionGroups = catalogConfig.optionsCatalog || {};
  const existingIds = (getProductOptionsListFromCfg(catalogConfig.products[currentSku] || {})).map((o) => o.optionId);
  const available = Object.entries(optionGroups).filter(([id]) => !existingIds.includes(id));
  const selected = selectEl.value;
  selectEl.innerHTML = '<option value="">Seleccionar grupo...</option>' +
    available.map(([id, g]) => {
      const label = (g && g.label) ? g.label : id;
      return '<option value="' + escapeHtml(id) + '">' + escapeHtml(label) + '</option>';
    }).join('');
  if (selected && available.some(([id]) => id === selected)) selectEl.value = selected;
}

function renderProductOptionsInModal(currentSku) {
  fillProductOptionSelect(currentSku);
  const listEl = document.getElementById('catalog-edit-product-options-list');
  const pickerEl = document.getElementById('catalog-edit-product-choice-variant-picker');
  const pickerInput = document.getElementById('catalog-edit-product-choice-variant-input');
  const pickerResults = document.getElementById('catalog-edit-product-choice-variant-results');
  if (!listEl) return;
  const products = catalogConfig.products || {};
  const optionGroups = catalogConfig.optionsCatalog || {};
  const cfg = currentSku ? products[currentSku] : null;
  const options = getProductOptionsListFromCfg(cfg || {});

  listEl.innerHTML = '';
  options.forEach((opt, idx) => {
    const g = optionGroups[opt.optionId];
    const label = getGroupDisplayLabel(g) || opt.optionId || 'Opcional';
    const choices = (g && g.choices) ? g.choices : [];
    opt.variantSkus = opt.variantSkus || {};
    const card = document.createElement('div');
    card.className = 'border border-gray-200 rounded overflow-hidden bg-gray-50';
    card.dataset.optionIndex = String(idx);
    let inner = '<div class="flex items-center justify-between gap-2 px-2 py-1.5 bg-gray-100 border-b border-gray-200">';
    inner += '<span class="text-sm font-medium text-gray-800">' + escapeHtml(label) + '</span>';
    inner += '<button type="button" class="product-option-remove text-red-600 hover:text-red-700 text-xs font-light" data-option-index="' + idx + '" title="Quitar grupo">Eliminar</button>';
    inner += '</div>';
    opt.catalogPrices = opt.catalogPrices || {};
    choices.forEach((choice, cIdx) => {
      const choiceId = String(choice.id || choice.name || 'choice-' + cIdx).trim();
      const variantSku = opt.variantSkus[choiceId] || (choice.name && opt.variantSkus[choice.name]) || (choice.id && opt.variantSkus[choice.id]);
      const variantProduct = variantSku ? allProducts.find((p) => p.sku === variantSku) : null;
      const variantLabel = variantProduct ? (variantProduct.name + ' — ' + variantProduct.sku) : 'Sin asignar';
      const catalogPrice = opt.catalogPrices[choiceId];
      const priceStr = catalogPrice != null && catalogPrice !== '' ? (window.formatCurrency ? window.formatCurrency(catalogPrice) : '$ ' + Number(catalogPrice).toLocaleString('es-UY')) : '';
      inner += '<div class="flex flex-col gap-1 px-2 py-1.5 border-b border-gray-100 last:border-b-0">';
      inner += '<div class="text-sm font-medium text-gray-800">' + escapeHtml(choice.name || choiceId) + (priceStr ? ' <span class="text-gray-600 font-normal">' + priceStr + '</span>' : '') + '</div>';
      inner += '<div class="flex items-center justify-between gap-2">';
      inner += '<span class="text-xs text-gray-600 min-w-0 truncate" title="' + escapeHtml(variantLabel) + '">' + escapeHtml(variantLabel) + '</span>';
      inner += '<button type="button" class="product-choice-assign text-xs text-red-600 hover:text-red-700 font-light shrink-0" data-option-index="' + idx + '" data-choice-id="' + escapeHtml(choiceId) + '">' + (variantSku ? 'Cambiar' : 'Asignar') + '</button>';
      inner += '</div></div>';
    });
    if (choices.length === 0) {
      inner += '<div class="px-2 py-1.5 text-xs text-gray-500">Sin ítems en este grupo. Agregue opcionales en la pestaña Opcionales.</div>';
    }
    card.innerHTML = inner;
    listEl.appendChild(card);
  });

  listEl.querySelectorAll('.product-option-remove').forEach((btn) => {
    btn.addEventListener('click', () => {
      const sku = (document.getElementById('catalog-edit-product-system-sku') && document.getElementById('catalog-edit-product-system-sku').value || '').trim();
      if (!sku) return;
      catalogConfig.products[sku] = catalogConfig.products[sku] || {};
      const opts = getProductOptionsListFromCfg(catalogConfig.products[sku]);
      const idx = parseInt(btn.dataset.optionIndex, 10);
      if (isNaN(idx) || idx < 0 || idx >= opts.length) return;
      opts.splice(idx, 1);
      catalogConfig.products[sku].options = opts.length ? opts : undefined;
      if (opts.length === 0) delete catalogConfig.products[sku].options;
      if (pickerEl) pickerEl.classList.add('hidden');
      renderProductOptionsInModal(sku);
    });
  });

}

function saveEditProductModal() {
  const modal = document.getElementById('catalog-edit-product-modal');
  const systemSku = document.getElementById('catalog-edit-product-system-sku');
  const name = document.getElementById('catalog-edit-product-name').value.trim();
  const category = document.getElementById('catalog-edit-product-category').value.trim();
  const editSku = modal && modal.dataset.editSku;

  const sku = (systemSku && systemSku.value || '').trim();
  if (!sku) {
    (window.showError || alert)('Debe seleccionar un producto o variante del sistema.');
    return;
  }
  if (!name) {
    (window.showError || alert)('El nombre es obligatorio.');
    return;
  }

  const product = allProducts.find((p) => p.sku === sku);
  if (!product) {
    (window.showError || alert)('Producto o variante no encontrado.');
    return;
  }

  catalogConfig.products = catalogConfig.products || {};
  if (editSku && editSku !== sku) delete catalogConfig.products[editSku];
  const existing = catalogConfig.products[sku];
  const imageVal = document.getElementById('catalog-edit-product-image-path').value.trim();
  const priceVal = document.getElementById('catalog-edit-product-price').value.trim();
  const priceNum = priceVal ? Number(document.getElementById('catalog-edit-product-price').value) : null;
  const entry = {
    name,
    description: document.getElementById('catalog-edit-product-desc').value.trim(),
    category,
    active: existing && existing.active === false ? false : true
  };
  if (imageVal) entry.image = imageVal;
  if (priceNum != null && !Number.isNaN(priceNum)) entry.price = priceNum;
  // Opciones son por producto: cada producto tiene su propio array options en la configuración del catálogo
  const productOptions = getProductOptionsListFromCfg(catalogConfig.products[sku] || {});
  if (productOptions.length > 0) entry.options = productOptions;
  catalogConfig.products[sku] = entry;
  saveCatalogConfig().then(() => {
    modal.classList.add('hidden');
    renderProductsPanel();
    renderSectionsList();
  }).catch((e) => (window.showError && window.showError(e.message)) || alert(e.message));
}

function renderProductsPanel() {
  renderSectionsList();
  const sectionTitleText = document.getElementById('catalog-section-title-text');
  const sectionTitleBtn = document.getElementById('catalog-section-edit-btn');
  const cat = (catalogConfig.categories || []).find((c) => c.id === selectedSectionId);
  if (selectedSectionId === 'todos') {
    if (sectionTitleText) sectionTitleText.textContent = 'Todos';
    if (sectionTitleBtn) sectionTitleBtn.classList.add('hidden');
  } else {
    if (sectionTitleBtn) {
      sectionTitleBtn.classList.remove('hidden');
      sectionTitleBtn.innerHTML = ICON_PENCIL;
      sectionTitleBtn.onclick = () => cat && editSectionName(selectedSectionId, cat.name);
    }
    if (cat && sectionTitleText) sectionTitleText.textContent = cat.name;
    else if (sectionTitleText) sectionTitleText.textContent = 'Todos';
  }

  const list = document.getElementById('catalog-products-list');
  if (!list) return;
  list.innerHTML = '';
  const products = catalogConfig.products || {};
  let entries = Object.entries(products).map(([sku, cfg]) => ({ sku, cfg }));
  if (selectedSectionId !== 'todos') entries = entries.filter(({ cfg }) => cfg.category === selectedSectionId);
  entries.sort((a, b) => (a.cfg.name || '').localeCompare(b.cfg.name || ''));

  const search = (document.getElementById('catalog-search') || {}).value || '';
  if (search.trim()) {
    const q = search.trim().toLowerCase();
    entries = entries.filter(({ cfg }) => (cfg.name || '').toLowerCase().includes(q));
  }

  entries.forEach(({ sku, cfg }) => {
    const sys = allProducts.find((p) => p.sku === sku);
    const price = cfg.price != null ? cfg.price : (sys && sys.price);
    const productOptions = getProductOptionsListFromCfg(cfg);
    const hasOptions = productOptions.length > 0;
    const verOpcionesHtml = hasOptions
      ? '<button type="button" class="catalog-product-ver-opciones text-red-600 text-sm font-light mt-1 cursor-pointer">Ver opciones →</button>'
      : '';
    const card = document.createElement('div');
    card.className = 'flex items-stretch gap-3 p-3 border border-gray-200 bg-white cursor-pointer';
    card.dataset.sku = sku;
    const imgSrc = (cfg.image || '').trim() || FALLBACK_IMAGE;
    card.innerHTML = `
      <div class="w-24 min-h-[5rem] shrink-0 self-stretch overflow-hidden bg-gray-100 border border-gray-200">
        <img class="w-full h-full object-cover min-h-full" src="${escapeHtml(imgSrc)}" alt="" data-fallback="${escapeHtml(FALLBACK_IMAGE)}" onerror="this.src=this.dataset.fallback||''">
      </div>
      <div class="flex-1 min-w-0">
        <div class="font-medium text-gray-800">${escapeHtml(cfg.name || sku)}</div>
        <div class="text-sm text-gray-600 line-clamp-2">${escapeHtml(cfg.description || '')}</div>
        <div class="text-sm text-gray-700 mt-1">${typeof price === 'number' ? (window.formatCurrency ? window.formatCurrency(price) : price + ' UYU') : '—'}</div>
        ${verOpcionesHtml}
      </div>
      <label class="shrink-0 flex items-center cursor-default">
        <span class="catalog-product-toggle-dot w-11 h-6 rounded-full border-2 flex items-center px-0.5 cursor-pointer ${cfg && cfg.active !== false ? 'bg-orange-500 border-orange-500 justify-end' : 'bg-gray-300 border-gray-300 justify-start'}" data-sku="${escapeHtml(sku)}" role="button" tabindex="0"><span class="w-4 h-4 rounded-full bg-white shadow-sm shrink-0"></span></span>
      </label>
    `;
    const toggleDot = card.querySelector('.catalog-product-toggle-dot');
    const toggleClick = (e) => {
      e.stopPropagation();
      e.preventDefault();
      const isActive = cfg && cfg.active !== false;
      catalogConfig.products[sku] = { ...cfg, active: !isActive };
      saveCatalogConfig().then(() => renderProductsPanel()).catch((err) => (window.showError && window.showError(err.message)) || alert(err.message));
    };
    toggleDot.addEventListener('click', toggleClick);
    const verOpcionesBtn = card.querySelector('.catalog-product-ver-opciones');
    if (verOpcionesBtn) {
      verOpcionesBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        openProductOptionsModal(sku);
      });
    }
    list.appendChild(card);
  });

  list.onclick = (e) => {
    const card = e.target.closest('[data-sku]');
    if (!card || !list.contains(card)) return;
    if (e.target.closest('.catalog-product-toggle-dot')) return;
    if (e.target.closest('.catalog-product-ver-opciones')) return;
    const sku = card.dataset.sku;
    if (sku) openEditProductModal(sku);
  };

  const addProductBtn = document.getElementById('catalog-add-product-btn');
  if (addProductBtn) addProductBtn.onclick = () => openEditProductModal(null);
}

// ——— Opcionales: grupos (izq) y opciones (der) ———

/** Texto para mostrar un grupo: "nombre interno (nombre comercial)" o solo "nombre interno". */
function getGroupDisplayLabel(g) {
  if (!g) return '';
  const internal = (g.label || '').trim();
  const commercial = (g.commercialLabel || '').trim();
  return commercial ? internal + ' (' + commercial + ')' : internal;
}

function renderOptionGroupsList() {
  const list = document.getElementById('catalog-option-groups-list');
  if (!list) return;
  const groups = catalogConfig.optionsCatalog || {};
  let ids = Object.keys(groups);
  const search = (document.getElementById('catalog-search') || {}).value || '';
  if (search.trim()) {
    const q = search.trim().toLowerCase();
    ids = ids.filter((optionId) => {
      const g = groups[optionId];
      return (getGroupDisplayLabel(g) || optionId).toLowerCase().includes(q);
    });
  }
  list.innerHTML = '';
  ids.forEach((optionId) => {
    const g = groups[optionId];
    const count = (g.choices || []).length;
    const isSelected = selectedOptionGroupId === optionId;
    const displayLabel = getGroupDisplayLabel(g) || optionId;
    const linkedCount = getProductSkusLinkedToOptionGroup(optionId).length;
    const canDelete = linkedCount === 0;

    const row = document.createElement('div');
    row.className = 'flex items-center gap-1 border border-gray-200 bg-white text-sm font-light ' + (isSelected ? 'border-red-600 ring-1 ring-red-600' : '');
    row.dataset.optionId = optionId;
    const selectBtn = document.createElement('button');
    selectBtn.type = 'button';
    selectBtn.className = 'flex-1 min-w-0 text-left px-3 py-2 flex items-center justify-between gap-2';
    selectBtn.innerHTML = `<span class="truncate">${escapeHtml(displayLabel)}</span><span class="text-gray-500 shrink-0">${count} Opcionales</span>`;
    selectBtn.addEventListener('click', () => {
      selectedOptionGroupId = optionId;
      renderOptionsPanel();
    });
    row.appendChild(selectBtn);

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'shrink-0 p-1.5 text-red-600 hover:bg-red-50 hover:text-red-700' + (canDelete ? '' : ' opacity-50 cursor-not-allowed');
    deleteBtn.title = canDelete ? 'Eliminar grupo' : 'No se puede eliminar: tiene productos vinculados';
    deleteBtn.setAttribute('aria-label', 'Eliminar');
    deleteBtn.innerHTML = ICON_TRASH;
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!canDelete) {
        (window.showError || alert)('No se puede eliminar: este grupo tiene productos vinculados. Quite el grupo de los artículos que lo usan antes de eliminarlo.');
        return;
      }
      confirmDeleteOptionGroup(optionId, displayLabel);
    });
    row.appendChild(deleteBtn);

    list.appendChild(row);
  });
  if (ids.length > 0 && !selectedOptionGroupId) selectedOptionGroupId = ids[0];
}

async function confirmDeleteOptionGroup(optionId, displayLabel) {
  const ok = await (window.showConfirm || ((t, m) => Promise.resolve(confirm(m))))('Eliminar grupo', '¿Eliminar el grupo «' + (displayLabel || optionId) + '»? Esta acción no se puede deshacer.');
  if (!ok) return;
  try {
    delete catalogConfig.optionsCatalog[optionId];
    await saveCatalogConfig();
    if (selectedOptionGroupId === optionId) selectedOptionGroupId = null;
    renderOptionGroupsList();
    renderOptionsPanel();
    (window.showSuccess || (() => {}))('Grupo eliminado');
  } catch (e) {
    (window.showError || alert)(e.message || 'Error al eliminar');
  }
}

function openEditOptionGroupModal(optionId) {
  const modal = document.getElementById('catalog-edit-option-group-modal');
  if (!modal) return;
  const titleEl = document.getElementById('catalog-edit-option-group-modal-title');
  const isCreate = optionId === null || optionId === undefined || optionId === '';
  if (isCreate) {
    if (titleEl) titleEl.textContent = 'Crear grupo de opcionales';
    document.getElementById('catalog-edit-option-group-name').value = '';
    document.getElementById('catalog-edit-option-group-commercial-name').value = '';
    modal.dataset.optionId = '';
    modal.classList.remove('hidden');
    document.getElementById('catalog-edit-option-group-name').focus();
    return;
  }
  if (!catalogConfig.optionsCatalog || !catalogConfig.optionsCatalog[optionId]) {
    (window.showError || alert)('Seleccione un grupo de opcionales a la izquierda.');
    return;
  }
  if (titleEl) titleEl.textContent = 'Editar grupo de opcionales';
  const group = catalogConfig.optionsCatalog[optionId];
  document.getElementById('catalog-edit-option-group-name').value = group.label || '';
  document.getElementById('catalog-edit-option-group-commercial-name').value = group.commercialLabel || '';
  modal.dataset.optionId = optionId;
  modal.classList.remove('hidden');
  document.getElementById('catalog-edit-option-group-name').focus();
}

function saveEditOptionGroupModal() {
  const modal = document.getElementById('catalog-edit-option-group-modal');
  const optionId = modal && modal.dataset.optionId;
  const internalName = (document.getElementById('catalog-edit-option-group-name').value || '').trim();
  if (!internalName) {
    (window.showError || alert)('El nombre interno es obligatorio.');
    return;
  }
  const commercialName = (document.getElementById('catalog-edit-option-group-commercial-name').value || '').trim();
  const isCreate = !optionId || !catalogConfig.optionsCatalog || !catalogConfig.optionsCatalog[optionId];
  if (isCreate) {
    let baseId = slugFromName(internalName);
    let id = baseId;
    let n = 1;
    catalogConfig.optionsCatalog = catalogConfig.optionsCatalog || {};
    while (catalogConfig.optionsCatalog[id]) {
      id = baseId + '-' + (++n);
    }
    catalogConfig.optionsCatalog[id] = { label: internalName, commercialLabel: commercialName || undefined, choices: [] };
    saveCatalogConfig().then(() => {
      modal.classList.add('hidden');
      selectedOptionGroupId = id;
      renderOptionsPanel();
    }).catch((e) => (window.showError && window.showError(e.message)) || alert(e.message));
    return;
  }
  const group = catalogConfig.optionsCatalog[optionId];
  group.label = internalName;
  group.commercialLabel = commercialName || undefined;
  saveCatalogConfig().then(() => {
    modal.classList.add('hidden');
    renderOptionsPanel();
  }).catch((e) => (window.showError && window.showError(e.message)) || alert(e.message));
}

function openEditOptionalModal(optionId, choiceIndex) {
  const modal = document.getElementById('catalog-edit-optional-modal');
  if (!modal) return;
  if (!optionId || !catalogConfig.optionsCatalog || !catalogConfig.optionsCatalog[optionId]) {
    (window.showError || alert)('Seleccione un grupo de opcionales a la izquierda.');
    return;
  }
  const group = catalogConfig.optionsCatalog[optionId];
  const choice = group.choices && group.choices[choiceIndex];
  const nameEl = document.getElementById('catalog-edit-optional-name');
  if (nameEl) nameEl.value = choice ? (choice.name || '') : '';
  modal.dataset.optionId = optionId;
  modal.dataset.choiceIndex = choice != null ? String(choiceIndex) : '';
  const deleteBtn = document.getElementById('catalog-edit-optional-delete');
  if (deleteBtn) deleteBtn.classList.toggle('hidden', !choice);
  updateOptionalModalSaveState();
  modal.classList.remove('hidden');
  if (nameEl) setTimeout(() => nameEl.focus(), 50);
}

/** Habilita/deshabilita Guardar en modal opcional: solo nombre (producto/variante se asocia en Editar producto). */
function updateOptionalModalSaveState() {
  const saveBtn = document.getElementById('catalog-edit-optional-save');
  const nameEl = document.getElementById('catalog-edit-optional-name');
  if (!saveBtn || !nameEl) return;
  saveBtn.disabled = (nameEl.value || '').trim().length === 0;
}

function slugFromName(name) {
  return String(name || '').trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '') || 'opcional';
}

function saveEditOptionalModal() {
  const modal = document.getElementById('catalog-edit-optional-modal');
  const optionId = modal && modal.dataset.optionId;
  const choiceIndex = modal.dataset.choiceIndex !== undefined && modal.dataset.choiceIndex !== '' ? parseInt(modal.dataset.choiceIndex, 10) : -1;
  const name = (document.getElementById('catalog-edit-optional-name') && document.getElementById('catalog-edit-optional-name').value || '').trim();
  if (!optionId || !catalogConfig.optionsCatalog[optionId]) {
    (window.showError || alert)('No hay grupo de opcionales seleccionado. Seleccione un grupo a la izquierda.');
    return;
  }
  if (!name) {
    (window.showError || alert)('El nombre del ítem es obligatorio.');
    return;
  }
  const group = catalogConfig.optionsCatalog[optionId];
  group.choices = group.choices || [];
  const existingChoice = choiceIndex >= 0 && choiceIndex < group.choices.length ? group.choices[choiceIndex] : null;
  const id = (existingChoice && (existingChoice.id || existingChoice.sku)) ? String(existingChoice.id || existingChoice.sku).trim() : slugFromName(name);
  const newChoice = { id, name };
  if (existingChoice && existingChoice.commercialName !== undefined) newChoice.commercialName = existingChoice.commercialName;
  if (existingChoice && existingChoice.priceAdjustment !== undefined) newChoice.priceAdjustment = existingChoice.priceAdjustment;
  else newChoice.priceAdjustment = 0;
  if (choiceIndex >= 0 && choiceIndex < group.choices.length) {
    group.choices[choiceIndex] = newChoice;
  } else {
    group.choices.push(newChoice);
  }
  saveCatalogConfig().then(() => {
    modal.classList.add('hidden');
    renderOptionsPanel();
  }).catch((e) => (window.showError && window.showError(e.message)) || alert(e.message));
}

function renderOptionsPanel() {
  renderOptionGroupsList();
  const group = selectedOptionGroupId && catalogConfig.optionsCatalog[selectedOptionGroupId];
  const titleEl = document.getElementById('catalog-option-group-title-text');
  const productsLine = document.getElementById('catalog-option-group-products');
  const list = document.getElementById('catalog-options-list');
  if (!list) return;

  if (!group) {
    if (titleEl) titleEl.textContent = '—';
    if (productsLine) productsLine.innerHTML = '';
    list.innerHTML = '<p class="text-sm text-gray-500">Seleccione un grupo o cree uno nuevo.</p>';
    return;
  }

  if (titleEl) titleEl.textContent = getGroupDisplayLabel(group) || selectedOptionGroupId;
  const linkedSkus = getProductSkusLinkedToOptionGroup(selectedOptionGroupId);
  const products = catalogConfig.products || {};
  if (productsLine) {
    if (linkedSkus.length === 0) {
      productsLine.innerHTML = '<span class="inline-block w-4 h-4 text-gray-500">🔗</span> <span class="text-gray-500">Sin productos vinculados</span>';
    } else {
      const links = linkedSkus.map((sku) => {
        const name = (products[sku] && products[sku].name) ? escapeHtml(products[sku].name) : escapeHtml(sku);
        return `<button type="button" class="catalog-linked-product-link text-red-600 hover:text-red-700 hover:underline font-light text-sm" data-sku="${escapeHtml(sku)}">${name}</button>`;
      }).join('<span class="text-gray-400">, </span>');
      productsLine.innerHTML = '<span class="inline-block w-4 h-4 text-gray-500">🔗</span> ' + links;
      productsLine.querySelectorAll('.catalog-linked-product-link').forEach((btn) => {
        btn.addEventListener('click', () => {
          const sku = btn.dataset.sku;
          if (!sku) return;
          switchCatalogSub('products');
          openEditProductModal(sku);
        });
      });
    }
  }

  list.innerHTML = '';
  (group.choices || []).forEach((choice, idx) => {
    const row = document.createElement('div');
    row.className = 'flex items-center justify-between gap-2 p-3 border border-gray-200 bg-white';
    row.dataset.optionId = selectedOptionGroupId || '';
    row.dataset.choiceIndex = String(idx);
    const displayName = choice.commercialName
      ? escapeHtml(choice.name) + ' <span class="text-gray-500 font-normal">(' + escapeHtml(choice.commercialName) + ')</span>'
      : escapeHtml(choice.name);
    row.innerHTML = `
      <div class="flex-1 min-w-0">
        <div class="font-medium text-gray-800">${displayName}</div>
      </div>
      <button type="button" class="catalog-optional-edit px-2 py-1 text-red-600 text-sm font-light" title="Editar ítem">Editar</button>
      <span class="w-11 h-6 rounded-full bg-orange-500 border-2 border-orange-500 shrink-0 flex items-center justify-end px-0.5" title="Activo"><span class="w-4 h-4 rounded-full bg-white shadow-sm"></span></span>
    `;
    list.appendChild(row);
  });

  const addOptionalBtn = document.getElementById('catalog-add-optional-btn');
  if (addOptionalBtn) addOptionalBtn.onclick = () => openEditOptionalModal(selectedOptionGroupId, -1);
}

// ——— Horario del local (sección colapsable) ———

/** Parsea "08:00" o "20:30" a minutos desde medianoche. */
function parseTimeToMinutes(str) {
  if (!str || typeof str !== 'string') return 0;
  const parts = str.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!parts) return 0;
  return parseInt(parts[1], 10) * 60 + parseInt(parts[2], 10);
}

/** Devuelve true si el local está abierto ahora según horario y override. */
function isStoreOpenNow() {
  const override = catalogConfig.storeManualOverride;
  if (override === 'open') return true;
  if (override === 'closed') return false;
  const openStr = catalogConfig.storeOpenTime || '08:00';
  const closeStr = catalogConfig.storeCloseTime || '20:00';
  const openMin = parseTimeToMinutes(openStr);
  const closeMin = parseTimeToMinutes(closeStr);
  const now = new Date();
  const currentMin = now.getHours() * 60 + now.getMinutes();
  if (openMin <= closeMin) {
    return currentMin >= openMin && currentMin < closeMin;
  }
  return currentMin >= openMin || currentMin < closeMin;
}

const STORE_REAL_ICONS = {
  open: '<svg class="w-3.5 h-3.5 shrink-0 inline-block align-middle" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
  closed: '<svg class="w-3.5 h-3.5 shrink-0 inline-block align-middle" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>'
};

function updateStoreStatusBadge() {
  const badgeEl = document.getElementById('catalog-store-status-badge');
  if (!badgeEl) return;
  const open = isStoreOpenNow();
  const label = open ? 'Abierto' : 'Cerrado';
  const icon = STORE_REAL_ICONS[open ? 'open' : 'closed'];
  badgeEl.className = 'text-xs font-semibold truncate max-w-[12rem] px-2 py-0.5 rounded inline-flex items-center gap-1 ';
  if (open) {
    badgeEl.classList.add('bg-green-100', 'text-green-700', 'border', 'border-green-300');
  } else {
    badgeEl.classList.add('bg-red-100', 'text-red-700', 'border', 'border-red-300');
  }
  badgeEl.innerHTML = icon + '<span class="uppercase">' + escapeHtml(label) + '</span>';
}

function renderStoreHoursPanel() {
  const openEl = document.getElementById('catalog-store-open-time');
  const closeEl = document.getElementById('catalog-store-close-time');
  const overrideEl = document.getElementById('catalog-store-manual-override');
  if (openEl) openEl.value = catalogConfig.storeOpenTime || '08:00';
  if (closeEl) closeEl.value = catalogConfig.storeCloseTime || '20:00';
  if (overrideEl) overrideEl.value = catalogConfig.storeManualOverride || '';
  updateStoreStatusBadge();
}

async function saveStoreHours() {
  const openEl = document.getElementById('catalog-store-open-time');
  const closeEl = document.getElementById('catalog-store-close-time');
  const overrideEl = document.getElementById('catalog-store-manual-override');
  catalogConfig.storeOpenTime = (openEl && openEl.value) ? openEl.value.trim() : '08:00';
  catalogConfig.storeCloseTime = (closeEl && closeEl.value) ? closeEl.value.trim() : '20:00';
  const v = (overrideEl && overrideEl.value) ? overrideEl.value.trim().toLowerCase() : '';
  catalogConfig.storeManualOverride = (v === 'open' || v === 'closed') ? v : null;
  await saveCatalogConfig();
  if (window.showSuccess) await window.showSuccess('Horario guardado');
  else alert('Horario guardado');
}

function normalizePaymentMethods(pm) {
  const src = pm && typeof pm === 'object' ? pm : {};
  return {
    efectivo: src.efectivo !== false,
    pos: src.pos !== false,
    mercadopago: src.mercadopago !== false
  };
}

function updatePaymentMethodsBadge() {
  const badgeEl = document.getElementById('catalog-payment-methods-badge');
  if (!badgeEl) return;
  const pm = normalizePaymentMethods(catalogConfig.paymentMethods);
  const enabled = Object.keys(pm).filter((k) => pm[k]).map((k) => PAYMENT_METHOD_LABELS[k] || k);
  badgeEl.className = 'text-xs font-semibold truncate max-w-[14rem] px-2 py-0.5 rounded border shrink-0 ';
  if (enabled.length === 0) {
    badgeEl.classList.add('bg-red-100', 'text-red-700', 'border-red-300');
    badgeEl.textContent = 'Ninguno activo';
  } else {
    badgeEl.classList.add('bg-green-100', 'text-green-700', 'border-green-300');
    badgeEl.textContent = enabled.join(' · ');
  }
}

function renderPaymentMethodsPanel() {
  const pm = normalizePaymentMethods(catalogConfig.paymentMethods);
  const efectivoEl = document.getElementById('catalog-pay-efectivo');
  const posEl = document.getElementById('catalog-pay-pos');
  const mpEl = document.getElementById('catalog-pay-mercadopago');
  if (efectivoEl) efectivoEl.checked = !!pm.efectivo;
  if (posEl) posEl.checked = !!pm.pos;
  if (mpEl) mpEl.checked = !!pm.mercadopago;
  updatePaymentMethodsBadge();
}

async function savePaymentMethods() {
  const efectivoEl = document.getElementById('catalog-pay-efectivo');
  const posEl = document.getElementById('catalog-pay-pos');
  const mpEl = document.getElementById('catalog-pay-mercadopago');
  catalogConfig.paymentMethods = {
    efectivo: !!(efectivoEl && efectivoEl.checked),
    pos: !!(posEl && posEl.checked),
    mercadopago: !!(mpEl && mpEl.checked)
  };
  if (!catalogConfig.paymentMethods.efectivo && !catalogConfig.paymentMethods.pos && !catalogConfig.paymentMethods.mercadopago) {
    if (window.showError) await window.showError('Debés dejar al menos un medio de pago activo');
    else alert('Debés dejar al menos un medio de pago activo');
    renderPaymentMethodsPanel();
    return;
  }
  await saveCatalogConfig();
  updatePaymentMethodsBadge();
  if (window.showSuccess) await window.showSuccess('Medios de pago guardados');
  else alert('Medios de pago guardados');
}

// ——— Carga allProducts: API flat: true; si no, aplanar localmente para listar padre + cada variante ———

function getVariantsArrayFromProduct(p) {
  const v = p.variants;
  if (!v) return [];
  if (Array.isArray(v)) {
    return v.map((item, idx) => {
      const base = typeof item === 'object' && item != null ? item : {};
      const id = base.id != null ? String(base.id) : (base.sku != null ? String(base.sku) : String(idx + 1));
      return { ...base, id };
    });
  }
  if (typeof v === 'object' && v !== null) {
    const entries = Object.entries(v);
    const numeric = entries.length > 0 && entries.every(([k]) => /^\d+$/.test(k));
    return (numeric ? [...entries].sort((a, b) => parseInt(a[0], 10) - parseInt(b[0], 10)) : entries)
      .map(([key, item]) => {
        const base = typeof item === 'object' && item !== null ? item : {};
        const id = base.id != null ? String(base.id) : (base.sku != null ? String(base.sku) : key);
        return { ...base, id };
      });
  }
  return [];
}

function flattenProductsWithVariants(list) {
  const out = [];
  const seen = new Set();
  (list || []).forEach((p) => {
    const parentId = (p.id || '').toString().trim();
    const parentSku = (p.sku || p.id || '').toString().trim();
    const parentName = p.name || p.productName || parentSku;
    const variants = getVariantsArrayFromProduct(p);

    if (variants.length === 0) {
      if (parentSku && !seen.has(parentSku)) {
        seen.add(parentSku);
        out.push({ sku: parentSku, name: parentName, price: p.price, productId: p.id });
      }
      return;
    }
    if (parentSku && !seen.has(parentSku)) {
      seen.add(parentSku);
      out.push({ sku: parentSku, name: parentName, price: p.price, productId: p.id });
    }
    variants.forEach((variant) => {
      const variantId = (variant.id || variant.sku || '').toString().trim();
      const variantSku = (variant.sku || (parentId && variantId ? parentId + '_' + variantId : '')).toString().trim() || (parentId + '_' + variantId);
      const variantName = (variant.name || '').toString().trim();
      const name = (parentName && variantName) ? parentName + ' - ' + variantName : (variantName || parentName || variantSku);
      const price = variant.price != null ? variant.price : p.price;
      if (variantSku && !seen.has(variantSku)) {
        seen.add(variantSku);
        out.push({ sku: variantSku, name, price, productId: parentId, variantId });
      }
    });
  });
  return out;
}

async function loadCatalog() {
  ensureProductOptionsModalInDom();
  showSpinner('Cargando catálogo...');
  try {
    const nrd = window.nrd;
    if (!nrd) throw new Error('NRD no disponible');
    await loadCatalogConfig();
    if (!nrd.products) {
      allProducts = [];
    } else {
      let rawList;
      try {
        rawList = await nrd.products.getAll({ flat: true });
      } catch (_) {
        rawList = await nrd.products.getAll();
      }
      const list = Array.isArray(rawList) ? rawList : (rawList && typeof rawList === 'object' ? Object.keys(rawList).map((k) => ({ id: k, ...rawList[k] })) : []);
      const hasVariants = list.some((p) => {
        const v = p && p.variants;
        return v && (Array.isArray(v) ? v.length > 0 : Object.keys(v).length > 0);
      });
      allProducts = hasVariants ? flattenProductsWithVariants(list) : list;
    }
    selectedSectionId = 'todos';
    selectedOptionGroupId = Object.keys(catalogConfig.optionsCatalog || {})[0] || null;
    switchCatalogSub('products');
    renderStoreHoursPanel();
    renderPaymentMethodsPanel();
  } catch (e) {
    (window.logger || console).error('Error loading catalog', e);
    if (window.showError) await window.showError('Error al cargar catálogo: ' + (e.message || e));
    else alert('Error al cargar catálogo');
  } finally {
    hideSpinner();
  }
}

// ——— Búsqueda producto/variante en modales ———

const normalizeSearchText = window.normalizeSearchText || window.NRDCommon?.normalizeSearchText || ((t) => (t || '').toLowerCase().trim());

function renderCatalogProductResults(filtered, resultsEl, skuHiddenId, inputId, onSelect, positionInput) {
  if (!resultsEl) return;
  if (filtered.length === 0) {
    resultsEl.innerHTML = '<div class="px-3 py-2 text-sm text-gray-500">No se encontraron productos</div>';
  } else {
    resultsEl.innerHTML = filtered.slice(0, 50).map((p) => {
      const isVariant = !!(p.variantId || (p.sku && p.productId && String(p.sku).indexOf('_') > 0));
      const displayName = (p.name || p.productName || p.sku || '').trim();
      const variantLabel = isVariant ? ' <span class="text-gray-400 font-normal">(variante)</span>' : '';
      const priceStr = typeof p.price === 'number' ? (window.formatCurrency ? window.formatCurrency(p.price) : p.price + ' UYU') : '—';
      return `
      <div class="catalog-search-item px-3 py-2 hover:bg-gray-50 cursor-pointer border-b border-gray-100 last:border-b-0" data-sku="${escapeHtml(p.sku)}" data-name="${escapeHtml(displayName)}">
        <div class="font-light text-sm">${escapeHtml(displayName)}${variantLabel}</div>
        <div class="text-xs text-gray-600">${escapeHtml(p.sku)} · ${priceStr}</div>
      </div>
    `;
    }).join('');
    resultsEl.querySelectorAll('.catalog-search-item').forEach((el) => {
      el.addEventListener('click', () => {
        const sku = el.dataset.sku;
        const name = el.dataset.name;
        const hidden = document.getElementById(skuHiddenId);
        const input = document.getElementById(inputId);
        if (hidden) hidden.value = sku || '';
        if (input) input.value = name && sku ? `${name} — ${sku}` : (sku || '');
        resultsEl.classList.add('hidden');
        resultsEl.removeAttribute('style');
        if (onSelect) onSelect({ sku, name });
      });
    });
  }
  resultsEl.classList.remove('hidden');
  if (positionInput && positionInput.getBoundingClientRect) {
    const rect = positionInput.getBoundingClientRect();
    resultsEl.style.position = 'fixed';
    resultsEl.style.top = rect.bottom + 'px';
    resultsEl.style.left = rect.left + 'px';
    resultsEl.style.width = Math.max(rect.width, 280) + 'px';
    resultsEl.style.zIndex = '9999';
  } else {
    resultsEl.removeAttribute('style');
  }
}

function setupCatalogProductSearch() {
  const input = document.getElementById('catalog-edit-product-system-input');
  const results = document.getElementById('catalog-edit-product-system-results');
  if (!input || !results) return;
  let timeout = null;
  input.addEventListener('input', () => {
    clearTimeout(timeout);
    const q = (input.value || '').trim();
    if (!q) {
      results.classList.add('hidden');
      return;
    }
    timeout = setTimeout(() => {
      const term = normalizeSearchText(q);
      const filtered = allProducts.filter((p) =>
        normalizeSearchText(p.name || '').includes(term) || normalizeSearchText(p.sku || '').includes(term)
      );
      renderCatalogProductResults(filtered, results, 'catalog-edit-product-system-sku', 'catalog-edit-product-system-input', (p) => {
        const nameEl = document.getElementById('catalog-edit-product-name');
        if (nameEl && !nameEl.value) nameEl.value = p.name || '';
        if (p.sku) renderProductOptionsInModal(p.sku);
        updateProductModalSaveState();
      });
    }, 150);
  });
  input.addEventListener('focus', () => {
    const q = (input.value || '').trim();
    if (q) {
      const term = normalizeSearchText(q);
      const filtered = allProducts.filter((p) =>
        normalizeSearchText(p.name || '').includes(term) || normalizeSearchText(p.sku || '').includes(term)
      );
      renderCatalogProductResults(filtered, results, 'catalog-edit-product-system-sku', 'catalog-edit-product-system-input', (p) => {
        const nameEl = document.getElementById('catalog-edit-product-name');
        if (nameEl && !nameEl.value) nameEl.value = p.name || '';
        if (p.sku) renderProductOptionsInModal(p.sku);
        updateProductModalSaveState();
      });
    }
  });
  document.getElementById('catalog-edit-product-name')?.addEventListener('input', updateProductModalSaveState);
  document.addEventListener('click', (e) => {
    if (input && results && !input.contains(e.target) && !results.contains(e.target)) results.classList.add('hidden');
  });
}

function setupCatalogProductChoiceVariantPicker() {
  const pickerEl = document.getElementById('catalog-edit-product-choice-variant-picker');
  const pickerInput = document.getElementById('catalog-edit-product-choice-variant-input');
  const pickerResults = document.getElementById('catalog-edit-product-choice-variant-results');
  const cancelBtn = document.getElementById('catalog-edit-product-choice-variant-cancel');
  const optionsListEl = document.getElementById('catalog-edit-product-options-list');
  if (!pickerEl || !pickerInput || !pickerResults) return;
  const priceInput = document.getElementById('catalog-edit-product-choice-price');
  const applyBtn = document.getElementById('catalog-edit-product-choice-variant-apply');
  if (optionsListEl) {
    optionsListEl.addEventListener('click', (e) => {
      const btn = e.target.closest('.product-choice-assign');
      if (!btn || !pickerEl || !pickerInput || !pickerResults) return;
      e.preventDefault();
      e.stopPropagation();
      const sku = (document.getElementById('catalog-edit-product-system-sku') && document.getElementById('catalog-edit-product-system-sku').value || '').trim();
      const optionIndex = parseInt(btn.dataset.optionIndex, 10);
      const choiceId = (btn.dataset.choiceId || '').trim();
      pickerEl.dataset.optionIndex = btn.dataset.optionIndex || '';
      pickerEl.dataset.choiceId = btn.dataset.choiceId || '';
      if (sku && !isNaN(optionIndex) && optionIndex >= 0 && choiceId) {
        const opts = getProductOptionsListFromCfg(catalogConfig.products[sku] || {});
        const opt = opts[optionIndex];
        const catalogPrices = (opt && opt.catalogPrices) || {};
        if (priceInput) priceInput.value = catalogPrices[choiceId] != null && catalogPrices[choiceId] !== '' ? String(catalogPrices[choiceId]) : '';
      } else if (priceInput) priceInput.value = '';
      pickerEl.classList.remove('hidden');
      pickerInput.value = '';
      pickerResults.classList.add('hidden');
      setTimeout(() => pickerInput.focus(), 0);
    });
  }
  function savePickerCatalogPrice() {
    const sku = (document.getElementById('catalog-edit-product-system-sku') && document.getElementById('catalog-edit-product-system-sku').value || '').trim();
    const optionIndex = parseInt(pickerEl.dataset.optionIndex, 10);
    const choiceId = (pickerEl.dataset.choiceId || '').trim();
    if (!sku || isNaN(optionIndex) || optionIndex < 0 || !choiceId) return;
    catalogConfig.products[sku] = catalogConfig.products[sku] || {};
    const opts = getProductOptionsListFromCfg(catalogConfig.products[sku]);
    const opt = opts[optionIndex];
    if (!opt) return;
    opt.catalogPrices = opt.catalogPrices || {};
    const priceVal = priceInput && priceInput.value.trim();
    const priceNum = priceVal ? Number(priceVal) : NaN;
    if (priceVal !== '' && !Number.isNaN(priceNum) && priceNum >= 0) {
      opt.catalogPrices[choiceId] = priceNum;
    } else {
      delete opt.catalogPrices[choiceId];
      if (Object.keys(opt.catalogPrices).length === 0) delete opt.catalogPrices;
    }
  }
  let timeout = null;
  function onSelectProduct(p) {
    const sku = (document.getElementById('catalog-edit-product-system-sku') && document.getElementById('catalog-edit-product-system-sku').value || '').trim();
    const optionIndex = parseInt(pickerEl.dataset.optionIndex, 10);
    const choiceId = (pickerEl.dataset.choiceId || '').trim();
    if (!sku || isNaN(optionIndex) || optionIndex < 0 || !choiceId) return;
    catalogConfig.products[sku] = catalogConfig.products[sku] || {};
    const opts = getProductOptionsListFromCfg(catalogConfig.products[sku]);
    const opt = opts[optionIndex];
    if (opt) {
      opt.variantSkus = opt.variantSkus || {};
      opt.variantSkus[choiceId] = p.sku || '';
      savePickerCatalogPrice();
      pickerEl.classList.add('hidden');
      pickerResults.classList.add('hidden');
      renderProductOptionsInModal(sku);
      updateProductModalSaveState();
    }
  }
  if (applyBtn) applyBtn.addEventListener('click', () => {
    savePickerCatalogPrice();
    const sku = (document.getElementById('catalog-edit-product-system-sku') && document.getElementById('catalog-edit-product-system-sku').value || '').trim();
    pickerEl.classList.add('hidden');
    if (pickerResults) pickerResults.classList.add('hidden');
    if (sku) {
      renderProductOptionsInModal(sku);
      updateProductModalSaveState();
    }
  });
  pickerInput.addEventListener('input', () => {
    clearTimeout(timeout);
    const q = (pickerInput.value || '').trim();
    if (!q) {
      pickerResults.classList.add('hidden');
      return;
    }
    timeout = setTimeout(() => {
      const term = normalizeSearchText(q);
      const filtered = allProducts.filter((p) =>
        normalizeSearchText(p.name || '').includes(term) || normalizeSearchText(p.sku || '').includes(term)
      );
      renderCatalogProductResults(filtered, pickerResults, '', '', onSelectProduct, pickerInput);
    }, 150);
  });
  pickerInput.addEventListener('focus', () => {
    const q = (pickerInput.value || '').trim();
    if (q) {
      const term = normalizeSearchText(q);
      const filtered = allProducts.filter((p) =>
        normalizeSearchText(p.name || '').includes(term) || normalizeSearchText(p.sku || '').includes(term)
      );
      renderCatalogProductResults(filtered, pickerResults, '', '', onSelectProduct, pickerInput);
    }
  });
  if (cancelBtn) cancelBtn.addEventListener('click', () => {
    pickerEl.classList.add('hidden');
    pickerResults.classList.add('hidden');
    pickerResults.removeAttribute('style');
  });
  document.addEventListener('click', (e) => {
    if (e.target.closest('.product-choice-assign')) return;
    if (pickerEl && !pickerEl.classList.contains('hidden') && !pickerEl.contains(e.target) && !pickerResults.contains(e.target)) {
      pickerEl.classList.add('hidden');
      pickerResults.classList.add('hidden');
      pickerResults.removeAttribute('style');
    }
  });
}

function setupCatalogOptionalSearch() {
  document.getElementById('catalog-edit-optional-name')?.addEventListener('input', updateOptionalModalSaveState);
}

// ——— Eventos modales y botones ———

function bindCatalogModals() {
  const closeProduct = document.getElementById('catalog-edit-product-close');
  const closeOptional = document.getElementById('catalog-edit-optional-close');
  const saveProduct = document.getElementById('catalog-edit-product-save');
  const saveOptional = document.getElementById('catalog-edit-optional-save');
  const deleteProduct = document.getElementById('catalog-edit-product-delete');
  const deleteOptional = document.getElementById('catalog-edit-optional-delete');
  const modalProduct = document.getElementById('catalog-edit-product-modal');
  const modalOptional = document.getElementById('catalog-edit-optional-modal');

  if (closeProduct) closeProduct.addEventListener('click', () => modalProduct && modalProduct.classList.add('hidden'));
  if (closeOptional) closeOptional.addEventListener('click', () => modalOptional && modalOptional.classList.add('hidden'));
  bindProductOptionsModalButtons();
  if (saveProduct) saveProduct.addEventListener('click', saveEditProductModal);
  if (saveOptional) saveOptional.addEventListener('click', saveEditOptionalModal);

  document.getElementById('catalog-edit-product-add-option')?.addEventListener('click', () => {
    const systemSku = document.getElementById('catalog-edit-product-system-sku');
    const sku = (systemSku && systemSku.value || '').trim();
    if (!sku) {
      (window.showError || alert)('Seleccione primero un producto o variante del sistema.');
      return;
    }
    const selectEl = document.getElementById('catalog-edit-product-option-select');
    const optionId = (selectEl && selectEl.value || '').trim();
    if (!optionId) {
      if (selectEl) selectEl.focus();
      return;
    }
    catalogConfig.products[sku] = catalogConfig.products[sku] || {};
    const existingOpts = getProductOptionsListFromCfg(catalogConfig.products[sku]);
    catalogConfig.products[sku].options = existingOpts.length ? existingOpts : [];
    if (catalogConfig.products[sku].optionId) {
      delete catalogConfig.products[sku].optionId;
      delete catalogConfig.products[sku].variantSkus;
    }
    catalogConfig.products[sku].options.push({ optionId, variantSkus: {} });
    renderProductOptionsInModal(sku);
  });

  document.getElementById('catalog-pick-option-group-close')?.addEventListener('click', () => {
    document.getElementById('catalog-pick-option-group-modal')?.classList.add('hidden');
  });
  document.getElementById('catalog-pick-option-group-cancel')?.addEventListener('click', () => {
    document.getElementById('catalog-pick-option-group-modal')?.classList.add('hidden');
  });

  if (deleteProduct) deleteProduct.addEventListener('click', () => {
    const sku = modalProduct && modalProduct.dataset.editSku;
    if (!sku) return;
    const nameEl = document.getElementById('catalog-edit-product-name');
    const productName = (nameEl && nameEl.value || '').trim() || sku;
    const confirmModal = document.getElementById('catalog-delete-product-confirm-modal');
    const confirmNameEl = document.getElementById('catalog-delete-product-confirm-name');
    const confirmInput = document.getElementById('catalog-delete-product-confirm-input');
    const confirmBtn = document.getElementById('catalog-delete-product-confirm-btn');
    const confirmCancel = document.getElementById('catalog-delete-product-confirm-cancel');
    if (!confirmModal || !confirmNameEl || !confirmInput || !confirmBtn) return;
    confirmNameEl.textContent = productName;
    confirmInput.value = '';
    confirmBtn.disabled = true;
    function checkMatch() {
      confirmBtn.disabled = (confirmInput.value || '').trim() !== productName;
    }
    confirmInput.oninput = checkMatch;
    confirmCancel.onclick = () => {
      confirmModal.classList.add('hidden');
      confirmInput.oninput = null;
    };
    confirmBtn.onclick = () => {
      if ((confirmInput.value || '').trim() !== productName) return;
      confirmModal.classList.add('hidden');
      confirmInput.oninput = null;
      delete catalogConfig.products[sku];
      saveCatalogConfig().then(() => { modalProduct.classList.add('hidden'); renderProductsPanel(); renderSectionsList(); }).catch((e) => (window.showError && window.showError(e.message)) || alert(e.message));
    };
    confirmModal.classList.remove('hidden');
    confirmInput.focus();
  });

  const deleteOptionalConfirmModal = document.getElementById('catalog-delete-optional-confirm-modal');
  const deleteOptionalConfirmBtn = document.getElementById('catalog-delete-optional-confirm-btn');
  const deleteOptionalConfirmCancel = document.getElementById('catalog-delete-optional-confirm-cancel');

  if (deleteOptional) deleteOptional.addEventListener('click', () => {
    const optionId = modalOptional && modalOptional.dataset.optionId;
    const choiceIndex = parseInt(modalOptional.dataset.choiceIndex, 10);
    if (optionId === undefined || isNaN(choiceIndex) || choiceIndex < 0) return;
    if (deleteOptionalConfirmModal) {
      deleteOptionalConfirmModal.dataset.optionId = optionId;
      deleteOptionalConfirmModal.dataset.choiceIndex = String(choiceIndex);
      deleteOptionalConfirmModal.classList.remove('hidden');
    }
  });

  if (deleteOptionalConfirmCancel) deleteOptionalConfirmCancel.addEventListener('click', () => {
    if (deleteOptionalConfirmModal) deleteOptionalConfirmModal.classList.add('hidden');
  });

  if (deleteOptionalConfirmBtn) deleteOptionalConfirmBtn.addEventListener('click', () => {
    const optionId = deleteOptionalConfirmModal && deleteOptionalConfirmModal.dataset.optionId;
    const choiceIndex = parseInt(deleteOptionalConfirmModal.dataset.choiceIndex, 10);
    if (deleteOptionalConfirmModal) deleteOptionalConfirmModal.classList.add('hidden');
    if (optionId === undefined || isNaN(choiceIndex) || choiceIndex < 0) return;
    const group = catalogConfig.optionsCatalog[optionId];
    if (group && group.choices) group.choices.splice(choiceIndex, 1);
    saveCatalogConfig().then(() => { modalOptional.classList.add('hidden'); renderOptionsPanel(); }).catch((e) => (window.showError && window.showError(e.message)) || alert(e.message));
  });

  const optionsListEl = document.getElementById('catalog-options-list');
  if (optionsListEl) {
    optionsListEl.addEventListener('click', (e) => {
      const btn = e.target.closest('.catalog-optional-edit');
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();
      const row = btn.closest('[data-option-id]');
      if (!row || !row.dataset.optionId) return;
      const choiceIndex = parseInt(row.dataset.choiceIndex, 10);
      if (isNaN(choiceIndex) || choiceIndex < 0) return;
      openEditOptionalModal(row.dataset.optionId, choiceIndex);
    });
  }

  const optionGroupEditBtn = document.getElementById('catalog-option-group-edit-btn');
  if (optionGroupEditBtn) {
    optionGroupEditBtn.addEventListener('click', () => {
      if (!selectedOptionGroupId) {
        (window.showError || alert)('Seleccione un grupo de opcionales a la izquierda.');
        return;
      }
      openEditOptionGroupModal(selectedOptionGroupId);
    });
  }

  document.body.addEventListener('click', (e) => {
    if (e.target.closest('#catalog-add-option-group-btn')) {
      e.preventDefault();
      openEditOptionGroupModal(null);
    }
  });

  const optionGroupModal = document.getElementById('catalog-edit-option-group-modal');
  document.getElementById('catalog-edit-option-group-close')?.addEventListener('click', () => optionGroupModal && optionGroupModal.classList.add('hidden'));
  document.getElementById('catalog-edit-option-group-save')?.addEventListener('click', saveEditOptionGroupModal);

  document.getElementById('catalog-add-section-btn')?.addEventListener('click', () => {
    const id = prompt('ID de la sección (ej: bebidas):');
    if (!id || !id.trim()) return;
    const name = prompt('Nombre para mostrar:', id);
    const tag = prompt('Tag para productos (opcional):');
    catalogConfig.categories = catalogConfig.categories || [];
    catalogConfig.categories.push({
      id: id.trim().toLowerCase().replace(/\s+/g, '-'),
      name: (name || id).trim(),
      tag: (tag || '').trim() || undefined
    });
    saveCatalogConfig().then(() => renderSectionsList()).catch((e) => (window.showError && window.showError(e.message)) || alert(e.message));
  });
  setupCatalogProductSearch();
  setupCatalogProductChoiceVariantPicker();
  setupCatalogOptionalSearch();

  document.getElementById('catalog-store-hours-save')?.addEventListener('click', () => {
    saveStoreHours().catch((e) => (window.showError && window.showError(e.message)) || alert('Error: ' + (e.message || e)));
  });

  const storeHoursToggle = document.getElementById('catalog-store-hours-toggle');
  const storeHoursContent = document.getElementById('catalog-store-hours-content');
  const storeHoursChevron = document.getElementById('catalog-store-hours-chevron');
  if (storeHoursToggle && storeHoursContent) {
    storeHoursToggle.addEventListener('click', () => {
      const isHidden = storeHoursContent.classList.toggle('hidden');
      if (storeHoursChevron) storeHoursChevron.classList.toggle('rotate-180', isHidden);
    });
  }
  document.getElementById('catalog-store-manual-override')?.addEventListener('change', updateStoreStatusBadge);

  document.getElementById('catalog-payment-methods-save')?.addEventListener('click', () => {
    savePaymentMethods().catch((e) => (window.showError && window.showError(e.message)) || alert('Error: ' + (e.message || e)));
  });
  const payToggle = document.getElementById('catalog-payment-methods-toggle');
  const payContent = document.getElementById('catalog-payment-methods-content');
  const payChevron = document.getElementById('catalog-payment-methods-chevron');
  if (payToggle && payContent) {
    payToggle.addEventListener('click', () => {
      const isHidden = payContent.classList.toggle('hidden');
      if (payChevron) payChevron.classList.toggle('rotate-180', isHidden);
    });
  }
  ['catalog-pay-efectivo', 'catalog-pay-pos', 'catalog-pay-mercadopago'].forEach((id) => {
    document.getElementById(id)?.addEventListener('change', () => {
      catalogConfig.paymentMethods = {
        efectivo: !!document.getElementById('catalog-pay-efectivo')?.checked,
        pos: !!document.getElementById('catalog-pay-pos')?.checked,
        mercadopago: !!document.getElementById('catalog-pay-mercadopago')?.checked
      };
      updatePaymentMethodsBadge();
    });
  });

  function getImageFormEls() {
    return {
      imageLinkWrap: document.getElementById('catalog-edit-product-image-link-wrap'),
      imageForm: document.getElementById('catalog-edit-product-image-form'),
      imageInput: document.getElementById('catalog-edit-product-image-input'),
      imagePathEl: document.getElementById('catalog-edit-product-image-path'),
      imgEl: document.getElementById('catalog-edit-product-image'),
      placeholder: document.getElementById('catalog-edit-product-image-placeholder')
    };
  }

  function applyImagePath(p) {
    const { imagePathEl, imgEl, placeholder } = getImageFormEls();
    if (imagePathEl) imagePathEl.value = p;
    if (imgEl && placeholder) {
      if (p) {
        imgEl.src = p;
        imgEl.onerror = () => { imgEl.classList.add('hidden'); placeholder.classList.remove('hidden'); };
        imgEl.classList.remove('hidden');
        placeholder.classList.add('hidden');
      } else {
        imgEl.classList.add('hidden');
        placeholder.classList.remove('hidden');
      }
    }
  }

  function showImageForm() {
    const { imageLinkWrap, imageForm, imageInput, imagePathEl } = getImageFormEls();
    if (imageLinkWrap) imageLinkWrap.classList.add('hidden');
    if (imageForm) {
      if (imageInput && imagePathEl) imageInput.value = imagePathEl.value || '';
      imageForm.classList.remove('hidden');
      imageInput?.focus();
    }
  }

  function hideImageForm() {
    const { imageLinkWrap, imageForm } = getImageFormEls();
    if (imageForm) imageForm.classList.add('hidden');
    if (imageLinkWrap) imageLinkWrap.classList.remove('hidden');
  }

  if (modalProduct) {
    modalProduct.addEventListener('click', (e) => {
      const btn = e.target.closest('#catalog-edit-product-image-btn');
      if (btn) {
        e.preventDefault();
        e.stopPropagation();
        showImageForm();
      }
      const saveBtn = e.target.closest('#catalog-edit-product-image-save');
      if (saveBtn) {
        e.preventDefault();
        const { imageInput } = getImageFormEls();
        const p = (imageInput?.value || '').trim();
        applyImagePath(p);
        hideImageForm();
      }
      const cancelBtn = e.target.closest('#catalog-edit-product-image-cancel');
      if (cancelBtn) {
        e.preventDefault();
        hideImageForm();
      }
    });
    modalProduct.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.id === 'catalog-edit-product-image-input') {
        e.preventDefault();
        const { imageInput } = getImageFormEls();
        const p = (imageInput?.value || '').trim();
        applyImagePath(p);
        hideImageForm();
      }
    });
  }
}

document.querySelectorAll('.catalog-sub-nav').forEach((btn) => {
  btn.addEventListener('click', () => switchCatalogSub(btn.dataset.sub));
});

const catalogSearchEl = document.getElementById('catalog-search');
if (catalogSearchEl) {
  let catalogSearchTimeout = null;
  catalogSearchEl.addEventListener('input', () => {
    clearTimeout(catalogSearchTimeout);
    catalogSearchTimeout = setTimeout(() => {
      renderProductsPanel();
      renderOptionsPanel();
    }, 150);
  });
}

bindCatalogModals();

window.loadCatalog = loadCatalog;

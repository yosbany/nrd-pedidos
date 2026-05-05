// Client management

let clientsListener = null;
let clientsSearchTerm = ''; // Search term for clients
let currentClientPreferredPrices = []; // Preferred prices for current client form

// Load clients
function loadClients() {
  logger.debug('Loading clients');
  const clientsList = document.getElementById('clients-list');
  if (!clientsList) {
    logger.warn('Clients list element not found');
    return;
  }
  
  clientsList.innerHTML = '';

  // Remove previous listener
  if (clientsListener) {
    logger.debug('Removing previous clients listener');
    clientsListener(); // Unsubscribe from NRD Data Access listener
    clientsListener = null;
  }

  // Listen for clients and orders using NRD Data Access
  logger.debug('Setting up clients listener');
  clientsListener = nrd.clients.onValue(async (clients) => {
    logger.debug('Clients data received', { count: Array.isArray(clients) ? clients.length : Object.keys(clients || {}).length });
    if (!clientsList) return;
    clientsList.innerHTML = '';
    
    // Convert to object format if needed (NRD Data Access may return object with IDs as keys or array)
    const clientsDict = Array.isArray(clients) 
      ? clients.reduce((acc, client) => {
          if (client && client.id) {
            acc[client.id] = client;
          }
          return acc;
        }, {})
      : clients || {};

    if (Object.keys(clientsDict).length === 0) {
      clientsList.innerHTML = '<p class="text-center text-gray-600 py-6 sm:py-8 text-sm sm:text-base">No hay clientes registrados</p>';
      return;
    }

    // Load orders to count by client using NRD Data Access
    const orders = await nrd.orders.getAll();
    const ordersObj = Array.isArray(orders) 
      ? orders.reduce((acc, order) => {
          if (order && order.id) {
            acc[order.id] = order;
          }
          return acc;
        }, {})
      : orders || {};
    
    // Count orders by client and status
    const clientOrderCounts = {};
    Object.values(ordersObj).forEach(order => {
      if (order.clientId) {
        if (!clientOrderCounts[order.clientId]) {
          clientOrderCounts[order.clientId] = { completed: 0, pending: 0 };
        }
        const status = order.status || 'Pendiente';
        if (status === 'Completado') {
          clientOrderCounts[order.clientId].completed++;
        } else {
          clientOrderCounts[order.clientId].pending++;
        }
      }
    });

    // Filter by search term if active
    let clientsToShow = Object.entries(clientsDict);
    if (clientsSearchTerm.trim()) {
      const normalizeSearchText = window.normalizeSearchText || window.NRDCommon?.normalizeSearchText || ((t) => t.toLowerCase());
      const normalizedTerm = normalizeSearchText(clientsSearchTerm.trim());
      clientsToShow = clientsToShow.filter(([id, client]) => {
        const name = normalizeSearchText(client.name || '');
        const phone = normalizeSearchText(client.phone || '');
        const address = normalizeSearchText(client.address || '');
        const description = normalizeSearchText(client.description || '');
        
        return name.includes(normalizedTerm) || 
               phone.includes(normalizedTerm) || 
               address.includes(normalizedTerm) ||
               description.includes(normalizedTerm);
      });
    }
    
    if (clientsToShow.length === 0) {
      clientsList.innerHTML = '<p class="text-center text-gray-600 py-6 sm:py-8 text-sm sm:text-base">No hay clientes que coincidan con la búsqueda</p>';
      return;
    }
    
    clientsToShow.forEach(([id, client]) => {
      const counts = clientOrderCounts[id] || { completed: 0, pending: 0 };
      const item = document.createElement('div');
      item.className = 'border border-gray-200 p-2 sm:p-2.5 hover:border-red-600 transition-colors cursor-pointer';
      item.dataset.clientId = id;
      item.innerHTML = `
        <div class="flex justify-between items-center mb-1">
          <div class="text-sm sm:text-base font-light">${escapeHtml(client.name)}</div>
        </div>
        <div class="text-xs text-gray-600 space-y-0.5">
          ${client.phone ? `<div>Tel: ${escapeHtml(client.phone)}</div>` : ''}
          ${client.address ? `<div class="truncate" title="${escapeHtml(client.address)}">${escapeHtml(client.address)}</div>` : ''}
          <div class="flex gap-2 mt-1">
            <span class="text-green-600">Completados: ${counts.completed}</span>
            <span class="text-red-600">Pendientes: ${counts.pending}</span>
          </div>
        </div>
      `;
      item.addEventListener('click', () => viewClient(id));
      clientsList.appendChild(item);
    });
  });
}

// Show client form
function showClientForm(clientId = null) {
  const form = document.getElementById('client-form');
  const list = document.getElementById('clients-list');
  const header = document.querySelector('#clients-view .flex.flex-col');
  const detail = document.getElementById('client-detail');
  const title = document.getElementById('client-form-title');
  const formElement = document.getElementById('client-form-element');
  
  if (form) form.classList.remove('hidden');
  if (list) list.style.display = 'none';
  if (header) header.style.display = 'none';
  if (detail) detail.classList.add('hidden');
  
  if (formElement) {
    formElement.reset();
    const clientIdInput = document.getElementById('client-id');
    if (clientIdInput) clientIdInput.value = clientId || '';
  }

  // Reset preferred prices
  currentClientPreferredPrices = [];

  const formHeader = document.getElementById('client-form-header');
  const subtitle = document.getElementById('client-form-subtitle');
  const saveBtn = document.getElementById('save-client-btn');
  
  if (clientId) {
    if (title) title.textContent = 'Editar Cliente';
    if (subtitle) subtitle.textContent = 'Modifique la información del cliente';
    // Cambiar color del header a azul para edición
    if (formHeader) {
      formHeader.classList.remove('bg-green-600', 'bg-gray-600');
      formHeader.classList.add('bg-blue-600');
    }
    // Cambiar color del botón guardar a azul
    if (saveBtn) {
      saveBtn.classList.remove('bg-green-600', 'border-green-600', 'hover:bg-green-700');
      saveBtn.classList.add('bg-blue-600', 'border-blue-600', 'hover:bg-blue-700');
    }
    (async () => {
      const client = await nrd.clients.getById(clientId);
      if (client) {
        const nameInput = document.getElementById('client-name');
        const phoneInput = document.getElementById('client-phone');
        const addressInput = document.getElementById('client-address');
        const descriptionInput = document.getElementById('client-description');
        if (nameInput) nameInput.value = client.name || '';
        if (phoneInput) phoneInput.value = client.phone || '';
        if (addressInput) addressInput.value = client.address || '';
        if (descriptionInput) descriptionInput.value = client.description || '';
        
        // Load preferred prices
        if (client.preferredPrices && Array.isArray(client.preferredPrices)) {
          currentClientPreferredPrices = [...client.preferredPrices];
        }
        renderClientPreferredPrices();
      }
    })();
  } else {
    if (title) title.textContent = 'Nuevo Cliente';
    if (subtitle) subtitle.textContent = 'Registre la información del nuevo cliente';
    // Cambiar color del header a verde para nuevo
    if (formHeader) {
      formHeader.classList.remove('bg-blue-600', 'bg-gray-600');
      formHeader.classList.add('bg-green-600');
    }
    // Cambiar color del botón guardar a verde
    if (saveBtn) {
      saveBtn.classList.remove('bg-blue-600', 'border-blue-600', 'hover:bg-blue-700');
      saveBtn.classList.add('bg-green-600', 'border-green-600', 'hover:bg-green-700');
    }
    renderClientPreferredPrices();
  }
  
  // Setup add preferred price button
  const addPreferredPriceBtn = document.getElementById('add-preferred-price-btn');
  if (addPreferredPriceBtn) {
    addPreferredPriceBtn.onclick = addClientPreferredPrice;
  }
}

// Render client preferred prices
async function renderClientPreferredPrices() {
  const container = document.getElementById('client-preferred-prices-list');
  if (!container) return;
  
  container.innerHTML = '';
  
  if (currentClientPreferredPrices.length === 0) {
    return;
  }
  
  // Load products for display
  const products = await loadProductsForOrder();
  const productMap = {};
  products.forEach(p => productMap[p.id] = p);
  
  currentClientPreferredPrices.forEach((preferredPrice, index) => {
    const product = productMap[preferredPrice.productId];
    const productName = product ? product.name : 'Producto no encontrado';
    const originalPrice = product ? parseFloat(product.price) : 0;
    
    // Calculate final price based on type
    let finalPrice = 0;
    let priceDisplay = '';
    if (preferredPrice.type === 'fijo' && preferredPrice.price) {
      finalPrice = parseFloat(preferredPrice.price);
      priceDisplay = `$${finalPrice.toFixed(2)}`;
    } else if (preferredPrice.type === 'porcentual' && preferredPrice.percentage) {
      const percentage = parseFloat(preferredPrice.percentage);
      finalPrice = originalPrice * (1 - percentage / 100);
      priceDisplay = `${percentage.toFixed(2)}% ($${finalPrice.toFixed(2)})`;
    }
    
    const div = document.createElement('div');
    div.className = 'flex flex-col gap-2 sm:gap-3 py-2 sm:py-3 border border-gray-200 rounded p-2 sm:p-3 bg-gray-50';
    
    div.innerHTML = `
      <div class="flex flex-col sm:flex-row gap-2 sm:gap-3 items-stretch sm:items-center">
        <div class="flex-1 text-xs sm:text-sm text-gray-600">
          <div class="font-medium">${escapeHtml(productName)}</div>
          <div class="text-xs text-gray-500">
            ${preferredPrice.type === 'fijo' ? 'Precio Fijo' : 'Porcentaje'}
            ${priceDisplay ? ` - ${priceDisplay}` : ''}
            ${preferredPrice.type === 'porcentual' && originalPrice > 0 ? ` (Original: $${originalPrice.toFixed(2)})` : ''}
          </div>
        </div>
        <button type="button" class="px-3 py-2 border border-gray-300 hover:border-red-600 hover:text-red-600 transition-colors text-sm font-light rounded remove-preferred-price" onclick="removeClientPreferredPrice(${index})">
          Eliminar
        </button>
      </div>
    `;
    
    container.appendChild(div);
  });
}

// Add client preferred price
async function addClientPreferredPrice() {
  // Load products
  const products = await loadProductsForOrder();
  if (products.length === 0) {
    await showError('No hay productos disponibles. Por favor, agregue productos primero.');
    return;
  }
  
  return new Promise((resolve) => {
    const modal = document.getElementById('custom-modal');
    const titleEl = document.getElementById('modal-title');
    const messageEl = document.getElementById('modal-message');
    const confirmBtn = document.getElementById('modal-confirm');
    const cancelBtn = document.getElementById('modal-cancel');

    titleEl.textContent = 'Agregar Precio Preferido';
    messageEl.innerHTML = `
      <div class="space-y-4">
        <div>
          <label class="block mb-1.5 text-xs uppercase tracking-wider text-gray-600">Producto</label>
          <div class="relative">
            <input type="text" id="preferred-price-product-search-input" 
              placeholder="Buscar producto..." 
              autocomplete="off"
              class="w-full px-3 py-2 border border-gray-300 focus:outline-none focus:border-red-600 bg-white text-sm sm:text-base rounded">
            
            <!-- Dropdown Results -->
            <div id="preferred-price-product-search-results" class="hidden absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded shadow-lg max-h-60 overflow-y-auto">
            </div>
          </div>
          <input type="hidden" id="preferred-price-product" value="">
        </div>
        <div>
          <label class="block mb-1.5 text-xs uppercase tracking-wider text-gray-600">Tipo</label>
          <select id="preferred-price-type" class="w-full px-3 py-2 border border-gray-300 focus:outline-none focus:border-red-600 bg-white text-sm sm:text-base rounded">
            <option value="fijo">Precio Fijo</option>
            <option value="porcentual">Porcentaje</option>
          </select>
        </div>
        <div id="preferred-price-value-container">
          <label class="block mb-1.5 text-xs uppercase tracking-wider text-gray-600" id="preferred-price-value-label">Precio</label>
          <input type="number" id="preferred-price-value" step="0.01" min="0" 
            placeholder="0.00" 
            class="w-full px-3 py-2 border border-gray-300 focus:outline-none focus:border-red-600 bg-white text-sm sm:text-base rounded">
        </div>
      </div>
    `;
    
    confirmBtn.textContent = 'Agregar';
    cancelBtn.textContent = 'Cancelar';

    modal.classList.remove('hidden');
    
    // Setup product search for preferred price modal
    setupPreferredPriceProductSearch(products);
    
    // Handle type change
    const typeSelect = document.getElementById('preferred-price-type');
    const valueLabel = document.getElementById('preferred-price-value-label');
    const valueInput = document.getElementById('preferred-price-value');
    
    if (typeSelect && valueLabel && valueInput) {
      typeSelect.addEventListener('change', (e) => {
        if (e.target.value === 'fijo') {
          valueLabel.textContent = 'Precio';
          valueInput.placeholder = '0.00';
          valueInput.value = '';
        } else {
          valueLabel.textContent = 'Porcentaje';
          valueInput.placeholder = '0.00';
          valueInput.value = '';
        }
      });
    }

    const handleConfirm = () => {
      const productSelect = document.getElementById('preferred-price-product');
      const typeSelect = document.getElementById('preferred-price-type');
      const valueInput = document.getElementById('preferred-price-value');
      
      const productId = productSelect ? productSelect.value : '';
      const type = typeSelect ? typeSelect.value : 'fijo';
      const value = valueInput ? parseFloat(valueInput.value) : 0;
      
      if (!productId) {
        showError('Por favor seleccione un producto');
        return;
      }
      
      if (isNaN(value) || value <= 0) {
        showError('Por favor ingrese un valor válido mayor a 0');
        return;
      }
      
      // Check if product already has preferred price
      const existingIndex = currentClientPreferredPrices.findIndex(pp => pp.productId === productId);
      if (existingIndex >= 0) {
        // Update existing
        if (type === 'fijo') {
          currentClientPreferredPrices[existingIndex] = { productId, type, price: value };
          delete currentClientPreferredPrices[existingIndex].percentage;
        } else {
          currentClientPreferredPrices[existingIndex] = { productId, type, percentage: value };
          delete currentClientPreferredPrices[existingIndex].price;
        }
      } else {
        // Add new
        if (type === 'fijo') {
          currentClientPreferredPrices.push({ productId, type, price: value });
        } else {
          currentClientPreferredPrices.push({ productId, type, percentage: value });
        }
      }
      
      renderClientPreferredPrices();
      
      // Close modal
      modal.classList.add('hidden');
      messageEl.innerHTML = '';
      confirmBtn.removeEventListener('click', handleConfirm);
      cancelBtn.removeEventListener('click', handleCancel);
      modal.removeEventListener('click', handleBackgroundClick);
      resolve();
    };

    const handleCancel = () => {
      modal.classList.add('hidden');
      messageEl.innerHTML = '';
      confirmBtn.removeEventListener('click', handleConfirm);
      cancelBtn.removeEventListener('click', handleCancel);
      modal.removeEventListener('click', handleBackgroundClick);
      resolve();
    };

    // Close on background click
    const handleBackgroundClick = (e) => {
      if (e.target === modal) {
        handleCancel();
      }
    };

    confirmBtn.addEventListener('click', handleConfirm);
    cancelBtn.addEventListener('click', handleCancel);
    modal.addEventListener('click', handleBackgroundClick);
  });
}

// Remove client preferred price
function removeClientPreferredPrice(index) {
  currentClientPreferredPrices.splice(index, 1);
  renderClientPreferredPrices();
}

// Preferred price product search functionality
let preferredPriceProducts = [];
let preferredPriceSearchTimeout = null;
let preferredPriceSearchHandler = null;
let preferredPriceClickOutsideHandler = null;
let preferredPriceKeyboardHandler = null;
let selectedPreferredPriceProductIndex = -1;
let filteredPreferredPriceProducts = [];

// Setup product search for preferred price modal
function setupPreferredPriceProductSearch(products) {
  preferredPriceProducts = products;
  
  const searchInput = document.getElementById('preferred-price-product-search-input');
  const resultsDiv = document.getElementById('preferred-price-product-search-results');
  const hiddenInput = document.getElementById('preferred-price-product');
  
  if (!searchInput || !resultsDiv || !hiddenInput) return;
  
  // Clear previous handlers
  if (preferredPriceSearchHandler) {
    searchInput.removeEventListener('input', preferredPriceSearchHandler);
  }
  if (preferredPriceKeyboardHandler) {
    searchInput.removeEventListener('keydown', preferredPriceKeyboardHandler);
  }
  if (preferredPriceClickOutsideHandler) {
    document.removeEventListener('click', preferredPriceClickOutsideHandler);
  }
  
  // Search handler
  preferredPriceSearchHandler = (e) => {
    clearTimeout(preferredPriceSearchTimeout);
    preferredPriceSearchTimeout = setTimeout(() => {
      searchPreferredPriceProducts(e.target.value, products, resultsDiv, hiddenInput);
    }, 200);
  };
  searchInput.addEventListener('input', preferredPriceSearchHandler);
  
  // Keyboard navigation
  preferredPriceKeyboardHandler = (e) => {
    const items = document.querySelectorAll('.preferred-price-product-search-item');
    const totalItems = items.length;
    
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      selectedPreferredPriceProductIndex = selectedPreferredPriceProductIndex >= totalItems - 1 ? 0 : selectedPreferredPriceProductIndex + 1;
      updatePreferredPriceProductSelection(items);
      if (items[selectedPreferredPriceProductIndex]) {
        scrollToPreferredPriceProductItem(items[selectedPreferredPriceProductIndex]);
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      selectedPreferredPriceProductIndex = selectedPreferredPriceProductIndex <= 0 ? totalItems - 1 : selectedPreferredPriceProductIndex - 1;
      updatePreferredPriceProductSelection(items);
      if (items[selectedPreferredPriceProductIndex]) {
        scrollToPreferredPriceProductItem(items[selectedPreferredPriceProductIndex]);
      }
    } else if (e.key === 'Enter' && selectedPreferredPriceProductIndex >= 0) {
      e.preventDefault();
      const selectedItem = items[selectedPreferredPriceProductIndex];
      if (selectedItem) {
        selectPreferredPriceProduct(selectedItem, searchInput, resultsDiv, hiddenInput);
      }
    } else if (e.key === 'Escape') {
      resultsDiv.classList.add('hidden');
      selectedPreferredPriceProductIndex = -1;
    }
  };
  searchInput.addEventListener('keydown', preferredPriceKeyboardHandler);
  
  // Click outside handler
  preferredPriceClickOutsideHandler = (e) => {
    if (resultsDiv && !searchInput.contains(e.target) && !resultsDiv.contains(e.target)) {
      resultsDiv.classList.add('hidden');
      selectedPreferredPriceProductIndex = -1;
    }
  };
  document.addEventListener('click', preferredPriceClickOutsideHandler);
}

// Search products for preferred price modal
function searchPreferredPriceProducts(query, products, resultsDiv, hiddenInput) {
  const searchTerm = query.toLowerCase().trim();
  
  if (searchTerm.length === 0) {
    resultsDiv.classList.add('hidden');
    return;
  }
  
  // Filter products
  const filtered = products.filter(product => 
    product.name && product.name.toLowerCase().includes(searchTerm)
  );
  
  // Store filtered products for keyboard navigation
  filteredPreferredPriceProducts = filtered;
  selectedPreferredPriceProductIndex = -1;
  
  // Build results HTML
  let resultsHTML = '';
  
  if (filtered.length === 0) {
    resultsHTML = '<div class="px-3 py-2 text-sm text-gray-500">No se encontraron productos</div>';
  } else {
    resultsHTML = filtered.map((product, index) => `
      <div class="preferred-price-product-search-item px-3 py-2 hover:bg-gray-50 cursor-pointer border-b border-gray-100 last:border-b-0 ${index === selectedPreferredPriceProductIndex ? 'bg-red-50 border-red-200' : ''}" 
           data-product-id="${product.id}" 
           data-product-name="${escapeHtml(product.name)}" 
           data-product-price="${product.price}"
           data-index="${index}">
        <div class="font-light text-sm">${escapeHtml(product.name)}</div>
        <div class="text-xs text-gray-600">$${parseFloat(product.price || 0).toFixed(2)}</div>
      </div>
    `).join('');
  }
  
  resultsDiv.innerHTML = resultsHTML;
  resultsDiv.classList.remove('hidden');
  
  // Attach click handlers
  document.querySelectorAll('.preferred-price-product-search-item').forEach(item => {
    item.addEventListener('click', () => {
      const searchInput = document.getElementById('preferred-price-product-search-input');
      selectPreferredPriceProduct(item, searchInput, resultsDiv, hiddenInput);
    });
  });
}

// Select preferred price product
function selectPreferredPriceProduct(item, searchInput, resultsDiv, hiddenInput) {
  const productId = item.dataset.productId;
  const productName = item.dataset.productName;
  
  if (hiddenInput) {
    hiddenInput.value = productId;
  }
  if (searchInput) {
    searchInput.value = productName;
  }
  if (resultsDiv) {
    resultsDiv.classList.add('hidden');
  }
  selectedPreferredPriceProductIndex = -1;
}

// Update preferred price product selection highlighting
function updatePreferredPriceProductSelection(items) {
  items.forEach((item, index) => {
    if (index === selectedPreferredPriceProductIndex) {
      item.classList.add('bg-red-50', 'border-red-200');
      item.classList.remove('hover:bg-gray-50');
    } else {
      item.classList.remove('bg-red-50', 'border-red-200');
      item.classList.add('hover:bg-gray-50');
    }
  });
}

// Scroll to selected preferred price product item
function scrollToPreferredPriceProductItem(item) {
  if (!item) return;
  const resultsDiv = document.getElementById('preferred-price-product-search-results');
  if (!resultsDiv) return;
  
  const itemTop = item.offsetTop;
  const itemBottom = itemTop + item.offsetHeight;
  const containerTop = resultsDiv.scrollTop;
  const containerBottom = containerTop + resultsDiv.offsetHeight;
  
  if (itemTop < containerTop) {
    resultsDiv.scrollTop = itemTop;
  } else if (itemBottom > containerBottom) {
    resultsDiv.scrollTop = itemBottom - resultsDiv.offsetHeight;
  }
}

// Hide client form
function hideClientForm() {
  const form = document.getElementById('client-form');
  const list = document.getElementById('clients-list');
  const header = document.querySelector('#clients-view .flex.flex-col');
  const detail = document.getElementById('client-detail');
  
  if (form) form.classList.add('hidden');
  if (list) list.style.display = 'block';
  if (header) header.style.display = 'flex';
  if (detail) detail.classList.add('hidden');
}

// Save client using NRD Data Access
async function saveClient(clientId, clientData) {
  const user = getCurrentUser();
  if (clientId) {
    logger.info('Updating client', { clientId, name: clientData.name });
    await nrd.clients.update(clientId, clientData);
    logger.audit('ENTITY_UPDATE', { entity: 'client', id: clientId, data: clientData, uid: user?.uid, email: user?.email, timestamp: Date.now() });
    logger.info('Client updated successfully', { clientId });
    return { key: clientId };
  } else {
    logger.info('Creating new client', { name: clientData.name });
    const id = await nrd.clients.create(clientData);
    logger.audit('ENTITY_CREATE', { entity: 'client', id, data: clientData, uid: user?.uid, email: user?.email, timestamp: Date.now() });
    logger.info('Client created successfully', { id, name: clientData.name });
    return { key: id, getKey: () => id };
  }
}

// View client detail
async function viewClient(clientId) {
  logger.debug('Viewing client', { clientId });
  showSpinner('Cargando cliente...');
  try {
    const client = await nrd.clients.getById(clientId);
    hideSpinner();
    if (!client) {
      logger.warn('Client not found', { clientId });
      await showError('Cliente no encontrado');
      return;
    }
    logger.debug('Client loaded successfully', { clientId, name: client.name });

    const list = document.getElementById('clients-list');
    const header = document.querySelector('#clients-view .flex.flex-col');
    const form = document.getElementById('client-form');
    const detail = document.getElementById('client-detail');
    const detailContent = document.getElementById('client-detail-content');
    
    if (!detail || !detailContent) {
      await showError('Error: Elemento de detalle no encontrado. Por favor, recarga la página.');
      return;
    }
    
    if (list) list.style.display = 'none';
    if (header) header.style.display = 'none';
    if (form) form.classList.add('hidden');
    if (detail) detail.classList.remove('hidden');

    let detailHTML = `
      <div class="space-y-3 sm:space-y-4">
        <div class="flex justify-between py-2 sm:py-3 border-b border-gray-200">
          <span class="text-gray-600 font-light text-sm sm:text-base">Nombre:</span>
          <span class="font-light text-sm sm:text-base">${escapeHtml(client.name)}</span>
        </div>
    `;
    
    if (client.phone) {
      detailHTML += `
        <div class="flex justify-between py-2 sm:py-3 border-b border-gray-200">
          <span class="text-gray-600 font-light text-sm sm:text-base">Teléfono:</span>
          <span class="font-light text-sm sm:text-base">${escapeHtml(client.phone)}</span>
        </div>
      `;
    }
    
    if (client.address) {
      detailHTML += `
        <div class="flex justify-between py-2 sm:py-3 border-b border-gray-200">
          <span class="text-gray-600 font-light text-sm sm:text-base">Dirección:</span>
          <span class="font-light text-sm sm:text-base text-right">${escapeHtml(client.address)}</span>
        </div>
      `;
    }
    
    if (client.description) {
      detailHTML += `
        <div class="flex justify-between py-2 sm:py-3 border-b border-gray-200">
          <span class="text-gray-600 font-light text-sm sm:text-base">Descripción:</span>
          <span class="font-light text-sm sm:text-base text-right whitespace-pre-wrap">${escapeHtml(client.description)}</span>
        </div>
      `;
    }
    
    // Show preferred prices if any
    if (client.preferredPrices && Array.isArray(client.preferredPrices) && client.preferredPrices.length > 0) {
      // Load products for display
      const products = await loadProductsForOrder();
      const productMap = {};
      products.forEach(p => productMap[p.id] = p);
      
      detailHTML += `
        <div class="py-2 sm:py-3 border-b border-gray-200">
          <div class="text-gray-600 font-light text-sm sm:text-base mb-2">Precios Preferidos:</div>
          <div class="space-y-2">
      `;
      
      client.preferredPrices.forEach(preferredPrice => {
        const product = productMap[preferredPrice.productId];
        const productName = product ? product.name : 'Producto no encontrado';
        const priceInfo = preferredPrice.type === 'fijo' && preferredPrice.price 
          ? `$${parseFloat(preferredPrice.price).toFixed(2)}` 
          : preferredPrice.type === 'porcentual' && preferredPrice.percentage 
          ? `${parseFloat(preferredPrice.percentage).toFixed(2)}%` 
          : '';
        
        detailHTML += `
          <div class="flex justify-between py-1 sm:py-2 text-xs sm:text-sm border-b border-gray-100 last:border-b-0">
            <span class="font-light text-gray-700">${escapeHtml(productName)}</span>
            <span class="font-light text-gray-600">${priceInfo}</span>
          </div>
        `;
      });
      
      detailHTML += `
          </div>
        </div>
      `;
    }
    
    detailHTML += `</div>`;
    detailContent.innerHTML = detailHTML;

    // Attach button handlers
    const editBtn = document.getElementById('edit-client-detail-btn');
    const deleteBtn = document.getElementById('delete-client-detail-btn');
    
    if (editBtn) {
      editBtn.onclick = () => {
        detail.classList.add('hidden');
        showClientForm(clientId);
      };
    }
    
    if (deleteBtn) {
      deleteBtn.onclick = () => deleteClientHandler(clientId);
    }
  } catch (error) {
    hideSpinner();
    logger.error('Failed to load client', error);
    await showError('Error al cargar cliente: ' + error.message);
  }
}

// Back to clients list
function backToClients() {
  const list = document.getElementById('clients-list');
  const header = document.querySelector('#clients-view .flex.flex-col');
  const detail = document.getElementById('client-detail');
  const form = document.getElementById('client-form');
  
  if (list) list.style.display = 'block';
  if (header) header.style.display = 'flex';
  if (detail) detail.classList.add('hidden');
  if (form) form.classList.add('hidden');
}

// Edit client
function editClient(clientId) {
  showClientForm(clientId);
}

// Delete client handler
async function deleteClientHandler(clientId) {
  logger.debug('Delete client requested', { clientId });
  const confirmed = await showConfirm('Eliminar Cliente', '¿Está seguro de eliminar este cliente?');
  if (!confirmed) {
    logger.debug('Client deletion cancelled', { clientId });
    return;
  }

  const user = getCurrentUser();
  logger.info('Deleting client', { clientId });
  showSpinner('Eliminando cliente...');
  try {
    await nrd.clients.delete(clientId);
    logger.audit('ENTITY_DELETE', { entity: 'client', id: clientId, uid: user?.uid, email: user?.email, timestamp: Date.now() });
    logger.info('Client deleted successfully', { clientId });
    hideSpinner();
    backToClients();
  } catch (error) {
    hideSpinner();
    logger.error('Failed to delete client', error);
    await showError('Error al eliminar cliente: ' + error.message);
  }
}

// Client form submit
document.getElementById('client-form-element').addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const clientId = document.getElementById('client-id').value;
  const name = document.getElementById('client-name').value.trim();
  const phone = document.getElementById('client-phone').value.trim();
  const address = document.getElementById('client-address').value.trim();
  const description = document.getElementById('client-description').value.trim();

  if (!name) {
    await showError('Por favor complete el nombre del cliente');
    return;
  }

  const isFromOrder = sessionStorage.getItem('creatingClientFromOrder') === 'true';
  
  logger.debug('Client form submitted', { clientId, name, isFromOrder });
  showSpinner('Guardando cliente...');
  try {
    const clientData = { name };
    // Always include phone, address, and description (even if empty) to allow clearing them
    clientData.phone = phone || null;
    clientData.address = address || null;
    clientData.description = description || null;
    
    // Include preferred prices if any
    if (currentClientPreferredPrices && currentClientPreferredPrices.length > 0) {
      clientData.preferredPrices = currentClientPreferredPrices;
    } else {
      clientData.preferredPrices = null;
    }
    
    const result = await saveClient(clientId || null, clientData);
    hideSpinner();
    
    // If coming from order form, return to order form with client selected
    if (isFromOrder) {
      sessionStorage.removeItem('creatingClientFromOrder');
      
      // Get the new client ID (if it's a new client, result.key will have the ID)
      let newClientId = clientId;
      if (!clientId && result) {
        // Firebase push() returns a reference with a key property
        if (result.key) {
          newClientId = result.key;
        } else if (result.getKey && typeof result.getKey === 'function') {
          newClientId = result.getKey();
        }
      }
      
      // Switch back to orders view
      if (typeof switchView === 'function') {
        switchView('orders');
      }
      
      // Show new order form
      if (typeof showNewOrderForm === 'function') {
        await showNewOrderForm();
        
        // Wait a bit for the form to render and clients to load
        setTimeout(() => {
          // Reload clients and select the new client
          loadClientsForOrder();
          setTimeout(() => {
            const select = document.getElementById('order-client-select');
            if (select && newClientId) {
              select.value = newClientId;
              // Trigger change event to update currentOrderClient
              const event = new Event('change', { bubbles: true });
              select.dispatchEvent(event);
            }
          }, 300);
        }, 100);
      }
    } else {
      hideClientForm();
    }
  } catch (error) {
    hideSpinner();
    await showError('Error al guardar cliente: ' + error.message);
  }
});

// New client button
document.getElementById('new-client-btn').addEventListener('click', () => {
  showClientForm();
});

// Cancel client form
document.getElementById('cancel-client-btn').addEventListener('click', () => {
  hideClientForm();
});

// Close client form button
document.getElementById('close-client-form').addEventListener('click', () => {
  hideClientForm();
});

// Back to clients button
const backToClientsBtn = document.getElementById('back-to-clients');
if (backToClientsBtn) {
  backToClientsBtn.addEventListener('click', () => {
    backToClients();
  });
}

// Close client detail button
const closeClientDetailBtn = document.getElementById('close-client-detail-btn');
if (closeClientDetailBtn) {
  closeClientDetailBtn.addEventListener('click', () => {
    backToClients();
  });
}

// Load clients for order form using NRD Data Access
async function loadClientsForOrder() {
  const select = document.getElementById('order-client-select');
  if (!select) return;
  
  select.innerHTML = '<option value="">Seleccionar cliente</option>';

  try {
    const clients = await nrd.clients.getAll();
    const clientsObj = Array.isArray(clients) 
      ? clients.reduce((acc, client) => {
          if (client && client.id) {
            acc[client.id] = client;
          }
          return acc;
        }, {})
      : clients || {};
    
    Object.entries(clientsObj).forEach(([id, client]) => {
      const option = document.createElement('option');
      option.value = id;
      option.textContent = client.name;
      select.appendChild(option);
    });
  } catch (error) {
    console.error('Error loading clients for order:', error);
  }
}

// Escape HTML to prevent XSS
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Search input for clients
const clientsSearchInput = document.getElementById('clients-search-input');
if (clientsSearchInput) {
  clientsSearchInput.addEventListener('input', (e) => {
    clientsSearchTerm = e.target.value;
    loadClients();
  });
}


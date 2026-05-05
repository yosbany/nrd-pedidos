// Main app controller

// Navigation
let currentView = null;

function switchView(viewName) {
  // Prevent duplicate loading
  if (currentView === viewName) {
    logger.debug('View already active, skipping', { viewName });
    return;
  }
  
  logger.info('Switching view', { from: currentView, to: viewName });
  currentView = viewName;

  // Hide all views
  const views = ['orders', 'clients', 'lunch', 'catalog'];
  views.forEach(view => {
    const viewElement = document.getElementById(`${view}-view`);
    if (viewElement) {
      viewElement.classList.add('hidden');
    }
  });

  // Show selected view
  const selectedView = document.getElementById(`${viewName}-view`);
  if (selectedView) {
    selectedView.classList.remove('hidden');
    logger.debug('View shown', { viewName });
  } else {
    logger.warn('View element not found', { viewName });
  }

  // Update nav buttons
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.classList.remove('border-red-600', 'text-red-600', 'bg-red-50', 'font-medium');
    btn.classList.add('border-transparent', 'text-gray-600');
  });
  const activeBtn = document.querySelector(`[data-view="${viewName}"]`);
  if (activeBtn) {
    activeBtn.classList.remove('border-transparent', 'text-gray-600');
    activeBtn.classList.add('border-red-600', 'text-red-600', 'bg-red-50', 'font-medium');
  } else {
    logger.warn('Active nav button not found', { viewName });
  }

  // Load data for the view
  if (viewName === 'orders') {
    logger.debug('Loading orders view');
    loadOrders();
    const ordersListView = document.getElementById('orders-list-view');
    if (ordersListView) {
      ordersListView.style.display = 'block';
    }
    const orderDetail = document.getElementById('order-detail');
    if (orderDetail) {
      orderDetail.classList.add('hidden');
    }
    const newOrderForm = document.getElementById('new-order-form');
    if (newOrderForm) {
      newOrderForm.classList.add('hidden');
    }
  } else if (viewName === 'clients') {
    logger.debug('Loading clients view');
    loadClients();
    hideClientForm();
    const clientDetail = document.getElementById('client-detail');
    if (clientDetail) clientDetail.classList.add('hidden');
  } else if (viewName === 'lunch') {
    logger.debug('Loading lunch view');
    const main = document.querySelector('main');
    if (main) main.scrollTop = 0;
    if (typeof loadLunch === 'function') loadLunch();
  } else if (viewName === 'catalog') {
    logger.debug('Loading catalog view');
    if (typeof loadCatalog === 'function') loadCatalog();
  }
  
  logger.debug('View switched successfully', { viewName });
}

// Nav button handlers
document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const view = btn.dataset.view;
    logger.debug('Nav button clicked', { view });
    switchView(view);
  });
});
logger.debug('Nav button handlers attached');

// Modal de prueba de sonido al cargar la app (una interacción para desbloquear el audio)
const soundTestModal = document.getElementById('sound-test-modal');
const soundTestModalBtn = document.getElementById('sound-test-modal-btn');
if (soundTestModalBtn && soundTestModal) {
  soundTestModalBtn.addEventListener('click', () => {
    if (typeof window.activateAndTestOrderSound === 'function') {
      window.activateAndTestOrderSound();
    }
    soundTestModal.classList.add('hidden');
  });
}

// Initialize app using NRD Data Access
nrd.auth.onAuthStateChanged((user) => {
  if (user) {
    logger.info('User authenticated, initializing app', { uid: user.uid, email: user.email });
    // Default to orders view (loadOrders registra el listener; sigue activo en otras pestañas)
    switchView('orders');
    // Mostrar modal de prueba de sonido para generar la interacción que el navegador exige
    setTimeout(() => {
      if (soundTestModal) soundTestModal.classList.remove('hidden');
    }, 400);
  } else {
    logger.debug('User not authenticated, app initialization skipped');
  }
});


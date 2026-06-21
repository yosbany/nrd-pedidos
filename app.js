// Main app controller

const PEDIDOS_VIEWS = ['orders', 'clients', 'lunch', 'catalog'];

let navigationService = null;

function createNavigationService() {
  if (navigationService) {
    return navigationService;
  }

  const NavigationService = window.NRDCommon?.NavigationService;
  if (!NavigationService) {
    logger.error('NavigationService not available in NRDCommon');
    return null;
  }

  navigationService = new NavigationService(PEDIDOS_VIEWS);
  window.navigationService = navigationService;

  navigationService.registerView('orders', () => {
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
  });

  navigationService.registerView('clients', () => {
    logger.debug('Loading clients view');
    loadClients();
    hideClientForm();
    const clientDetail = document.getElementById('client-detail');
    if (clientDetail) clientDetail.classList.add('hidden');
  });

  navigationService.registerView('lunch', () => {
    logger.debug('Loading lunch view');
    const main = document.querySelector('main');
    if (main) main.scrollTop = 0;
    if (typeof loadLunch === 'function') loadLunch();
  });

  navigationService.registerView('catalog', () => {
    logger.debug('Loading catalog view');
    if (typeof loadCatalog === 'function') loadCatalog();
  });

  logger.info('NavigationService created and views registered');
  return navigationService;
}

function switchView(viewName) {
  const nav = navigationService || createNavigationService();
  if (nav) {
    nav.switchView(viewName);
    return;
  }
  logger.error('Cannot switch view: NavigationService unavailable', { viewName });
}

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

(window.NRDCommon?.startApp || function(fn, opts) {
  window.__nrdStartQueue = window.__nrdStartQueue || [];
  window.__nrdStartQueue.push({ onReady: fn, options: opts || {} });
})(function(user) {
  logger.info('User authenticated, initializing app', { uid: user.uid, email: user.email });

  const nav = createNavigationService();
  if (!nav) {
    logger.error('Could not create NavigationService');
    return;
  }

  nav.setupNavButtons();
  nav.switchView('orders');

  setTimeout(function() {
    var modal = document.getElementById('sound-test-modal');
    if (modal) modal.classList.remove('hidden');
  }, 400);
});

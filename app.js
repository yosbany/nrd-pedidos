// Main app controller

const PEDIDOS_VIEWS = ['orders', 'clients', 'lunch', 'catalog', 'web'];

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

  navigationService.registerView('web', () => {
    logger.debug('Loading web view');
    if (typeof loadWeb === 'function') loadWeb();
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

// Botón "Probar sonido" (desbloquea audio del navegador y reproduce una prueba)
const testOrderSoundBtn = document.getElementById('test-order-sound-btn');
if (testOrderSoundBtn) {
  testOrderSoundBtn.addEventListener('click', () => {
    if (typeof window.activateAndTestOrderSound === 'function') {
      window.activateAndTestOrderSound();
    }
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
});

// Order management

const SCHEDULED_TO_PENDING_MS = 30 * 60 * 1000; // 30 min: retiro en local pasa a pendientes cuando faltan ≤30 min
let lastScheduledOrderIds = new Set();
let activatedFromScheduledIds = new Set();
let ordersListener = null;
let ordersTimeIndicatorIntervalId = null;
let previousOrderIds = null; // Set of order IDs from last callback (null = first load, don't ring)
let alreadyPlayedForOrderIds = new Set(); // IDs we already played sound for (evita repetir si el callback dispara varias veces)
let pendingAlarmIntervalId = null; // Interval que repite el sonido mientras haya pedidos pendientes sin aceptar
let currentOrderProducts = [];
let currentOrderClient = null;
let selectedFilterDate = new Date(); // Default to today
let ordersSearchTerm = ''; // Search term for orders
let currentOrderStep = 1; // Wizard step (1, 2, 3, or 4)
let currentOrderDiscount = { type: '', value: 0 }; // Discount for current order: { type: 'fijo' | 'porcentual' | '', value: number }

// Predefined orders templates
const predefinedOrders = {
  'oferta-5': {
    name: 'Oferta para 5 personas',
    items: [
      { productName: 'SANDWICH COPETIN - JAMON Y QUESO', quantity: 16 },
      { productName: 'SANDWICH COPETIN - ATUN Y TOMATE', quantity: 16 },
      { productName: 'SANDWICH COPETIN - POLLO Y JARDINERA', quantity: 16 },
      { productName: 'SANDWICH COPETIN - LOMITO Y MANTECA', quantity: 16 },
      { productName: 'BOCADITOS DE PIZZA', quantity: 10 },
      { productName: 'EMPANADITAS - POLLO', quantity: 10 },
      { productName: 'MEDIALUNITAS - JAMON Y QUESO', quantity: 8 },
      { productName: 'JESUITAS', quantity: 8 }
    ]
  },
  'oferta-10': {
    name: 'Oferta para 10 personas',
    items: [
      { productName: 'SANDWICH COPETIN - JAMON Y CHOCLO', quantity: 32 },
      { productName: 'SANDWICH COPETIN - OLIMPICO', quantity: 32 },
      { productName: 'SANDWICH COPETIN - BONDIOLA Y MANTECA', quantity: 32 },
      { productName: 'SANDWICH COPETIN - JAMON Y PALMITOS', quantity: 32 },
      { productName: 'BOCADITOS DE PIZZA', quantity: 30 },
      { productName: 'EMPANADITAS - CARNE', quantity: 20 },
      { productName: 'MEDIALUNITAS - JAMON Y QUESO', quantity: 20 },
      { productName: 'JESUITAS', quantity: 12 }
      
    ]
  },
  'oferta-15': {
    name: 'Oferta para 15 personas',
    items: [
      { productName: 'SANDWICH COPETIN - JAMON Y QUESO', quantity: 48 },
      { productName: 'SANDWICH COPETIN - ATUN Y TOMATE', quantity: 48 },
      { productName: 'SANDWICH COPETIN - JAMON Y HUEVO', quantity: 48 },
      { productName: 'SANDWICH COPETIN - LOMITO Y MANTECA', quantity: 48 },
      { productName: 'BOCADITOS DE PIZZA', quantity: 30 },
      { productName: 'MEDIALUNITAS - JAMON Y QUESO', quantity: 24 },
      { productName: "PEBETE - JAMON Y QUESO", quantity: 30 },
      { productName: 'JESUITAS', quantity: 24 }
    ]
  }
};

// Format date in 24-hour format
function formatDate24h(date) {
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
}

// Format time in 24-hour format
function formatTime24h(date) {
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

// Tiempo restante hasta la fecha de entrega (para indicador en tarjeta)
function formatTimeRemaining(deliveryTimestamp) {
  if (!deliveryTimestamp) return '';
  const left = deliveryTimestamp - Date.now();
  if (left <= 0) return 'Vencido';
  const min = Math.floor(left / 60000);
  if (min < 60) return 'En ' + min + ' min';
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m > 0 ? 'En ' + h + ' h ' + m + ' min' : 'En ' + h + ' h';
}

/** Formato de fecha/hora del pedido igual que en nrd-catalogo: "hoy HH:MM" si es hoy, sino "día mes año HH:MM". */
function formatOrderDateLikeCatalog(ts) {
  if (!ts || isNaN(ts)) return '';
  const d = new Date(ts);
  const today = new Date();
  const sameDay = d.getDate() === today.getDate() && d.getMonth() === today.getMonth() && d.getFullYear() === today.getFullYear();
  if (sameDay) {
    return 'hoy ' + d.toLocaleTimeString('es-UY', { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString('es-UY', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** Indicador de tiempo con el mismo criterio que nrd-catalogo: con entrega = restante "X min" o vencido "-X min"; sin entrega = transcurrido "X min". */
function getTimeIndicatorLikeCatalog(createdAt, deliveryDate, status) {
  const now = Date.now();
  const created = createdAt ? Number(createdAt) : now;
  const delivery = deliveryDate ? Number(deliveryDate) : 0;
  const hasDelivery = delivery && !isNaN(delivery) && (status === 'Aceptado' || status === 'Completado');
  if (hasDelivery) {
    if (now < delivery) {
      const remainingMin = Math.ceil((delivery - now) / 60000);
      return remainingMin + ' min';
    }
    const overdueMin = Math.floor((now - delivery) / 60000);
    return '-' + overdueMin + ' min';
  }
  const elapsedMin = Math.floor((now - created) / 60000);
  return elapsedMin + ' min';
}

/** Construye el HTML de la línea de tiempo de la tarjeta (fecha + punto + indicador). Si showPulse es true (pedido no completado ni rechazado), el punto lleva animate-pulse. */
function buildOrderTimeLineHtml(createdAt, deliveryDate, status, showPulse) {
  const orderDateStr = formatOrderDateLikeCatalog(createdAt);
  const timeIndicatorStr = getTimeIndicatorLikeCatalog(createdAt, deliveryDate, status);
  const isOverdue = timeIndicatorStr.startsWith('-');
  const dotClass = (isOverdue ? 'bg-red-500' : 'bg-blue-500') + (showPulse ? ' animate-pulse' : '');
  const timeLineStr = orderDateStr ? (orderDateStr + ' <span class="inline-block w-1.5 h-1.5 rounded-full ' + dotClass + ' align-middle mx-0.5" aria-hidden="true"></span> ' + escapeHtml(timeIndicatorStr)) : escapeHtml(timeIndicatorStr);
  const timeLineClass = isOverdue ? 'text-red-600' : 'text-gray-600';
  return { html: timeLineStr, timeLineClass };
}

/** True si el pedido es retiro en local y falta más de 30 min para la hora de retiro (va en sección Programados). */
function isOrderScheduled(order) {
  const status = order.status || 'Pendiente';
  if (status === 'Completado' || status === 'Rechazado') return false;
  if ((order.deliveryType || 'envio') !== 'retiro') return false;
  const delivery = order.deliveryDate ? Number(order.deliveryDate) : 0;
  if (!delivery || isNaN(delivery)) return false;
  return (delivery - Date.now()) > SCHEDULED_TO_PENDING_MS;
}

/** Convierte el ID del pedido en un código corto legible de 6 caracteres (igual que en nrd-catalogo). */
function orderIdToShortCode(id) {
  if (!id || typeof id !== 'string') return '';
  const base = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = ((h << 5) - h) + id.charCodeAt(i);
    h = h | 0;
  }
  h = Math.abs(h);
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += base[h % base.length];
    h = Math.floor(h / base.length);
  }
  return code;
}

// AudioContext compartido; los navegadores solo permiten reproducir audio tras un gesto del usuario (clic, toque, tecla).
let orderSoundContext = null;

function unlockOrderSound() {
  if (orderSoundContext != null) return;
  try {
    orderSoundContext = new (window.AudioContext || window.webkitAudioContext)();
    orderSoundContext.resume();
    logger.debug('Order sound unlocked');
  } catch (e) {
    logger.warn('Could not unlock order sound', e);
  }
}

// Registrar desbloqueo en la primera interacción (click, toque o tecla) para que el sonido funcione al llegar un pedido.
function setupOrderSoundUnlock() {
  const unlock = () => {
    unlockOrderSound();
    document.removeEventListener('click', unlock);
    document.removeEventListener('touchstart', unlock);
    document.removeEventListener('keydown', unlock);
  };
  document.addEventListener('click', unlock, { once: true });
  document.addEventListener('touchstart', unlock, { once: true });
  document.addEventListener('keydown', unlock, { once: true });
}

// Fallback: Audio HTML con data URI (beep corto). Se priman en el clic del usuario y se reutiliza al llegar un pedido.
let orderSoundAudioEl = null;

/** Arpegio alegre (C6-E6-G6-C7) como WAV, bien alto. Misma melodía de antes, ~0,9 s. */
function getOrderBeepDataUri() {
  const sampleRate = 44100;
  const duration = 0.9;
  const numSamples = Math.round(sampleRate * duration);
  const data = new Float32Array(numSamples);
  data.fill(0);
  const beat = 0.2;
  const len = 0.16;
  const freqs = [1047, 1319, 1568, 2093];
  const starts = [0, beat, beat * 2, beat * 3];
  const lens = [len, len, len, len * 1.2];
  const gain = 0.55;
  for (let n = 0; n < freqs.length; n++) {
    const f = freqs[n];
    const startS = Math.round(starts[n] * sampleRate);
    const endS = Math.min(numSamples, startS + Math.round(lens[n] * sampleRate));
    for (let i = startS; i < endS; i++) {
      const t = (i - startS) / sampleRate;
      const env = t < 0.02 ? t / 0.02 : Math.exp(-t * 8);
      data[i] += gain * Math.sin(2 * Math.PI * f * t) * env;
    }
  }
  const dataLen = numSamples * 2;
  const arr = new Uint8Array(44 + dataLen);
  const view = new DataView(arr.buffer);
  const writeStr = (off, s) => { for (let i = 0; i < s.length; i++) arr[off + i] = s.charCodeAt(i); };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataLen, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, dataLen, true);
  for (let i = 0; i < numSamples; i++) {
    const s = Math.max(-1, Math.min(1, data[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }
  let b64 = '';
  const chunk = 8192;
  for (let i = 0; i < arr.length; i += chunk) {
    b64 += String.fromCharCode.apply(null, arr.subarray(i, i + chunk));
  }
  return 'data:audio/wav;base64,' + btoa(b64);
}

var ORDER_BEEP_DATA_URI = null;
function getOrderBeepUri() {
  if (!ORDER_BEEP_DATA_URI) ORDER_BEEP_DATA_URI = getOrderBeepDataUri();
  return ORDER_BEEP_DATA_URI;
}

/** Activa el audio y reproduce el sonido de prueba (para el modal de prueba de sonido al cargar la app). */
window.activateAndTestOrderSound = function () {
  unlockOrderSound();
  primeOrderSoundAudio();
  playNewOrderSound();
};

/** Crea el elemento Audio con el beep y lo reproduce una vez (en gesto del usuario) para poder reutilizarlo. */
function primeOrderSoundAudio() {
  if (orderSoundAudioEl) return;
  try {
    orderSoundAudioEl = new Audio(getOrderBeepUri());
    orderSoundAudioEl.volume = 1;
    orderSoundAudioEl.play().then(() => {}).catch(function (e) {
      (window.logger || console).warn('Order sound prime play failed', e);
    });
    (window.logger || console).info('Order sound audio primed (click to enable)');
  } catch (e) {
    (window.logger || console).warn('Could not prime order sound audio', e);
  }
}

// Melodía corta cuando hay pedidos pendientes (arpegio ascendente suave)
function playNewOrderSound() {
  const log = window.logger || console;
  if (orderSoundAudioEl) {
    try {
      orderSoundAudioEl.volume = 1;
      orderSoundAudioEl.currentTime = 0;
      orderSoundAudioEl.play().then(function () {
        log.debug('New order sound played (audio element)');
      }).catch(function (e) {
        log.warn('New order sound (audio element) play failed', e);
      });
    } catch (e) {
      log.warn('New order sound (audio element) error', e);
    }
  }
  try {
    const ctx = orderSoundContext || new (window.AudioContext || window.webkitAudioContext)();
    if (!orderSoundContext) orderSoundContext = ctx;

    const run = () => {
      try {
        if (ctx.state === 'closed') return;
        const note = (freq, start, duration) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.frequency.value = freq;
          osc.type = 'sine';
          gain.gain.setValueAtTime(0, start);
          gain.gain.linearRampToValueAtTime(0.5, start + 0.02);
          gain.gain.exponentialRampToValueAtTime(0.01, start + duration);
          osc.start(start);
          osc.stop(start + duration);
        };
        const beat = 0.2;
        const len = 0.16;
        note(1047, 0, len);
        note(1319, beat, len);
        note(1568, beat * 2, len);
        note(2093, beat * 3, len * 1.2);
        log.debug('New order sound played (Web Audio)');
      } catch (err) {
        log.warn('New order sound run failed', err);
      }
    };

    ctx.resume().then(run).catch((e) => log.warn('New order sound resume failed', e));
  } catch (e) {
    (window.logger || console).warn('Could not play new order sound', e);
  }
}

let orderSoundUnlockSetup = false;
let hasScheduledOrdersInList = false;

// Load orders
function loadOrders() {
  if (!orderSoundUnlockSetup) {
    setupOrderSoundUnlock();
    orderSoundUnlockSetup = true;
  }
  logger.debug('Loading orders');
  let ordersListPending = document.getElementById('orders-list-pending');
  let ordersListCompleted = document.getElementById('orders-list-completed');
  let ordersListScheduled = document.getElementById('orders-list-scheduled');
  let useSingleList = false;
  if (!ordersListPending || !ordersListCompleted) {
    const singleList = document.getElementById('orders-list');
    if (singleList) {
      ordersListPending = singleList;
      ordersListCompleted = singleList;
      ordersListScheduled = null;
      useSingleList = true;
      logger.debug('Using single orders-list (fallback for cached HTML)');
    } else {
      logger.warn('Orders list elements not found');
      return;
    }
  } else {
    ordersListPending.innerHTML = '';
    ordersListCompleted.innerHTML = '';
    if (ordersListScheduled) ordersListScheduled.innerHTML = '';
  }

  // Remove previous listener and time indicator interval
  if (ordersTimeIndicatorIntervalId) {
    clearInterval(ordersTimeIndicatorIntervalId);
    ordersTimeIndicatorIntervalId = null;
  }
  if (ordersListener) {
    logger.debug('Removing previous orders listener');
    ordersListener(); // Unsubscribe from NRD Data Access listener
    ordersListener = null;
  }

  // Listen for orders using NRD Data Access
  logger.debug('Setting up orders listener');
  ordersListener = nrd.orders.onValue(async (orders) => {
    logger.debug('Orders data received', { count: Array.isArray(orders) ? orders.length : Object.keys(orders || {}).length });
    if (!ordersListPending || !ordersListCompleted) return;
    if (!useSingleList) {
      ordersListPending.innerHTML = '';
      ordersListCompleted.innerHTML = '';
      if (ordersListScheduled) ordersListScheduled.innerHTML = '';
    }
    
    // Convert to object format if needed (NRD Data Access may return object with IDs as keys or array)
    const ordersDict = Array.isArray(orders) 
      ? orders.reduce((acc, order) => {
          if (order && order.id) {
            acc[order.id] = order;
          }
          return acc;
        }, {})
      : orders || {};

    if (Object.keys(ordersDict).length === 0) {
      previousOrderIds = new Set();
      if (pendingAlarmIntervalId) {
        clearInterval(pendingAlarmIntervalId);
        pendingAlarmIntervalId = null;
      }
      const emptyMsg = '<p class="text-center text-gray-600 py-6 sm:py-8 text-sm sm:text-base">No hay pedidos registrados</p>';
      if (useSingleList) {
        ordersListPending.innerHTML = emptyMsg;
      } else {
        ordersListPending.innerHTML = emptyMsg;
        ordersListCompleted.innerHTML = '';
      }
      return;
    }

    const currentOrderIds = new Set(Object.keys(ordersDict));
    const notYetPlayed = previousOrderIds !== null
      ? [...currentOrderIds].filter((id) => !previousOrderIds.has(id) && !alreadyPlayedForOrderIds.has(id))
      : [];

    const pendingCount = Object.values(ordersDict).filter((o) => (o.status || 'Pendiente') === 'Pendiente').length;
    if (pendingCount > 0) {
      if (!pendingAlarmIntervalId) {
        setTimeout(() => playNewOrderSound(), 0);
        pendingAlarmIntervalId = setInterval(() => playNewOrderSound(), 2500);
        logger.debug('Pending orders alarm started', { pendingCount });
      }
    } else {
      if (pendingAlarmIntervalId) {
        clearInterval(pendingAlarmIntervalId);
        pendingAlarmIntervalId = null;
        logger.debug('Pending orders alarm stopped');
      }
    }

    if (notYetPlayed.length > 0) {
      setTimeout(() => playNewOrderSound(), 0);
      notYetPlayed.forEach((id) => alreadyPlayedForOrderIds.add(id));
    }
    previousOrderIds = currentOrderIds;

    // Sort by creation date (newest first)
    const sortedOrders = Object.entries(ordersDict).sort((a, b) => {
      const dateA = a[1].createdAt || 0;
      const dateB = b[1].createdAt || 0;
      return dateB - dateA;
    });

    // Filter orders by date if filter is active
    let ordersToShow = sortedOrders;
    if (selectedFilterDate) {
      const filterDateStart = new Date(selectedFilterDate.getFullYear(), selectedFilterDate.getMonth(), selectedFilterDate.getDate(), 0, 0, 0, 0).getTime();
      const filterDateEnd = new Date(selectedFilterDate.getFullYear(), selectedFilterDate.getMonth(), selectedFilterDate.getDate(), 23, 59, 59, 999).getTime();
      
      ordersToShow = sortedOrders.filter(([id, order]) => {
        if (!order.deliveryDate) return false;
        const deliveryDate = order.deliveryDate;
        return deliveryDate >= filterDateStart && deliveryDate <= filterDateEnd;
      });
    }
    
    sortedOrders.forEach(([id, order]) => {
      // Check if delivery date has passed and update status automatically
      const currentStatus = order.status || 'Pendiente';
      if (currentStatus === 'Pendiente' && order.deliveryDate) {
        const deliveryDate = new Date(order.deliveryDate);
        const now = new Date();
        if (deliveryDate < now) {
          // Update status to Completado (async, don't wait)
          logger.debug('Auto-updating order status to Completado', { orderId: id });
          nrd.orders.update(id, { status: 'Completado' }).catch(error => {
            logger.error('Error updating order status', error);
          });
          order.status = 'Completado';
        }
      }
    });
    
    // Load all clients to get names using NRD Data Access
    (async () => {
      try {
        const clientsArray = await nrd.clients.getAll();
        const clients = Array.isArray(clientsArray) 
          ? clientsArray.reduce((acc, client) => {
              if (client && client.id) {
                acc[client.id] = client;
              }
              return acc;
            }, {})
          : clientsArray || {};
        const clientsMap = {};
        Object.entries(clients).forEach(([id, client]) => {
          clientsMap[id] = client;
        });
      
      // Filter by search term if active (after loading clients)
      let filteredOrders = ordersToShow;
      if (ordersSearchTerm.trim()) {
        const normalizedTerm = (window.normalizeSearchText || window.NRDCommon?.normalizeSearchText || ((t) => t.toLowerCase()))(ordersSearchTerm.trim());
        filteredOrders = ordersToShow.filter(([id, order]) => {
          // Search in client name, products, delivery date
          const client = order.clientId ? clientsMap[order.clientId] : null;
          const clientName = (window.normalizeSearchText || window.NRDCommon?.normalizeSearchText || ((t) => t.toLowerCase()))(client ? client.name : '');
          const deliveryDate = order.deliveryDate ? new Date(order.deliveryDate) : null;
          const deliveryDateStr = deliveryDate ? (window.normalizeSearchText || window.NRDCommon?.normalizeSearchText || ((t) => t.toLowerCase()))(`${formatDate24h(deliveryDate)} ${formatTime24h(deliveryDate)}`) : '';
          const productsStr = order.items ? order.items.map(item => (window.normalizeSearchText || window.NRDCommon?.normalizeSearchText || ((t) => t.toLowerCase()))(item.productName || '')).join(' ') : '';
          const notesStr = (window.normalizeSearchText || window.NRDCommon?.normalizeSearchText || ((t) => t.toLowerCase()))(order.notes || '');
          
          return clientName.includes(normalizedTerm) || 
                 productsStr.includes(normalizedTerm) || 
                 deliveryDateStr.includes(normalizedTerm) ||
                 notesStr.includes(normalizedTerm);
        });
      }
      
      // Split: completados, programados (retiro >30 min), pendientes (resto no completados)
      const completedOrders = filteredOrders.filter(([, order]) => (order.status || 'Pendiente') === 'Completado');
      const scheduledOrders = filteredOrders.filter(([, order]) => isOrderScheduled(order));
      let pendingOrders = filteredOrders.filter(([, order]) => {
        const status = order.status || 'Pendiente';
        if (status === 'Completado') return false;
        if (isOrderScheduled(order)) return false;
        return true;
      });
      // Si no hay sección de programados, mostrar esos pedidos en pendientes
      const hasScheduledSection = useSingleList || ordersListScheduled;
      if (!hasScheduledSection && scheduledOrders.length > 0) {
        pendingOrders = [...pendingOrders, ...scheduledOrders];
      }

      // Sonido cuando un pedido programado pasa a pendientes (faltan ≤30 min para retiro)
      const currentScheduledIds = new Set(scheduledOrders.map(([id]) => id));
      pendingOrders.forEach(([id]) => {
        if (lastScheduledOrderIds.has(id) && !currentScheduledIds.has(id) && !activatedFromScheduledIds.has(id)) {
          activatedFromScheduledIds.add(id);
          playNewOrderSound();
        }
      });
      lastScheduledOrderIds = currentScheduledIds;

      if (filteredOrders.length === 0) {
        const noSearchMsg = '<p class="text-center text-gray-600 py-6 sm:py-8 text-sm sm:text-base">No hay pedidos que coincidan con la búsqueda</p>';
        if (useSingleList) {
          ordersListPending.innerHTML = noSearchMsg;
        } else {
          ordersListPending.innerHTML = noSearchMsg;
          ordersListCompleted.innerHTML = '';
        }
        return;
      }
      
      const emptyPendingMsg = '<div class="text-center py-8 px-4 border border-green-200 bg-green-50"><p class="text-green-800 font-semibold text-lg mb-1">No hay pedidos pendientes</p><p class="text-green-700 text-sm">Todo al día</p></div>';
      const emptyScheduledMsg = '<p class="text-center text-gray-500 py-4 text-sm">No hay pedidos programados</p>';
      const emptyCompletedMsg = '<p class="text-center text-gray-500 py-4 text-sm">No hay pedidos completados</p>';

      let targetPending;
      let targetScheduled;
      let targetCompleted;
      if (useSingleList) {
        ordersListPending.innerHTML = '';
        const wrapPending = document.createElement('div');
        wrapPending.className = 'mb-6';
        wrapPending.innerHTML = '<h2 class="text-sm font-semibold uppercase tracking-wider text-gray-600 mb-2">Pedidos pendientes</h2><div class="space-y-2 sm:space-y-3 orders-single-pending"></div>';
        targetPending = wrapPending.querySelector('.orders-single-pending');
        const wrapScheduled = document.createElement('div');
        wrapScheduled.className = 'mb-6';
        wrapScheduled.innerHTML = '<h2 class="text-sm font-semibold uppercase tracking-wider text-gray-600 mb-2">Pedidos programados</h2><div class="space-y-2 sm:space-y-3 orders-single-scheduled"></div>';
        targetScheduled = wrapScheduled.querySelector('.orders-single-scheduled');
        const wrapCompleted = document.createElement('div');
        wrapCompleted.innerHTML = '<h2 class="text-sm font-semibold uppercase tracking-wider text-gray-600 mb-2">Pedidos completados</h2><div class="space-y-2 sm:space-y-3 orders-single-completed"></div>';
        targetCompleted = wrapCompleted.querySelector('.orders-single-completed');
        hasScheduledOrdersInList = scheduledOrders.length > 0;
        if (pendingOrders.length === 0) targetPending.innerHTML = emptyPendingMsg;
        if (scheduledOrders.length === 0) targetScheduled.innerHTML = emptyScheduledMsg;
        if (completedOrders.length === 0) targetCompleted.innerHTML = emptyCompletedMsg;
        ordersListPending.appendChild(wrapPending);
        if (hasScheduledOrdersInList) {
          ordersListPending.appendChild(wrapScheduled);
        }
        ordersListPending.appendChild(wrapCompleted);
      } else {
        if (pendingOrders.length === 0) {
          ordersListPending.innerHTML = emptyPendingMsg;
        } else {
          ordersListPending.innerHTML = '';
        }
        if (ordersListScheduled) {
          hasScheduledOrdersInList = scheduledOrders.length > 0;
          const ordersSectionScheduled = document.getElementById('orders-section-scheduled');
          if (!hasScheduledOrdersInList) {
            if (ordersSectionScheduled) ordersSectionScheduled.style.setProperty('display', 'none', 'important');
          } else {
            if (ordersSectionScheduled) ordersSectionScheduled.style.removeProperty('display');
            ordersListScheduled.innerHTML = '';
          }
        }
        if (completedOrders.length === 0) {
          ordersListCompleted.innerHTML = emptyCompletedMsg;
        } else {
          ordersListCompleted.innerHTML = '';
        }
        targetPending = ordersListPending;
        targetScheduled = ordersListScheduled;
        targetCompleted = ordersListCompleted;
      }
      
      function renderOrderCard([id, order], targetList) {
        const item = document.createElement('div');
        item.className = 'border border-gray-200 px-3 py-2 sm:px-3 sm:py-2 md:px-4 md:py-2.5 hover:border-red-600 transition-colors relative';
        item.dataset.orderId = id;
        const date = new Date(order.createdAt);
        const deliveryDate = order.deliveryDate ? new Date(order.deliveryDate) : null;
        const status = order.status || 'Pendiente';
        const statusColor = status === 'Completado' ? 'text-green-600' : status === 'Aceptado' ? 'text-blue-600' : 'text-red-600';
        
        // Get client name from reference
        const client = order.clientId ? clientsMap[order.clientId] : null;
        const clientName = client ? client.name : 'Cliente desconocido';
        
        // Format delivery date
        let deliveryDateStr = 'No especificada';
        if (deliveryDate) {
          deliveryDateStr = `${formatDate24h(deliveryDate)} ${formatTime24h(deliveryDate)}`;
        }
        
        // Format creation date
        const creationDateStr = `${formatDate24h(date)} ${formatTime24h(date)}`;
        
        // Build tooltip content
        const productsList = order.items && order.items.length > 0 
          ? order.items.map(item => `• ${item.quantity} ${escapeHtml(item.productName)}`).join('<br>')
          : 'No hay productos';
        
        const tooltipContent = `
          <div class="order-tooltip-content tooltip-top bg-white border border-gray-300 rounded-lg shadow-lg p-3 sm:p-4 max-w-xs z-50 pointer-events-none">
            <div class="text-xs sm:text-sm space-y-1.5 sm:space-y-2">
              <div class="font-medium text-gray-900 border-b border-gray-200 pb-1.5 mb-2">${escapeHtml(clientName)}</div>
              <div><span class="text-gray-600">Fecha creación:</span> <span class="font-light">${creationDateStr}</span></div>
              <div><span class="text-gray-600">Fecha entrega:</span> <span class="font-light">${deliveryDateStr}</span></div>
              <div><span class="text-gray-600">Estado:</span> <span class="${statusColor} font-medium">${escapeHtml(status)}</span></div>
              <div class="pt-1 border-t border-gray-200 mt-2">
                <div class="text-gray-600 mb-1">Productos:</div>
                <div class="text-xs font-light text-gray-700">${productsList}</div>
              </div>
              ${order.notes ? `<div class="pt-1 border-t border-gray-200 mt-2"><span class="text-gray-600">Observaciones:</span> <div class="text-xs font-light text-gray-700 mt-0.5">${escapeHtml(stripNotesHtml(order.notes))}</div></div>` : ''}
              <div class="pt-1 border-t border-gray-200 mt-2 font-medium text-gray-900">Total: $${parseFloat(order.total || 0).toFixed(2)}</div>
            </div>
          </div>
        `;
        
        const isPending = status === 'Pendiente';
        const isAccepted = status === 'Aceptado';
        const isScheduled = targetList === targetScheduled;
        const canComplete = isAccepted && !isScheduled;
        const showTimeIndicator = status !== 'Completado' && status !== 'Rechazado';
        const showTimerPulse = !isScheduled && showTimeIndicator;
        const timeLine = showTimeIndicator ? buildOrderTimeLineHtml(order.createdAt, order.deliveryDate, status, showTimerPulse) : null;
        const timeLineDisplay = !showTimeIndicator ? '' : (isScheduled
          ? '<div class="order-card-scheduled-time text-gray-600 text-xs font-medium mt-0.5">Programado para ' + escapeHtml(deliveryDateStr) + '</div>'
          : '<div class="order-card-time-indicator ' + timeLine.timeLineClass + ' text-xs font-medium mt-0.5">' + timeLine.html + '</div>');
        const iconPrint = '<svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>';
        const iconReject = '<svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
        const iconComplete = '<svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>';
        const orderCode = orderIdToShortCode(id);
        item.innerHTML = `
          <div class="order-tooltip-container">
            ${tooltipContent}
          </div>
          <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-0.5 sm:gap-0 mb-1 sm:mb-1.5">
            <div class="text-sm sm:text-base leading-tight">${orderCode ? `<span class="font-bold text-gray-900">#${escapeHtml(orderCode)}</span> ` : ''}<span class="font-light">${escapeHtml(clientName)}</span></div>
            <div class="hidden sm:block text-sm sm:text-base font-light text-red-600 leading-tight">$${parseFloat(order.total || 0).toFixed(2)}</div>
          </div>
          <div class="text-xs sm:text-sm text-gray-600 space-y-0.5 leading-tight">
            <div>Fecha entrega: ${deliveryDateStr}</div>
            <div>
              <span class="inline-block px-1.5 py-0.5 ${status === 'Completado' ? 'bg-green-600' : status === 'Aceptado' ? 'bg-blue-600' : status === 'Rechazado' ? 'bg-gray-500' : 'bg-red-600'} text-white text-xs font-medium uppercase rounded leading-none">
                ${status === 'Completado' ? 'COMPLETADO' : status === 'Aceptado' ? 'ACEPTADO' : status === 'Rechazado' ? 'RECHAZADO' : 'PENDIENTE'}
              </span>
            </div>
            ${isPending ? `<div class="text-amber-600 text-xs font-medium mt-0.5">Esperando aceptar</div>` : ''}
            ${timeLineDisplay ? timeLineDisplay : ''}
            <div>Productos: ${order.items ? order.items.length : 0}</div>
            <div class="sm:hidden text-sm font-light text-red-600">$${parseFloat(order.total || 0).toFixed(2)}</div>
          </div>
          ${isPending ? `
          <div class="mt-3 pt-3 border-t border-gray-100 flex flex-wrap gap-2 items-center justify-end">
            <button type="button" class="order-card-accept-btn order-card-accept-btn-blink inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-white bg-green-600 border border-green-700 rounded hover:bg-green-700 transition-colors uppercase tracking-wider font-medium z-10" data-order-id="${id}" title="Aceptar pedido">
              Aceptar
            </button>
          </div>
          ` : ''}
          ${isAccepted ? `
          <div class="mt-3 pt-3 border-t border-gray-100 flex flex-wrap gap-2 items-center justify-between">
            <div class="order-card-more-options-wrap relative inline-block" data-order-id="${id}">
              <button type="button" class="order-card-more-options-btn inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-gray-600 border border-gray-300 rounded hover:bg-gray-50 hover:border-gray-400 transition-colors" title="Otras opciones">
                <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg>
                <span>Otras opciones</span>
              </button>
              <div class="order-card-more-options-dropdown absolute left-0 py-1 min-w-[12rem] bg-white border border-gray-200 rounded shadow-lg z-[100] hidden">
                <button type="button" class="order-card-option-reject w-full text-left px-3 py-2 text-xs text-red-600 hover:bg-red-50 flex items-center gap-2 whitespace-nowrap" data-order-id="${id}">${iconReject}<span>Rechazar</span></button>
                <button type="button" class="order-card-option-print w-full text-left px-3 py-2 text-xs text-gray-700 hover:bg-gray-50 flex items-center gap-2 whitespace-nowrap" data-order-id="${id}">${iconPrint}<span>Imprimir</span></button>
                <button type="button" class="order-card-option-whatsapp-cadete w-full text-left px-3 py-2 text-xs text-gray-700 hover:bg-gray-50 flex items-center gap-2 whitespace-nowrap" data-order-id="${id}"><span class="text-green-600">📱</span><span>Enviar por WhatsApp al cadete</span></button>
                <button type="button" class="order-card-option-whatsapp-cliente w-full text-left px-3 py-2 text-xs text-gray-700 hover:bg-gray-50 flex items-center gap-2 whitespace-nowrap" data-order-id="${id}"><span class="text-green-600">📱</span><span>Contactar por WhatsApp al cliente</span></button>
              </div>
            </div>
            ${canComplete ? `<button type="button" class="order-card-complete-btn inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-green-700 border border-green-400 rounded bg-green-50 hover:bg-green-100 hover:border-green-500 transition-colors" data-order-id="${id}" title="Completar">${iconComplete}<span>Completar</span></button>` : isScheduled ? `<span class="text-xs text-gray-500 italic">Completar cuando pase a pendientes</span>` : ''}
          </div>
          ` : ''}
        `;
        
        // Tooltip functionality with smart positioning
        const tooltip = item.querySelector('.order-tooltip-content');
        
        if (tooltip) {
          item.addEventListener('mouseenter', () => {
            // Calculate position
            const rect = item.getBoundingClientRect();
            const spaceAbove = rect.top;
            const spaceBelow = window.innerHeight - rect.bottom;
            
            // Conservative threshold: if less than 350px above, show below
            // This accounts for tooltip height (~250-300px) + margin
            const minSpaceRequired = 350;
            
            // Remove previous position classes
            tooltip.classList.remove('tooltip-top', 'tooltip-bottom');
            
            // More sensitive detection: if space above is insufficient, show below
            if (spaceAbove < minSpaceRequired) {
              // Check if there's more space below than above
              if (spaceBelow > spaceAbove) {
                tooltip.classList.add('tooltip-bottom');
              } else {
                // Even if not ideal, prefer above if space below is also limited
                tooltip.classList.add('tooltip-top');
              }
            } else {
              // Enough space above
              tooltip.classList.add('tooltip-top');
            }
          });
        }
        
        const acceptBtn = item.querySelector('.order-card-accept-btn');
        const completeBtn = item.querySelector('.order-card-complete-btn');
        const moreWrap = item.querySelector('.order-card-more-options-wrap');
        const moreBtn = item.querySelector('.order-card-more-options-btn');
        const moreDropdown = item.querySelector('.order-card-more-options-dropdown');
        if (acceptBtn) acceptBtn.addEventListener('click', (e) => { e.stopPropagation(); setOrderStatusToAccepted(id); });
        if (completeBtn) completeBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleOrderStatus(id, status); });

        if (moreWrap && moreBtn && moreDropdown) {
          let closeTimeout = null;
          function scheduleClose() {
            if (closeTimeout) clearTimeout(closeTimeout);
            closeTimeout = setTimeout(() => { moreDropdown.classList.add('hidden'); closeTimeout = null; }, 200);
          }
          function cancelClose() {
            if (closeTimeout) clearTimeout(closeTimeout);
            closeTimeout = null;
          }
          moreBtn.addEventListener('mouseenter', () => {
            cancelClose();
            const rect = moreWrap.getBoundingClientRect();
            const spaceBelow = window.innerHeight - rect.bottom;
            const spaceAbove = rect.top;
            const dropdownHeight = 180;
            if (spaceBelow < dropdownHeight && spaceAbove >= spaceBelow) {
              moreDropdown.style.top = '';
              moreDropdown.style.marginTop = '';
              moreDropdown.style.bottom = '100%';
              moreDropdown.style.marginBottom = '2px';
            } else {
              moreDropdown.style.bottom = '';
              moreDropdown.style.marginBottom = '';
              moreDropdown.style.top = '100%';
              moreDropdown.style.marginTop = '2px';
            }
            moreDropdown.classList.remove('hidden');
          });
          moreWrap.addEventListener('mouseleave', () => scheduleClose());
          moreDropdown.addEventListener('mouseenter', () => cancelClose());
          moreDropdown.addEventListener('mouseleave', () => scheduleClose());
          moreDropdown.querySelectorAll('.order-card-option-reject').forEach((btn) => {
            if (btn.dataset.orderId === id) btn.addEventListener('click', (e) => { e.stopPropagation(); e.preventDefault(); moreDropdown.classList.add('hidden'); setOrderStatusToRejected(id); });
          });
          moreDropdown.querySelectorAll('.order-card-option-print').forEach((btn) => {
            if (btn.dataset.orderId === id) btn.addEventListener('click', (e) => { e.stopPropagation(); e.preventDefault(); moreDropdown.classList.add('hidden'); openOrderAndPrint(id); });
          });
          moreDropdown.querySelectorAll('.order-card-option-whatsapp-cadete').forEach((btn) => {
            if (btn.dataset.orderId === id) btn.addEventListener('click', (e) => { e.stopPropagation(); e.preventDefault(); moreDropdown.classList.add('hidden'); openWhatsAppOrderForCadete(id); });
          });
          moreDropdown.querySelectorAll('.order-card-option-whatsapp-cliente').forEach((btn) => {
            if (btn.dataset.orderId === id) btn.addEventListener('click', (e) => { e.stopPropagation(); e.preventDefault(); moreDropdown.classList.add('hidden'); openWhatsAppContactClient(id); });
          });
        }

        // Make the card clickable (except for the action buttons)
        item.addEventListener('click', (e) => {
          if (!e.target.closest('.order-card-accept-btn') && !e.target.closest('.order-card-complete-btn') && !e.target.closest('.order-card-more-options-wrap')) {
            viewOrder(id);
          }
        });

        item.classList.add('order-card');
        item.dataset.orderId = id;
        item.dataset.createdAt = String(order.createdAt || '');
        item.dataset.deliveryDate = String(order.deliveryDate || '');
        item.dataset.status = status;
        item.dataset.deliveryType = String(order.deliveryType || 'envio');
        targetList.appendChild(item);
      }

      function updateOrderCardsTimeIndicators() {
        document.querySelectorAll('.order-card').forEach((card) => {
          const status = card.dataset.status || 'Pendiente';
          if (status === 'Completado' || status === 'Rechazado') return;
          const createdAt = card.dataset.createdAt ? Number(card.dataset.createdAt) : 0;
          const deliveryDate = card.dataset.deliveryDate ? Number(card.dataset.deliveryDate) : 0;
          const showTimerPulse = true;
          const timeLine = buildOrderTimeLineHtml(createdAt, deliveryDate, status, showTimerPulse);
          const el = card.querySelector('.order-card-time-indicator');
          if (el) {
            el.className = 'order-card-time-indicator ' + timeLine.timeLineClass + ' text-xs font-medium mt-0.5';
            el.innerHTML = timeLine.html;
          }
        });
      }

      pendingOrders.forEach(entry => renderOrderCard(entry, targetPending));
      if (targetScheduled) scheduledOrders.forEach(entry => renderOrderCard(entry, targetScheduled));
      completedOrders.forEach(entry => renderOrderCard(entry, targetCompleted));

      if (ordersTimeIndicatorIntervalId) clearInterval(ordersTimeIndicatorIntervalId);
      ordersTimeIndicatorIntervalId = setInterval(updateOrderCardsTimeIndicators, 60000);
      } catch (error) {
        logger.error('Error loading clients for orders', error);
      }
    })();
  });
}

// Show new order form
async function showNewOrderForm() {
  const form = document.getElementById('new-order-form');
  const listView = document.getElementById('orders-list-view');
  if (!form) {
    (window.showError || window.alert)('No se pudo cargar el formulario de pedido. Recargue la página.');
    return;
  }
  // Mostrar formulario y ocultar lista/filtros (forzado con !important por si hay CSS que lo impida)
  form.classList.remove('hidden');
  function hideEl(el) {
    if (el) el.style.setProperty('display', 'none', 'important');
  }
  hideEl(listView);
  hideEl(document.getElementById('orders-search-container'));
  hideEl(document.getElementById('date-filter-container'));
  hideEl(document.getElementById('orders-list-container'));
  hideEl(document.querySelector('#orders-view > .flex.flex-col'));
  // Ocultar también las secciones de listas por si están fuera del contenedor
  hideEl(document.getElementById('orders-section-pending'));
  hideEl(document.getElementById('orders-section-scheduled'));
  hideEl(document.getElementById('orders-section-completed'));
  
  // Clear editing state
  delete form.dataset.editingOrderId;
  
  // Reset form title
  const formTitle = document.getElementById('order-form-title');
  if (formTitle) {
    formTitle.textContent = 'Nuevo Pedido';
    const orderFormSubtitle = document.getElementById('order-form-subtitle');
    if (orderFormSubtitle) orderFormSubtitle.textContent = 'Cree un nuevo pedido seleccionando cliente y productos';
    // Cambiar color del header a verde para nuevo
    const orderFormHeader = document.getElementById('order-form-header');
    if (orderFormHeader) {
      orderFormHeader.classList.remove('bg-blue-600', 'bg-gray-600');
      orderFormHeader.classList.add('bg-green-600');
    }
    // Cambiar color del botón finalizar a verde
    const saveOrderBtn = document.getElementById('save-order-btn');
    if (saveOrderBtn) {
      saveOrderBtn.classList.remove('bg-blue-600', 'border-blue-600', 'hover:bg-blue-700');
      saveOrderBtn.classList.add('bg-green-600', 'border-green-600', 'hover:bg-green-700');
    }
  }
  
  // Reset save button text (will be "Finalizar" in step 4)
  const saveBtn = document.getElementById('save-order-btn');
  if (saveBtn) {
    saveBtn.textContent = 'Finalizar';
  }
  
  currentOrderProducts = [];
  currentOrderClient = null;
  currentOrderDiscount = { type: '', value: 0 };
  currentOrderStep = 1;
  
  // Reset client search
  const clientSelect = document.getElementById('order-client-select');
  const clientSearchInput = document.getElementById('client-search-input');
  const clientResultsDiv = document.getElementById('client-search-results');
  const selectedClientDisplay = document.getElementById('selected-client-display');
  const clientSearchContainer = document.getElementById('client-search-container');
  if (clientSelect) clientSelect.value = '';
  if (clientSearchInput) clientSearchInput.value = '';
  if (clientResultsDiv) clientResultsDiv.classList.add('hidden');
  if (selectedClientDisplay) selectedClientDisplay.classList.add('hidden');
  if (clientSearchContainer) clientSearchContainer.classList.remove('hidden');
  
  // Reset products
  const orderProductsList = document.getElementById('order-products-list');
  const productSearchInput = document.getElementById('product-search-input');
  const productSearchResults = document.getElementById('product-search-results');
  const orderNotes = document.getElementById('order-notes');
  if (orderProductsList) orderProductsList.innerHTML = '';
  if (productSearchInput) productSearchInput.value = '';
  if (productSearchResults) productSearchResults.classList.add('hidden');
  if (orderNotes) orderNotes.value = '';
  
  // Set default delivery date (tomorrow)
  const deliveryDateInput = document.getElementById('order-delivery-date');
  const deliveryTimeInput = document.getElementById('order-delivery-time');
  
  if (deliveryDateInput) {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    // Format for date input (YYYY-MM-DD)
    const year = tomorrow.getFullYear();
    const month = String(tomorrow.getMonth() + 1).padStart(2, '0');
    const day = String(tomorrow.getDate()).padStart(2, '0');
    deliveryDateInput.value = `${year}-${month}-${day}`;
  }
  
  // Set default delivery time (12:00)
  if (deliveryTimeInput) {
    deliveryTimeInput.value = '12:00';
  }
  
  // Reset reload flag when starting new order
  reloadAttempted = false;
  
  // Reset predefined (step 2) - tarjetas: valor vacío y actualizar selección visual
  const predefinedSelect = document.getElementById('order-predefined-select');
  if (predefinedSelect) predefinedSelect.value = '';
  updatePredefinedCardsSelection();
  
  try {
    await loadAvailableProducts();
    await loadAvailableClients();
  } catch (err) {
    (window.logger || console).error('Error loading data for new order form', err);
    await (window.showError || window.alert)('Error al cargar datos. ' + (err.message || ''));
  }
  
  updateOrderTotal();
  
  // Show step 1 (Cliente)
  showOrderStep(1);
  
  // Setup client search input
  setupClientSearch();
  
  // Setup product search input
  setupProductSearch();
  
  // Setup discount handlers
  setupDiscountHandlers();
}

// Update product selection highlighting
function updateProductSelection(items) {
  items.forEach((item, index) => {
    if (index === selectedProductIndex) {
      item.classList.add('bg-red-50', 'border-red-200');
      item.classList.remove('hover:bg-gray-50');
    } else {
      item.classList.remove('bg-red-50', 'border-red-200');
      item.classList.add('hover:bg-gray-50');
    }
  });
}

// Scroll to selected item in dropdown
function scrollToSelectedItem(item) {
  if (!item) return;
  const resultsDiv = document.getElementById('product-search-results');
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

// Load predefined order
async function loadPredefinedOrder(orderId) {
  const predefined = predefinedOrders[orderId];
  if (!predefined) return;
  
  showSpinner('Cargando productos...');
  try {
    // Load all products
    const products = await loadProductsForOrder();
    const normalizeSearchText = window.normalizeSearchText || window.NRDCommon?.normalizeSearchText || ((t) => t.toLowerCase());
    const productMap = {};
    products.forEach(p => {
      productMap[normalizeSearchText(p.name || '')] = p;
    });
    
    // Match predefined items with actual products
    currentOrderProducts = [];
    for (const item of predefined.items) {
      // Try to find product by name (case insensitive, partial match)
      const productNameNormalized = normalizeSearchText(item.productName || '');
      let foundProduct = null;
      
      // First try exact match
      if (productMap[productNameNormalized]) {
        foundProduct = productMap[productNameNormalized];
      } else {
        // Try partial match
        for (const [key, product] of Object.entries(productMap)) {
          if (productNameNormalized.includes(key) || key.includes(productNameNormalized)) {
            foundProduct = product;
            break;
          }
        }
      }
      
      if (foundProduct) {
        currentOrderProducts.push({
          productId: foundProduct.id,
          quantity: item.quantity
        });
      } else {
        logger.warn('Product not found in predefined order', { productName: item.productName });
      }
    }
    
    // Render products (caller will show step 3)
    await renderOrderProducts();
    await updateOrderTotal();
    hideSpinner();
  } catch (error) {
    hideSpinner();
    logger.error('Error loading predefined order', error);
    await showError('Error al cargar pedido precargado: ' + error.message);
  }
}

// Show order wizard step
function showOrderStep(step) {
  currentOrderStep = step;
  
  // Hide all steps
  const steps = ['order-step-1', 'order-step-2', 'order-step-3', 'order-step-4'];
  steps.forEach((stepId, index) => {
    const stepElement = document.getElementById(stepId);
    if (stepElement) {
      if (index + 1 === step) {
        stepElement.classList.remove('hidden');
      } else {
        stepElement.classList.add('hidden');
      }
    }
  });
  
  // Update step indicators
  for (let i = 1; i <= 4; i++) {
    const indicator = document.getElementById(`step-${i}-indicator`);
    if (indicator) {
      if (i < step) {
        // Completed step
        indicator.classList.remove('border-gray-300', 'bg-white', 'text-gray-400');
        indicator.classList.add('border-red-600', 'bg-red-600', 'text-white');
      } else if (i === step) {
        // Current step
        indicator.classList.remove('border-gray-300', 'bg-white', 'text-gray-400');
        indicator.classList.add('border-red-600', 'bg-red-600', 'text-white');
      } else {
        // Future step
        indicator.classList.remove('border-red-600', 'bg-red-600', 'text-white');
        indicator.classList.add('border-gray-300', 'bg-white', 'text-gray-400');
      }
    }
  }
  
  // Update total in step 4 (Detalles) if we're on step 4
  if (step === 4) {
    updateOrderTotal();
    const totalStep4 = document.getElementById('order-total-step-4');
    const total = document.getElementById('order-total');
    if (totalStep4 && total) {
      totalStep4.textContent = total.textContent;
    }
  }
  // Sincronizar selección visual de tarjetas en step 2
  if (step === 2) {
    updatePredefinedCardsSelection();
  }
}

// Actualizar estado visual de las tarjetas de pedido precargado (step 2)
function updatePredefinedCardsSelection() {
  const hidden = document.getElementById('order-predefined-select');
  const value = hidden ? hidden.value : '';
  document.querySelectorAll('.order-predefined-card').forEach((card) => {
    const isSelected = card.dataset.value === value;
    if (isSelected) {
      card.classList.add('border-red-600', 'bg-red-50');
      card.classList.remove('border-gray-200');
    } else {
      card.classList.remove('border-red-600', 'bg-red-50');
      card.classList.add('border-gray-200');
    }
  });
}

// Go to next step
async function goToNextStep() {
  if (currentOrderStep === 1) {
    // Validate step 1: client must be selected
    const clientId = document.getElementById('order-client-select').value;
    if (!clientId) {
      await showError('Por favor seleccione un cliente');
      return;
    }
    currentOrderClient = clientId;
    showOrderStep(2);
  } else if (currentOrderStep === 2) {
    // Step 2: predefined order - load if selected, then go to products
    const predefinedSelect = document.getElementById('order-predefined-select');
    const selectedPredefined = predefinedSelect ? predefinedSelect.value : '';
    if (selectedPredefined && predefinedOrders[selectedPredefined]) {
      showSpinner('Cargando productos...');
      try {
        await loadPredefinedOrder(selectedPredefined);
        hideSpinner();
      } catch (err) {
        hideSpinner();
        await showError('Error al cargar plantilla: ' + (err.message || ''));
        return;
      }
    } else {
      await renderOrderProducts();
      await updateOrderTotal();
    }
    showOrderStep(3);
  } else if (currentOrderStep === 3) {
    // Validate step 3: at least one product must be added
    if (currentOrderProducts.length === 0) {
      await showError('Por favor agregue al menos un producto');
      return;
    }
    showOrderStep(4);
    await updateOrderTotal();
    const totalStep4 = document.getElementById('order-total-step-4');
    const total = document.getElementById('order-total');
    if (totalStep4 && total) {
      totalStep4.textContent = total.textContent;
    }
  }
}

// Go to previous step
function goToPreviousStep() {
  if (currentOrderStep === 2) {
    showOrderStep(1);
  } else if (currentOrderStep === 3) {
    showOrderStep(2);
  } else if (currentOrderStep === 4) {
    showOrderStep(3);
  }
}

// Hide new order form
function hideNewOrderForm() {
  const form = document.getElementById('new-order-form');
  function showEl(el) {
    if (el) el.style.removeProperty('display');
  }
  form.classList.add('hidden');
  showEl(document.getElementById('orders-list-view'));
  showEl(document.getElementById('orders-search-container'));
  showEl(document.getElementById('date-filter-container'));
  showEl(document.getElementById('orders-list-container'));
  showEl(document.querySelector('#orders-view > .flex.flex-col'));
  showEl(document.getElementById('orders-section-pending'));
  if (hasScheduledOrdersInList) showEl(document.getElementById('orders-section-scheduled'));
  showEl(document.getElementById('orders-section-completed'));
  
  // Reset to step 1
  currentOrderStep = 1;
}

// Product search functionality
let availableProducts = [];
let productSearchTimeout = null;
let searchInputHandler = null;
let clickOutsideHandler = null;
let keyboardHandler = null;
let selectedProductIndex = -1;
let filteredProducts = [];

// Client search functionality
let availableClients = [];
let clientSearchTimeout = null;
let clientSearchInputHandler = null;
let clientClickOutsideHandler = null;
let clientKeyboardHandler = null;
let selectedClientIndex = -1;
let filteredClients = [];

// Load products for order (products and sellable variants - usa API con withVariants)
async function loadProductsForOrder() {
  const nrd = window.nrd;
  if (!nrd || !nrd.products) {
    logger.error('NRD products service not available');
    return [];
  }
  
  try {
    // API con variantes: withVariants true = cada variante como item; false = solo padres sin variantes
    const [withVariants, withoutVariants] = await Promise.all([
      nrd.products.getAll({ withVariants: true }),   // Productos con variantes → 1 item por variante
      nrd.products.getAll({ withVariants: false })   // Productos sin variantes
    ]);
    const allItems = [...(withVariants || []), ...(withoutVariants || [])];
    const result = [];
    
    for (const item of allItems) {
      if (item.active === false || item.esVendible !== true) continue;
      
      const id = item.variantId ? `${item.productId}_${item.variantId}` : (item.id || item.productId);
      const productName = item.productName || item.name;
      const variantLabel = item.name && item.name !== productName ? item.name : (item.variantId || item.sku || '');
      const name = item.variantId ? (variantLabel ? `${productName} - ${variantLabel}` : productName) : (item.name || productName);
      result.push({
        id,
        name,
        price: item.price || 0,
        sku: item.sku || '',
        parentId: item.productId || item.id,
        parentName: item.productName || item.name,
        productId: item.productId || item.id,
        variantId: item.variantId || null,
        isVariant: !!item.variantId
      });
    }
    
    logger.debug('Products loaded for order', { totalItems: allItems.length, sellableItems: result.length });
    return result;
  } catch (error) {
    logger.error('Error loading products for order', error);
    return [];
  }
}

// Load available products for search
let isLoadingProducts = false;
async function loadAvailableProducts() {
  // Prevent concurrent loads
  if (isLoadingProducts) {
    logger.debug('Products already loading, skipping...');
    return Promise.resolve();
  }
  
  isLoadingProducts = true;
  logger.debug('Loading available products for search');
  try {
    availableProducts = await loadProductsForOrder();
    logger.debug('Products loaded for search', { count: availableProducts.length });
    
    // Log if no products found
    if (availableProducts.length === 0) {
      logger.warn('No sellable products found. Check if products exist and are marked as sellable.');
    }
  } catch (error) {
    logger.error('Error loading products for search', error);
    console.error('Error loading products:', error);
    availableProducts = [];
    throw error; // Re-throw to allow caller to handle
  } finally {
    isLoadingProducts = false;
  }
}

// Search products
let reloadAttempted = false;
function searchProducts(query) {
  const searchInput = document.getElementById('product-search-input');
  const resultsDiv = document.getElementById('product-search-results');
  
  if (!searchInput || !resultsDiv) {
    logger.error('Search elements not found');
    return;
  }
  
  const searchTerm = query.toLowerCase().trim();
  
  if (searchTerm.length === 0) {
    resultsDiv.classList.add('hidden');
    return;
  }
  
  // Check if products are loaded
  if (!availableProducts || availableProducts.length === 0) {
    // Only try to reload once, and only if not already loading
    if (!isLoadingProducts && !reloadAttempted) {
      reloadAttempted = true;
      logger.warn('No products available for search, attempting to load', { 
        availableProductsLength: availableProducts ? availableProducts.length : 'null' 
      });
      resultsDiv.innerHTML = '<div class="px-3 py-2 text-sm text-gray-500">Cargando productos...</div>';
      resultsDiv.classList.remove('hidden');
      
      // Try to reload products only once
      loadAvailableProducts().then(() => {
        if (availableProducts && availableProducts.length > 0) {
          reloadAttempted = false; // Solo resetear si cargamos productos
          if (searchInput && searchInput.value && searchInput.value.trim()) {
            searchProducts(searchInput.value);
          } else {
            resultsDiv.classList.add('hidden');
          }
        } else {
          // Sin productos: no reintentar para evitar loop infinito
          reloadAttempted = true;
          resultsDiv.innerHTML = '<div class="px-3 py-2 text-sm text-gray-500">No hay productos disponibles</div>';
          resultsDiv.classList.remove('hidden');
        }
      }).catch((error) => {
        reloadAttempted = false; // Reset flag on error
        logger.error('Failed to reload products', error);
        resultsDiv.innerHTML = '<div class="px-3 py-2 text-sm text-red-500">Error al cargar productos</div>';
      });
    } else if (isLoadingProducts) {
      // Already loading, just show loading message
      resultsDiv.innerHTML = '<div class="px-3 py-2 text-sm text-gray-500">Cargando productos...</div>';
      resultsDiv.classList.remove('hidden');
    } else {
      // Already attempted reload, show no products message
      resultsDiv.innerHTML = '<div class="px-3 py-2 text-sm text-gray-500">No hay productos disponibles</div>';
      resultsDiv.classList.remove('hidden');
    }
    return;
  }
  
  // Reset reload flag if products are available
  reloadAttempted = false;
  
  // Filter products
  const normalizeSearchText = window.normalizeSearchText || window.NRDCommon?.normalizeSearchText || ((t) => t.toLowerCase());
  const filtered = availableProducts.filter(product => {
    const productName = normalizeSearchText(product.name || '');
    return productName.includes(searchTerm);
  });
  
  logger.debug('Product search performed', { 
    query: searchTerm, 
    found: filtered.length, 
    totalAvailable: availableProducts.length 
  });
  
  // Store filtered products for keyboard navigation
  filteredProducts = filtered;
  selectedProductIndex = -1;
  
  // Build results HTML
  let resultsHTML = '';
  
  if (filtered.length === 0) {
    resultsHTML = '<div class="px-3 py-2 text-sm text-gray-500">No se encontraron productos</div>';
  } else {
    resultsHTML = filtered.map((product, index) => `
      <div class="product-search-item px-3 py-2 hover:bg-gray-50 cursor-pointer border-b border-gray-100 last:border-b-0 ${index === selectedProductIndex ? 'bg-red-50 border-red-200' : ''}" 
           data-product-id="${product.id}" 
           data-product-name="${escapeHtml(product.name)}" 
           data-product-price="${product.price}"
           data-index="${index}">
        <div class="font-light text-sm">${escapeHtml(product.name)}</div>
        <div class="text-xs text-gray-600">$${parseFloat(product.price || 0).toFixed(2)}</div>
      </div>
    `).join('');
  }
  
  // Always add "Otros" option at the end
  resultsHTML += `
    <div class="product-search-item-other px-3 py-2 hover:bg-gray-50 cursor-pointer border-t border-gray-200 bg-gray-50" 
         data-is-other="true">
      <div class="font-light text-sm text-red-600">+ Otros (producto personalizado)</div>
      <div class="text-xs text-gray-600">Ingresar nombre y precio</div>
    </div>
  `;
  
  resultsDiv.innerHTML = resultsHTML;
  resultsDiv.classList.remove('hidden');
  
  // Attach click handlers for regular products
  document.querySelectorAll('.product-search-item').forEach(item => {
    item.addEventListener('click', () => {
      addProductFromSearch(item);
    });
  });
  
  // Attach click handler for "Otros"
  const otherItem = resultsDiv.querySelector('.product-search-item-other');
  if (otherItem) {
    otherItem.addEventListener('click', () => {
      showCustomProductModal();
    });
  }
}

// Show custom product modal
async function showCustomProductModal() {
  return new Promise((resolve) => {
    const modal = document.getElementById('custom-modal');
    const titleEl = document.getElementById('modal-title');
    const messageEl = document.getElementById('modal-message');
    const confirmBtn = document.getElementById('modal-confirm');
    const cancelBtn = document.getElementById('modal-cancel');

    titleEl.textContent = 'Producto Personalizado';
    messageEl.innerHTML = `
      <div class="space-y-4">
        <div>
          <label class="block mb-1.5 text-xs uppercase tracking-wider text-gray-600">Nombre del Producto</label>
          <input type="text" id="custom-product-name" 
            placeholder="Ej: Producto especial" 
            class="w-full px-3 py-2 border border-gray-300 focus:outline-none focus:border-red-600 bg-white text-sm sm:text-base rounded">
        </div>
        <div>
          <label class="block mb-1.5 text-xs uppercase tracking-wider text-gray-600">Precio</label>
          <input type="number" id="custom-product-price" step="0.01" min="0" 
            placeholder="0.00" 
            class="w-full px-3 py-2 border border-gray-300 focus:outline-none focus:border-red-600 bg-white text-sm sm:text-base rounded">
        </div>
      </div>
    `;
    
    confirmBtn.textContent = 'Agregar';
    cancelBtn.textContent = 'Cancelar';

    modal.classList.remove('hidden');

    const handleConfirm = () => {
      const nameInput = document.getElementById('custom-product-name');
      const priceInput = document.getElementById('custom-product-price');
      
      const name = nameInput ? nameInput.value.trim() : '';
      const price = priceInput ? parseFloat(priceInput.value) : 0;
      
      if (!name) {
        showError('Por favor ingrese el nombre del producto');
        return;
      }
      
      if (isNaN(price) || price <= 0) {
        showError('Por favor ingrese un precio válido mayor a 0');
        return;
      }
      
      // Generate custom product ID
      const customId = `custom-${Date.now()}`;
      
      // Add custom product
      currentOrderProducts.push({
        productId: customId,
        customName: name,
        customPrice: price,
        quantity: 1
      });
      
      renderOrderProducts();
      updateOrderTotal();
      
      // Clear search
      const searchInput = document.getElementById('product-search-input');
      const resultsDiv = document.getElementById('product-search-results');
      if (searchInput) searchInput.value = '';
      if (resultsDiv) resultsDiv.classList.add('hidden');
      selectedProductIndex = -1;
      
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
    
    // Focus on name input
    setTimeout(() => {
      const nameInput = document.getElementById('custom-product-name');
      if (nameInput) nameInput.focus();
    }, 100);
  });
}

// Add product from search (used by both click and keyboard)
function addProductFromSearch(item) {
  // Check if it's "Otros" option
  if (item.dataset.isOther === 'true') {
    showCustomProductModal();
    return;
  }
  
  const productId = item.dataset.productId;
  const productName = item.dataset.productName;
  const productPrice = parseFloat(item.dataset.productPrice);
  
  // Check if product already added
  if (currentOrderProducts.find(p => p.productId === productId)) {
    showError('Este producto ya está en el pedido');
    return;
  }
  
  // Add product
  currentOrderProducts.push({
    productId,
    quantity: 1
  });
  
  renderOrderProducts();
  updateOrderTotal();
  
  // Clear search
  const searchInput = document.getElementById('product-search-input');
  const resultsDiv = document.getElementById('product-search-results');
  if (searchInput) searchInput.value = '';
  if (resultsDiv) resultsDiv.classList.add('hidden');
  selectedProductIndex = -1;
}

// Load available clients for search using NRD Data Access
async function loadAvailableClients() {
  try {
    const clientsArray = await nrd.clients.getAll();
    const clients = Array.isArray(clientsArray) 
      ? clientsArray.reduce((acc, client, index) => {
          acc[index] = client;
          return acc;
        }, {})
      : clientsArray || {};
    availableClients = Object.entries(clients).map(([id, client]) => ({
      id,
      ...client
    }));
    console.log('Clients loaded for search:', availableClients.length);
  } catch (error) {
    console.error('Error loading clients for search:', error);
    availableClients = [];
  }
}

// Search clients
function searchClients(query) {
  const searchInput = document.getElementById('client-search-input');
  const resultsDiv = document.getElementById('client-search-results');
  
  if (!searchInput || !resultsDiv) {
    logger.error('Client search elements not found');
    return;
  }
  
  const normalizeSearchText = window.normalizeSearchText || window.NRDCommon?.normalizeSearchText || ((t) => t.toLowerCase());
  const searchTerm = normalizeSearchText(query.trim());
  
  if (searchTerm.length === 0) {
    resultsDiv.classList.add('hidden');
    return;
  }
  
  // Filter clients by name, phone, or address
  const filtered = availableClients.filter(client => {
    const name = normalizeSearchText(client.name || '');
    const phone = normalizeSearchText(client.phone || '');
    const address = normalizeSearchText(client.address || '');
    return name.includes(searchTerm) || phone.includes(searchTerm) || address.includes(searchTerm);
  });
  
  console.log('Client search query:', searchTerm, 'Found:', filtered.length, 'clients');
  
  // Store filtered clients for keyboard navigation
  filteredClients = filtered;
  selectedClientIndex = -1;
  
  // Build results HTML
  let resultsHTML = '';
  
  if (filtered.length === 0) {
    resultsHTML = '<div class="px-3 py-2 text-sm text-gray-500">No se encontraron clientes</div>';
  } else {
    resultsHTML = filtered.map((client, index) => `
      <div class="client-search-item px-3 py-2 hover:bg-gray-50 cursor-pointer border-b border-gray-100 last:border-b-0 ${index === selectedClientIndex ? 'bg-red-50 border-red-200' : ''}" 
           data-client-id="${client.id}" 
           data-client-name="${escapeHtml(client.name || '')}" 
           data-client-phone="${escapeHtml(client.phone || '')}"
           data-index="${index}">
        <div class="font-light text-sm">${escapeHtml(client.name || 'Sin nombre')}</div>
        ${client.phone ? `<div class="text-xs text-gray-600">${escapeHtml(client.phone)}</div>` : ''}
        ${client.address ? `<div class="text-xs text-gray-500">${escapeHtml(client.address)}</div>` : ''}
      </div>
    `).join('');
  }
  
  resultsDiv.innerHTML = resultsHTML;
  resultsDiv.classList.remove('hidden');
  
  // Attach click handlers
  document.querySelectorAll('.client-search-item').forEach(item => {
    item.addEventListener('click', () => {
      addClientFromSearch(item);
    });
  });
}

// Update client selection highlighting
function updateClientSelection(items) {
  items.forEach((item, index) => {
    if (index === selectedClientIndex) {
      item.classList.add('bg-red-50', 'border-red-200');
      item.classList.remove('hover:bg-gray-50');
    } else {
      item.classList.remove('bg-red-50', 'border-red-200');
      item.classList.add('hover:bg-gray-50');
    }
  });
}

// Scroll to selected client item
function scrollToSelectedClientItem(item) {
  if (item && item.scrollIntoView) {
    item.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
}

// Add client from search (used by both click and keyboard)
function addClientFromSearch(item) {
  const clientId = item.dataset.clientId;
  const clientName = item.dataset.clientName;
  const clientPhone = item.dataset.clientPhone;
  
  // Set selected client
  currentOrderClient = clientId;
  const clientSelect = document.getElementById('order-client-select');
  if (clientSelect) {
    clientSelect.value = clientId;
  }
  
  // Show selected client display
  const selectedDisplay = document.getElementById('selected-client-display');
  const selectedName = document.getElementById('selected-client-name');
  const selectedPhone = document.getElementById('selected-client-phone');
  const searchInputContainer = document.getElementById('client-search-container');
  const searchInput = document.getElementById('client-search-input');
  const resultsDiv = document.getElementById('client-search-results');
  
  if (selectedDisplay) selectedDisplay.classList.remove('hidden');
  if (selectedName) selectedName.textContent = clientName || 'Sin nombre';
  if (selectedPhone) {
    selectedPhone.textContent = clientPhone || '';
    if (!clientPhone) selectedPhone.style.display = 'none';
    else selectedPhone.style.display = 'block';
  }
  
  // Hide search input container when client is selected
  if (searchInputContainer) searchInputContainer.classList.add('hidden');
  
  // Clear search
  if (searchInput) searchInput.value = '';
  if (resultsDiv) resultsDiv.classList.add('hidden');
  selectedClientIndex = -1;
  
  // Trigger change event to update prices
  const event = new Event('change', { bubbles: true });
  if (clientSelect) clientSelect.dispatchEvent(event);
}

// Setup client search input
function setupClientSearch() {
  const searchInput = document.getElementById('client-search-input');
  const resultsDiv = document.getElementById('client-search-results');
  
  if (searchInput) {
    // Remove previous listener if exists
    if (clientSearchInputHandler) {
      searchInput.removeEventListener('input', clientSearchInputHandler);
    }
    
    // Add new listener
    clientSearchInputHandler = (e) => {
      clearTimeout(clientSearchTimeout);
      clientSearchTimeout = setTimeout(() => {
        searchClients(e.target.value);
      }, 200);
    };
    searchInput.addEventListener('input', clientSearchInputHandler);
    
    // Keyboard navigation for client search
    if (clientKeyboardHandler) {
      searchInput.removeEventListener('keydown', clientKeyboardHandler);
    }
    
    clientKeyboardHandler = (e) => {
      const items = document.querySelectorAll('.client-search-item');
      const totalItems = items.length;
      
      if (totalItems === 0) return;
      
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        selectedClientIndex = selectedClientIndex >= totalItems - 1 ? 0 : selectedClientIndex + 1;
        updateClientSelection(items);
        scrollToSelectedClientItem(items[selectedClientIndex]);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        selectedClientIndex = selectedClientIndex <= 0 ? totalItems - 1 : selectedClientIndex - 1;
        updateClientSelection(items);
        scrollToSelectedClientItem(items[selectedClientIndex]);
      } else if (e.key === 'Enter' && selectedClientIndex >= 0) {
        e.preventDefault();
        const selectedItem = items[selectedClientIndex];
        if (selectedItem) {
          addClientFromSearch(selectedItem);
        }
      } else if (e.key === 'Escape') {
        resultsDiv.classList.add('hidden');
        selectedClientIndex = -1;
      }
    };
    
    searchInput.addEventListener('keydown', clientKeyboardHandler);
    
    // Remove previous click outside handler if exists
    if (clientClickOutsideHandler) {
      document.removeEventListener('click', clientClickOutsideHandler);
    }
    
    // Close dropdown when clicking outside
    clientClickOutsideHandler = (e) => {
      if (resultsDiv && !searchInput.contains(e.target) && !resultsDiv.contains(e.target)) {
        resultsDiv.classList.add('hidden');
        selectedClientIndex = -1;
      }
    };
    document.addEventListener('click', clientClickOutsideHandler);
  }
}

// Setup discount handlers
function setupDiscountHandlers() {
  const discountTypeEl = document.getElementById('order-discount-type');
  const discountValueEl = document.getElementById('order-discount-value');
  
  if (discountTypeEl && discountValueEl) {
    // Update placeholder based on discount type
    const updatePlaceholder = () => {
      if (discountTypeEl.value === 'porcentual') {
        discountValueEl.placeholder = '0.00%';
      } else if (discountTypeEl.value === 'fijo') {
        discountValueEl.placeholder = '$0.00';
      } else {
        discountValueEl.placeholder = '0.00';
      }
    };
    
    discountTypeEl.addEventListener('change', () => {
      updatePlaceholder();
      if (!discountTypeEl.value) {
        // Reset value when "Sin descuento" is selected
        discountValueEl.value = '';
      }
      updateOrderTotal();
    });
    
    discountValueEl.addEventListener('input', () => {
      updateOrderTotal();
    });
    
    // Set initial placeholder
    updatePlaceholder();
  }
}

// Setup product search input
function setupProductSearch() {
  const searchInput = document.getElementById('product-search-input');
  const resultsDiv = document.getElementById('product-search-results');
  
  if (searchInput) {
    // Remove previous listener if exists
    if (searchInputHandler) {
      searchInput.removeEventListener('input', searchInputHandler);
    }
    
    // Add new listener
    searchInputHandler = (e) => {
      clearTimeout(productSearchTimeout);
      productSearchTimeout = setTimeout(() => {
        searchProducts(e.target.value);
      }, 200);
    };
    searchInput.addEventListener('input', searchInputHandler);
    
    // Keyboard navigation for product search
    if (keyboardHandler) {
      searchInput.removeEventListener('keydown', keyboardHandler);
    }
    
    keyboardHandler = (e) => {
      const items = document.querySelectorAll('.product-search-item');
      const otherItem = document.querySelector('.product-search-item-other');
      const totalItems = items.length + (otherItem ? 1 : 0);
      
      if (totalItems === 0) return;
      
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        selectedProductIndex = selectedProductIndex >= totalItems - 1 ? 0 : selectedProductIndex + 1;
        if (selectedProductIndex < items.length) {
          updateProductSelection(items);
          scrollToSelectedItem(items[selectedProductIndex]);
          if (otherItem) {
            otherItem.classList.remove('bg-red-50', 'border-red-200');
            otherItem.classList.add('hover:bg-gray-50');
          }
        } else {
          // Selected "Otros"
          items.forEach(item => {
            item.classList.remove('bg-red-50', 'border-red-200');
            item.classList.add('hover:bg-gray-50');
          });
          if (otherItem) {
            otherItem.classList.add('bg-red-50', 'border-red-200');
            otherItem.classList.remove('hover:bg-gray-50');
          }
        }
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        selectedProductIndex = selectedProductIndex <= 0 ? totalItems - 1 : selectedProductIndex - 1;
        if (selectedProductIndex < items.length) {
          updateProductSelection(items);
          scrollToSelectedItem(items[selectedProductIndex]);
          if (otherItem) {
            otherItem.classList.remove('bg-red-50', 'border-red-200');
            otherItem.classList.add('hover:bg-gray-50');
          }
        } else {
          // Selected "Otros"
          items.forEach(item => {
            item.classList.remove('bg-red-50', 'border-red-200');
            item.classList.add('hover:bg-gray-50');
          });
          if (otherItem) {
            otherItem.classList.add('bg-red-50', 'border-red-200');
            otherItem.classList.remove('hover:bg-gray-50');
          }
        }
      } else if (e.key === 'Enter' && selectedProductIndex >= 0) {
        e.preventDefault();
        if (selectedProductIndex < items.length) {
          const selectedItem = items[selectedProductIndex];
          if (selectedItem) {
            addProductFromSearch(selectedItem);
          }
        } else if (otherItem) {
          // "Otros" selected
          showCustomProductModal();
        }
      } else if (e.key === 'Escape') {
        resultsDiv.classList.add('hidden');
        selectedProductIndex = -1;
      }
    };
    
    searchInput.addEventListener('keydown', keyboardHandler);
    
    // Remove previous click outside handler if exists
    if (clickOutsideHandler) {
      document.removeEventListener('click', clickOutsideHandler);
    }
    
    // Close dropdown when clicking outside
    clickOutsideHandler = (e) => {
      if (resultsDiv && !searchInput.contains(e.target) && !resultsDiv.contains(e.target)) {
        resultsDiv.classList.add('hidden');
        selectedProductIndex = -1;
      }
    };
    document.addEventListener('click', clickOutsideHandler);
  }
}

// Add product to order (kept for compatibility)
async function addProductToOrder() {
  const products = await loadProductsForOrder();
  if (products.length === 0) {
    await showError('No hay productos activos disponibles');
    return;
  }

  const productId = products[0].id;
  currentOrderProducts.push({
    productId,
    quantity: 1
  });
  renderOrderProducts();
  updateOrderTotal();
}

// Remove product from order
function removeProductFromOrder(index) {
  // Prevent removing the last product
  if (currentOrderProducts.length <= 1) {
    showError('Debe haber al menos un producto en el pedido');
    return;
  }
  currentOrderProducts.splice(index, 1);
  renderOrderProducts();
  updateOrderTotal();
}

// Update product in order
function updateOrderProduct(index, field, value) {
  if (field === 'productId') {
    // Check if "Otros" was selected
    if (value && value.startsWith('custom-')) {
      // Show modal to enter custom product details
      showCustomProductModalForEdit(index);
      return;
    }
    currentOrderProducts[index].productId = value;
    // Clear custom fields if switching to regular product
    delete currentOrderProducts[index].customName;
    delete currentOrderProducts[index].customPrice;
  } else if (field === 'quantity') {
    const qty = parseInt(value) || 1;
    currentOrderProducts[index].quantity = qty > 0 ? qty : 1;
  }
  renderOrderProducts();
  updateOrderTotal();
}

// Show custom product modal for editing existing product
async function showCustomProductModalForEdit(index) {
  return new Promise((resolve) => {
    const modal = document.getElementById('custom-modal');
    const titleEl = document.getElementById('modal-title');
    const messageEl = document.getElementById('modal-message');
    const confirmBtn = document.getElementById('modal-confirm');
    const cancelBtn = document.getElementById('modal-cancel');

    const currentItem = currentOrderProducts[index];
    const currentName = currentItem.customName || '';
    const currentPrice = currentItem.customPrice || 0;

    titleEl.textContent = 'Producto Personalizado';
    messageEl.innerHTML = `
      <div class="space-y-4">
        <div>
          <label class="block mb-1.5 text-xs uppercase tracking-wider text-gray-600">Nombre del Producto</label>
          <input type="text" id="custom-product-name" 
            value="${escapeHtml(currentName)}"
            placeholder="Ej: Producto especial" 
            class="w-full px-3 py-2 border border-gray-300 focus:outline-none focus:border-red-600 bg-white text-sm sm:text-base rounded">
        </div>
        <div>
          <label class="block mb-1.5 text-xs uppercase tracking-wider text-gray-600">Precio</label>
          <input type="number" id="custom-product-price" step="0.01" min="0" 
            value="${currentPrice}"
            placeholder="0.00" 
            class="w-full px-3 py-2 border border-gray-300 focus:outline-none focus:border-red-600 bg-white text-sm sm:text-base rounded">
        </div>
      </div>
    `;
    
    confirmBtn.textContent = 'Guardar';
    cancelBtn.textContent = 'Cancelar';

    modal.classList.remove('hidden');

    const handleConfirm = () => {
      const nameInput = document.getElementById('custom-product-name');
      const priceInput = document.getElementById('custom-product-price');
      
      const name = nameInput ? nameInput.value.trim() : '';
      const price = priceInput ? parseFloat(priceInput.value) : 0;
      
      if (!name) {
        showError('Por favor ingrese el nombre del producto');
        return;
      }
      
      if (isNaN(price) || price <= 0) {
        showError('Por favor ingrese un precio válido mayor a 0');
        return;
      }
      
      // Update custom product
      const customId = `custom-${Date.now()}`;
      currentOrderProducts[index].productId = customId;
      currentOrderProducts[index].customName = name;
      currentOrderProducts[index].customPrice = price;
      
      renderOrderProducts();
      updateOrderTotal();
      
      // Close modal
      modal.classList.add('hidden');
      messageEl.innerHTML = '';
      confirmBtn.removeEventListener('click', handleConfirm);
      cancelBtn.removeEventListener('click', handleCancel);
      modal.removeEventListener('click', handleBackgroundClick);
      resolve();
    };

    const handleCancel = () => {
      // Restore previous product selection
      renderOrderProducts();
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
    
    // Focus on name input
    setTimeout(() => {
      const nameInput = document.getElementById('custom-product-name');
      if (nameInput) nameInput.focus();
    }, 100);
  });
}

// Render order products
async function renderOrderProducts() {
  const container = document.getElementById('order-products-list');
  container.innerHTML = '';

  const products = await loadProductsForOrder();
  const productMap = {};
  products.forEach(p => productMap[p.id] = p);

  for (let index = 0; index < currentOrderProducts.length; index++) {
    const item = currentOrderProducts[index];
    // Check if it's a custom product
    const isCustom = item.productId && item.productId.startsWith('custom-');
    
    if (isCustom) {
      // Render custom product with editable name and price
      const productTotal = ((item.customPrice || 0) * item.quantity).toFixed(2);
      
      const div = document.createElement('div');
      div.className = 'flex flex-col gap-2 sm:gap-3 py-2 sm:py-3 border border-gray-200 rounded p-2 sm:p-3 bg-gray-50';
      
      div.innerHTML = `
        <div class="flex flex-col gap-2 sm:gap-3">
          <div class="flex items-center justify-between">
            <div class="text-xs uppercase tracking-wider text-gray-600">Producto Personalizado</div>
            <button type="button" class="px-2 py-1 text-xs text-gray-500 hover:text-red-600 transition-colors font-light underline" onclick="removeProductFromOrder(${index})">Quitar</button>
          </div>
          <div class="flex flex-col sm:flex-row gap-2 sm:gap-3 items-stretch sm:items-center">
            <input type="text" value="${escapeHtml(item.customName || '')}" 
              onchange="updateCustomProduct(${index}, 'name', this.value)" 
              placeholder="Nombre del producto"
              class="flex-1 sm:flex-2 px-2 py-2 border border-gray-300 focus:outline-none focus:border-red-600 bg-white text-sm sm:text-base rounded">
            <input type="number" step="0.01" min="0" value="${item.customPrice || 0}" 
              onchange="updateCustomProduct(${index}, 'price', this.value)" 
              placeholder="Precio"
              class="flex-1 sm:flex-none sm:max-w-24 px-2 py-2 border border-gray-300 focus:outline-none focus:border-red-600 bg-white text-sm sm:text-base rounded">
            <input type="number" min="1" value="${item.quantity}" 
              onchange="updateOrderProduct(${index}, 'quantity', this.value)" 
              required 
              class="flex-1 sm:flex-none sm:max-w-20 px-2 py-2 border border-gray-300 focus:outline-none focus:border-red-600 bg-white text-center text-sm sm:text-base rounded">
            <div class="flex-1 text-left sm:text-right font-light text-sm sm:text-base text-red-600 font-medium">$${productTotal}</div>
          </div>
        </div>
      `;
      container.appendChild(div);
    } else {
      // Render regular product
      const product = productMap[item.productId];
      if (!product) continue;

      const preferredPrice = await getPreferredPrice(item.productId, product.price);
      const productTotal = (preferredPrice * item.quantity).toFixed(2);
      const showPreferredPrice = preferredPrice !== product.price;
      
      const div = document.createElement('div');
      div.className = 'flex flex-col gap-2 sm:gap-3 py-2 sm:py-3 border border-gray-200 rounded p-2 sm:p-3 bg-gray-50';
      
      div.innerHTML = `
        <div class="flex flex-col sm:flex-row gap-2 sm:gap-3 items-stretch sm:items-center">
          <select onchange="updateOrderProduct(${index}, 'productId', this.value)" required 
            class="flex-1 sm:flex-2 px-2 py-2 border border-gray-300 focus:outline-none focus:border-red-600 bg-white text-sm sm:text-base rounded">
            ${products.map(p => 
              `<option value="${p.id}" ${p.id === item.productId ? 'selected' : ''}>${escapeHtml(p.name)} - $${parseFloat(p.price).toFixed(2)}</option>`
            ).join('')}
            <option value="custom-new" ${item.productId && item.productId.startsWith('custom-') ? 'selected' : ''}>Otros (personalizado)</option>
          </select>
          <input type="number" min="1" value="${item.quantity}" onchange="updateOrderProduct(${index}, 'quantity', this.value)" required 
            class="flex-1 sm:flex-none sm:max-w-20 px-2 py-2 border border-gray-300 focus:outline-none focus:border-red-600 bg-white text-center text-sm sm:text-base rounded">
          <div class="flex-1 flex items-center justify-between sm:justify-end gap-2">
            <div class="text-left sm:text-right font-light text-sm sm:text-base text-red-600 font-medium">
              ${showPreferredPrice ? `<div class="text-xs text-gray-500 line-through">$${parseFloat(product.price).toFixed(2)}</div>` : ''}
              <div>$${productTotal}</div>
            </div>
            <button type="button" class="px-2 py-1 text-xs text-gray-500 hover:text-red-600 transition-colors font-light underline" onclick="removeProductFromOrder(${index})">Quitar</button>
          </div>
        </div>
      `;
      container.appendChild(div);
    }
  }
}

// Update custom product
function updateCustomProduct(index, field, value) {
  if (field === 'name') {
    currentOrderProducts[index].customName = value.trim();
  } else if (field === 'price') {
    const price = parseFloat(value) || 0;
    currentOrderProducts[index].customPrice = price > 0 ? price : 0;
  }
  renderOrderProducts();
  updateOrderTotal();
}

// Get preferred price for a product from current client
async function getPreferredPrice(productId, basePrice) {
  if (!currentOrderClient) {
    return basePrice;
  }
  
  try {
    const client = await nrd.clients.getById(currentOrderClient);
    
    if (!client || !client.preferredPrices || !Array.isArray(client.preferredPrices)) {
      return basePrice;
    }
    
    const preferredPrice = client.preferredPrices.find(pp => pp.productId === productId);
    
    if (!preferredPrice) {
      return basePrice;
    }
    
    if (preferredPrice.type === 'fijo' && preferredPrice.price !== undefined) {
      return parseFloat(preferredPrice.price);
    } else if (preferredPrice.type === 'porcentual' && preferredPrice.percentage !== undefined) {
      const percentage = parseFloat(preferredPrice.percentage);
      return basePrice * (1 - percentage / 100);
    }
    
    return basePrice;
  } catch (error) {
    console.error('Error getting preferred price:', error);
    return basePrice;
  }
}

// Update order total
async function updateOrderTotal() {
  const products = await loadProductsForOrder();
  const productMap = {};
  products.forEach(p => productMap[p.id] = p);

  // Calculate subtotal
  let subtotal = 0;
  for (const item of currentOrderProducts) {
    // Check if it's a custom product
    if (item.productId && item.productId.startsWith('custom-')) {
      subtotal += (item.customPrice || 0) * item.quantity;
    } else {
      const product = productMap[item.productId];
      if (product) {
        const price = await getPreferredPrice(item.productId, product.price);
        subtotal += price * item.quantity;
      }
    }
  }

  // Calculate discount
  let discountAmount = 0;
  const discountTypeEl = document.getElementById('order-discount-type');
  const discountValueEl = document.getElementById('order-discount-value');
  
  if (discountTypeEl && discountValueEl) {
    const discountType = discountTypeEl.value;
    const discountValue = parseFloat(discountValueEl.value) || 0;
    
    currentOrderDiscount = { type: discountType, value: discountValue };
    
    if (discountType === 'fijo' && discountValue > 0) {
      discountAmount = discountValue;
    } else if (discountType === 'porcentual' && discountValue > 0) {
      discountAmount = subtotal * (discountValue / 100);
    }
  }

  // Calculate total
  const total = Math.max(0, subtotal - discountAmount);

  // Update subtotal display
  const subtotalEl = document.getElementById('order-subtotal');
  const subtotalRow = document.getElementById('order-subtotal-row');
  if (subtotalEl) {
    subtotalEl.textContent = `$${subtotal.toFixed(2)}`;
  }
  if (subtotalRow) {
    subtotalRow.classList.toggle('hidden', !discountTypeEl || !discountTypeEl.value);
  }

  // Update discount display
  const discountRow = document.getElementById('order-discount-row');
  const discountLabel = document.getElementById('order-discount-label');
  const discountAmountEl = document.getElementById('order-discount-amount');
  
  if (discountRow && discountLabel && discountAmountEl) {
    const hasDiscount = discountAmount > 0;
    discountRow.classList.toggle('hidden', !hasDiscount);
    
    if (hasDiscount) {
      if (currentOrderDiscount.type === 'porcentual') {
        discountLabel.textContent = `Descuento (${currentOrderDiscount.value.toFixed(2)}%):`;
      } else {
        discountLabel.textContent = 'Descuento:';
      }
      discountAmountEl.textContent = `-$${discountAmount.toFixed(2)}`;
    }
  }

  // Update total
  const totalText = `$${total.toFixed(2)}`;
  const totalElement = document.getElementById('order-total');
  if (totalElement) {
    totalElement.textContent = totalText;
  }
  
  // Also update total in step 4 if visible
  const totalStep4 = document.getElementById('order-total-step-4');
  if (totalStep4 && currentOrderStep === 4) {
    totalStep4.textContent = totalText;
  }
}

// Save order
async function saveOrder() {
  const form = document.getElementById('new-order-form');
  const isEditing = form.dataset.editingOrderId;
  
  const clientId = document.getElementById('order-client-select').value;
  if (!clientId) {
    await showError('Por favor seleccione un cliente');
    return;
  }

  if (currentOrderProducts.length === 0) {
    await showError('Por favor agregue al menos un producto');
    return;
  }

  try {
    // Get client data
    const client = await nrd.clients.getById(clientId);
    if (!client) {
      await showError('Cliente no encontrado');
      return;
    }

    // Get products data
    const products = await loadProductsForOrder();
    const productMap = {};
    products.forEach(p => productMap[p.id] = p);

    // Build order items
    const items = [];
    for (const item of currentOrderProducts) {
      // Check if it's a custom product
      if (item.productId && item.productId.startsWith('custom-')) {
        items.push({
          productId: null, // Custom products don't have a productId
          productName: item.customName || 'Producto personalizado',
          quantity: item.quantity,
          price: item.customPrice || 0
        });
      } else {
        const product = productMap[item.productId];
        if (!product) {
          // Product not found, skip it
          continue;
        }
        // Get preferred price if client has one
        const price = await getPreferredPrice(item.productId, product.price);
        items.push({
          productId: item.productId,
          productName: product.name,
          quantity: item.quantity,
          price: price
        });
      }
    }

    // Calculate subtotal
    const subtotal = items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    
    // Calculate discount
    let discountAmount = 0;
    if (currentOrderDiscount.type === 'fijo' && currentOrderDiscount.value > 0) {
      discountAmount = currentOrderDiscount.value;
    } else if (currentOrderDiscount.type === 'porcentual' && currentOrderDiscount.value > 0) {
      discountAmount = subtotal * (currentOrderDiscount.value / 100);
    }
    
    // Calculate total
    const total = Math.max(0, subtotal - discountAmount);

    // Get observations
    const notes = document.getElementById('order-notes').value.trim();
    
    // Get delivery date and time
    const deliveryDateInput = document.getElementById('order-delivery-date');
    const deliveryTimeInput = document.getElementById('order-delivery-time');
    const deliveryTypeRadio = document.querySelector('input[name="order-delivery-type"]:checked');
    const deliveryType = deliveryTypeRadio ? deliveryTypeRadio.value : 'envio';
    let deliveryDate = null;
    
    if (deliveryDateInput && deliveryDateInput.value) {
      const dateValue = deliveryDateInput.value;
      const timeValue = deliveryTimeInput ? deliveryTimeInput.value : '12:00';
      
      // Combine date and time
      const dateTimeString = `${dateValue}T${timeValue}`;
      deliveryDate = new Date(dateTimeString).getTime();
    }

    const user = getCurrentUser();
    if (isEditing) {
      // Update existing order
      const orderId = isEditing;
      logger.info('Updating order', { orderId, clientId, itemCount: items.length, total });
      // Get existing order to preserve createdAt
      const existingOrder = await nrd.orders.getById(orderId);
      
      const orderData = {
        clientId,
        createdAt: existingOrder.createdAt, // Preserve original creation date
        status: existingOrder.status || 'Pendiente', // Preserve status
        items,
        total,
        notes: notes || null,
        deliveryDate: deliveryDate,
        deliveryType: deliveryType
      };

      showSpinner('Actualizando pedido...');
      await nrd.orders.update(orderId, orderData);
      logger.audit('ENTITY_UPDATE', { entity: 'order', id: orderId, data: orderData, uid: user?.uid, email: user?.email, timestamp: Date.now() });
      logger.info('Order updated successfully', { orderId });
      hideSpinner();
      hideNewOrderForm();
      await showSuccess('Pedido actualizado exitosamente');
    } else {
      // Create new order
      logger.info('Creating new order', { clientId, itemCount: items.length, total });
      const orderData = {
        clientId,
        createdAt: Date.now(),
        status: 'Pendiente',
        items,
        total,
        notes: notes || null,
        deliveryDate: deliveryDate,
        deliveryType: deliveryType
      };

      showSpinner('Guardando pedido...');
      const orderId = await nrd.orders.create(orderData);
      logger.audit('ENTITY_CREATE', { entity: 'order', id: orderId, data: orderData, uid: user?.uid, email: user?.email, timestamp: Date.now() });
      logger.info('Order created successfully', { orderId, total });
      hideSpinner();
      hideNewOrderForm();
      await showSuccess('Pedido guardado exitosamente');
    }
  } catch (error) {
    hideSpinner();
    logger.error('Failed to save order', error);
    await showError('Error al guardar pedido: ' + error.message);
  }
}

// View order detail
async function viewOrder(orderId) {
  logger.debug('Viewing order', { orderId });
  showSpinner('Cargando pedido...');
  try {
    const order = await nrd.orders.getById(orderId);
    if (!order) {
      hideSpinner();
      logger.warn('Order not found', { orderId });
      await showError('Pedido no encontrado');
      return;
    }
    logger.debug('Order loaded successfully', { orderId, clientId: order.clientId, status: order.status, total: order.total });

    // Get client data from reference (name, phone, address)
    let clientName = 'Cliente desconocido';
    let clientPhone = '';
    let clientAddress = '';
    if (order.clientId) {
      try {
        const client = await nrd.clients.getById(order.clientId);
        if (client) {
          if (client.name) clientName = client.name;
          if (client.phone) clientPhone = String(client.phone).trim();
          if (client.address) clientAddress = String(client.address).trim();
        }
      } catch (error) {
        console.error('Error loading client:', error);
      }
    }

    hideSpinner();

    const listView = document.getElementById('orders-list-view');
    const form = document.getElementById('new-order-form');
    
    if (listView) listView.style.display = 'none';
    if (form) form.classList.add('hidden');
    document.getElementById('order-detail').classList.remove('hidden');

    const date = new Date(order.createdAt);
    const deliveryDate = order.deliveryDate ? new Date(order.deliveryDate) : null;
    
    // Get status and related variables
    const status = order.status || 'Pendiente';
    const statusColor = status === 'Completado' ? 'text-green-600' : status === 'Aceptado' ? 'text-blue-600' : 'text-red-600';
    const canEdit = status === 'Pendiente';
    
    // Format delivery date and time for display
    let deliveryDateStr = 'No especificada';
    if (deliveryDate) {
      deliveryDateStr = `${formatDate24h(deliveryDate)} ${formatTime24h(deliveryDate)}`;
    }
    
    const itemsHtml = (order.items && Array.isArray(order.items)) ? order.items.map(item => `
      <div class="flex justify-between py-3 sm:py-4 border-b border-gray-200">
        <div class="flex-1">
          <div class="font-light text-sm sm:text-base">${escapeHtml(item.productName)}</div>
          <div class="text-xs sm:text-sm text-gray-600">
            ${item.quantity} x $${parseFloat(item.price).toFixed(2)}
          </div>
        </div>
        <div class="font-light text-sm sm:text-base">$${(item.price * item.quantity).toFixed(2)}</div>
      </div>
    `).join('') : '<p class="text-center text-gray-600 py-4 text-sm">No hay productos en este pedido</p>';

    const wazeUrl = clientAddress ? 'https://waze.com/ul?q=' + encodeURIComponent(clientAddress) : '';
    document.getElementById('order-detail-content').innerHTML = `
      <div class="py-4 sm:py-6 mb-4 sm:mb-6">
        <div class="flex justify-between py-2 sm:py-3 border-b border-gray-200 text-sm sm:text-base">
          <span class="text-gray-600 font-light">Cliente:</span>
          <span class="font-light">${escapeHtml(clientName)}</span>
        </div>
        ${clientPhone ? `
        <div class="flex justify-between py-2 sm:py-3 border-b border-gray-200 text-sm sm:text-base">
          <span class="text-gray-600 font-light">Teléfono:</span>
          <span class="font-light">${escapeHtml(clientPhone)}</span>
        </div>
        ` : ''}
        ${clientAddress ? `
        <div class="flex justify-between items-center py-2 sm:py-3 border-b border-gray-200 text-sm sm:text-base gap-2">
          <span class="text-gray-600 font-light shrink-0">Dirección:</span>
          <a href="${wazeUrl}" target="_blank" rel="noopener noreferrer" class="font-light text-blue-600 hover:text-blue-800 hover:underline truncate" title="Abrir en Waze">${escapeHtml(clientAddress)}</a>
        </div>
        ` : ''}
        <div class="flex justify-between py-2 sm:py-3 border-b border-gray-200 text-sm sm:text-base">
          <span class="text-gray-600 font-light">Fecha de Creación:</span>
          <span class="font-light">${formatDate24h(date)} ${formatTime24h(date)}</span>
        </div>
        <div class="flex justify-between py-2 sm:py-3 border-b border-gray-200 text-sm sm:text-base">
          <span class="text-gray-600 font-light">Fecha de Entrega:</span>
          <span class="font-light">${deliveryDateStr}</span>
        </div>
        <div class="flex justify-between py-2 sm:py-3 border-b border-gray-200 text-sm sm:text-base">
          <span class="text-gray-600 font-light">Estado:</span>
          <span class="font-light ${statusColor} font-medium">${escapeHtml(status)}</span>
        </div>
      </div>
      <div class="mt-4 sm:mt-6">
        <h4 class="mb-3 sm:mb-4 text-xs uppercase tracking-wider text-gray-600">Productos:</h4>
        ${itemsHtml}
      </div>
      ${order.notes ? `
      <div class="mt-4 sm:mt-6 pt-4 sm:pt-6 border-t border-gray-200">
        <h4 class="mb-2 sm:mb-3 text-xs uppercase tracking-wider text-gray-600">Observaciones:</h4>
        <p class="text-sm sm:text-base font-light text-gray-700 whitespace-pre-wrap">${renderOrderNotes(order.notes)}</p>
      </div>
      ` : ''}
      <div class="flex justify-between mt-4 sm:mt-6 pt-4 sm:pt-6 border-t border-gray-200 text-sm sm:text-base font-light text-gray-600">
        <span>Total:</span>
        <span class="text-gray-700">$${parseFloat(order.total).toFixed(2)}</span>
      </div>
    `;

    // Store order data for WhatsApp and print
    document.getElementById('order-detail').dataset.orderId = orderId;
    document.getElementById('order-detail').dataset.orderData = JSON.stringify(order);
    
    // Show/hide edit button based on status
    const editBtn = document.getElementById('edit-order-btn');
    if (editBtn) {
      if (canEdit) {
        editBtn.classList.remove('hidden');
        editBtn.onclick = () => editOrder(orderId, order);
      } else {
        editBtn.classList.add('hidden');
      }
    }
    
    // Show delete button for pending (simple confirm) and completed (modal con código)
    const deleteBtn = document.getElementById('delete-order-detail-btn');
    if (deleteBtn) {
      deleteBtn.classList.remove('hidden');
      deleteBtn.onclick = () => deleteOrderHandler(orderId, order);
    }
  } catch (error) {
    hideSpinner();
    await showError('Error al cargar pedido: ' + error.message);
  }
}

// Back to orders list
function backToOrders() {
  function showEl(el) {
    if (el) el.style.removeProperty('display');
  }
  showEl(document.getElementById('orders-list-view'));
  showEl(document.getElementById('orders-search-container'));
  showEl(document.getElementById('date-filter-container'));
  showEl(document.getElementById('orders-list-container'));
  showEl(document.querySelector('#orders-view > .flex.flex-col'));
  showEl(document.getElementById('orders-section-pending'));
  if (hasScheduledOrdersInList) showEl(document.getElementById('orders-section-scheduled'));
  showEl(document.getElementById('orders-section-completed'));
  const detail = document.getElementById('order-detail');
  if (detail) detail.classList.add('hidden');
}

// Set order status to Aceptado e imprime el ticket automáticamente
async function setOrderStatusToAccepted(orderId) {
  showSpinner('Actualizando estado...');
  try {
    await nrd.orders.update(orderId, { status: 'Aceptado' });
    hideSpinner();
    loadOrders();
    const orderDetail = document.getElementById('order-detail');
    if (orderDetail && !orderDetail.classList.contains('hidden')) {
      await viewOrder(orderId);
    }
    // Imprimir ticket al aceptar
    await openOrderAndPrint(orderId);
  } catch (error) {
    hideSpinner();
    await showError('Error al actualizar estado: ' + error.message);
  }
}

// Abre el modal para rechazar pedido con motivo seleccionable
function openRejectOrderModal(orderId) {
  const modal = document.getElementById('reject-order-modal');
  const reasonSelect = document.getElementById('reject-order-reason');
  const cancelBtn = document.getElementById('reject-order-modal-cancel');
  const confirmBtn = document.getElementById('reject-order-modal-confirm');
  if (!modal || !reasonSelect || !cancelBtn || !confirmBtn) return;
  modal.dataset.rejectOrderId = orderId;
  reasonSelect.value = 'Cliente no responde';
  modal.classList.remove('hidden');

  function closeModal() {
    modal.classList.add('hidden');
    cancelBtn.removeEventListener('click', onCancel);
    confirmBtn.removeEventListener('click', onConfirm);
  }
  function onCancel() {
    closeModal();
  }
  async function onConfirm() {
    const id = modal.dataset.rejectOrderId;
    if (!id) return;
    closeModal();
    const reason = (reasonSelect.value || 'Otro').trim();
    await performRejectOrder(id, reason);
  }
  cancelBtn.addEventListener('click', onCancel);
  confirmBtn.addEventListener('click', onConfirm);
}

// Rechaza el pedido con el motivo indicado (se añade a las notas)
async function performRejectOrder(orderId, reason) {
  showSpinner('Rechazando pedido...');
  try {
    const order = await nrd.orders.getById(orderId);
    const existingNotes = (order && order.notes) ? String(order.notes).trim() : '';
    const rejectionNote = 'Rechazado. Motivo: ' + (reason || 'Otro');
    const newNotes = existingNotes ? existingNotes + '\n' + rejectionNote : rejectionNote;
    await nrd.orders.update(orderId, { status: 'Rechazado', notes: newNotes });
    hideSpinner();
    await showSuccess('Pedido rechazado');
    loadOrders();
  } catch (error) {
    hideSpinner();
    await showError('Error al rechazar pedido: ' + error.message);
  }
}

// Set order status to Rechazado (abre modal de motivo)
function setOrderStatusToRejected(orderId) {
  openRejectOrderModal(orderId);
}

// Abrir vista previa de impresión (no abre el detalle del pedido)
async function openOrderAndPrint(orderId) {
  await openPrintPreview(orderId);
}

// Toggle order status (Pendiente/Completado)
async function toggleOrderStatus(orderId, currentStatus) {
  const newStatus = currentStatus === 'Pendiente' || currentStatus === 'Aceptado' ? 'Completado' : 'Pendiente';
  if (newStatus === 'Completado') {
    const order = await nrd.orders.getById(orderId);
    if (order && isOrderScheduled(order)) {
      await showAlert('Pedido programado', 'No se puede completar hasta que el pedido pase a la sección de pendientes (cuando falte 30 min o menos para el horario de retiro).');
      return;
    }
  }
  showSpinner('Actualizando estado...');
  try {
    await nrd.orders.update(orderId, { status: newStatus });
    hideSpinner();
    // Reload orders to reflect the change in the list
    loadOrders();
    // If viewing order detail, reload it
    const orderDetail = document.getElementById('order-detail');
    if (orderDetail && !orderDetail.classList.contains('hidden')) {
      await viewOrder(orderId);
    }
  } catch (error) {
    hideSpinner();
    await showError('Error al actualizar estado: ' + error.message);
  }
}

// Edit order
async function editOrder(orderId, order) {
  // Hide detail view and show form
  document.getElementById('order-detail').classList.add('hidden');
  
  const form = document.getElementById('new-order-form');
  const listView = document.getElementById('orders-list-view');
  
  form.classList.remove('hidden');
  if (listView) listView.style.display = 'none';
  
  // Set form title to indicate editing
  const formTitle = document.getElementById('order-form-title');
  if (formTitle) {
    formTitle.textContent = 'Editar Pedido';
    const orderFormSubtitle = document.getElementById('order-form-subtitle');
    if (orderFormSubtitle) orderFormSubtitle.textContent = 'Modifique los datos del pedido existente';
    // Cambiar color del header a azul para edición
    const orderFormHeader = document.getElementById('order-form-header');
    if (orderFormHeader) {
      orderFormHeader.classList.remove('bg-green-600', 'bg-gray-600');
      orderFormHeader.classList.add('bg-blue-600');
    }
    // Cambiar color del botón finalizar a azul
    const saveOrderBtn = document.getElementById('save-order-btn');
    if (saveOrderBtn) {
      saveOrderBtn.classList.remove('bg-green-600', 'border-green-600', 'hover:bg-green-700');
      saveOrderBtn.classList.add('bg-blue-600', 'border-blue-600', 'hover:bg-blue-700');
    }
  }
  
  // Store order ID for update
  form.dataset.editingOrderId = orderId;
  
  // Load clients and set the selected client
  await loadAvailableClients();
  
  const clientId = order.clientId;
  const client = availableClients.find(c => c.id === clientId);
  
  if (client) {
    currentOrderClient = clientId;
    const clientSelect = document.getElementById('order-client-select');
    if (clientSelect) {
      clientSelect.value = clientId;
    }
    
    // Show selected client display
    const selectedDisplay = document.getElementById('selected-client-display');
    const selectedName = document.getElementById('selected-client-name');
    const selectedPhone = document.getElementById('selected-client-phone');
    const searchInputContainer = document.getElementById('client-search-container');
    
    if (selectedDisplay) selectedDisplay.classList.remove('hidden');
    if (selectedName) selectedName.textContent = client.name || 'Sin nombre';
    if (selectedPhone) {
      selectedPhone.textContent = client.phone || '';
      if (!client.phone) selectedPhone.style.display = 'none';
      else selectedPhone.style.display = 'block';
    }
    
    // Hide search input container when client is selected
    if (searchInputContainer) searchInputContainer.classList.add('hidden');
  }
  
  // Setup client search
  setupClientSearch();
  
  // Load products
  currentOrderProducts = (order.items && Array.isArray(order.items)) ? order.items.map(item => {
    if (item.productId && item.productId.startsWith('custom-')) {
      // Handle custom products
      return {
        productId: item.productId,
        customName: item.productName,
        customPrice: item.price,
        quantity: item.quantity
      };
    } else {
      return {
        productId: item.productId,
        quantity: item.quantity
      };
    }
  }) : [];
  await renderOrderProducts();
  
  // Load discount if exists
  const discountTypeEl = document.getElementById('order-discount-type');
  const discountValueEl = document.getElementById('order-discount-value');
  if (order.discount && discountTypeEl && discountValueEl) {
    currentOrderDiscount = { type: order.discount.type, value: order.discount.value };
    discountTypeEl.value = order.discount.type || '';
    discountValueEl.value = order.discount.value || '';
  } else {
    currentOrderDiscount = { type: '', value: 0 };
    if (discountTypeEl) discountTypeEl.value = '';
    if (discountValueEl) discountValueEl.value = '';
  }
  
  await updateOrderTotal();
  
  // Load notes
  document.getElementById('order-notes').value = order.notes || '';
  
  // Load delivery date and time
  const deliveryDateInput = document.getElementById('order-delivery-date');
  const deliveryTimeInput = document.getElementById('order-delivery-time');
  
  if (order.deliveryDate && deliveryDateInput && deliveryTimeInput) {
    const deliveryDate = new Date(order.deliveryDate);
    const year = deliveryDate.getFullYear();
    const month = String(deliveryDate.getMonth() + 1).padStart(2, '0');
    const day = String(deliveryDate.getDate()).padStart(2, '0');
    const hours = String(deliveryDate.getHours()).padStart(2, '0');
    const minutes = String(deliveryDate.getMinutes()).padStart(2, '0');
    
    deliveryDateInput.value = `${year}-${month}-${day}`;
    deliveryTimeInput.value = `${hours}:${minutes}`;
  }
  const deliveryTypeVal = order.deliveryType || 'envio';
  document.querySelectorAll('input[name="order-delivery-type"]').forEach((radio) => {
    radio.checked = radio.value === deliveryTypeVal;
  });
  document.querySelectorAll('.order-delivery-type-option').forEach((label) => {
    label.classList.toggle('border-red-600', label.dataset.type === deliveryTypeVal);
    label.classList.toggle('border-gray-300', label.dataset.type !== deliveryTypeVal);
  });
  
  // Load available products for search
  await loadAvailableProducts();
  
  // Show step 4 (Detalles - editing mode, all data is loaded)
  showOrderStep(4);
  const totalStep4 = document.getElementById('order-total-step-4');
  const total = document.getElementById('order-total');
  if (totalStep4 && total) {
    totalStep4.textContent = total.textContent;
  }
  
  // Setup product search input
  setupProductSearch();
  
  // Clear product search input
  const searchInput = document.getElementById('product-search-input');
  const resultsDiv = document.getElementById('product-search-results');
  if (searchInput) searchInput.value = '';
  if (resultsDiv) resultsDiv.classList.add('hidden');
  
  // Change save button text
  const saveBtn = document.getElementById('save-order-btn');
  if (saveBtn) {
    saveBtn.textContent = 'Actualizar Pedido';
  }
}

const DELETE_COMPLETED_ORDER_CODE = 'ELIMINAR';

function openDeleteCompletedOrderModal(orderId, order) {
  const modal = document.getElementById('delete-completed-order-modal');
  const input = document.getElementById('delete-completed-order-code-input');
  const confirmBtn = document.getElementById('delete-completed-order-confirm-btn');
  const cancelBtn = document.getElementById('delete-completed-order-cancel');
  if (!modal || !input || !confirmBtn || !cancelBtn) return;

  input.value = '';
  confirmBtn.disabled = true;

  function checkCode() {
    confirmBtn.disabled = (input.value || '').trim().toUpperCase() !== DELETE_COMPLETED_ORDER_CODE;
  }

  input.oninput = checkCode;
  input.onkeyup = checkCode;

  cancelBtn.onclick = () => {
    modal.classList.add('hidden');
    input.oninput = null;
    input.onkeyup = null;
  };

  confirmBtn.onclick = () => {
    if ((input.value || '').trim().toUpperCase() !== DELETE_COMPLETED_ORDER_CODE) return;
    modal.classList.add('hidden');
    input.oninput = null;
    input.onkeyup = null;
    performDeleteOrder(orderId, order);
  };

  modal.classList.remove('hidden');
  input.focus();
}

async function performDeleteOrder(orderId, order) {
  const user = getCurrentUser();
  const status = order?.status || 'Pendiente';
  logger.info('Deleting order', { orderId, status, total: order?.total });
  showSpinner('Eliminando pedido...');
  try {
    await nrd.orders.delete(orderId);
    logger.audit('ENTITY_DELETE', { entity: 'order', id: orderId, uid: user?.uid, email: user?.email, timestamp: Date.now() });
    logger.info('Order deleted successfully', { orderId });
    hideSpinner();
    await showSuccess('Pedido eliminado exitosamente');
    backToOrders();
  } catch (error) {
    hideSpinner();
    logger.error('Failed to delete order', error);
    await showError('Error al eliminar pedido: ' + error.message);
  }
}

// Delete order handler
async function deleteOrderHandler(orderId, order = null) {
  logger.debug('Delete order requested', { orderId });
  if (!order) {
    try {
      order = await nrd.orders.getById(orderId);
    } catch (error) {
      logger.error('Failed to fetch order for deletion', error);
      await showError('Error al obtener información del pedido: ' + error.message);
      return;
    }
    if (!order) {
      await showError('Pedido no encontrado');
      return;
    }
  }

  const status = order.status || 'Pendiente';

  if (status === 'Completado') {
    openDeleteCompletedOrderModal(orderId, order);
    return;
  }

  const confirmed = await showConfirm('Eliminar Pedido', '¿Está seguro de eliminar este pedido? Esta acción no se puede deshacer.');
  if (!confirmed) {
    logger.debug('Order deletion cancelled', { orderId });
    return;
  }

  await performDeleteOrder(orderId, order);
}

/** Construye el texto del mensaje de WhatsApp para un pedido (para cadete o detalle). */
function buildOrderWhatsAppMessage(orderData, clientName, clientAddress, withPrice) {
  let deliveryDateStr = 'No especificada';
  let deliveryDayTimeStr = '';
  if (orderData.deliveryDate) {
    const deliveryDate = new Date(orderData.deliveryDate);
    const daysOfWeek = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
    const dayName = daysOfWeek[deliveryDate.getDay()];
    const dateStr = deliveryDate.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const timeStr = deliveryDate.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
    deliveryDateStr = dateStr;
    deliveryDayTimeStr = `El ${dayName} a las ${timeStr}`;
  }
  let message = `Pedido para: ${escapeHtml(clientName)}\n`;
  message += `Fecha entrega: ${deliveryDateStr}\n`;
  if (deliveryDayTimeStr) message += `${deliveryDayTimeStr}\n`;
  message += '\n';
  if (withPrice && orderData.items && orderData.items.length > 0) {
    let maxQtyLen = 3, maxPriceLen = 6, maxSubtotalLen = 8;
    orderData.items.forEach(item => {
      maxQtyLen = Math.max(maxQtyLen, String(item.quantity).length);
      maxPriceLen = Math.max(maxPriceLen, (`$${parseFloat(item.price).toFixed(2)}`).length);
      maxSubtotalLen = Math.max(maxSubtotalLen, (`$${(item.quantity * parseFloat(item.price)).toFixed(2)}`).length);
    });
    message += `Cant${' '.repeat(Math.max(1, maxQtyLen - 4))} Precio${' '.repeat(Math.max(1, maxPriceLen - 6))} Nombre${' '.repeat(15)} Subtotal\n`;
    message += `${'-'.repeat(maxQtyLen + maxPriceLen + 30 + maxSubtotalLen)}\n`;
    orderData.items.forEach(item => {
      const qtyStr = String(item.quantity).padEnd(maxQtyLen);
      const priceStr = `$${parseFloat(item.price).toFixed(2)}`.padEnd(maxPriceLen);
      const name = escapeHtml(item.productName || '');
      const nameDisplay = name.length > 25 ? name.substring(0, 22) + '...' : name;
      const subtotalStr = `$${(item.quantity * parseFloat(item.price)).toFixed(2)}`.padStart(maxSubtotalLen);
      message += `${qtyStr} ${priceStr} ${nameDisplay.padEnd(25)} ${subtotalStr}\n`;
    });
    message += `\nTOTAL: $${parseFloat(orderData.total).toFixed(2)}`;
  } else if (orderData.items && Array.isArray(orderData.items)) {
    orderData.items.forEach(item => {
      message += `• ${item.quantity} ${escapeHtml(item.productName || '')}\n`;
    });
  }
  if (orderData.notes && orderData.notes.trim()) {
    message += `\n\n${escapeHtml(stripNotesHtml(orderData.notes))}`;
  }
  const addressFromNotes = getAddressFromOrderNotes(orderData.notes);
  const deliveryAddress = (orderData.deliveryAddress && String(orderData.deliveryAddress).trim()) || clientAddress || addressFromNotes;
  if (deliveryAddress) {
    message += `\n\n📍 Dirección: ${escapeHtml(deliveryAddress)}`;
    message += `\n\n🗺 Abrir en Waze: https://waze.com/ul?q=${encodeURIComponent(deliveryAddress)}`;
  }
  return message;
}

// Send WhatsApp message (desde detalle del pedido)
async function sendWhatsAppMessage() {
  const orderDetail = document.getElementById('order-detail');
  const orderData = JSON.parse(orderDetail.dataset.orderData);

  const option = await showConfirmWithOptions('Enviar por WhatsApp', '¿Desea incluir los precios en el mensaje?', 'Con Precio', 'Sin Precio');
  if (!option) return;
  const withPrice = option === 'option1';

  showSpinner('Preparando mensaje...');
  try {
    let clientName = 'Cliente desconocido';
    let clientAddress = '';
    if (orderData.clientId) {
      try {
        const client = await nrd.clients.getById(orderData.clientId);
        if (client) {
          if (client.name) clientName = client.name;
          if (client.address) clientAddress = String(client.address).trim();
        }
      } catch (e) { console.error('Error loading client:', e); }
    }
    const message = buildOrderWhatsAppMessage(orderData, clientName, clientAddress, withPrice);
    window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, '_blank');
  } catch (error) {
    await showError('Error al generar mensaje de WhatsApp: ' + error.message);
  } finally {
    hideSpinner();
  }
}

/** Abre WhatsApp para enviar al cadete: solo nombre del cliente y URL de Waze. */
async function openWhatsAppOrderForCadete(orderId) {
  showSpinner('Preparando mensaje...');
  try {
    const order = await nrd.orders.getById(orderId);
    if (!order) { await showError('Pedido no encontrado'); return; }
    let clientName = 'Cliente desconocido';
    let clientAddress = '';
    if (order.clientId) {
      try {
        const client = await nrd.clients.getById(order.clientId);
        if (client) {
          if (client.name) clientName = client.name;
          if (client.address) clientAddress = String(client.address).trim();
        }
      } catch (e) { console.error('Error loading client:', e); }
    }
    const addressFromNotes = getAddressFromOrderNotes(order.notes);
    const deliveryAddress = (order.deliveryAddress && String(order.deliveryAddress).trim()) || clientAddress || addressFromNotes;
    const orderCode = orderIdToShortCode(orderId);
    const createdAtStr = order.createdAt ? (formatDate24h(new Date(order.createdAt)) + ' ' + formatTime24h(new Date(order.createdAt))) : '';
    let message = orderCode ? 'Nuevo Pedido #' + orderCode : 'Nuevo Pedido';
    if (createdAtStr) message += '\n' + createdAtStr;
    message += '\n\n' + clientName;
    if (deliveryAddress) {
      const wazeUrl = 'https://waze.com/ul?q=' + encodeURIComponent(deliveryAddress);
      message += '\n\n' + wazeUrl;
    }
    window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, '_blank');
  } catch (error) {
    await showError('Error al generar mensaje: ' + (error.message || error));
  } finally {
    hideSpinner();
  }
}

/** Normaliza teléfono para WhatsApp Uruguay: quita cero inicial y asegura prefijo 598 (sin + en resultado para URL). */
function formatPhoneForWhatsApp(raw) {
  let digits = String(raw || '').replace(/\s+/g, '').replace(/\D/g, '');
  if (digits.startsWith('0')) digits = digits.slice(1);
  if (!digits) return '';
  if (digits.startsWith('598')) return digits;
  return '598' + digits;
}

/** Abre WhatsApp para contactar al cliente: número formateado +598 sin cero inicial y mensaje inicial por el pedido. */
async function openWhatsAppContactClient(orderId) {
  try {
    const order = await nrd.orders.getById(orderId);
    if (!order || !order.clientId) { await showError('Pedido o cliente no encontrado'); return; }
    const client = await nrd.clients.getById(order.clientId);
    if (!client || !client.phone) { await showError('El cliente no tiene número de teléfono registrado'); return; }
    const phoneForUrl = formatPhoneForWhatsApp(client.phone);
    if (!phoneForUrl) { await showError('Número de teléfono no válido'); return; }
    const clientName = (client.name || 'Cliente').trim();
    const orderCode = orderId ? orderIdToShortCode(orderId) : '';
    const message = orderCode
      ? `Hola ${clientName}, te contacto por el pedido #${orderCode}.`
      : `Hola ${clientName}, te contacto por tu pedido.`;
    const url = `https://wa.me/${phoneForUrl}?text=${encodeURIComponent(message)}`;
    window.open(url, '_blank');
  } catch (error) {
    await showError('Error: ' + (error.message || error));
  }
}

/** Construye HTML de vista previa del ticket (estilo 80mm). */
function buildPrintPreviewHTML(orderData, clientName, clientPhone, withPrice, orderId) {
  const orderCode = orderId ? orderIdToShortCode(orderId) : '';
  let createdAtStr = orderData.createdAt ? (formatDate24h(new Date(orderData.createdAt)) + ' ' + formatTime24h(new Date(orderData.createdAt))) : '-';
  let deliveryDateStr = 'No especificada';
  if (orderData.deliveryDate) {
    const d = new Date(orderData.deliveryDate);
    const days = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
    deliveryDateStr = days[d.getDay()] + ' ' + d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' }) + ' ' + formatTime24h(d);
  }
  const statusLabel = (orderData.status || 'Pendiente').toUpperCase();
  let rows = '';
  if (orderData.items && orderData.items.length) {
    orderData.items.forEach((item) => {
      const qty = item.quantity;
      const name = escapeHtml(item.productName || '');
      const price = parseFloat(item.price);
      const sub = qty * price;
      if (withPrice) {
        rows += `<div class="flex items-baseline gap-1 text-xs"><span class="flex-1 min-w-0">${qty} ${name}</span><span class="w-14 text-right shrink-0 tabular-nums">$${price.toFixed(2)}</span><span class="w-14 text-right shrink-0 tabular-nums">$${sub.toFixed(2)}</span></div>`;
      } else {
        rows += `<div class="text-xs">${qty} ${name}</div>`;
      }
    });
  }
  const totalLine = withPrice ? `<div class="border-t border-black mt-1 pt-1 text-xs font-bold text-right">TOTAL: $${parseFloat(orderData.total).toFixed(2)}</div>` : '';
  const notesHtml = (orderData.notes && orderData.notes.trim()) ? `<div class="border-t border-black mt-1 pt-1 text-xs text-left"><strong>Observaciones:</strong><div class="whitespace-pre-wrap">${escapeHtml(stripNotesHtml(orderData.notes))}</div></div>` : '';
  const telLine = clientPhone ? `<div class="text-xs"><strong>Tel:</strong> ${escapeHtml(clientPhone)}</div>` : '';
  const codeLine = orderCode ? `<div class="text-xs font-bold text-gray-900 mb-0.5">#${escapeHtml(orderCode)}</div>` : '';
  return `
    <div class="print-preview-ticket bg-white text-black p-3 text-center shadow-inner" style="width: 80mm; min-width: 80mm; font-family: monospace; font-size: 11px;">
      <div class="font-bold text-sm mb-1">*** PEDIDO ***</div>
      ${codeLine}
      <hr class="border-black my-1"/>
      <div class="text-left space-y-0.5">
        <div class="text-xs"><strong>Cliente:</strong> ${escapeHtml(clientName)}</div>
        ${telLine}
        <div class="text-xs"><strong>Fecha pedido:</strong> ${escapeHtml(createdAtStr)}</div>
        <div class="text-xs"><strong>Entrega:</strong> ${escapeHtml(deliveryDateStr)}</div>
        <div class="text-xs"><strong>Estado:</strong> ${escapeHtml(statusLabel)}</div>
      </div>
      <hr class="border-black my-1"/>
      <div class="text-left space-y-0.5">${rows}</div>
      ${totalLine}
      ${notesHtml}
      <hr class="border-black mt-2 mb-1"/>
      <div class="text-xs">--- Fin del ticket ---</div>
    </div>
  `;
}

/** Abre el modal de vista previa de impresión; al aceptar, imprime. No abre el detalle del pedido. */
async function openPrintPreview(orderId, orderDataOptional) {
  let orderData = orderDataOptional;
  if (!orderData && orderId) {
    showSpinner('Cargando pedido...');
    try {
      orderData = await nrd.orders.getById(orderId);
    } finally {
      hideSpinner();
    }
  }
  if (!orderData) {
    await showError('Pedido no encontrado');
    return;
  }

  let clientName = 'Cliente desconocido';
  let clientPhone = '';
  if (orderData.clientId) {
    try {
      const client = await nrd.clients.getById(orderData.clientId);
      if (client) {
        if (client.name) clientName = client.name;
        if (client.phone) clientPhone = String(client.phone).trim();
      }
    } catch (e) { console.error('Error loading client:', e); }
  }
  if (!clientPhone && orderData.notes) {
    const telMatch = orderData.notes.match(/Tel[:\s]*([^\n]+)/i);
    if (telMatch) clientPhone = telMatch[1].trim();
  }

  const modal = document.getElementById('print-preview-modal');
  const contentEl = document.getElementById('print-preview-content');
  const withPriceCheck = document.getElementById('print-preview-with-price');
  const cancelBtn = document.getElementById('print-preview-cancel');
  const closeBtn = document.getElementById('print-preview-close');
  const confirmBtn = document.getElementById('print-preview-confirm');
  if (!modal || !contentEl || !withPriceCheck) return;

  function renderPreview() {
    const withPrice = withPriceCheck.checked;
    contentEl.innerHTML = buildPrintPreviewHTML(orderData, clientName, clientPhone, withPrice, orderId || null);
  }

  withPriceCheck.checked = true;
  renderPreview();
  withPriceCheck.addEventListener('change', renderPreview);

  modal.classList.remove('hidden');

  function closeModal() {
    modal.classList.add('hidden');
    withPriceCheck.removeEventListener('change', renderPreview);
    cancelBtn.removeEventListener('click', onCancel);
    closeBtn.removeEventListener('click', onCancel);
    confirmBtn.removeEventListener('click', onConfirm);
  }
  function onCancel() { closeModal(); }
  async function onConfirm() {
    const withPrice = withPriceCheck.checked;
    closeModal();
    await performPrintOrder(orderData, withPrice, clientName, clientPhone, orderId || null);
  }
  cancelBtn.addEventListener('click', onCancel);
  closeBtn.addEventListener('click', onCancel);
  confirmBtn.addEventListener('click', onConfirm);
}

/** Genera el PDF y abre el cuadro de impresión (misma lógica que antes). */
async function performPrintOrder(orderData, withPrice, clientName, clientPhone, orderId) {
  try {
    const orderCode = orderId ? orderIdToShortCode(orderId) : '';
    // Fecha/hora del pedido (creación)
    let createdAtStr = '';
    if (orderData.createdAt) {
      const d = new Date(orderData.createdAt);
      createdAtStr = formatDate24h(d) + ' ' + formatTime24h(d);
    } else {
      createdAtStr = '-';
    }

    // Format delivery date with day of week (same as WhatsApp)
    let deliveryDateStr = 'No especificada';
    if (orderData.deliveryDate) {
      const deliveryDate = new Date(orderData.deliveryDate);
      const daysOfWeek = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
      const dayName = daysOfWeek[deliveryDate.getDay()];
      const dateStr = deliveryDate.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
      const timeStr = formatTime24h(deliveryDate);
      deliveryDateStr = dayName + ' ' + dateStr + ' ' + timeStr;
    }

    const statusLabel = (orderData.status || 'Pendiente').toUpperCase();
    
    // Create PDF using jsPDF - 80mm width x 210mm height (thermal printer size)
    const { jsPDF } = window.jspdf;
    // 80mm = 226.77 points, 210mm = 595.28 points (1mm = 2.83465 points)
    const width = 80 * 2.83465; // 226.77 points
    const height = 210 * 2.83465; // 595.28 points (210mm)
    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'pt',
      format: [width, height] // 80mm x 210mm
    });
    
    // Set minimal margins (same as report)
    const margin = 2;
    const maxWidth = width - (margin * 2); // Available width
    let yPos = margin + 10;
    const lineHeight = 10;
    const fontSize = 9;
    
    // Helper function to get current page height (accounts for new pages)
    const getCurrentPageHeight = () => doc.internal.pageSize.getHeight();
    
    // Calculate fixed width for quantities (using "999" as reference for 3 digits)
    const quantityWidth = doc.getTextWidth('999');
    
    // Helper function to format quantity with fixed width positioning
    function formatQuantityWithPosition(qty, xPos) {
      const qtyStr = String(qty);
      const qtyWidth = doc.getTextWidth(qtyStr);
      // Calculate padding to align to the right within the fixed width
      const padding = quantityWidth - qtyWidth;
      return { text: qtyStr, x: xPos + padding };
    }
    
    // Helper function to split long text into multiple lines
    function splitText(text, maxWidth) {
      const words = text.split(' ');
      const lines = [];
      let currentLine = '';
      
      words.forEach(word => {
        // Check if the word itself is longer than maxWidth
        const wordWidth = doc.getTextWidth(word);
        
        if (wordWidth > maxWidth) {
          // Word is too long, need to split it character by character
          if (currentLine) {
            // Save current line first
            lines.push(currentLine);
            currentLine = '';
          }
          
          // Split the long word
          let wordPart = '';
          for (let i = 0; i < word.length; i++) {
            const testPart = wordPart + word[i];
            const testWidth = doc.getTextWidth(testPart);
            
            if (testWidth > maxWidth && wordPart) {
              lines.push(wordPart);
              wordPart = word[i];
            } else {
              wordPart = testPart;
            }
          }
          
          if (wordPart) {
            currentLine = wordPart;
          }
        } else {
          // Word fits, try to add it to current line
          const testLine = currentLine + (currentLine ? ' ' : '') + word;
          const testWidth = doc.getTextWidth(testLine);
          
          if (testWidth > maxWidth && currentLine) {
            // Current line is full, start new line
            lines.push(currentLine);
            currentLine = word;
          } else {
            // Add word to current line
            currentLine = testLine;
          }
        }
      });
      
      // Add remaining line
      if (currentLine) {
        lines.push(currentLine);
      }
      
      return lines;
    }
    
    // Header estilo ticket térmico: título centrado, sin fondo (impresoras térmicas)
    doc.setFontSize(fontSize + 3);
    doc.setFont(undefined, 'bold');
    const headerText = '*** PEDIDO ***';
    const headerWidth = doc.getTextWidth(headerText);
    doc.text(headerText, margin + (maxWidth - headerWidth) / 2, yPos);
    yPos += lineHeight + 2;
    if (orderCode) {
      doc.setFontSize(fontSize);
      const codeText = '#' + orderCode;
      const codeWidth = doc.getTextWidth(codeText);
      doc.text(codeText, margin + (maxWidth - codeWidth) / 2, yPos);
      yPos += lineHeight;
    }
    // Línea separadora (trazo para térmica)
    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(0.3);
    doc.line(margin, yPos, margin + maxWidth, yPos);
    yPos += lineHeight;

    doc.setFontSize(fontSize);
    doc.setFont(undefined, 'bold');
    doc.text('Cliente:', margin, yPos);
    doc.setFont(undefined, 'normal');
    const clientLines = splitText(clientName, maxWidth - doc.getTextWidth('Cliente: '));
    doc.text(clientLines[0], margin + doc.getTextWidth('Cliente: '), yPos);
    yPos += lineHeight;
    for (let i = 1; i < clientLines.length; i++) {
      doc.text(clientLines[i], margin, yPos);
      yPos += lineHeight;
    }
    if (clientPhone) {
      doc.setFont(undefined, 'bold');
      doc.text('Tel:', margin, yPos);
      doc.setFont(undefined, 'normal');
      doc.text(clientPhone, margin + doc.getTextWidth('Tel: '), yPos);
      yPos += lineHeight;
    }
    doc.setFont(undefined, 'bold');
    doc.text('Fecha pedido:', margin, yPos);
    doc.setFont(undefined, 'normal');
    doc.text(createdAtStr, margin + doc.getTextWidth('Fecha pedido: '), yPos);
    yPos += lineHeight;
    doc.setFont(undefined, 'bold');
    doc.text('Entrega:', margin, yPos);
    doc.setFont(undefined, 'normal');
    doc.text(deliveryDateStr, margin + doc.getTextWidth('Entrega: '), yPos);
    yPos += lineHeight;
    doc.setFont(undefined, 'bold');
    doc.text('Estado:', margin, yPos);
    doc.setFont(undefined, 'normal');
    doc.text(statusLabel, margin + doc.getTextWidth('Estado: '), yPos);
    yPos += lineHeight + 2;
    doc.setDrawColor(0, 0, 0);
    doc.line(margin, yPos, margin + maxWidth, yPos);
    yPos += lineHeight;
    
    // Products
    doc.setFontSize(fontSize);
    doc.setFont(undefined, 'bold');
    
    if (withPrice) {
      // With prices: calculate fixed column positions based on maximum widths
      // Calculate maximum widths for price and subtotal columns
      let maxPriceWidth = 0;
      let maxSubtotalWidth = 0;
      
      if (orderData.items && Array.isArray(orderData.items)) {
        orderData.items.forEach(item => {
          const price = parseFloat(item.price);
          const subtotal = item.quantity * price;
          const priceStr = `$${price.toFixed(2)}`;
          const subtotalStr = `$${subtotal.toFixed(2)}`;
          maxPriceWidth = Math.max(maxPriceWidth, doc.getTextWidth(priceStr));
          maxSubtotalWidth = Math.max(maxSubtotalWidth, doc.getTextWidth(subtotalStr));
        });
      }
      
      // Define fixed column positions (same for all items)
      const quantityX = margin;
      const spacing = doc.getTextWidth(' '); // Space between columns (reduced from '  ')
      const rightEdge = margin + maxWidth;
      
      // Position subtotal at the right edge (using max width)
      const subtotalX = rightEdge - maxSubtotalWidth;
      // Position price before subtotal with spacing (using max width)
      const priceX = subtotalX - spacing - maxPriceWidth;
      // Position for product name (between quantity and price)
      const productNameX = quantityX + quantityWidth + spacing;
      const availableWidthForName = priceX - productNameX - spacing;
      
      if (orderData.items && Array.isArray(orderData.items)) {
        orderData.items.forEach(item => {
          const quantity = item.quantity;
          const price = parseFloat(item.price);
          const subtotal = quantity * price;
          const quantityStr = String(quantity);
          const priceStr = `$${price.toFixed(2)}`;
          const subtotalStr = `$${subtotal.toFixed(2)}`;
          
          const qtyPos = formatQuantityWithPosition(quantity, quantityX);
          const productNameText = item.productName;
          const productLines = splitText(productNameText, Math.max(availableWidthForName, maxWidth * 0.3));
          
          // Calculate alignment for price and subtotal (right-aligned within their columns)
          const priceWidth = doc.getTextWidth(priceStr);
          const priceAlignedX = priceX + (maxPriceWidth - priceWidth);
          const subtotalWidth = doc.getTextWidth(subtotalStr);
          const subtotalAlignedX = subtotalX + (maxSubtotalWidth - subtotalWidth);
          
          // Draw quantity (no bullet)
          doc.setFont(undefined, 'bold');
          doc.text(qtyPos.text, qtyPos.x, yPos);
          doc.setFont(undefined, 'normal');
          
          // Draw first line of product name
          if (productLines.length > 0) {
            doc.text(productLines[0], productNameX, yPos);
          }
          
          // Draw price and subtotal on the right (on first line) - right-aligned
          doc.setFont(undefined, 'normal');
          doc.text(priceStr, priceAlignedX, yPos);
          doc.setFont(undefined, 'bold');
          doc.text(subtotalStr, subtotalAlignedX, yPos);
          
          // Draw remaining lines of product name (if any) on new lines
          for (let idx = 1; idx < productLines.length; idx++) {
            yPos += lineHeight;
            doc.setFont(undefined, 'normal');
            doc.text(productLines[idx], productNameX, yPos);
          }
          
          yPos += lineHeight;
          
          // Check if we need a new page
          if (yPos > getCurrentPageHeight() - 30) {
            doc.addPage();
            yPos = margin + 10;
            doc.setFont(undefined, 'bold');
          }
        });
      }
    } else {
      // Without prices: show only quantity and name
      // Calculate position for quantity (bullet + space) - fixed for all items
      const bulletX = margin;
      const quantityX = bulletX + doc.getTextWidth('• ');
      const productNameX = quantityX + quantityWidth + doc.getTextWidth(' ');
      
      orderData.items.forEach(item => {
        const quantity = item.quantity;
        const qtyPos = formatQuantityWithPosition(quantity, quantityX);
        
        // Draw product name after quantity (normal weight)
        doc.setFont(undefined, 'normal');
        const productNameText = item.productName;
        const productLines = splitText(productNameText, maxWidth - (productNameX - margin));
        
        // Draw bullet and quantity only on first line
        doc.text('•', bulletX, yPos);
        doc.setFont(undefined, 'bold');
        doc.text(qtyPos.text, qtyPos.x, yPos);
        doc.setFont(undefined, 'normal');
        
        // Draw first line of product name
        if (productLines.length > 0) {
          doc.text(productLines[0], productNameX, yPos);
        }
        
        // Draw remaining lines of product name (if any) on new lines
        for (let idx = 1; idx < productLines.length; idx++) {
          yPos += lineHeight;
          doc.text(productLines[idx], productNameX, yPos);
        }
        
        yPos += lineHeight;
        
        // Check if we need a new page
        if (yPos > getCurrentPageHeight() - 30) {
          doc.addPage();
          yPos = margin + 10;
          doc.setFont(undefined, 'bold'); // Keep bold on new page
        }
      });
    }
    
    // Línea antes del total (térmica: negro)
    if (withPrice) {
      yPos += 2;
      doc.setDrawColor(0, 0, 0);
      doc.setLineWidth(0.3);
      doc.line(margin, yPos, margin + maxWidth, yPos);
      yPos += lineHeight;
      
      // Total
      doc.setFontSize(fontSize + 1);
      doc.setFont(undefined, 'bold');
      const totalStr = `TOTAL: $${parseFloat(orderData.total).toFixed(2)}`;
      const totalX = maxWidth + margin - doc.getTextWidth(totalStr);
      doc.text(totalStr, totalX, yPos);
      yPos += lineHeight + 3;
    }
    
    if (orderData.notes && orderData.notes.trim()) {
      yPos += 2;
      doc.setDrawColor(0, 0, 0);
      doc.setLineWidth(0.3);
      doc.line(margin, yPos, margin + maxWidth, yPos);
      yPos += lineHeight;
    }
    
    // Observations
    if (orderData.notes && orderData.notes.trim()) {
      doc.setFontSize(fontSize - 1); // Smaller font for notes
      doc.setFont(undefined, 'bold'); // Bold for notes
      // Use a larger line height for smaller font to prevent overlap
      // Calculate line height based on font size: fontSize-1 needs more vertical space
      // Use at least 1.5x the font size to ensure no overlap with descenders
      const notesLineHeight = Math.max(lineHeight + 2, (fontSize - 1) * 1.5);
      const notesLabel = 'Observaciones:';
      doc.text(notesLabel, margin, yPos);
      yPos += notesLineHeight; // Line height for label
      
      // Check if we need a new page
      if (yPos > getCurrentPageHeight() - 30) {
        doc.addPage();
        yPos = margin + 10;
        doc.setFont(undefined, 'bold');
        doc.setFontSize(fontSize - 1); // Keep smaller font
      }
      
      // Calculate available width for notes (accounting for indent)
      // IMPORTANT: getTextWidth uses current font size, so this is correct
      const notesIndent = doc.getTextWidth(' ');
      const notesMaxWidth = maxWidth - notesIndent;
      
      // Split notes text - use plain text (no HTML) for PDF; preserve line breaks
      const notesPlain = stripNotesHtml(orderData.notes);
      const noteParagraphs = notesPlain.split('\n');
      const notesLines = [];
      
      noteParagraphs.forEach(paragraph => {
        if (paragraph.trim()) {
          const wrappedLines = splitText(paragraph.trim(), notesMaxWidth);
          notesLines.push(...wrappedLines);
        }
      });
      
      // Draw each line separately with proper spacing
      // CRITICAL: Each line must be drawn at a different yPos
      notesLines.forEach((line, idx) => {
        // Draw the line with indent at current yPos
        doc.text(` ${line}`, margin, yPos);
        
        // CRITICAL: Always increment yPos AFTER drawing, BEFORE next iteration
        // This ensures each line is drawn at a unique vertical position
        yPos += notesLineHeight;
        
        // Check if we need a new page AFTER incrementing
        if (yPos > getCurrentPageHeight() - 30) {
          doc.addPage();
          yPos = margin + 10;
          doc.setFont(undefined, 'bold');
          doc.setFontSize(fontSize - 1); // Keep smaller font
        }
      });
      // Add small spacing after all notes lines
      yPos += 2;
      
      doc.setFontSize(fontSize);
    }
    // Cierre del ticket
    yPos += 4;
    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(0.3);
    doc.line(margin, yPos, margin + maxWidth, yPos);
    yPos += lineHeight;
    doc.setFont(undefined, 'normal');
    doc.setFontSize(fontSize - 1);
    const footerText = '--- Fin del ticket ---';
    const footerW = doc.getTextWidth(footerText);
    doc.text(footerText, margin + (maxWidth - footerW) / 2, yPos);

    // Open print dialog instead of downloading
    const pdfBlob = doc.output('blob');
    const pdfUrl = URL.createObjectURL(pdfBlob);
    const printWindow = window.open(pdfUrl);
    
    if (printWindow) {
      printWindow.onload = () => {
        printWindow.print();
        // Clean up the URL after printing
        setTimeout(() => {
          URL.revokeObjectURL(pdfUrl);
        }, 1000);
      };
    }
  } catch (error) {
    console.error('Error generating PDF:', error);
    await showError('Error al generar PDF: ' + error.message);
  }
}

// Generate product summary report
async function generateProductReport() {
  // Show report modal with date picker and action buttons
  const result = await showReportModal();
  
  if (!result) {
    return; // User cancelled
  }
  
  const { selectedDate, action } = result;
  
  showSpinner('Generando reporte...');
  try {
    // Get all orders using NRD Data Access
    const ordersArray = await nrd.orders.getAll();
    const orders = Array.isArray(ordersArray) 
      ? ordersArray.reduce((acc, order) => {
          if (order && order.id) {
            acc[order.id] = order;
          }
          return acc;
        }, {})
      : ordersArray || {};
    
    if (Object.keys(orders).length === 0) {
      hideSpinner();
      await showInfo('No hay pedidos para generar el reporte');
      return;
    }
    
    // Parse selected date (YYYY-MM-DD) - parse manually to avoid timezone issues
    const dateParts = selectedDate.split('-');
    const year = parseInt(dateParts[0], 10);
    const month = parseInt(dateParts[1], 10) - 1; // Month is 0-indexed
    const day = parseInt(dateParts[2], 10);
    
    // Create date objects in local timezone
    const selectedDateObj = new Date(year, month, day);
    const selectedDateStart = new Date(year, month, day, 0, 0, 0, 0).getTime();
    const selectedDateEnd = new Date(year, month, day, 23, 59, 59, 999).getTime();
    
    console.log('Filtering orders for date:', selectedDate, 'Range:', new Date(selectedDateStart), 'to', new Date(selectedDateEnd));
    
    // Filter orders by delivery date
    const filteredOrders = Object.values(orders).filter(order => {
      if (!order.deliveryDate) {
        console.log('Order has no deliveryDate:', order);
        return false;
      }
      const deliveryDate = order.deliveryDate;
      const deliveryDateObj = new Date(deliveryDate);
      const isInRange = deliveryDate >= selectedDateStart && deliveryDate <= selectedDateEnd;
      console.log('Order delivery date:', new Date(deliveryDate), 'In range?', isInRange);
      return isInRange;
    });
    
    console.log('Filtered orders count:', filteredOrders.length, 'out of', Object.keys(orders).length);
    
    if (filteredOrders.length === 0) {
      hideSpinner();
      await showInfo('No hay pedidos con fecha de entrega ' + formatDate24h(selectedDateObj));
      return;
    }
    
    // Sort orders by delivery time (hour)
    filteredOrders.sort((a, b) => {
      const timeA = a.deliveryDate ? new Date(a.deliveryDate).getTime() : 0;
      const timeB = b.deliveryDate ? new Date(b.deliveryDate).getTime() : 0;
      return timeA - timeB;
    });
    
    // Aggregate products by name
    const productSummary = {};
    
    filteredOrders.forEach(order => {
      if (order.items && Array.isArray(order.items)) {
        order.items.forEach(item => {
          const productName = item.productName;
          if (productSummary[productName]) {
            productSummary[productName] += item.quantity;
          } else {
            productSummary[productName] = item.quantity;
          }
        });
      }
    });
    
    // Sort products by name
    const sortedProducts = Object.entries(productSummary)
      .sort((a, b) => a[0].localeCompare(b[0]));
    
    // Calculate total items
    const totalItems = Object.values(productSummary).reduce((sum, qty) => sum + qty, 0);
    
    // Load clients to get names for orders using NRD Data Access
    const clientsArray = await nrd.clients.getAll();
    const clients = Array.isArray(clientsArray) 
      ? clientsArray.reduce((acc, client, index) => {
          acc[index] = client;
          return acc;
        }, {})
      : clientsArray || {};
    const clientsMap = {};
    Object.entries(clients).forEach(([id, client]) => {
      clientsMap[id] = client;
    });
    
    hideSpinner();
    
    // Generate PDF if action is print
    if (action === 'print') {
      showSpinner('Generando PDF...');
      const { jsPDF } = window.jspdf;
      // 80mm width x 210mm height for thermal printer (rotativa térmica)
      const width = 80 * 2.83465; // 226.77 points
      const height = 210 * 2.83465; // 595.28 points (210mm)
      // Set minimal margins and line height
      const margin = 2;
      const lineHeight = 10;
      const fontSize = 9;
      
      // Create PDF with fixed 210mm height (thermal printer paper size)
      // jsPDF will automatically create new pages when content exceeds height
      const doc = new jsPDF({
        orientation: 'portrait',
        unit: 'pt',
        format: [width, height] // 80mm x 210mm
      });
    
      // Use the already defined margin and lineHeight
      const maxWidth = width - (margin * 2);
      let yPos = margin + 10;
      
      // Helper function to get current page height (accounts for new pages)
      const getCurrentPageHeight = () => doc.internal.pageSize.getHeight();
      
      // Calculate fixed width for quantities (using "999" as reference for 3 digits)
      const quantityWidth = doc.getTextWidth('999');
      
      // Helper function to format quantity with fixed width positioning
      function formatQuantityWithPosition(qty, xPos) {
        const qtyStr = String(qty);
        const qtyWidth = doc.getTextWidth(qtyStr);
        // Calculate padding to align to the right within the fixed width
        const padding = quantityWidth - qtyWidth;
        return { text: qtyStr, x: xPos + padding };
      }
      
      // Helper function to split long text
      function splitText(text, maxWidth) {
        const words = text.split(' ');
        const lines = [];
        let currentLine = '';
        
        words.forEach(word => {
          // Check if the word itself is longer than maxWidth
          const wordWidth = doc.getTextWidth(word);
          
          if (wordWidth > maxWidth) {
            // Word is too long, need to split it character by character
            if (currentLine) {
              // Save current line first
              lines.push(currentLine);
              currentLine = '';
            }
            
            // Split the long word
            let wordPart = '';
            for (let i = 0; i < word.length; i++) {
              const testPart = wordPart + word[i];
              const testWidth = doc.getTextWidth(testPart);
              
              if (testWidth > maxWidth && wordPart) {
                lines.push(wordPart);
                wordPart = word[i];
              } else {
                wordPart = testPart;
              }
            }
            
            if (wordPart) {
              currentLine = wordPart;
            }
          } else {
            // Word fits, try to add it to current line
            const testLine = currentLine + (currentLine ? ' ' : '') + word;
            const testWidth = doc.getTextWidth(testLine);
            
            if (testWidth > maxWidth && currentLine) {
              // Current line is full, start new line
              lines.push(currentLine);
              currentLine = word;
            } else {
              // Add word to current line
              currentLine = testLine;
            }
          }
        });
        
        // Add remaining line
        if (currentLine) {
          lines.push(currentLine);
        }
        
        return lines;
      }
      
      // Header: REPORTE DEL DÍA with gray background
      doc.setFontSize(fontSize + 4);
      doc.setFont(undefined, 'bold');
      const headerText = 'REPORTE DEL DÍA';
      const headerHeight = lineHeight + 4;
      
      // Draw gray background
      doc.setFillColor(200, 200, 200); // Gray color
      doc.rect(margin, yPos - headerHeight + 2, maxWidth, headerHeight, 'F');
      
      // Draw text on gray background
      doc.setTextColor(0, 0, 0); // Black text
      const headerLines = splitText(headerText, maxWidth);
      headerLines.forEach(line => {
        doc.text(line, margin, yPos);
        yPos += lineHeight + 2;
      });
      yPos += 3;
      
      // Date with "Fecha:" prefix
      doc.setFontSize(fontSize + 1);
      doc.setFont(undefined, 'bold');
      const dateText = `Fecha: ${formatDate24h(selectedDateObj)}`;
      doc.text(dateText, margin, yPos);
      yPos += lineHeight + 5;
      
      // RESUMEN section
      doc.setFontSize(fontSize + 1);
      doc.setFont(undefined, 'bold');
      doc.text('RESUMEN', margin, yPos);
      yPos += lineHeight + 3;
      
      // Products summary section
      doc.setFontSize(fontSize);
      doc.setFont(undefined, 'bold');
      
      sortedProducts.forEach(([productName, quantity]) => {
        // Calculate position for quantity (bullet + space)
        const bulletX = margin;
        const quantityX = bulletX + doc.getTextWidth('• ');
        const qtyPos = formatQuantityWithPosition(quantity, quantityX);
        
        // Draw product name after quantity (bold)
        doc.setFont(undefined, 'bold');
        const productNameX = quantityX + quantityWidth + doc.getTextWidth(' ');
        const productNameText = productName;
        const productLines = splitText(productNameText, maxWidth - (productNameX - margin));
        
        // Draw bullet and quantity only on first line
        doc.text('•', bulletX, yPos);
        doc.setFont(undefined, 'bold');
        doc.text(qtyPos.text, qtyPos.x, yPos);
        doc.setFont(undefined, 'bold');
        
        // Draw first line of product name
        if (productLines.length > 0) {
          doc.text(productLines[0], productNameX, yPos);
        }
        
        // Draw remaining lines of product name (if any) on new lines
        for (let idx = 1; idx < productLines.length; idx++) {
          yPos += lineHeight;
          doc.text(productLines[idx], productNameX, yPos);
        }
        
        yPos += lineHeight + 2; // Add small spacing between products
        
        // Check if we need a new page
        if (yPos > getCurrentPageHeight() - 30) {
          doc.addPage();
          yPos = margin + 10;
          doc.setFont(undefined, 'bold');
        }
      });
      
      // Total
      yPos += lineHeight;
      doc.setFontSize(fontSize + 1);
      doc.setFont(undefined, 'bold');
      const totalText = `TOTAL: ${totalItems} productos`;
      doc.text(totalText, margin, yPos);
      yPos += lineHeight + 15; // More spacing before PEDIDOS X CLIENTES
      
      // Orders section with gray background
      doc.setFontSize(fontSize + 1);
      doc.setFont(undefined, 'bold');
      const ordersTitle = 'PEDIDOS X CLIENTES';
      const ordersTitleHeight = lineHeight + 4;
      
      // Draw gray background
      doc.setFillColor(200, 200, 200); // Gray color
      doc.rect(margin, yPos - ordersTitleHeight + 2, maxWidth, ordersTitleHeight, 'F');
      
      // Draw text on gray background
      doc.setTextColor(0, 0, 0); // Black text
      doc.text(ordersTitle, margin, yPos);
      yPos += lineHeight + 3;
      
      // List each order
      doc.setFontSize(fontSize);
      doc.setFont(undefined, 'bold');
      
      filteredOrders.forEach((order, index) => {
        // Get client name
        const client = order.clientId ? clientsMap[order.clientId] : null;
        const clientName = client ? client.name : 'Cliente desconocido';
        
        // Get delivery time
        let timeStr = '';
        if (order.deliveryDate) {
          const deliveryDate = new Date(order.deliveryDate);
          timeStr = formatTime24h(deliveryDate);
        }
        
        // Order header (number and client name) - larger font and bold
        doc.setFontSize(fontSize + 2); // Larger font for client name
        doc.setFont(undefined, 'bold'); // Ensure bold
        const orderHeader = `${index + 1}. ${clientName}`;
        const orderHeaderLines = splitText(orderHeader, maxWidth);
        orderHeaderLines.forEach(line => {
          doc.text(line, margin, yPos);
          yPos += lineHeight + 2; // Slightly more spacing for larger font
        });
        // Restore normal font size (keep bold)
        doc.setFontSize(fontSize);
        doc.setFont(undefined, 'bold');
        
        // Check if we need a new page
        if (yPos > getCurrentPageHeight() - 30) {
          doc.addPage();
          yPos = margin + 10;
          doc.setFont(undefined, 'bold');
        }
        
        // Hora: label and time
        doc.text(`Hora: ${timeStr || 'No especificada'}`, margin, yPos);
        yPos += lineHeight + 3; // Add spacing before products
        
        // Check if we need a new page
        if (yPos > getCurrentPageHeight() - 30) {
          doc.addPage();
          yPos = margin + 10;
          doc.setFont(undefined, 'bold');
        }
        
        // Order items
        if (order.items && Array.isArray(order.items)) {
          order.items.forEach(item => {
            // Calculate position for quantity (indent + bullet + space)
            const indentX = margin + doc.getTextWidth('  ');
            const bulletX = indentX;
            const quantityX = bulletX + doc.getTextWidth('• ');
            const qtyPos = formatQuantityWithPosition(item.quantity, quantityX);
            
            // Draw product name after quantity (bold)
            doc.setFont(undefined, 'bold');
            const productNameX = quantityX + quantityWidth + doc.getTextWidth(' ');
            const productNameText = item.productName;
            const productLines = splitText(productNameText, maxWidth - (productNameX - margin));
            
            // Draw indent, bullet and quantity only on first line
            doc.text('  •', margin, yPos);
            doc.setFont(undefined, 'bold');
            doc.text(qtyPos.text, qtyPos.x, yPos);
            doc.setFont(undefined, 'bold');
            
            // Draw first line of product name
            if (productLines.length > 0) {
              doc.text(productLines[0], productNameX, yPos);
            }
            
            // Draw remaining lines of product name (if any) on new lines
            for (let idx = 1; idx < productLines.length; idx++) {
              yPos += lineHeight;
              doc.text(productLines[idx], productNameX, yPos);
            }
            
            yPos += lineHeight + 2; // Add small spacing between products
            
            // Check if we need a new page
            if (yPos > getCurrentPageHeight() - 30) {
              doc.addPage();
              yPos = margin + 10;
              doc.setFont(undefined, 'bold');
            }
          });
        }
        
        // Notes/Observations
        if (order.notes && order.notes.trim()) {
          yPos += 2; // Small spacing before notes
          doc.setFontSize(fontSize - 1); // Smaller font for notes
          doc.setFont(undefined, 'bold'); // Bold for notes
          // Use a larger line height for smaller font to prevent overlap
          // CRITICAL: Need enough vertical space to prevent any overlap
          // Use at least 2x the font size to ensure proper spacing with descenders and ascenders
          const notesLineHeight = Math.max(lineHeight + 4, (fontSize - 1) * 2);
          const notesLabel = 'Observaciones:';
          doc.text(notesLabel, margin, yPos);
          yPos += notesLineHeight; // Line height for label
          
          // Check if we need a new page
          if (yPos > getCurrentPageHeight() - 30) {
            doc.addPage();
            yPos = margin + 10;
            doc.setFont(undefined, 'bold');
            doc.setFontSize(fontSize - 1); // Keep smaller font
          }
          
          // Calculate available width for notes (accounting for indent)
          // IMPORTANT: getTextWidth uses current font size, so this is correct
          const notesIndent = doc.getTextWidth('  ');
          const notesMaxWidth = maxWidth - notesIndent;
          
          // Split notes text - use plain text (no HTML) for PDF; preserve line breaks
          const notesPlain = stripNotesHtml(order.notes);
          const noteParagraphs = notesPlain.split('\n');
          const notesLines = [];
          
          noteParagraphs.forEach(paragraph => {
            if (paragraph.trim()) {
              const wrappedLines = splitText(paragraph.trim(), notesMaxWidth);
              notesLines.push(...wrappedLines);
            }
          });
          
          // Draw each line separately with proper spacing
          // CRITICAL: Each line must be drawn at a different yPos
          notesLines.forEach((line, idx) => {
            // Draw the line with indent at current yPos (bold)
            doc.setFont(undefined, 'bold');
            doc.text(`  ${line}`, margin, yPos);
            
            // CRITICAL: Always increment yPos AFTER drawing, BEFORE next iteration
            // This ensures each line is drawn at a unique vertical position
            yPos += notesLineHeight;
            
            // Check if we need a new page AFTER incrementing
            if (yPos > getCurrentPageHeight() - 30) {
              doc.addPage();
              yPos = margin + 10;
              doc.setFont(undefined, 'bold');
              doc.setFontSize(fontSize - 1); // Keep smaller font
            }
          });
          // Add small spacing after all notes lines
          yPos += 2;
          
          // Restore normal font size (keep bold)
          doc.setFontSize(fontSize);
          doc.setFont(undefined, 'bold');
        }
        
        // Add spacing and line between orders
        yPos += lineHeight;
        
        // Draw a line to separate orders (only if not the last order)
        if (index < filteredOrders.length - 1) {
          doc.setDrawColor(200, 200, 200); // Light gray color
          doc.setLineWidth(0.5);
          doc.line(margin, yPos, margin + maxWidth, yPos);
          yPos += lineHeight;
        }
        
        // Check if we need a new page
        if (yPos > getCurrentPageHeight() - 30) {
          doc.addPage();
          yPos = margin + 10;
          doc.setFont(undefined, 'bold');
        }
      });
      
      // Generate filename
      const filename = `Reporte_Productos_${formatDate24h(selectedDateObj).replace(/\//g, '-')}.pdf`;
      
      // Open print dialog instead of downloading
      const pdfBlob = doc.output('blob');
      const pdfUrl = URL.createObjectURL(pdfBlob);
      const printWindow = window.open(pdfUrl);
      
      if (printWindow) {
        printWindow.onload = () => {
          printWindow.print();
          // Clean up the URL after printing
          setTimeout(() => {
            URL.revokeObjectURL(pdfUrl);
          }, 1000);
        };
      }
      
      hideSpinner();
    }
    
    // Generate WhatsApp message if action is whatsapp
    if (action === 'whatsapp') {
      // Generate WhatsApp message with same format as PDF
      let message = `REPORTE DE PRODUCTOS\n`;
      message += `Fecha entrega: ${formatDate24h(selectedDateObj)}\n\n`;
      
      // Add products
      sortedProducts.forEach(([productName, quantity]) => {
        message += `• ${quantity} ${productName}\n`;
      });
      
      message += `\nTOTAL: ${totalItems} productos`;
      
      // Open WhatsApp (user needs to select contact)
      const url = `https://wa.me/?text=${encodeURIComponent(message)}`;
      window.open(url, '_blank');
    }
  } catch (error) {
    hideSpinner();
    console.error('Error generating report:', error);
    await showError('Error al generar reporte: ' + error.message);
  }
}

// Siempre usar delegación para "Nuevo Pedido" (funciona aunque el botón esté en vista cargada después)
document.body.addEventListener('click', function handleNewOrderClick(e) {
  if (e.target.id === 'new-order-btn' || (e.target.closest && e.target.closest('#new-order-btn'))) {
    e.preventDefault();
    e.stopPropagation();
    showNewOrderForm();
  }
});
document.getElementById('cancel-order-btn')?.addEventListener('click', hideNewOrderForm);
document.getElementById('save-order-btn')?.addEventListener('click', saveOrder);
const backToOrdersBtn = document.getElementById('back-to-orders');
if (backToOrdersBtn) {
  backToOrdersBtn.addEventListener('click', backToOrders);
}

// Close order detail button
const closeOrderDetailBtn = document.getElementById('close-order-detail-btn');
if (closeOrderDetailBtn) {
  closeOrderDetailBtn.addEventListener('click', backToOrders);
}
document.getElementById('close-order-form')?.addEventListener('click', hideNewOrderForm);

// Wizard step navigation
const step1NextBtn = document.getElementById('order-step-1-next');
if (step1NextBtn) {
  step1NextBtn.addEventListener('click', goToNextStep);
}

const step2BackBtn = document.getElementById('order-step-2-back');
if (step2BackBtn) step2BackBtn.addEventListener('click', goToPreviousStep);
const step2NextBtn = document.getElementById('order-step-2-next');
if (step2NextBtn) step2NextBtn.addEventListener('click', goToNextStep);

const step3BackBtn = document.getElementById('order-step-3-back');
if (step3BackBtn) step3BackBtn.addEventListener('click', goToPreviousStep);
const step3NextBtn = document.getElementById('order-step-3-next');
if (step3NextBtn) step3NextBtn.addEventListener('click', goToNextStep);

const step4BackBtn = document.getElementById('order-step-4-back');
if (step4BackBtn) step4BackBtn.addEventListener('click', goToPreviousStep);

// Tarjetas de pedido precargado (step 2): al hacer clic se selecciona y actualiza el input oculto
document.querySelectorAll('.order-predefined-card').forEach((card) => {
  card.addEventListener('click', () => {
    const value = card.getAttribute('data-value') || '';
    const hidden = document.getElementById('order-predefined-select');
    if (hidden) hidden.value = value;
    updatePredefinedCardsSelection();
  });
});

// Tipo de entrega (step 4): al hacer clic actualizar borde seleccionado
document.querySelectorAll('.order-delivery-type-option').forEach((label) => {
  label.addEventListener('click', () => {
    const type = label.dataset.type || 'envio';
    document.querySelectorAll('.order-delivery-type-option').forEach((l) => {
      l.classList.toggle('border-red-600', l.dataset.type === type);
      l.classList.toggle('border-gray-300', l.dataset.type !== type);
    });
  });
});

document.getElementById('whatsapp-order-btn')?.addEventListener('click', sendWhatsAppMessage);
document.getElementById('print-order-btn')?.addEventListener('click', () => {
  const orderDetail = document.getElementById('order-detail');
  const orderId = orderDetail?.dataset?.orderId;
  const orderDataStr = orderDetail?.dataset?.orderData;
  if (orderId && orderDataStr) {
    try {
      openPrintPreview(orderId, JSON.parse(orderDataStr));
    } catch (e) {
      openPrintPreview(orderId);
    }
  } else {
    showError('Abra un pedido para imprimir');
  }
});
document.getElementById('report-orders-btn')?.addEventListener('click', generateProductReport);

// Date filter handlers
function updateDateFilterDisplay() {
  const display = document.getElementById('filter-date-display');
  if (!display) return;
  
  if (selectedFilterDate) {
    // Check if it's today
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const filterDate = new Date(selectedFilterDate);
    filterDate.setHours(0, 0, 0, 0);
    
    if (filterDate.getTime() === today.getTime()) {
      display.textContent = 'Hoy';
    } else {
      display.textContent = formatDate24h(selectedFilterDate);
    }
  } else {
    display.textContent = 'Todas';
  }
}

function setToday() {
  selectedFilterDate = new Date();
  selectedFilterDate.setHours(0, 0, 0, 0);
  updateDateFilterDisplay();
  loadOrders();
}

function setFilterDate(date) {
  selectedFilterDate = date;
  updateDateFilterDisplay();
  loadOrders(); // Reload orders with new filter
}

function prevDate() {
  if (!selectedFilterDate) {
    // If no filter, start with today
    selectedFilterDate = new Date();
    selectedFilterDate.setHours(0, 0, 0, 0);
  } else {
    // Go to previous day
    const prev = new Date(selectedFilterDate);
    prev.setDate(prev.getDate() - 1);
    prev.setHours(0, 0, 0, 0);
    selectedFilterDate = prev;
  }
  updateDateFilterDisplay();
  loadOrders();
}

function nextDate() {
  if (!selectedFilterDate) {
    // If no filter, start with today
    selectedFilterDate = new Date();
    selectedFilterDate.setHours(0, 0, 0, 0);
  } else {
    // Go to next day
    const next = new Date(selectedFilterDate);
    next.setDate(next.getDate() + 1);
    next.setHours(0, 0, 0, 0);
    selectedFilterDate = next;
  }
  updateDateFilterDisplay();
  loadOrders();
}

function clearDateFilter() {
  selectedFilterDate = null;
  updateDateFilterDisplay();
  loadOrders();
}

// Initialize date filter display on load
document.addEventListener('DOMContentLoaded', () => {
  // Set default to today
  if (selectedFilterDate) {
    selectedFilterDate.setHours(0, 0, 0, 0);
    updateDateFilterDisplay();
  }
});

document.getElementById('today-date-btn').addEventListener('click', setToday);
document.getElementById('prev-date-btn').addEventListener('click', prevDate);
document.getElementById('next-date-btn').addEventListener('click', nextDate);
document.getElementById('clear-date-filter-btn').addEventListener('click', clearDateFilter);

// Search input for orders
const ordersSearchInput = document.getElementById('orders-search-input');
if (ordersSearchInput) {
  ordersSearchInput.addEventListener('input', (e) => {
    ordersSearchTerm = e.target.value;
    loadOrders();
  });
}

// Add new client from order form
const addNewClientFromOrderBtn = document.getElementById('add-new-client-from-order-btn');
if (addNewClientFromOrderBtn) {
  addNewClientFromOrderBtn.addEventListener('click', () => {
    // Mark that we're coming from order form
    sessionStorage.setItem('creatingClientFromOrder', 'true');
    // Switch to clients view
    if (typeof switchView === 'function') {
      switchView('clients');
    }
    // Show new client form
    if (typeof showClientForm === 'function') {
      showClientForm();
    }
  });
}

// Clear client button handler
const clearClientBtn = document.getElementById('clear-client-btn');
if (clearClientBtn) {
  clearClientBtn.addEventListener('click', () => {
    currentOrderClient = null;
    const clientSelect = document.getElementById('order-client-select');
    const clientSearchInput = document.getElementById('client-search-input');
    const searchInputContainer = document.getElementById('client-search-container');
    const selectedDisplay = document.getElementById('selected-client-display');
    const resultsDiv = document.getElementById('client-search-results');
    
    if (clientSelect) clientSelect.value = '';
    if (clientSearchInput) clientSearchInput.value = '';
    if (selectedDisplay) selectedDisplay.classList.add('hidden');
    if (resultsDiv) resultsDiv.classList.add('hidden');
    
    // Show search input container again
    if (searchInputContainer) searchInputContainer.classList.remove('hidden');
    
    // Recalculate prices when client changes
    renderOrderProducts();
    updateOrderTotal();
    
    // Focus on search input
    if (clientSearchInput) clientSearchInput.focus();
  });
}

// Client select change handler (for hidden input)
const orderClientSelect = document.getElementById('order-client-select');
if (orderClientSelect) {
  orderClientSelect.addEventListener('change', (e) => {
    currentOrderClient = e.target.value || null;
    // Recalculate prices when client changes
    renderOrderProducts();
    updateOrderTotal();
  });
}

// Make functions available globally for inline handlers
window.updateOrderProduct = updateOrderProduct;
window.removeProductFromOrder = removeProductFromOrder;
window.toggleOrderStatus = toggleOrderStatus;
window.updateCustomProduct = updateCustomProduct;

// Escape HTML to prevent XSS
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Render order notes: lines starting with "Envío: " may contain our HTML link (address -> Waze), render as HTML; rest escaped.
function renderOrderNotes(notes) {
  if (!notes || !String(notes).trim()) return '';
  const lines = String(notes).split('\n');
  return lines.map((line) => {
    if (line.startsWith('Envío: ')) {
      return 'Envío: ' + line.substring(7);
    }
    return escapeHtml(line);
  }).join('\n');
}

// Strip HTML from notes for plain-text use (e.g. WhatsApp)
function stripNotesHtml(notes) {
  if (!notes || !String(notes).trim()) return '';
  const div = document.createElement('div');
  div.innerHTML = String(notes);
  return (div.textContent || div.innerText || '').trim();
}

/** Extrae la dirección de las notas del pedido (línea "Envío: ..." o "Dirección: ..."). */
function getAddressFromOrderNotes(notes) {
  if (!notes || !String(notes).trim()) return '';
  const plain = stripNotesHtml(notes);
  const lines = plain.split('\n');
  for (const line of lines) {
    const t = line.trim();
    if (t.startsWith('Envío: ')) return t.substring(7).trim();
    if (t.startsWith('Dirección: ')) return t.substring(11).trim();
  }
  return '';
}



/**
 * Tab Web: contenido editable de nrd-web (nodo Firebase /web).
 * Lectura pública vía API GET /web; escritura solo desde Pedidos.
 */

const DEFAULT_WEB = {
  banner: { enabled: false, text: '', type: 'info' },
  hero: {
    eyebrow: 'Pedidos habituales: catálogo online o PedidosYa',
    title: "Panadería artesanal en Montevideo",
    subtitle: 'Productos frescos todos los días. Pedí por nuestro catálogo online o por PedidosYa.'
  },
  hoursDisplay: 'Mar–Dom 7:30–22:30 • Lun cerrado',
  links: {
    catalogUrl: 'https://catalogo.nrdonline.site/',
    pedidosYaUrl: 'https://www.pedidosya.com.uy/restaurantes/montevideo/panaderia-nueva-rio-dor-f259bb10-32bc-4e1d-934b-908a08efcc7c-menu?origin=shop_list',
    instagramUrl: 'https://www.instagram.com/nuevariodor/',
    facebookUrl: 'https://www.facebook.com/profile.php?id=100091573790662',
    tiktokUrl: 'https://www.tiktok.com/@nriodor'
  },
  whatsapp: {
    e164: '+59899646848',
    display: '+598 99 646 848',
    message: 'Hola! Quiero coordinar un pedido especial (gran volumen / evento).'
  },
  featuredProducts: [
    { id: 'pan-flauta', name: 'Pan Flauta', category: 'Panes', description: 'Clásico y fresco, ideal para todos los días.', image: 'assets/images/products/pan-flauta.jpg', alt: 'Pan flauta', active: true, order: 1 },
    { id: 'bizcochos', name: 'Bizcochos (¼ kg)', category: 'Bizcochos', description: 'Surtido para acompañar el mate o el café.', image: 'assets/images/products/bizcochos.jpg', alt: 'Bizcochos surtidos', active: true, order: 2 },
    { id: 'alfajor-suizo', name: 'Alfajor suizo', category: 'Pastelería', description: 'Dulce, colorido y tentador. Ideal para un antojo.', image: 'assets/images/products/alfajor-suizo.jpg', alt: 'Alfajores suizos', active: true, order: 3 },
    { id: 'pasta-frola', name: 'Pasta frola', category: 'Pastelería', description: 'Clásica, ideal para compartir.', image: 'assets/images/products/pasta-frola-ddl.jpg', alt: 'Pasta frola', active: true, order: 4 },
    { id: 'empanada-jq', name: 'Empanada de jamón y queso', category: 'Salados', description: 'Rellena y dorada, lista para disfrutar.', image: 'assets/images/products/empanada-jamon-queso.jpg', alt: 'Empanada de jamón y queso', active: true, order: 5 },
    { id: 'medialuna-rellena', name: 'Medialuna rellena', category: 'Salados', description: 'Ideal para una colación rápida.', image: 'assets/images/products/medialuna-rellena.jpg', alt: 'Medialuna rellena', active: true, order: 6 }
  ],
  faq: [
    { id: 'faq-pedido', q: '¿Cómo hago un pedido?', a: 'Los pedidos se realizan por el catálogo online. Ahí vas a ver productos y opciones disponibles.', active: true, order: 1 },
    { id: 'faq-catalogo', q: '¿Y si no encuentro lo que busco en el catálogo?', a: 'Escribinos por WhatsApp y te ayudamos con otros productos u opciones especiales.', active: true, order: 2 },
    { id: 'faq-lunch', q: '¿Hacen lunch para eventos?', a: 'Sí. Armamos lunch para eventos y opciones a medida. Consultanos por WhatsApp para coordinar.', active: true, order: 3 },
    { id: 'faq-horario', q: '¿Cuál es el horario?', a: 'Martes a domingo de 7:30 a 22:30. Lunes cerrado.', active: true, order: 4 },
    { id: 'faq-ubicacion', q: '¿Dónde están ubicados?', a: "Dr Juan B. Morelli 3475, 11400 Montevideo, Departamento de Montevideo.", active: true, order: 5 },
    { id: 'faq-pedidosya', q: '¿También están en PedidosYa?', a: 'Sí, también podés encontrarnos en PedidosYa.', active: true, order: 6 },
    { id: 'faq-whatsapp', q: '¿Cuándo usar WhatsApp para pedir?', a: 'WhatsApp es solo para pedidos especiales, grandes volúmenes o coordinaciones fuera de lo habitual. Para pedidos habituales, usá el catálogo online o PedidosYa.', active: true, order: 7 }
  ],
  testimonials: [
    { id: 't1', name: 'Carolina M.', rating: 5, text: 'La mejor medialuna que probé. Siempre fresco y la atención impecable.', active: true, order: 1 },
    { id: 't2', name: 'Diego R.', rating: 5, text: 'Encargué para un cumple y la torta llegó perfecta. Sabor espectacular.', active: true, order: 2 },
    { id: 't3', name: 'Valentina S.', rating: 4, text: 'Pan de campo increíble. Se nota la fermentación lenta y la calidad.', active: true, order: 3 }
  ]
};

let webContent = null;
let webHandlersBound = false;

function cloneDefaultWeb() {
  return JSON.parse(JSON.stringify(DEFAULT_WEB));
}

function newId(prefix) {
  return prefix + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function escapeHtml(s) {
  if (s == null) return '';
  const div = document.createElement('div');
  div.textContent = String(s);
  return div.innerHTML;
}

function normalizeWeb(raw) {
  const base = cloneDefaultWeb();
  if (!raw || typeof raw !== 'object') return base;

  const banner = raw.banner && typeof raw.banner === 'object' ? raw.banner : {};
  const hero = raw.hero && typeof raw.hero === 'object' ? raw.hero : {};
  const links = raw.links && typeof raw.links === 'object' ? raw.links : {};
  const whatsapp = raw.whatsapp && typeof raw.whatsapp === 'object' ? raw.whatsapp : {};

  return {
    banner: {
      enabled: banner.enabled === true,
      text: banner.text != null ? String(banner.text) : '',
      type: ['info', 'warning', 'promo'].includes(banner.type) ? banner.type : 'info'
    },
    hero: {
      eyebrow: hero.eyebrow != null ? String(hero.eyebrow) : base.hero.eyebrow,
      title: hero.title != null ? String(hero.title) : base.hero.title,
      subtitle: hero.subtitle != null ? String(hero.subtitle) : base.hero.subtitle
    },
    hoursDisplay: raw.hoursDisplay != null ? String(raw.hoursDisplay) : base.hoursDisplay,
    links: {
      catalogUrl: links.catalogUrl != null ? String(links.catalogUrl) : base.links.catalogUrl,
      pedidosYaUrl: links.pedidosYaUrl != null ? String(links.pedidosYaUrl) : base.links.pedidosYaUrl,
      instagramUrl: links.instagramUrl != null ? String(links.instagramUrl) : base.links.instagramUrl,
      facebookUrl: links.facebookUrl != null ? String(links.facebookUrl) : base.links.facebookUrl,
      tiktokUrl: links.tiktokUrl != null ? String(links.tiktokUrl) : base.links.tiktokUrl
    },
    whatsapp: {
      e164: whatsapp.e164 != null ? String(whatsapp.e164) : base.whatsapp.e164,
      display: whatsapp.display != null ? String(whatsapp.display) : base.whatsapp.display,
      message: whatsapp.message != null ? String(whatsapp.message) : base.whatsapp.message
    },
    featuredProducts: Array.isArray(raw.featuredProducts)
      ? raw.featuredProducts.map((p, i) => ({
          id: p.id || newId('prod'),
          name: String(p.name || ''),
          category: String(p.category || ''),
          description: String(p.description || ''),
          image: String(p.image || ''),
          alt: String(p.alt || p.name || ''),
          active: p.active !== false,
          order: typeof p.order === 'number' ? p.order : i + 1
        }))
      : base.featuredProducts,
    faq: Array.isArray(raw.faq)
      ? raw.faq.map((f, i) => ({
          id: f.id || newId('faq'),
          q: String(f.q || ''),
          a: String(f.a || ''),
          active: f.active !== false,
          order: typeof f.order === 'number' ? f.order : i + 1
        }))
      : base.faq,
    testimonials: Array.isArray(raw.testimonials)
      ? raw.testimonials.map((t, i) => ({
          id: t.id || newId('t'),
          name: String(t.name || ''),
          rating: Math.max(1, Math.min(5, Number(t.rating) || 5)),
          text: String(t.text || ''),
          active: t.active !== false,
          order: typeof t.order === 'number' ? t.order : i + 1
        }))
      : base.testimonials,
    updatedAt: raw.updatedAt || null
  };
}

const WEB_RTDB_URL = 'https://nrd-db-default-rtdb.firebaseio.com/web.json';

async function getIdToken() {
  const user = window.nrd?.auth?.getCurrentUser?.();
  if (!user?.getIdToken) {
    throw new Error('No hay sesión autenticada');
  }
  return user.getIdToken();
}

async function loadWebViaRest() {
  const token = await getIdToken();
  const res = await fetch(`${WEB_RTDB_URL}?auth=${encodeURIComponent(token)}`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    cache: 'no-store'
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Error al leer /web (${res.status})`);
  }
  const data = await res.json();
  return data;
}

async function saveWebViaRest(payload) {
  const token = await getIdToken();
  const res = await fetch(`${WEB_RTDB_URL}?auth=${encodeURIComponent(token)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Error al guardar /web (${res.status})`);
  }
}

async function loadWebFromFirebase() {
  const nrd = window.nrd;
  let data = null;
  if (nrd?.webContent?.get) {
    data = await nrd.webContent.get();
  } else {
    logger?.warn?.('nrd.webContent no disponible; usando REST Firebase');
    data = await loadWebViaRest();
  }
  return normalizeWeb(data);
}

async function saveWebToFirebase(payload) {
  const nrd = window.nrd;
  if (nrd?.webContent?.set) {
    await nrd.webContent.set(payload);
    return;
  }
  logger?.warn?.('nrd.webContent no disponible; guardando vía REST Firebase');
  await saveWebViaRest(payload);
}

function fillForm(data) {
  webContent = data;
  const set = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.value = val != null ? val : '';
  };
  const setCheck = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.checked = !!val;
  };

  setCheck('web-banner-enabled', data.banner.enabled);
  set('web-banner-text', data.banner.text);
  set('web-banner-type', data.banner.type);
  set('web-hero-eyebrow', data.hero.eyebrow);
  set('web-hero-title', data.hero.title);
  set('web-hero-subtitle', data.hero.subtitle);
  set('web-hours-display', data.hoursDisplay);
  set('web-link-catalog', data.links.catalogUrl);
  set('web-link-pedidosya', data.links.pedidosYaUrl);
  set('web-link-instagram', data.links.instagramUrl);
  set('web-link-facebook', data.links.facebookUrl);
  set('web-link-tiktok', data.links.tiktokUrl);
  set('web-wa-e164', data.whatsapp.e164);
  set('web-wa-display', data.whatsapp.display);
  set('web-wa-message', data.whatsapp.message);

  renderProductsList();
  renderFaqList();
  renderTestimonialsList();

  const meta = document.getElementById('web-updated-at');
  if (meta) {
    meta.textContent = data.updatedAt
      ? 'Última guardada: ' + new Date(data.updatedAt).toLocaleString('es-UY')
      : 'Aún no guardado en Firebase (se usarán defaults al guardar)';
  }
}

function renderProductsList() {
  const list = document.getElementById('web-products-list');
  if (!list || !webContent) return;
  const items = webContent.featuredProducts || [];
  if (!items.length) {
    list.innerHTML = '<p class="text-sm text-gray-500 py-2">Sin productos destacados</p>';
    return;
  }
  list.innerHTML = items.map((p, idx) => `
    <div class="border border-gray-200 bg-white p-3 space-y-2" data-idx="${idx}">
      <div class="flex items-center justify-between gap-2">
        <label class="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" class="web-prod-active border-gray-300" ${p.active ? 'checked' : ''}>
          Activo
        </label>
        <button type="button" class="web-prod-remove text-red-600 text-sm hover:underline">Eliminar</button>
      </div>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <input type="text" class="web-prod-name px-2 py-1.5 border border-gray-300 text-sm" placeholder="Nombre" value="${escapeHtml(p.name)}">
        <input type="text" class="web-prod-category px-2 py-1.5 border border-gray-300 text-sm" placeholder="Categoría" value="${escapeHtml(p.category)}">
      </div>
      <textarea class="web-prod-desc w-full px-2 py-1.5 border border-gray-300 text-sm" rows="2" placeholder="Descripción">${escapeHtml(p.description)}</textarea>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <input type="text" class="web-prod-image px-2 py-1.5 border border-gray-300 text-sm" placeholder="Imagen (ruta)" value="${escapeHtml(p.image)}">
        <input type="text" class="web-prod-alt px-2 py-1.5 border border-gray-300 text-sm" placeholder="Alt" value="${escapeHtml(p.alt)}">
      </div>
    </div>
  `).join('');

  list.querySelectorAll('[data-idx]').forEach((row) => {
    const idx = Number(row.getAttribute('data-idx'));
    row.querySelector('.web-prod-remove')?.addEventListener('click', () => {
      webContent.featuredProducts.splice(idx, 1);
      renderProductsList();
    });
  });
}

function renderFaqList() {
  const list = document.getElementById('web-faq-list');
  if (!list || !webContent) return;
  const items = webContent.faq || [];
  if (!items.length) {
    list.innerHTML = '<p class="text-sm text-gray-500 py-2">Sin preguntas</p>';
    return;
  }
  list.innerHTML = items.map((f, idx) => `
    <div class="border border-gray-200 bg-white p-3 space-y-2" data-idx="${idx}">
      <div class="flex items-center justify-between gap-2">
        <label class="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" class="web-faq-active border-gray-300" ${f.active ? 'checked' : ''}>
          Activo
        </label>
        <button type="button" class="web-faq-remove text-red-600 text-sm hover:underline">Eliminar</button>
      </div>
      <input type="text" class="web-faq-q w-full px-2 py-1.5 border border-gray-300 text-sm" placeholder="Pregunta" value="${escapeHtml(f.q)}">
      <textarea class="web-faq-a w-full px-2 py-1.5 border border-gray-300 text-sm" rows="2" placeholder="Respuesta">${escapeHtml(f.a)}</textarea>
    </div>
  `).join('');

  list.querySelectorAll('[data-idx]').forEach((row) => {
    const idx = Number(row.getAttribute('data-idx'));
    row.querySelector('.web-faq-remove')?.addEventListener('click', () => {
      webContent.faq.splice(idx, 1);
      renderFaqList();
    });
  });
}

function renderTestimonialsList() {
  const list = document.getElementById('web-testimonials-list');
  if (!list || !webContent) return;
  const items = webContent.testimonials || [];
  if (!items.length) {
    list.innerHTML = '<p class="text-sm text-gray-500 py-2">Sin testimonios</p>';
    return;
  }
  list.innerHTML = items.map((t, idx) => `
    <div class="border border-gray-200 bg-white p-3 space-y-2" data-idx="${idx}">
      <div class="flex items-center justify-between gap-2">
        <label class="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" class="web-test-active border-gray-300" ${t.active ? 'checked' : ''}>
          Activo
        </label>
        <button type="button" class="web-test-remove text-red-600 text-sm hover:underline">Eliminar</button>
      </div>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <input type="text" class="web-test-name px-2 py-1.5 border border-gray-300 text-sm" placeholder="Nombre" value="${escapeHtml(t.name)}">
        <input type="number" min="1" max="5" class="web-test-rating px-2 py-1.5 border border-gray-300 text-sm" placeholder="Rating 1-5" value="${escapeHtml(t.rating)}">
      </div>
      <textarea class="web-test-text w-full px-2 py-1.5 border border-gray-300 text-sm" rows="2" placeholder="Texto">${escapeHtml(t.text)}</textarea>
    </div>
  `).join('');

  list.querySelectorAll('[data-idx]').forEach((row) => {
    const idx = Number(row.getAttribute('data-idx'));
    row.querySelector('.web-test-remove')?.addEventListener('click', () => {
      webContent.testimonials.splice(idx, 1);
      renderTestimonialsList();
    });
  });
}

function collectFromForm() {
  const val = (id) => (document.getElementById(id)?.value || '').trim();
  const checked = (id) => !!document.getElementById(id)?.checked;

  const products = [];
  document.querySelectorAll('#web-products-list [data-idx]').forEach((row, i) => {
    const prev = webContent?.featuredProducts?.[Number(row.getAttribute('data-idx'))] || {};
    products.push({
      id: prev.id || newId('prod'),
      name: row.querySelector('.web-prod-name')?.value?.trim() || '',
      category: row.querySelector('.web-prod-category')?.value?.trim() || '',
      description: row.querySelector('.web-prod-desc')?.value?.trim() || '',
      image: row.querySelector('.web-prod-image')?.value?.trim() || '',
      alt: row.querySelector('.web-prod-alt')?.value?.trim() || '',
      active: !!row.querySelector('.web-prod-active')?.checked,
      order: i + 1
    });
  });

  const faq = [];
  document.querySelectorAll('#web-faq-list [data-idx]').forEach((row, i) => {
    const prev = webContent?.faq?.[Number(row.getAttribute('data-idx'))] || {};
    faq.push({
      id: prev.id || newId('faq'),
      q: row.querySelector('.web-faq-q')?.value?.trim() || '',
      a: row.querySelector('.web-faq-a')?.value?.trim() || '',
      active: !!row.querySelector('.web-faq-active')?.checked,
      order: i + 1
    });
  });

  const testimonials = [];
  document.querySelectorAll('#web-testimonials-list [data-idx]').forEach((row, i) => {
    const prev = webContent?.testimonials?.[Number(row.getAttribute('data-idx'))] || {};
    testimonials.push({
      id: prev.id || newId('t'),
      name: row.querySelector('.web-test-name')?.value?.trim() || '',
      rating: Math.max(1, Math.min(5, Number(row.querySelector('.web-test-rating')?.value) || 5)),
      text: row.querySelector('.web-test-text')?.value?.trim() || '',
      active: !!row.querySelector('.web-test-active')?.checked,
      order: i + 1
    });
  });

  return {
    banner: {
      enabled: checked('web-banner-enabled'),
      text: val('web-banner-text'),
      type: val('web-banner-type') || 'info'
    },
    hero: {
      eyebrow: val('web-hero-eyebrow'),
      title: val('web-hero-title'),
      subtitle: val('web-hero-subtitle')
    },
    hoursDisplay: val('web-hours-display'),
    links: {
      catalogUrl: val('web-link-catalog'),
      pedidosYaUrl: val('web-link-pedidosya'),
      instagramUrl: val('web-link-instagram'),
      facebookUrl: val('web-link-facebook'),
      tiktokUrl: val('web-link-tiktok')
    },
    whatsapp: {
      e164: val('web-wa-e164'),
      display: val('web-wa-display'),
      message: val('web-wa-message')
    },
    featuredProducts: products,
    faq,
    testimonials,
    updatedAt: Date.now()
  };
}

function setupWebHandlers() {
  if (webHandlersBound) return;
  webHandlersBound = true;

  document.getElementById('web-save-btn')?.addEventListener('click', async () => {
    try {
      (window.showSpinner || (() => {}))('Guardando contenido web...');
      const payload = collectFromForm();
      await saveWebToFirebase(payload);
      webContent = normalizeWeb(payload);
      fillForm(webContent);
      (window.showSuccess || (() => {}))('Contenido web guardado');
      logger?.audit?.('web_content_saved', { updatedAt: payload.updatedAt });
    } catch (error) {
      logger?.error?.('Error saving web content', error);
      (window.showError || alert)(error.message || 'Error al guardar');
    } finally {
      (window.hideSpinner || (() => {}))();
    }
  });

  document.getElementById('web-save-btn-bottom')?.addEventListener('click', () => {
    document.getElementById('web-save-btn')?.click();
  });

  document.getElementById('web-reload-btn')?.addEventListener('click', () => {
    loadWeb();
  });

  document.getElementById('web-seed-btn')?.addEventListener('click', () => {
    fillForm(cloneDefaultWeb());
  });

  document.getElementById('web-add-product')?.addEventListener('click', () => {
    if (!webContent) webContent = cloneDefaultWeb();
    // sync current edits before re-render
    const current = collectFromForm();
    webContent = normalizeWeb(current);
    webContent.featuredProducts.push({
      id: newId('prod'),
      name: '',
      category: '',
      description: '',
      image: '',
      alt: '',
      active: true,
      order: webContent.featuredProducts.length + 1
    });
    fillForm(webContent);
  });

  document.getElementById('web-add-faq')?.addEventListener('click', () => {
    if (!webContent) webContent = cloneDefaultWeb();
    const current = collectFromForm();
    webContent = normalizeWeb(current);
    webContent.faq.push({
      id: newId('faq'),
      q: '',
      a: '',
      active: true,
      order: webContent.faq.length + 1
    });
    fillForm(webContent);
  });

  document.getElementById('web-add-testimonial')?.addEventListener('click', () => {
    if (!webContent) webContent = cloneDefaultWeb();
    const current = collectFromForm();
    webContent = normalizeWeb(current);
    webContent.testimonials.push({
      id: newId('t'),
      name: '',
      rating: 5,
      text: '',
      active: true,
      order: webContent.testimonials.length + 1
    });
    fillForm(webContent);
  });
}

async function loadWeb() {
  setupWebHandlers();
  try {
    (window.showSpinner || (() => {}))('Cargando contenido web...');
    const data = await loadWebFromFirebase();
    fillForm(data);
  } catch (error) {
    logger?.error?.('Error loading web content', error);
    fillForm(cloneDefaultWeb());
    (window.showError || alert)(error.message || 'No se pudo cargar /web; mostrando defaults');
  } finally {
    (window.hideSpinner || (() => {}))();
  }
}

window.loadWeb = loadWeb;

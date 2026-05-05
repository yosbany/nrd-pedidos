# NRD Pedidos

Sistema de gestión de pedidos — PWA. Gestiona clientes, catálogo de productos, opcionales y pedidos con impresión de tickets y envío por WhatsApp.

## Características

- **Clientes**: alta y edición de clientes.
- **Pedidos**: creación y seguimiento de pedidos; estados (pendiente, aceptado, rechazado, completado).
- **Catálogo**:
  - **Productos**: secciones, productos del sistema (con variantes), nombre, imagen, descripción, categoría, precio. Cada producto puede tener grupos de opcionales.
  - **Opcionales**: grupos (ej. Sabor, Tipo) con ítems (ej. Jamón, Salame). Cada ítem se enlaza a un producto o variante del sistema (SKU). Nombre interno y nombre comercial por opcional.
  - Horario del local y estado (abierto/cerrado/automático).
- **Impresión**: ticket térmico 80 mm con detalle del pedido; impresión al aceptar; botones Imprimir / Eliminar en detalle.
- **Acciones en pedidos**: Aceptar, Imprimir, Rechazar (con motivo), Completar.
- **Resumen por WhatsApp**.
- **Presupuesto lunch**: flujo específico para presupuestos.
- **PWA**: instalable y uso offline.

## Tecnologías

- HTML, CSS (Tailwind vía CDN), JavaScript ES6 (sin frameworks).
- Firebase Realtime Database y Firebase Authentication.
- NRD Data Access (productos, variantes, configuración de catálogo).
- NRD Common (auth, navegación, modales, formato).
- Service Worker (PWA).

## Estructura del proyecto

```
nrd-pedidos/
├── index.html          # Pantallas login, app, modales (producto, opcional, catálogo)
├── app.js              # Navegación por pestañas (Pedidos, Clientes, Catálogo, etc.)
├── auth.js             # Login y estado de autenticación
├── logger.js           # Logging
├── modal.js            # Utilidades de modales
├── service-worker.js   # PWA
├── manifest.json
├── tabs/
│   ├── orders.js       # Pedidos: listado, detalle, aceptar/rechazar/imprimir
│   ├── clients.js      # Clientes
│   ├── catalog.js      # Catálogo: productos, opcionales, secciones, horario
│   └── lunch.js        # Presupuesto lunch
├── assets/
│   └── (iconos, estilos)
└── tools/              # Scripts de versión / iconos si aplica
```

- **Catálogo** (`tabs/catalog.js`): carga configuración desde `nrd.catalogConfig` y productos/variantes desde `nrd.products.getAll({ flat: true })`. Lista plana: un ítem por producto padre y uno por cada variante (nombre compuesto: "Padre - Variante"). En "Editar producto" se asigna producto o variante del sistema y, por cada grupo de opcionales, se enlaza cada ítem (ej. Jamón, Salame) a un SKU. En "Editar opcional" solo nombre interno, nombre comercial y precio.

## Interfaz

### Sistema de colores en formularios

- **Verde** (`bg-green-600`): formularios de **nuevo** registro.
- **Azul** (`bg-blue-600`): formularios de **edición**.
- **Gris** (`bg-gray-600`): vistas de **detalle** (solo lectura).

Los botones principales (Guardar/Finalizar) usan el mismo color que el cabezal del formulario.

### Catálogo — Opcionales

En la lista de opcionales por grupo, cada ítem se muestra en dos líneas:

1. **Línea 1**: nombre de la opción (ej. Jamón y tomate).
2. **Línea 2**: producto o variante asignado (nombre compuesto + SKU) y botón Cambiar/Asignar.

## Despliegue

- **GitHub Pages**: https://yosbany.github.io/nrd-pedidos/

## Dependencias externas

- **NRD Common**: header, perfil, navegación, modales, formato.
- **NRD Data Access**: productos (con `flat: true` para productos y variantes), configuración de catálogo (`catalogConfig`).
- Firebase: Realtime Database y Auth (configuración en `index.html`).

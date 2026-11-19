"use strict";
/* =========================================================
   Catálogo público de Mercería Oriente.
   Lee las vistas y tablas públicas de Supabase:
   - "catalogo_publico" (productos publicados sin costos ni cantidades exactas)
   - "carrusel" (fotos activas que se muestran de fondo en el banner)
   - "categorias_publicas" (categorías visibles ordenadas desde el panel)
   - "configuracion_catalogo" (imagen Hero Full-Bleed del pie de página)
   El pedido (carrito) se guarda en el navegador de la clienta.
   ========================================================= */

const CLAVE_PEDIDO = "mo_pedido";
const MAX_CANT = 99;
const DIAS_NUEVO = 7;

const pub = {
  items: [],
  fotos: [],
  heroPieUrl: "",
  tipo: "todos",
  q: "",
  orden: "destacados",
  soloDisp: false,
  vistaProd: "todos", // todos | disponibles | destacados | nuevos
  categoriasOk: false,
};
let rotFondo = null;
let pedido = [];   // [{ id, variante, cantidad }]. Precio y foto se leen del catálogo actual.
let detalle = null; // { id, variante } del producto abierto en la ficha
let vista = null;   // "pedido" o "detalle": qué hay dentro del panel que está abierto

const urlSegura = u => (/^https?:\/\//i.test(String(u || "")) ? String(u) : "");
const fotosDe = p => (Array.isArray(p.fotos) ? p.fotos.map(urlSegura).filter(Boolean) : []);
// Busca sin importar mayúsculas ni tildes: "azul", "Azúl" y "AZUL" son lo mismo
const norma = s => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

function estadoDe(p) {
  const vars = Array.isArray(p.variantes) ? p.variantes : [];
  if (!vars.length) return { ok: true, txt: "Disponible" };
  return vars.some(v => v.disponible)
    ? { ok: true, txt: "Disponible" }
    : { ok: false, txt: "Agotado" };
}

// Opciones que se pueden pedir: [""] si el producto no tiene colores o modelos
function disponiblesDe(p) {
  const vars = Array.isArray(p.variantes) ? p.variantes : [];
  if (!vars.length) return [""];
  return vars.filter(v => v.disponible).map(v => v.nombre);
}

function esNuevo(p) {
  const t = Date.parse(p.creado_en || "");
  return Number.isFinite(t) && Date.now() - t < DIAS_NUEVO * 86400000;
}

function textoBusqueda(p) {
  const colores = (Array.isArray(p.variantes) ? p.variantes : []).map(v => v.nombre).join(" ");
  const usos = (Array.isArray(p.usos) ? p.usos : []).join(" ");
  return norma(`${p.nombre} ${p.codigo || ""} ${p.descripcion || ""} ${CATEGORIAS[p.tipo] || ""} ${colores} ${usos}`);
}

/* ---------- Rotación suave de fotos en el banner principal y pie Hero ---------- */
function iniciarRotacion(imgs, ms) {
  let i = 0;
  let timer = null;

  const pintar = n => {
    if (!imgs.length) return;
    i = (n + imgs.length) % imgs.length;
    imgs.forEach((im, k) => im.classList.toggle("on", k === i));
  };
  const parar = () => clearInterval(timer);
  const arrancar = () => {
    parar();
    if (imgs.length > 1) timer = setInterval(() => pintar(i + 1), ms);
  };

  pintar(0);
  arrancar();
  return { parar, arrancar };
}

function pintarFondoHero() {
  const fondo = $("#heroFondo");
  if (!fondo) return;
  if (rotFondo) rotFondo.parar();
  rotFondo = null;
  const fotos = pub.fotos;
  fondo.innerHTML = fotos.map((u, i) => `<img src="${esc(u)}" alt="" class="${i === 0 ? "on" : ""}" loading="lazy">`).join("");
  if (fotos.length > 1) {
    rotFondo = iniciarRotacion($$("img", fondo), 6500);
  }
}

function pintarPieHero() {
  const bg = $("#pieHeroBg");
  const pie = $("#pieHero");
  if (!bg || !pie) return;
  const url = urlSegura(pub.heroPieUrl) || pub.fotos[0] || "";
  if (url) {
    bg.style.backgroundImage = `url('${url.replace(/'/g, "\\'")}')`;
    pie.classList.add("con-imagen");
  } else {
    bg.style.backgroundImage = "";
    pie.classList.remove("con-imagen");
  }
}

function categoriasConProductos() {
  return Object.entries(CATEGORIAS).map(([k, nombre]) => {
    const lista = pub.items.filter(p => p.tipo === k);
    const disp = lista.filter(p => estadoDe(p).ok).length;
    const portada = lista.map(p => fotosDe(p)[0]).find(Boolean) || "";
    return { k, nombre, n: lista.length, disp, portada };
  }).filter(c => c.n > 0);
}

/* ---------- Pedido (carrito) ---------- */
function guardarPedido() {
  try { localStorage.setItem(CLAVE_PEDIDO, JSON.stringify(pedido)); } catch { /* navegador sin almacenamiento */ }
}

function cargarPedido() {
  try {
    const datos = JSON.parse(localStorage.getItem(CLAVE_PEDIDO) || "[]");
    if (!Array.isArray(datos)) return [];
    return datos
      .filter(l => l && typeof l.id === "string")
      .map(l => ({
        id: l.id,
        variante: typeof l.variante === "string" ? l.variante : "",
        cantidad: Math.min(MAX_CANT, Math.max(1, parseInt(l.cantidad, 10) || 1)),
      }));
  } catch {
    return [];
  }
}

// Quita del pedido los productos que el catálogo ya no tiene publicados
function podarPedido() {
  const antes = pedido.length;
  pedido = pedido.filter(l => pub.items.some(p => p.id === l.id));
  if (pedido.length !== antes) guardarPedido();
}

// Líneas con los datos actuales del producto (precio, foto y disponibilidad)
function lineasPedido() {
  return pedido.map(l => {
    const p = pub.items.find(x => x.id === l.id);
    if (!p) return null;
    const vars = Array.isArray(p.variantes) ? p.variantes : [];
    const v = vars.find(x => x.nombre === l.variante);
    const disponible = vars.length ? !!(v && v.disponible) : l.variante === "";
    return { ...l, p, foto: fotosDe(p)[0] || "", precio: Number(p.precio) || 0, disponible };
  }).filter(Boolean);
}

function actualizarFab() {
  const n = pedido.reduce((a, l) => a + l.cantidad, 0);
  const texto = n > 99 ? "99+" : String(n);
  const num = $("#fabNum");
  if (num) {
    num.textContent = texto;
    num.hidden = n === 0;
  }
  const topNum = $("#topPedidoNum");
  if (topNum) {
    topNum.textContent = texto;
    topNum.hidden = n === 0;
  }
  const subPed = $("#optSubPedido");
  if (subPed) {
    subPed.textContent = n > 0 ? `Tienes ${n} artículo(s) en tu pedido` : "Envía tu lista directo por WhatsApp";
  }
  const fab = $("#fab");
  if (fab) fab.setAttribute("aria-label", `Ver mi pedido (${n} artículo(s))`);
}

function pulsoCarrito() {
  const f = $("#fab");
  if (!f) return;
  f.classList.remove("pulso");
  void f.offsetWidth; // reinicia la animación
  f.classList.add("pulso");
}

function cambiarPedido() {
  guardarPedido();
  actualizarFab();
  if (vista === "pedido" && !$("#modal").hidden) pintarPedido();
}

function agregarAlPedido(id, variante) {
  const linea = pedido.find(l => l.id === id && l.variante === variante);
  if (linea) linea.cantidad = Math.min(MAX_CANT, linea.cantidad + 1);
  else pedido.push({ id, variante, cantidad: 1 });
  cambiarPedido();
  pulsoCarrito();
  toast("Agregado a tu pedido ✔");
}

function cambiarCantidad(id, variante, delta) {
  const linea = pedido.find(l => l.id === id && l.variante === variante);
  if (!linea) return;
  linea.cantidad = Math.min(MAX_CANT, linea.cantidad + delta);
  if (linea.cantidad <= 0) return quitarDelPedido(id, variante);
  cambiarPedido();
}

function quitarDelPedido(id, variante) {
  pedido = pedido.filter(l => !(l.id === id && l.variante === variante));
  cambiarPedido();
}

// Botón "+" de la tarjeta: si hay que elegir color o modelo, abre la ficha
function agregarRapido(id) {
  const p = pub.items.find(x => x.id === id);
  if (!p) return;
  const disp = disponiblesDe(p);
  if (!disp.length) return toast("Este producto está agotado por ahora");
  if (disp.length > 1) return abrirDetalle(id);
  agregarAlPedido(id, disp[0]);
}

const waLink = texto => `https://wa.me/${CONFIG.WHATSAPP}?text=${encodeURIComponent(texto)}`;
const totalDe = ls => ls.reduce((a, l) => a + l.precio * l.cantidad, 0);
const filasMensaje = ls => ls
  .map((l, i) => `${i + 1}. ${l.p.nombre}${l.variante ? ` (${l.variante})` : ""} × ${l.cantidad} = ${usd(l.precio * l.cantidad)}`)
  .join("\n");

function mensajePedido(ls) {
  return `Hola, quisiera hacer este pedido en Mercería Oriente:\n\n${filasMensaje(ls)}\n\nTotal estimado: ${usd(totalDe(ls))}\n\n¿Me confirman la disponibilidad? Gracias.`;
}

function mensajeAsesoria(ls) {
  return `Hola, quisiera que me asesoren sobre estos productos antes de comprar:\n\n${filasMensaje(ls)}\n\n¿Me pueden orientar? Gracias.`;
}

function abrirPedido() {
  vista = "pedido";
  pintarPedido();
  abrirModal();
}

function pintarPedido() {
  const ls = lineasPedido();
  const disp = ls.filter(l => l.disponible);
  const hayAgotados = ls.some(l => !l.disponible);

  const acciones = disp.length ? `
    <div class="acciones-pedido">
      <a class="pedido-btn principal" href="${waLink(mensajePedido(disp))}" target="_blank" rel="noopener">
        <b>Enviar mi pedido</b><small>Te respondemos por WhatsApp</small>
      </a>
      <a class="pedido-btn" href="${waLink(mensajeAsesoria(disp))}" target="_blank" rel="noopener">
        <b>Quiero que me asesoren</b><small>Preguntas antes de comprar</small>
      </a>
    </div>` : `<p class="hint">Quita los productos agotados para poder enviar el pedido.</p>`;

  $("#modal .sheet").innerHTML = `
  <button class="x cerrar" data-cerrar aria-label="Cerrar">✕</button>
  <div class="pedido">
    <span class="eyebrow">Tu pedido</span>
    <h2>Mi carrito</h2>
    ${ls.length ? `
      <ul class="lineas-car">
        ${ls.map(l => `
        <li class="linea-car ${l.disponible ? "" : "no-disp"}">
          <div class="car-foto">${l.foto ? `<img src="${esc(l.foto)}" alt="${esc(l.p.nombre)}">` : `<span class="sin-foto">Sin foto</span>`}</div>
          <div class="car-info">
            <span class="tipo">${esc(CATEGORIAS[l.p.tipo] || "")}</span>
            <b>${esc(l.p.nombre)}</b>
            <small>${esc([l.variante, `${usd(l.precio)} c/u`, l.disponible ? "" : "ya no disponible"].filter(Boolean).join(" · "))}</small>
            <strong>${usd(l.precio * l.cantidad)}</strong>
          </div>
          <div class="car-acc">
            <div class="stepper">
              <button type="button" data-cant="${esc(l.id)}" data-var-linea="${esc(l.variante)}" data-d="-1" aria-label="Quitar uno">−</button>
              <span>${l.cantidad}</span>
              <button type="button" data-cant="${esc(l.id)}" data-var-linea="${esc(l.variante)}" data-d="1" aria-label="Agregar uno">+</button>
            </div>
            <button type="button" class="x" data-quitar="${esc(l.id)}" data-var-linea="${esc(l.variante)}" aria-label="Quitar del pedido">✕ Quitar</button>
          </div>
        </li>`).join("")}
      </ul>
      <div class="total-car"><span>Total estimado</span><strong>${usd(totalDe(disp))}</strong></div>
      <p class="hint">Los precios y la disponibilidad se confirman por WhatsApp.</p>
      ${acciones}
      ${hayAgotados ? `<p class="hint">Algunos productos de tu pedido ya no están disponibles.</p>` : ""}
      <button type="button" class="link-vaciar" data-vaciar>Vaciar pedido</button>
    ` : `<p class="vacio-car">Tu pedido está vacío. Toca el botón + de cualquier producto para agregarlo.</p>`}
  </div>`;
}

/* ---------- Compartir ---------- */
async function compartir(id) {
  const p = pub.items.find(x => x.id === id);
  if (!p) return;
  const url = location.href.split("#")[0];
  const texto = `${p.nombre} · ${usd(p.precio)} · Mercería Oriente`;
  try {
    if (navigator.share) return await navigator.share({ title: p.nombre, text: texto, url });
  } catch (err) {
    if (err && err.name === "AbortError") return;
  }
  window.open(`https://wa.me/?text=${encodeURIComponent(`${texto}\n${url}`)}`, "_blank", "noopener");
}

/* ---------- Categorías en Bento Grid Editorial ---------- */
function claseBentoCat(i, total) {
  if (i === 0) return "bento-featured";
  if (i === 1 && total >= 3) return "bento-wide";
  if (i > 4 && i % 5 === 0) return "bento-wide";
  return "";
}

function pintarCategorias() {
  const cats = categoriasConProductos();
  const sec = $("#categorias");
  if (!sec) return;
  sec.hidden = cats.length === 0;
  const btnTodas = $("#btnVerTodasCats");
  if (btnTodas) btnTodas.hidden = pub.tipo === "todos";
  $("#catGrid").innerHTML = cats.map((c, i) => {
    const activa = pub.tipo === c.k;
    const tam = claseBentoCat(i, cats.length);
    const badge = i === 0 ? "Colección destacada" : `${c.n} artículo${c.n === 1 ? "" : "s"}`;
    return `
    <button type="button" class="cat bento-cat ${tam} ${activa ? "on" : ""}" data-cat="${esc(c.k)}" aria-pressed="${activa}">
      <span class="cat-foto">
        ${c.portada ? `<img src="${esc(c.portada)}" alt="${esc(c.nombre)}" loading="lazy">` : `<span class="cat-placeholder">✦</span>`}
      </span>
      <span class="cat-velo" aria-hidden="true"></span>
      <span class="cat-badge">${esc(badge)}</span>
      <span class="cat-txt">
        <span class="cat-info">
          <b>${esc(c.nombre)}</b>
          <small>${c.n} producto${c.n === 1 ? "" : "s"} · ${c.disp} disponible${c.disp === 1 ? "" : "s"}</small>
        </span>
        <span class="cat-flecha" aria-hidden="true">→</span>
      </span>
    </button>`;
  }).join("");
}

/* ---------- Lista de productos ---------- */
function visibles() {
  const q = norma(pub.q.trim());
  const orden = {
    destacados: (a, b) => (Number(b.destacado) - Number(a.destacado)) || a.nombre.localeCompare(b.nombre, "es"),
    "precio-asc": (a, b) => Number(a.precio) - Number(b.precio),
    "precio-desc": (a, b) => Number(b.precio) - Number(a.precio),
    nombre: (a, b) => a.nombre.localeCompare(b.nombre, "es"),
  }[pub.orden];

  return pub.items
    .filter(p => {
      if (pub.tipo !== "todos" && p.tipo !== pub.tipo) return false;
      if (pub.soloDisp && !estadoDe(p).ok) return false;
      if (pub.vistaProd === "disponibles" && !estadoDe(p).ok) return false;
      if (pub.vistaProd === "destacados" && !p.destacado) return false;
      if (pub.vistaProd === "nuevos" && !esNuevo(p)) return false;
      if (q && !textoBusqueda(p).includes(q)) return false;
      return true;
    })
    .sort(orden);
}

function tarjeta(p) {
  const e = estadoDe(p);
  const foto = fotosDe(p)[0] || "";
  const vars = Array.isArray(p.variantes) ? p.variantes : [];
  const usos = Array.isArray(p.usos) ? p.usos.filter(Boolean) : [];
  const subInfo = vars.length > 1
    ? `${vars.filter(v => v.disponible).length} opción(es) disponible(s)`
    : (usos[0] ? usos[0] : (p.descripcion ? p.descripcion : ""));
  return `
  <article class="card-prod" data-id="${esc(p.id)}" tabindex="0" role="button" aria-label="Ver ${esc(p.nombre)}">
    <div class="foto">
      ${foto ? `<img src="${esc(foto)}" alt="${esc(p.nombre)}" loading="lazy">` : `<span class="sin-foto">Sin foto</span>`}
      ${esNuevo(p) ? `<span class="etiqueta-nuevo">Nuevo</span>` : (p.destacado ? `<span class="etiqueta-nuevo">★ Destacado</span>` : "")}
    </div>
    <div class="cuerpo">
      <span class="tipo">${esc(CATEGORIAS[p.tipo] || "")}${p.codigo ? ` · ${esc(p.codigo)}` : ""}</span>
      <h3>${esc(p.nombre)}</h3>
      ${subInfo ? `<p class="card-subinfo">${esc(subInfo)}</p>` : ""}
      <div class="fila-precio">
        <strong>${usd(p.precio)}</strong>
        <span class="pill ${e.ok ? "ok" : "agotado"}">${e.txt}</span>
      </div>
      <button type="button" class="btn sm add" data-add="${esc(p.id)}" ${e.ok ? "" : "disabled"} aria-label="Agregar ${esc(p.nombre)} al pedido">${e.ok ? "+ Agregar" : "Agotado"}</button>
    </div>
  </article>`;
}

function limpiarFiltros() {
  pub.tipo = "todos";
  pub.q = "";
  pub.soloDisp = false;
  pub.vistaProd = "todos";
  const buscador = $("#buscar");
  if (buscador) buscador.value = "";
  render();
}

function render() {
  const cats = categoriasConProductos();
  const totalDisp = pub.items.filter(p => estadoDe(p).ok).length;
  const totalDest = pub.items.filter(p => p.destacado).length;
  const totalNuevos = pub.items.filter(p => esNuevo(p)).length;

  const chips = [["todos", `Todos (${pub.items.length})`], ...cats.map(c => [c.k, `${c.nombre} (${c.n})`])]
    .map(([k, l]) => `<button type="button" class="chip ${pub.tipo === k ? "on" : ""}" data-tipo="${esc(k)}">${esc(l)}</button>`)
    .join("");
  $("#chips").innerHTML = chips
    + `<button type="button" class="chip ${pub.soloDisp ? "on" : ""}" data-solo aria-pressed="${pub.soloDisp}">Solo disponibles (${totalDisp})</button>`;

  const btnDest = $("#btnFiltroDest");
  if (btnDest) btnDest.hidden = totalDest === 0;
  const btnNuevos = $("#btnFiltroNuevos");
  if (btnNuevos) btnNuevos.hidden = totalNuevos === 0;

  $$("[data-vista-prod]").forEach(b => b.classList.toggle("on", b.dataset.vistaProd === pub.vistaProd));

  const tituloSec = $("#tituloSeccionProd");
  if (tituloSec) {
    tituloSec.textContent = pub.tipo !== "todos" && CATEGORIAS[pub.tipo]
      ? CATEGORIAS[pub.tipo]
      : pub.vistaProd === "disponibles" || pub.soloDisp
        ? "Productos disponibles"
        : pub.vistaProd === "destacados"
          ? "Productos destacados"
          : pub.vistaProd === "nuevos"
            ? "Nuevos ingresos"
            : "Todos los productos";
  }

  const hayFiltroActivo = pub.tipo !== "todos" || pub.soloDisp || pub.vistaProd !== "todos" || pub.q.trim() !== "";
  const btnLimpiar = $("#btnLimpiarFiltros");
  if (btnLimpiar) btnLimpiar.hidden = !hayFiltroActivo;

  pintarCategorias();

  const lista = visibles();
  $("#grid").innerHTML = lista.map(tarjeta).join("");
  $("#conteo").textContent = `${lista.length} de ${pub.items.length} producto(s)`;
  $("#vacio").textContent = pub.items.length
    ? "No encontramos productos con esos criterios. Prueba limpiando los filtros."
    : "Pronto subiremos nuestros productos. ¡Vuelve pronto!";
  $("#vacio").hidden = lista.length > 0;

  $("#heroTotal").textContent = pub.items.length;
  $("#heroConteo").hidden = pub.items.length === 0;
  const heroDisp = $("#heroDisp");
  const heroDispItem = $("#heroDispItem");
  if (heroDisp && heroDispItem) {
    heroDisp.textContent = totalDisp;
    heroDispItem.hidden = pub.items.length === 0;
  }
  const heroCats = $("#heroCats");
  const heroCatItem = $("#heroCatItem");
  if (heroCats && heroCatItem) {
    heroCats.textContent = cats.length;
    heroCatItem.hidden = cats.length === 0;
  }
  const subTodos = $("#optSubTodos");
  if (subTodos && pub.items.length) subTodos.textContent = `${pub.items.length} artículos publicados en línea`;
  const subDisp = $("#optSubDisp");
  if (subDisp && pub.items.length) subDisp.textContent = `${totalDisp} artículos listos para entrega`;
  const subCats = $("#optSubCats");
  if (subCats && cats.length) subCats.textContent = `${cats.length} secciones disponibles`;
}

/* ---------- Ficha de producto ---------- */
function abrirDetalle(id) {
  const p = pub.items.find(x => x.id === id);
  if (!p) return;
  detalle = { id, variante: disponiblesDe(p)[0] || "" };
  vista = "detalle";
  pintarDetalle();
  abrirModal();
}

function pintarDetalle() {
  const p = detalle && pub.items.find(x => x.id === detalle.id);
  if (!p) return cerrarModal();

  const fotos = fotosDe(p);
  const caracteristicas = (Array.isArray(p.caracteristicas) ? p.caracteristicas : [])
    .filter(c => c && c.campo && c.valor);
  const accesorios = Array.isArray(p.accesorios) ? p.accesorios : [];
  const usos = Array.isArray(p.usos) ? p.usos : [];
  const documentos = (Array.isArray(p.documentos) ? p.documentos : []).filter(d => urlSegura(d.url));
  const variantes = Array.isArray(p.variantes) ? p.variantes : [];
  const e = estadoDe(p);
  const disp = disponiblesDe(p);
  const elegida = disp.includes(detalle.variante) ? detalle.variante : (disp[0] || "");
  detalle.variante = elegida;

  const mensaje = `Hola, me interesa: ${p.nombre}${p.codigo ? ` (Código: ${p.codigo})` : ""}${elegida ? ` (${elegida})` : ""} · ${usd(p.precio)}.`;
  const wa = waLink(mensaje);

  $("#modal .sheet").innerHTML = `
  <button class="x cerrar" data-cerrar aria-label="Cerrar">✕</button>
  <div class="detalle">
    <div class="galeria">
      <div class="foto-grande" id="fotoGrande">
        ${fotos[0] ? `<img src="${esc(fotos[0])}" alt="${esc(p.nombre)}" data-zoom="${esc(fotos[0])}">` : `<span class="sin-foto">Sin foto</span>`}
      </div>
      ${fotos.length ? `<p class="hint" style="margin-top:8px">Toca la foto para verla de cerca</p>` : ""}
      ${fotos.length > 1 ? `
        <div class="miniaturas">
          ${fotos.map((f, i) => `<button class="mini ${i === 0 ? "on" : ""}" data-foto="${esc(f)}" aria-label="Ver foto ${i + 1}"><img src="${esc(f)}" alt=""></button>`).join("")}
        </div>` : ""}
    </div>

    <div class="info">
      <span class="tipo">${esc(CATEGORIAS[p.tipo] || "")}${p.codigo ? ` · Código ${esc(p.codigo)}` : ""}</span>
      <h2>${esc(p.nombre)}</h2>
      <p class="precio-grande">${usd(p.precio)} <span class="pill ${e.ok ? "ok" : "agotado"}">${e.txt}</span></p>
      ${p.descripcion ? `<p class="desc">${esc(p.descripcion)}</p>` : ""}

      ${variantes.length ? `
        <h4>Elige tu opción</h4>
        <div class="vars">
          ${variantes.map(v => v.disponible
            ? `<button type="button" class="opt ${v.nombre === elegida ? "on" : ""}" data-var="${esc(v.nombre)}" aria-pressed="${v.nombre === elegida}">${esc(v.nombre)}</button>`
            : `<span class="pill agotado">${esc(v.nombre)} · Agotado</span>`).join("")}
        </div>` : ""}

      <div class="acciones-detalle">
        ${e.ok
          ? `<button class="btn" type="button" data-agregar-detalle="${esc(p.id)}">+ Agregar al pedido</button>`
          : `<button class="btn ghost" type="button" disabled>Agotado por ahora</button>`}
        <button class="btn ghost" type="button" data-compartir="${esc(p.id)}">Compartir</button>
      </div>
      <p style="margin:12px 0 0"><a class="btn wa" href="${wa}" target="_blank" rel="noopener">Preguntar por WhatsApp</a></p>

      ${caracteristicas.length ? `
        <h4>Características</h4>
        <dl class="specs">
          ${caracteristicas.map(c => `<div><dt>${esc(c.campo)}</dt><dd>${esc(c.valor)}</dd></div>`).join("")}
        </dl>` : ""}

      ${accesorios.length ? `
        <h4>Accesorios incluidos</h4>
        <ul class="lista-simple">${accesorios.map(a => `<li>${esc(a)}</li>`).join("")}</ul>` : ""}

      ${usos.length ? `
        <h4>Usos</h4>
        <ul class="lista-simple">${usos.map(u => `<li>${esc(u)}</li>`).join("")}</ul>` : ""}

      ${documentos.length ? `
        <h4>Documentos</h4>
        <ul class="lista-simple">
          ${documentos.map(d => `<li><a href="${esc(urlSegura(d.url))}" target="_blank" rel="noopener">${esc(d.nombre || "Descargar")}</a></li>`).join("")}
        </ul>` : ""}
    </div>
  </div>`;
}

/* ---------- Eventos ---------- */
document.addEventListener("click", (e) => {
  const t = e.target;

  if (t.closest("#fab") || t.closest("#btnPedidoTop") || t.closest("#btnPedidoPie")) return abrirPedido();
  if (t.closest("#btnLimpiarFiltros") || t.closest("#btnVerTodasCats")) return limpiarFiltros();

  const opcInicio = t.closest("[data-opcion-inicio]");
  if (opcInicio) {
    const modo = opcInicio.dataset.opcionInicio;
    if (modo === "pedido") return abrirPedido();
    if (modo === "categorias") {
      const sec = $("#categorias");
      if (sec && !sec.hidden) sec.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    if (modo === "disponibles") {
      pub.tipo = "todos";
      pub.soloDisp = true;
      pub.vistaProd = "disponibles";
      render();
      const sec = $("#productosSec");
      if (sec) sec.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    limpiarFiltros();
    const sec = $("#productosSec");
    if (sec) sec.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }

  const vistaBtn = t.closest("[data-vista-prod]");
  if (vistaBtn) {
    pub.vistaProd = vistaBtn.dataset.vistaProd;
    pub.soloDisp = pub.vistaProd === "disponibles";
    return render();
  }

  const add = t.closest("[data-add]");
  if (add) return agregarRapido(add.dataset.add);

  const agregarDet = t.closest("[data-agregar-detalle]");
  if (agregarDet && detalle) return agregarAlPedido(detalle.id, detalle.variante);

  const compartirBtn = t.closest("[data-compartir]");
  if (compartirBtn) return compartir(compartirBtn.dataset.compartir);

  const opcion = t.closest("[data-var]");
  if (opcion && detalle) {
    detalle.variante = opcion.dataset.var;
    return pintarDetalle();
  }

  const cat = t.closest("[data-cat]");
  if (cat) {
    pub.tipo = pub.tipo === cat.dataset.cat ? "todos" : cat.dataset.cat;
    render();
    const sec = $("#productosSec");
    if (sec) sec.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }

  const chip = t.closest("[data-tipo]");
  if (chip) {
    pub.tipo = chip.dataset.tipo;
    return render();
  }

  if (t.closest("[data-solo]")) {
    pub.soloDisp = !pub.soloDisp;
    pub.vistaProd = pub.soloDisp ? "disponibles" : "todos";
    return render();
  }

  const mini = t.closest("[data-foto]");
  if (mini) {
    const grande = $("#fotoGrande");
    if (grande) grande.innerHTML = `<img src="${esc(mini.dataset.foto)}" alt="" data-zoom="${esc(mini.dataset.foto)}">`;
    $$("[data-foto]").forEach(b => b.classList.toggle("on", b === mini));
    return;
  }

  const cant = t.closest("[data-cant]");
  if (cant) return cambiarCantidad(cant.dataset.cant, cant.dataset.varLinea || "", Number(cant.dataset.d));

  const quitar = t.closest("[data-quitar]");
  if (quitar) return quitarDelPedido(quitar.dataset.quitar, quitar.dataset.varLinea || "");

  if (t.closest("[data-vaciar]")) {
    if (confirm("¿Vaciar tu pedido?")) {
      pedido = [];
      cambiarPedido();
    }
    return;
  }

  const card = t.closest(".card-prod");
  if (card) abrirDetalle(card.dataset.id);
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && e.target.classList && e.target.classList.contains("card-prod")) {
    abrirDetalle(e.target.dataset.id);
  }
});

/* ---------- Datos y tiempo real ---------- */
async function cargar() {
  const [cat, car, cats, cfg] = await Promise.all([
    sb.from("catalogo_publico").select("*"),
    sb.from("carrusel").select("url").eq("activo", true).order("orden", { ascending: true }),
    sb.from("categorias_publicas").select("*"),
    sb.from("configuracion_catalogo").select("clave, valor").eq("clave", "hero_pie_url").maybeSingle(),
  ]);
  const aviso = $("#avisoCarga");
  if (cat.error) {
    aviso.textContent = "No pudimos cargar el catálogo. Revisa tu conexión e intenta de nuevo.";
    aviso.hidden = false;
    return;
  }
  // Solo se muestran los productos de categorías visibles
  pub.categoriasOk = !cats.error;
  if (!cats.error) fijarCategorias(cats.data || []);
  pub.items = (cat.data || []).filter(p => !pub.categoriasOk || CATEGORIAS[p.tipo]);
  pub.fotos = car.error ? [] : (car.data || []).map(f => urlSegura(f.url)).filter(Boolean);
  pub.heroPieUrl = (!cfg.error && cfg.data && cfg.data.valor) ? urlSegura(cfg.data.valor) : "";

  aviso.textContent = "No pudimos cargar las categorías. Intenta de nuevo en un momento.";
  aviso.hidden = !cats.error;
  podarPedido();
  pintarFondoHero();
  pintarPieHero();
  render();
  actualizarFab();
}

function iniciar() {
  pedido = cargarPedido();
  $("#buscar").addEventListener("input", e => { pub.q = e.target.value; render(); });
  $("#orden").addEventListener("change", e => { pub.orden = e.target.value; render(); });
  const waUrl = `https://wa.me/${CONFIG.WHATSAPP}`;
  $("#btnWa").href = waUrl;
  const btnWaPie = $("#btnWaPie");
  if (btnWaPie) btnWaPie.href = waUrl;

  render();
  pintarPieHero();
  actualizarFab();

  if (!CONFIGURADO) {
    const aviso = $("#avisoCarga");
    aviso.textContent = "Falta configurar Supabase en config.js.";
    aviso.hidden = false;
    return;
  }

  cargar();
  // Cuando el panel guarda algo (productos, carrusel o configuración), la tabla catalogo_meta cambia y se vuelve a cargar
  sb.channel("catalogo-publico")
    .on("postgres_changes", { event: "*", schema: "public", table: "catalogo_meta" }, () => cargar())
    .subscribe();
}

iniciar();

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
const MAX_PILLS_TARJETA = 6;

// Iconos y descripciones breves para el Mega Menu de 3 columnas y el Mobile Bottom Sheet
const META_CATEGORIAS = {
  maquina:       { ico: "🪡", desc: "Máquinas domésticas, industriales y fileteadoras" },
  hilo:          { ico: "🧵", desc: "Hilos de coser, bordar, nylon y alta resistencia" },
  tela:          { ico: "🧶", desc: "Telas seleccionadas y forros para confección" },
  bisuteria:     { ico: "💎", desc: "Perlas, cristales, dijes e insumos creativos" },
  acce_met:      { ico: "⚙️", desc: "Argollas, hebillas, cáncamos, trabillas y herrajes" },
  acce_plast:    { ico: "🧷", desc: "Copas, broches, pasadores y accesorios técnicos" },
  cierre:        { ico: "🤐", desc: "Cierres por metro, invisibles, fijos y deslizadores" },
  cordon:        { ico: "🪢", desc: "Cordones trenzados, elásticos y cintas textiles" },
  tijera:        { ico: "✂️", desc: "Tijeras de sastrería, rematadoras y corte preciso" },
  crochet_neg:   { ico: "🖤", desc: "Rollos de crochet e hilaza en tono negro intenso" },
  crochet_blanc: { ico: "🤍", desc: "Rollos de crochet e hilaza en blanco clásico" },
  macuto_neg:    { ico: "🎒", desc: "Macutos e hilos gruesos negros para marroquinería" },
  macuto_blanc:  { ico: "👜", desc: "Macutos e hilos gruesos blancos de alta tenacidad" },
  repuesto:      { ico: "🔧", desc: "Agujas, prénsatelas, bobinas y piezas de recambio" },
  otro:          { ico: "✦",  desc: "Broches magnéticos, tensores, aros y misceláneos" },
};

const metaDeCat = (codigo, n = 0, disp = 0) => {
  const base = META_CATEGORIAS[codigo] || {
    ico: "❖",
    desc: `${n} artículo${n === 1 ? "" : "s"} · ${disp} disponible${disp === 1 ? "" : "s"}`,
  };
  return base;
};

const pub = {
  items: [],
  aliasIds: new Map(), // idOriginal -> { idBase, variante }
  seleccion: {},       // idProducto -> nombre de la variante seleccionada en su tarjeta
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
let pedido = [];   // [{ id, variante, cantidad }]. Precio y disponibilidad se leen de la variante actual.
let detalle = null; // { id, variante } del producto abierto en la ficha
let vista = null;   // "pedido" o "detalle": qué hay dentro del panel modal abierto
let bsContexto = null; // { modo: "categorias" | "variantes" | "orden", id?: string }

const urlSegura = u => (/^https?:\/\//i.test(String(u || "")) ? String(u) : "");
const fotosDe = p => (Array.isArray(p.fotos) ? p.fotos.map(urlSegura).filter(Boolean) : []);
const norma = s => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
const esVarianteUnica = nombre => {
  const n = norma(nombre);
  return !n || n === "unica" || n === "unico";
};

/* ---------- Normalización y consolidación en Producto Base + Variantes ---------- */
function normalizarVariantesProducto(p) {
  const varsRaw = Array.isArray(p.variantes) ? p.variantes : [];
  const precioBase = Number(p.precio) || 0;
  if (!varsRaw.length) {
    return [{
      nombre: "Única",
      precio: precioBase,
      disponible: true,
      codigo: p.codigo || "",
      orden: 1,
    }];
  }
  const lista = varsRaw.map((v, idx) => {
    const pr = (v && v.precio !== undefined && v.precio !== null && v.precio !== "")
      ? Number(String(v.precio).replace(",", "."))
      : precioBase;
    const disp = (v && typeof v.disponible === "boolean")
      ? v.disponible
      : (v && v.stock !== undefined ? (Number(v.stock) || 0) > 0 : true);
    return {
      nombre: String((v && v.nombre) || "Única").trim(),
      precio: Number.isFinite(pr) && pr >= 0 ? pr : precioBase,
      disponible: disp,
      codigo: (v && v.codigo) || p.codigo || "",
      orden: Number(v && v.orden) || (idx + 1),
    };
  });

  // Si hay varias opciones y alguna tiene medida numérica, las ordena de menor a mayor
  const tieneMedidas = lista.length > 1 && lista.some(v => Number.isFinite(valorMedidaVariante(v.nombre)));
  return tieneMedidas ? ordenarVariantesLista(lista) : lista;
}

/* Consolida tarjetas separadas del mismo producto base con distintas medidas o misma foto
   en un solo Producto Base con Variantes ordenadas de menor a mayor y precios individuales. */
function consolidarProductosCatalogo(itemsRaw) {
  pub.aliasIds.clear();
  const limpios = (itemsRaw || []).map(p => ({
    ...p,
    variantes: normalizarVariantesProducto(p),
  }));

  // 1) Agrupar productos simples (sin múltiples variantes propias) que comparten nombre base + medida/talla
  const gruposPorBase = new Map();
  const individuales = [];

  for (const p of limpios) {
    const vars = p.variantes;
    const tieneMultiplesPropias = vars.length > 1 || (vars.length === 1 && !esVarianteUnica(vars[0].nombre));
    if (tieneMultiplesPropias) {
      individuales.push(p);
      continue;
    }
    const { base, variante } = typeof extraerBaseYVariante === "function"
      ? extraerBaseYVariante(p.nombre)
      : { base: p.nombre, variante: "" };

    if (!variante) {
      individuales.push(p);
      continue;
    }

    const clave = `${p.tipo}::${norma(base)}`;
    if (!gruposPorBase.has(clave)) {
      gruposPorBase.set(clave, { base, tipo: p.tipo, entradas: [] });
    }
    gruposPorBase.get(clave).entradas.push({ p, etiqueta: variante });
  }

  const resultado = [...individuales];

  for (const g of gruposPorBase.values()) {
    if (g.entradas.length === 1) {
      // Un solo producto con medida en el nombre: conserva su tarjeta y expone también su medida como pastilla
      const { p, etiqueta } = g.entradas[0];
      const disp = p.variantes.some(v => v.disponible);
      resultado.push({
        ...p,
        variantes: [{
          nombre: etiqueta,
          precio: Number(p.precio) || 0,
          disponible: disp,
          codigo: p.codigo || "",
          orden: 1,
        }],
      });
      continue;
    }

    // 2 o más productos del mismo producto base con distintas medidas -> 1 sola tarjeta con variantes
    const ordenadas = [...g.entradas].sort((a, b) => compararVariantes(a.etiqueta, b.etiqueta));
    const principal = ordenadas.find(x => fotosDe(x.p).length > 0)?.p || ordenadas[0].p;
    const fotosUnicas = [];
    ordenadas.forEach(({ p }) => {
      fotosDe(p).forEach(u => {
        if (!fotosUnicas.includes(u)) fotosUnicas.push(u);
      });
    });

    const variantesConsolidadas = ordenadas.map(({ p, etiqueta }, idx) => {
      const disp = p.variantes.some(v => v.disponible);
      const precioVar = Number(p.precio) || 0;
      pub.aliasIds.set(p.id, { idBase: principal.id, variante: etiqueta });
      return {
        nombre: etiqueta,
        precio: precioVar,
        disponible: disp,
        codigo: p.codigo || "",
        origenId: p.id,
        orden: idx + 1,
      };
    });

    const primeraDisp = variantesConsolidadas.find(v => v.disponible) || variantesConsolidadas[0];
    const algunDestacado = ordenadas.some(x => x.p.destacado);
    const fechaMasReciente = ordenadas
      .map(x => x.p.creado_en || "")
      .sort()
      .pop() || principal.creado_en;

    resultado.push({
      ...principal,
      nombre: g.base,
      precio: primeraDisp ? primeraDisp.precio : principal.precio,
      destacado: algunDestacado,
      creado_en: fechaMasReciente,
      fotos: fotosUnicas.length ? [fotosUnicas[0]] : principal.fotos,
      variantes: variantesConsolidadas,
    });
  }

  return resultado;
}

function variantesDe(p) {
  return Array.isArray(p && p.variantes) && p.variantes.length
    ? p.variantes
    : [{ nombre: "Única", precio: Number(p && p.precio) || 0, disponible: true, codigo: (p && p.codigo) || "" }];
}

function tieneSelectorVariantes(p) {
  const vars = variantesDe(p);
  return vars.length > 1 || (vars.length === 1 && !esVarianteUnica(vars[0].nombre));
}

function etiquetaTipoVariante(vars) {
  const tieneMedida = (vars || []).some(v => /(\bcm\b|\bmm\b|\bmts?\b|talla|#|")/i.test(String(v.nombre || "")));
  return tieneMedida ? "Medidas" : "Opciones / Colores";
}

function varianteSeleccionadaDe(p) {
  const vars = variantesDe(p);
  const actual = pub.seleccion[p.id];
  if (actual) {
    const hallada = vars.find(v => v.nombre === actual);
    if (hallada) return hallada;
  }
  // Por defecto selecciona la primera variante disponible (o la primera si todas están agotadas)
  const porDefecto = vars.find(v => v.disponible) || vars[0];
  if (porDefecto) pub.seleccion[p.id] = porDefecto.nombre;
  return porDefecto || { nombre: "Única", precio: Number(p.precio) || 0, disponible: true, codigo: p.codigo || "" };
}

function estadoDe(p) {
  const vars = variantesDe(p);
  return vars.some(v => v.disponible)
    ? { ok: true, txt: "Disponible" }
    : { ok: false, txt: "Agotado" };
}

function precioMinimoDe(p) {
  const vars = variantesDe(p);
  const disp = vars.filter(v => v.disponible);
  const fuente = disp.length ? disp : vars;
  const precios = fuente.map(v => Number(v.precio)).filter(n => Number.isFinite(n) && n >= 0);
  return precios.length ? Math.min(...precios) : (Number(p.precio) || 0);
}

function disponiblesDe(p) {
  const vars = variantesDe(p);
  return vars.filter(v => v.disponible).map(v => v.nombre);
}

function esNuevo(p) {
  const t = Date.parse(p.creado_en || "");
  return Number.isFinite(t) && Date.now() - t < DIAS_NUEVO * 86400000;
}

function textoBusqueda(p) {
  const vars = variantesDe(p);
  const nombresVars = vars.map(v => `${v.nombre} ${v.codigo || ""}`).join(" ");
  const usos = (Array.isArray(p.usos) ? p.usos : []).join(" ");
  return norma(`${p.nombre} ${p.codigo || ""} ${p.descripcion || ""} ${CATEGORIAS[p.tipo] || ""} ${nombresVars} ${usos}`);
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
    const meta = metaDeCat(k, lista.length, disp);
    return { k, nombre, n: lista.length, disp, portada, ico: meta.ico, desc: meta.desc };
  }).filter(c => c.n > 0);
}

/* ---------- Mega Menu en Escritorio (3 columnas con iconos y descripciones + tarjeta destacada) ---------- */
function pintarMegaMenu() {
  const colsEl = $("#megaCols");
  const featEl = $("#megaFeatured");
  if (!colsEl || !featEl) return;

  const cats = categoriasConProductos();
  const todas = cats.length
    ? cats
    : Object.entries(CATEGORIAS).map(([k, nombre]) => {
        const meta = metaDeCat(k, 0, 0);
        return { k, nombre, n: 0, disp: 0, portada: "", ico: meta.ico, desc: meta.desc };
      });

  colsEl.innerHTML = todas.map(c => {
    const activa = pub.tipo === c.k;
    return `
    <button type="button" class="mega-item ${activa ? "on" : ""}" data-mega-cat="${esc(c.k)}">
      <span class="mega-item-ico" aria-hidden="true">${c.ico}</span>
      <span class="mega-item-body">
        <span class="mega-item-top">
          <b>${esc(c.nombre)}</b>
          ${c.n > 0 ? `<span class="mega-item-badge">${c.n}</span>` : ""}
        </span>
        <small>${esc(c.desc)}</small>
      </span>
    </button>`;
  }).join("");

  // Producto estrella o tarjeta destacada a la derecha del Mega Menu
  const prodEstrella =
    pub.items.find(p => p.destacado && fotosDe(p).length && estadoDe(p).ok) ||
    pub.items.find(p => fotosDe(p).length && estadoDe(p).ok) ||
    pub.items[0] ||
    null;

  if (prodEstrella) {
    const vSel = varianteSeleccionadaDe(prodEstrella);
    const foto = fotosDe(prodEstrella)[0] || pub.fotos[0] || "logo.png";
    const numVars = variantesDe(prodEstrella).length;
    featEl.innerHTML = `
      <div class="mega-feat-card">
        <div class="mega-feat-img">
          <img src="${esc(foto)}" alt="${esc(prodEstrella.nombre)}" loading="lazy">
          <span class="mega-feat-tag">${prodEstrella.destacado ? "★ Producto estrella" : "✦ Destacado"}</span>
        </div>
        <div class="mega-feat-info">
          <span class="tipo">${esc(CATEGORIAS[prodEstrella.tipo] || "Catálogo")}</span>
          <h4>${esc(prodEstrella.nombre)}</h4>
          <p class="mega-feat-desc">${numVars > 1 ? `${numVars} medidas u opciones disponibles desde ${usd(precioMinimoDe(prodEstrella))}` : (prodEstrella.descripcion || "Disponible para pedido inmediato por WhatsApp.")}</p>
          <div class="mega-feat-foot">
            <strong>${usd(vSel.precio)}</strong>
            <button type="button" class="btn sm" data-mega-prod="${esc(prodEstrella.id)}">Ver producto →</button>
          </div>
        </div>
      </div>`;
  } else {
    const fotoFallback = pub.fotos[0] || "logo.png";
    featEl.innerHTML = `
      <div class="mega-feat-card">
        <div class="mega-feat-img">
          <img src="${esc(fotoFallback)}" alt="Mercería Oriente" loading="lazy">
          <span class="mega-feat-tag">★ Mercería Oriente</span>
        </div>
        <div class="mega-feat-info">
          <span class="tipo">Atención personalizada</span>
          <h4>Todo para coser, bordar y crear</h4>
          <p class="mega-feat-desc">Explora accesorios metálicos, hilos, cierres, tijeras y máquinas con precios actualizados en vivo.</p>
          <div class="mega-feat-foot">
            <button type="button" class="btn sm" data-mega-todas>Explorar catálogo →</button>
          </div>
        </div>
      </div>`;
  }
}

function cerrarMegaMenu() {
  const wrap = $("#navMegaWrap");
  const btn = $("#btnMegaCats");
  if (wrap) wrap.classList.remove("abierto");
  if (btn) btn.setAttribute("aria-expanded", "false");
}

/* ---------- Mobile Bottom Sheet (drag handle, rounded top corners 24px, swipe down to close) ---------- */
function abrirBottomSheet({ eyebrow = "Mercería Oriente", titulo = "Seleccionar", html = "", contexto = null }) {
  const modalBs = $("#bottomSheetModal");
  const sheet = $("#bottomSheet");
  const ey = $("#bsEyebrow");
  const ti = $("#bsTitulo");
  const body = $("#bsBody");
  if (!modalBs || !sheet || !body) return;

  bsContexto = contexto;
  if (ey) ey.textContent = eyebrow;
  if (ti) ti.textContent = titulo;
  body.innerHTML = html;

  sheet.style.transform = "";
  sheet.style.transition = "";
  modalBs.hidden = false;
  requestAnimationFrame(() => {
    modalBs.classList.add("abierto");
  });
  document.body.classList.add("lock");
}

function cerrarBottomSheet() {
  const modalBs = $("#bottomSheetModal");
  const sheet = $("#bottomSheet");
  if (!modalBs || modalBs.hidden) return;
  modalBs.classList.remove("abierto");
  if (sheet) sheet.style.transform = "";
  bsContexto = null;
  setTimeout(() => {
    if (!modalBs.classList.contains("abierto")) {
      modalBs.hidden = true;
      const modalPrincipal = $("#modal");
      const visor = $("#visor");
      if ((!modalPrincipal || modalPrincipal.hidden) && (!visor || visor.hidden)) {
        document.body.classList.remove("lock");
      }
    }
  }, 240);
}

function abrirBottomSheetCategorias() {
  const cats = categoriasConProductos();
  const totalDisp = pub.items.filter(p => estadoDe(p).ok).length;
  const html = `
    <div class="bs-opciones" role="listbox" aria-label="Categorías">
      <button type="button" class="bs-opcion ${pub.tipo === "todos" ? "on" : ""}" data-bs-cat="todos">
        <span class="bs-opcion-ico">✦</span>
        <span class="bs-opcion-info">
          <b>Todas las categorías</b>
          <small>${pub.items.length} productos publicados · ${totalDisp} disponibles</small>
        </span>
        <span class="bs-opcion-check">${pub.tipo === "todos" ? "✔" : `${pub.items.length}`}</span>
      </button>
      ${cats.map(c => {
        const activa = pub.tipo === c.k;
        return `
        <button type="button" class="bs-opcion ${activa ? "on" : ""}" data-bs-cat="${esc(c.k)}">
          <span class="bs-opcion-ico">${c.ico}</span>
          <span class="bs-opcion-info">
            <b>${esc(c.nombre)}</b>
            <small>${esc(c.desc)} · ${c.disp} disponible${c.disp === 1 ? "" : "s"}</small>
          </span>
          <span class="bs-opcion-check">${activa ? "✔" : c.n}</span>
        </button>`;
      }).join("")}
    </div>`;

  abrirBottomSheet({
    eyebrow: "Departamentos",
    titulo: "Explorar por categoría",
    html,
    contexto: { modo: "categorias" },
  });
}

function abrirBottomSheetVariantes(id) {
  const p = pub.items.find(x => x.id === id);
  if (!p) return;
  const vars = variantesDe(p);
  const vSel = varianteSeleccionadaDe(p);
  const foto = fotosDe(p)[0] || "";
  const tipoLbl = etiquetaTipoVariante(vars);

  const html = `
    <div class="bs-prod-resumen">
      <div class="bs-prod-foto">
        ${foto ? `<img src="${esc(foto)}" alt="${esc(p.nombre)}">` : `<span class="sin-foto">✦</span>`}
      </div>
      <div class="bs-prod-txt">
        <span class="tipo">${esc(CATEGORIAS[p.tipo] || "")}</span>
        <h4>${esc(p.nombre)}</h4>
        <p class="bs-prod-precio"><strong id="bsVarPrecioSel">${usd(vSel.precio)}</strong> · <span id="bsVarNomSel">${esc(vSel.nombre)}</span></p>
      </div>
    </div>
    <p class="hint" style="margin:4px 0 8px">Selecciona la medida o color para actualizar el precio al instante:</p>
    <div class="bs-opciones bs-opciones-vars" role="listbox" aria-label="${esc(tipoLbl)}">
      ${vars.map(v => {
        const activa = v.nombre === vSel.nombre;
        return `
        <button type="button" class="bs-opcion ${activa ? "on" : ""} ${v.disponible ? "" : "agotada"}" data-bs-var="${esc(p.id)}" data-var-nom="${esc(v.nombre)}">
          <span class="bs-opcion-ico">${activa ? "●" : "○"}</span>
          <span class="bs-opcion-info">
            <b>${esc(v.nombre)}</b>
            <small>${v.disponible ? "Disponible para entrega" : "Agotado temporalmente"}${v.codigo ? ` · Cód. ${esc(v.codigo)}` : ""}</small>
          </span>
          <span class="bs-opcion-precio">
            <strong>${usd(v.precio)}</strong>
            <span class="pill ${v.disponible ? "ok" : "agotado"}">${v.disponible ? "Disponible" : "Agotado"}</span>
          </span>
        </button>`;
      }).join("")}
    </div>
    <div class="bs-footer-acc">
      <button type="button" class="btn" id="bsBtnAgregarVar" data-bs-add="${esc(p.id)}" ${vSel.disponible ? "" : "disabled"}>
        ${vSel.disponible ? `+ Agregar ${esc(vSel.nombre)} (${usd(vSel.precio)}) al pedido` : "Variante agotada"}
      </button>
    </div>`;

  abrirBottomSheet({
    eyebrow: tipoLbl,
    titulo: `Elige tu opción (${vars.length})`,
    html,
    contexto: { modo: "variantes", id: p.id },
  });
}

function abrirBottomSheetOrden() {
  const opciones = [
    ["destacados", "★", "Destacados primero", "Productos recomendados y orden alfabético"],
    ["precio-asc", "↑", "Precio: menor a mayor", "Ideal para ver las opciones más económicas primero"],
    ["precio-desc", "↓", "Precio: mayor a menor", "Equipos, máquinas y presentaciones mayores primero"],
    ["nombre", "A–Z", "Nombre A–Z", "Orden alfabético de la A a la Z"],
  ];
  const html = `
    <div class="bs-opciones" role="listbox" aria-label="Ordenar productos">
      ${opciones.map(([val, ico, tit, sub]) => {
        const activo = pub.orden === val;
        return `
        <button type="button" class="bs-opcion ${activo ? "on" : ""}" data-bs-orden="${val}">
          <span class="bs-opcion-ico">${ico}</span>
          <span class="bs-opcion-info">
            <b>${esc(tit)}</b>
            <small>${esc(sub)}</small>
          </span>
          <span class="bs-opcion-check">${activo ? "✔" : ""}</span>
        </button>`;
      }).join("")}
    </div>`;

  abrirBottomSheet({
    eyebrow: "Orden del catálogo",
    titulo: "Ordenar productos por",
    html,
    contexto: { modo: "orden" },
  });
}

// Gesto táctil y de arrastre para deslizar hacia abajo (swipe down to close) en el Mobile Bottom Sheet
function configurarGestoBottomSheet() {
  const sheet = $("#bottomSheet");
  const dragArea = $("#bsDragArea");
  const headArea = $(".bs-head");
  if (!sheet || !dragArea) return;

  let arrastrando = false;
  let inicioY = 0;
  let deltaY = 0;

  const iniciar = (y, target) => {
    const body = $("#bsBody");
    const desdeManija = dragArea.contains(target) || (headArea && headArea.contains(target) && !target.closest("button"));
    const enTopeBody = body && body.scrollTop <= 0;
    if (!desdeManija && !enTopeBody) return;
    arrastrando = true;
    inicioY = y;
    deltaY = 0;
    sheet.style.transition = "none";
  };

  const mover = (y, ev) => {
    if (!arrastrando) return;
    const diff = y - inicioY;
    if (diff <= 0) {
      deltaY = 0;
      sheet.style.transform = "";
      return;
    }
    deltaY = diff;
    if (ev && ev.cancelable) ev.preventDefault();
    sheet.style.transform = `translateY(${deltaY}px)`;
  };

  const soltar = () => {
    if (!arrastrando) return;
    arrastrando = false;
    sheet.style.transition = "transform .25s cubic-bezier(.22, 1, .36, 1)";
    if (deltaY > 80) {
      cerrarBottomSheet();
    } else {
      sheet.style.transform = "";
    }
    deltaY = 0;
  };

  sheet.addEventListener("touchstart", e => {
    if (e.touches && e.touches.length === 1) iniciar(e.touches[0].clientY, e.target);
  }, { passive: true });

  sheet.addEventListener("touchmove", e => {
    if (e.touches && e.touches.length === 1) mover(e.touches[0].clientY, e);
  }, { passive: false });

  sheet.addEventListener("touchend", soltar);
  sheet.addEventListener("touchcancel", soltar);

  // Soporte con mouse sobre la barra superior del Bottom Sheet
  dragArea.addEventListener("pointerdown", e => {
    iniciar(e.clientY, e.target);
    dragArea.setPointerCapture?.(e.pointerId);
  });
  dragArea.addEventListener("pointermove", e => mover(e.clientY, null));
  dragArea.addEventListener("pointerup", soltar);
  dragArea.addEventListener("pointercancel", soltar);
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

// Reconcilia productos consolidados y quita del pedido los que ya no están publicados
function podarPedido() {
  let cambio = false;
  const reconciliado = [];
  for (const l of pedido) {
    let idActual = l.id;
    let varActual = l.variante;
    if (pub.aliasIds.has(idActual)) {
      const alias = pub.aliasIds.get(idActual);
      idActual = alias.idBase;
      if (!varActual || esVarianteUnica(varActual)) varActual = alias.variante;
      cambio = true;
    }
    const prod = pub.items.find(p => p.id === idActual);
    if (!prod) {
      cambio = true;
      continue;
    }
    const vars = variantesDe(prod);
    if (!varActual && vars.length === 1) {
      varActual = vars[0].nombre;
    } else if (varActual && !vars.some(v => v.nombre === varActual) && vars.length === 1) {
      varActual = vars[0].nombre;
    }
    const existente = reconciliado.find(x => x.id === idActual && x.variante === varActual);
    if (existente) {
      existente.cantidad = Math.min(MAX_CANT, existente.cantidad + l.cantidad);
      cambio = true;
    } else {
      reconciliado.push({ id: idActual, variante: varActual, cantidad: l.cantidad });
    }
  }
  pedido = reconciliado;
  if (cambio) guardarPedido();
}

// Líneas con los datos actuales del producto y el precio individual de su variante seleccionada
function lineasPedido() {
  return pedido.map(l => {
    const p = pub.items.find(x => x.id === l.id);
    if (!p) return null;
    const vars = variantesDe(p);
    const v = vars.find(x => x.nombre === l.variante) || (vars.length === 1 ? vars[0] : null);
    const disponible = v ? !!v.disponible : estadoDe(p).ok;
    const precio = v && Number.isFinite(Number(v.precio)) ? Number(v.precio) : (Number(p.precio) || 0);
    const etiquetaVar = v && !esVarianteUnica(v.nombre) ? v.nombre : (!esVarianteUnica(l.variante) ? l.variante : "");
    return {
      ...l,
      p,
      etiquetaVar,
      foto: fotosDe(p)[0] || "",
      precio,
      disponible,
    };
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
  void f.offsetWidth;
  f.classList.add("pulso");
}

function cambiarPedido() {
  guardarPedido();
  actualizarFab();
  if (vista === "pedido" && !$("#modal").hidden) pintarPedido();
}

function agregarAlPedido(id, variante) {
  const p = pub.items.find(x => x.id === id);
  const vars = p ? variantesDe(p) : [];
  const varFinal = variante || (vars[0] ? vars[0].nombre : "");
  const vObj = vars.find(v => v.nombre === varFinal) || vars[0];
  if (vObj && !vObj.disponible) {
    return toast("Esa medida o color está agotada por ahora");
  }

  const linea = pedido.find(l => l.id === id && l.variante === varFinal);
  if (linea) linea.cantidad = Math.min(MAX_CANT, linea.cantidad + 1);
  else pedido.push({ id, variante: varFinal, cantidad: 1 });
  cambiarPedido();
  pulsoCarrito();

  const etiquetaToast = p
    ? `${p.nombre}${!esVarianteUnica(varFinal) ? ` (${varFinal} · ${usd(vObj ? vObj.precio : p.precio)})` : ""}`
    : "Producto";
  toast(`Agregado: ${etiquetaToast} ✔`);
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

// Botón "+ Agregar" de la tarjeta: envía directamente al carrito la variante exacta seleccionada en la tarjeta
function agregarRapido(id) {
  const p = pub.items.find(x => x.id === id);
  if (!p) return;
  const vSel = varianteSeleccionadaDe(p);
  if (!vSel || !vSel.disponible) {
    return toast("Esta variante está agotada. Elige otra medida o color disponible.");
  }
  agregarAlPedido(id, vSel.nombre);
}

// Actualiza dinámicamente al instante el precio, disponibilidad y pastilla activa dentro de la tarjeta
function seleccionarVarianteTarjeta(id, nombreVar) {
  const p = pub.items.find(x => x.id === id);
  if (!p) return;
  const vars = variantesDe(p);
  const v = vars.find(x => x.nombre === nombreVar);
  if (!v) return;

  pub.seleccion[id] = v.nombre;

  // Si la variante seleccionada estaba fuera de las primeras pastillas visibles, re-renderiza las pastillas de esa tarjeta
  const card = document.querySelector(`.card-prod[data-id="${CSS.escape(id)}"]`);
  if (card) {
    const varsCont = card.querySelector(".card-vars");
    if (varsCont && !varsCont.querySelector(`[data-var-nom="${CSS.escape(v.nombre)}"]`)) {
      card.outerHTML = tarjeta(p);
    } else {
      card.querySelectorAll("[data-card-var]").forEach(btn => {
        const on = btn.dataset.varNom === v.nombre;
        btn.classList.toggle("on", on);
        btn.setAttribute("aria-pressed", String(on));
      });
      const precioEl = card.querySelector("[data-card-precio]");
      if (precioEl) {
        precioEl.textContent = usd(v.precio);
        precioEl.classList.remove("precio-flash");
        void precioEl.offsetWidth;
        precioEl.classList.add("precio-flash");
      }
      const estadoEl = card.querySelector("[data-card-estado]");
      if (estadoEl) {
        estadoEl.textContent = v.disponible ? "Disponible" : "Agotado";
        estadoEl.className = `pill ${v.disponible ? "ok" : "agotado"}`;
      }
      const tipoEl = card.querySelector("[data-card-tipo]");
      if (tipoEl) {
        const cod = v.codigo || p.codigo || "";
        tipoEl.textContent = `${CATEGORIAS[p.tipo] || ""}${cod ? ` · ${cod}` : ""}`;
      }
      const btnAdd = card.querySelector("[data-add]");
      if (btnAdd) {
        btnAdd.disabled = !v.disponible;
        const mostrarVar = !esVarianteUnica(v.nombre);
        btnAdd.textContent = v.disponible
          ? `+ Agregar${mostrarVar ? ` · ${v.nombre}` : ""}`
          : `Agotado${mostrarVar ? ` (${v.nombre})` : ""}`;
      }
    }
  }

  // Si el Bottom Sheet de variantes de este producto está abierto, sincroniza su estado también
  if (bsContexto && bsContexto.modo === "variantes" && bsContexto.id === id) {
    const prSel = $("#bsVarPrecioSel");
    const nomSel = $("#bsVarNomSel");
    const btnBsAdd = $("#bsBtnAgregarVar");
    if (prSel) prSel.textContent = usd(v.precio);
    if (nomSel) nomSel.textContent = v.nombre;
    $$("[data-bs-var]").forEach(b => {
      const on = b.dataset.varNom === v.nombre;
      b.classList.toggle("on", on);
      const ico = b.querySelector(".bs-opcion-ico");
      if (ico) ico.textContent = on ? "●" : "○";
    });
    if (btnBsAdd) {
      btnBsAdd.disabled = !v.disponible;
      btnBsAdd.textContent = v.disponible
        ? `+ Agregar ${v.nombre} (${usd(v.precio)}) al pedido`
        : "Variante agotada";
    }
  }
}

const waLink = texto => `https://wa.me/${CONFIG.WHATSAPP}?text=${encodeURIComponent(texto)}`;
const totalDe = ls => ls.reduce((a, l) => a + l.precio * l.cantidad, 0);
const filasMensaje = ls => ls
  .map((l, i) => `${i + 1}. ${l.p.nombre}${l.etiquetaVar ? ` (${l.etiquetaVar})` : ""} · ${usd(l.precio)} c/u × ${l.cantidad} = ${usd(l.precio * l.cantidad)}`)
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
            <b>${esc(l.p.nombre)}${l.etiquetaVar ? ` <span class="car-var-badge">${esc(l.etiquetaVar)}</span>` : ""}</b>
            <small>${esc([l.etiquetaVar ? `Opción: ${l.etiquetaVar}` : "", `${usd(l.precio)} c/u`, l.disponible ? "" : "ya no disponible"].filter(Boolean).join(" · "))}</small>
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
      <p class="hint">Los precios individuales por variante y la disponibilidad se confirman por WhatsApp.</p>
      ${acciones}
      ${hayAgotados ? `<p class="hint">Algunos productos de tu pedido ya no están disponibles.</p>` : ""}
      <button type="button" class="link-vaciar" data-vaciar>Vaciar pedido</button>
    ` : `<p class="vacio-car">Tu pedido está vacío. Elige la medida o color en cualquier producto y toca + Agregar.</p>`}
  </div>`;
}

/* ---------- Compartir ---------- */
async function compartir(id) {
  const p = pub.items.find(x => x.id === id);
  if (!p) return;
  const vSel = varianteSeleccionadaDe(p);
  const url = location.href.split("#")[0];
  const varTxt = !esVarianteUnica(vSel.nombre) ? ` (${vSel.nombre})` : "";
  const texto = `${p.nombre}${varTxt} · ${usd(vSel.precio)} · Mercería Oriente`;
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
        ${c.portada ? `<img src="${esc(c.portada)}" alt="${esc(c.nombre)}" loading="lazy">` : `<span class="cat-placeholder">${c.ico}</span>`}
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
    "precio-asc": (a, b) => precioMinimoDe(a) - precioMinimoDe(b),
    "precio-desc": (a, b) => precioMinimoDe(b) - precioMinimoDe(a),
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
  const foto = fotosDe(p)[0] || "";
  const vars = variantesDe(p);
  const vSel = varianteSeleccionadaDe(p);
  const mostrarVars = tieneSelectorVariantes(p);
  const usos = Array.isArray(p.usos) ? p.usos.filter(Boolean) : [];
  const subInfo = !mostrarVars
    ? (usos[0] ? usos[0] : (p.descripcion ? p.descripcion : ""))
    : "";

  // Si hay muchas variantes, muestra las primeras MAX_PILLS_TARJETA garantizando que la seleccionada esté visible
  let varsVisibles = vars;
  let ocultas = 0;
  if (vars.length > MAX_PILLS_TARJETA) {
    varsVisibles = vars.slice(0, MAX_PILLS_TARJETA - 1);
    if (!varsVisibles.some(v => v.nombre === vSel.nombre)) {
      varsVisibles = [...vars.slice(0, MAX_PILLS_TARJETA - 2), vSel];
    }
    ocultas = vars.length - varsVisibles.length;
  }

  const codMostrar = vSel.codigo || p.codigo || "";
  const mostrarVarBtn = !esVarianteUnica(vSel.nombre);

  return `
  <article class="card-prod" data-id="${esc(p.id)}" tabindex="0" role="button" aria-label="Ver ${esc(p.nombre)}">
    <div class="foto">
      ${foto ? `<img src="${esc(foto)}" alt="${esc(p.nombre)}" loading="lazy">` : `<span class="sin-foto">Sin foto</span>`}
      ${esNuevo(p) ? `<span class="etiqueta-nuevo">Nuevo</span>` : (p.destacado ? `<span class="etiqueta-nuevo">★ Destacado</span>` : "")}
      ${vars.length > 1 ? `<span class="etiqueta-vars-cnt">${vars.length} ${etiquetaTipoVariante(vars).toLowerCase()}</span>` : ""}
    </div>
    <div class="cuerpo">
      <span class="tipo" data-card-tipo>${esc(CATEGORIAS[p.tipo] || "")}${codMostrar ? ` · ${esc(codMostrar)}` : ""}</span>
      <h3>${esc(p.nombre)}</h3>
      ${subInfo ? `<p class="card-subinfo">${esc(subInfo)}</p>` : ""}

      ${mostrarVars ? `
        <div class="card-vars-wrap">
          <div class="card-vars-cab">
            <span class="card-vars-lbl">${esc(etiquetaTipoVariante(vars))}</span>
            ${vars.length > 3 ? `<button type="button" class="card-vars-ver" data-abrir-vars="${esc(p.id)}">Ver lista (${vars.length}) ▾</button>` : ""}
          </div>
          <div class="card-vars" role="group" aria-label="Seleccionar medida o color de ${esc(p.nombre)}">
            ${varsVisibles.map(v => {
              const activa = v.nombre === vSel.nombre;
              return `
              <button type="button"
                class="var-pill ${activa ? "on" : ""} ${v.disponible ? "" : "agotada"}"
                data-card-var="${esc(p.id)}"
                data-var-nom="${esc(v.nombre)}"
                aria-pressed="${activa}"
                title="${esc(v.nombre)} · ${usd(v.precio)} · ${v.disponible ? "Disponible" : "Agotado"}">
                ${esc(v.nombre)}
              </button>`;
            }).join("")}
            ${ocultas > 0 ? `
              <button type="button" class="var-pill var-pill-mas" data-abrir-vars="${esc(p.id)}" title="Ver todas las medidas o colores">
                +${ocultas} más
              </button>` : ""}
          </div>
        </div>
      ` : ""}

      <div class="fila-precio">
        <strong data-card-precio="${esc(p.id)}">${usd(vSel.precio)}</strong>
        <span class="pill ${vSel.disponible ? "ok" : "agotado"}" data-card-estado="${esc(p.id)}">${vSel.disponible ? "Disponible" : "Agotado"}</span>
      </div>
      <button type="button" class="btn sm add" data-add="${esc(p.id)}" ${vSel.disponible ? "" : "disabled"} aria-label="Agregar ${esc(p.nombre)} al pedido">
        ${vSel.disponible ? `+ Agregar${mostrarVarBtn ? ` · ${esc(vSel.nombre)}` : ""}` : `Agotado${mostrarVarBtn ? ` (${esc(vSel.nombre)})` : ""}`}
      </button>
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

  const chips = [["todos", `Todos (${pub.items.length})`], ...cats.map(c => [c.k, `${c.ico} ${c.nombre} (${c.n})`])]
    .map(([k, l]) => `<button type="button" class="chip ${pub.tipo === k ? "on" : ""}" data-tipo="${esc(k)}">${esc(l)}</button>`)
    .join("");
  $("#chips").innerHTML = chips
    + `<button type="button" class="chip ios-chip-toggle ${pub.soloDisp ? "on" : ""}" data-solo role="switch" aria-checked="${pub.soloDisp}">
         <span>Solo disponibles (${totalDisp})</span>
         <span class="ios-switch sm ${pub.soloDisp ? "on ok" : ""}" aria-hidden="true"><span class="ios-knob"></span></span>
       </button>`;

  const lblCatActiva = $("#lblCatActiva");
  if (lblCatActiva) {
    lblCatActiva.textContent = pub.tipo !== "todos" && CATEGORIAS[pub.tipo] ? CATEGORIAS[pub.tipo] : "Categorías";
  }
  const lblOrdenMovil = $("#lblOrdenMovil");
  if (lblOrdenMovil) {
    const nombresOrden = {
      destacados: "Destacados",
      "precio-asc": "Menor precio",
      "precio-desc": "Mayor precio",
      nombre: "A–Z",
    };
    lblOrdenMovil.textContent = nombresOrden[pub.orden] || "Ordenar";
  }

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
  pintarMegaMenu();

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
  if (subTodos && pub.items.length) subTodos.textContent = `${pub.items.length} productos base publicados`;
  const subDisp = $("#optSubDisp");
  if (subDisp && pub.items.length) subDisp.textContent = `${totalDisp} artículos listos para entrega`;
  const subCats = $("#optSubCats");
  if (subCats && cats.length) subCats.textContent = `${cats.length} secciones disponibles`;
}

/* ---------- Ficha de producto ---------- */
function abrirDetalle(id) {
  const p = pub.items.find(x => x.id === id);
  if (!p) return;
  const vSel = varianteSeleccionadaDe(p);
  detalle = { id, variante: vSel ? vSel.nombre : "" };
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
  const variantes = variantesDe(p);

  const vElegida = variantes.find(v => v.nombre === detalle.variante)
    || varianteSeleccionadaDe(p)
    || variantes[0];
  detalle.variante = vElegida.nombre;
  pub.seleccion[p.id] = vElegida.nombre;

  const precioActual = Number(vElegida.precio) || Number(p.precio) || 0;
  const dispActual = !!vElegida.disponible;
  const codActual = vElegida.codigo || p.codigo || "";
  const varTxt = !esVarianteUnica(vElegida.nombre) ? ` (${vElegida.nombre})` : "";

  const mensaje = `Hola, me interesa: ${p.nombre}${codActual ? ` (Código: ${codActual})` : ""}${varTxt} · ${usd(precioActual)}.`;
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
      <span class="tipo">${esc(CATEGORIAS[p.tipo] || "")}${codActual ? ` · Código ${esc(codActual)}` : ""}</span>
      <h2>${esc(p.nombre)}</h2>
      <p class="precio-grande">
        <span>${usd(precioActual)}</span>
        <span class="pill ${dispActual ? "ok" : "agotado"}">${dispActual ? "Disponible" : "Agotado"}</span>
      </p>
      ${p.descripcion ? `<p class="desc">${esc(p.descripcion)}</p>` : ""}

      ${tieneSelectorVariantes(p) ? `
        <h4>Elige tu ${etiquetaTipoVariante(variantes).toLowerCase()}</h4>
        <div class="vars">
          ${variantes.map(v => {
            const on = v.nombre === vElegida.nombre;
            return `
            <button type="button" class="opt ${on ? "on" : ""} ${v.disponible ? "" : "opt-agotada"}" data-var="${esc(v.nombre)}" aria-pressed="${on}">
              <span>${esc(v.nombre)}</span>
              <small class="opt-precio">${usd(v.precio)}${v.disponible ? "" : " · Agotado"}</small>
            </button>`;
          }).join("")}
        </div>` : ""}

      <div class="acciones-detalle">
        ${dispActual
          ? `<button class="btn" type="button" data-agregar-detalle="${esc(p.id)}">+ Agregar${!esVarianteUnica(vElegida.nombre) ? ` ${esc(vElegida.nombre)}` : ""} (${usd(precioActual)})</button>`
          : `<button class="btn ghost" type="button" disabled>Variante agotada por ahora</button>`}
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

/* ---------- Hover y foco del Mega Menu en Escritorio ---------- */
function configurarMegaMenuHover() {
  const wrap = $("#navMegaWrap");
  const btn = $("#btnMegaCats");
  if (!wrap || !btn) return;
  let timerCerrar = null;

  const abrir = () => {
    clearTimeout(timerCerrar);
    wrap.classList.add("abierto");
    btn.setAttribute("aria-expanded", "true");
  };
  const programarCierre = () => {
    clearTimeout(timerCerrar);
    timerCerrar = setTimeout(() => cerrarMegaMenu(), 140);
  };

  wrap.addEventListener("mouseenter", abrir);
  wrap.addEventListener("mouseleave", programarCierre);
  wrap.addEventListener("focusin", abrir);
  wrap.addEventListener("focusout", e => {
    if (!wrap.contains(e.relatedTarget)) programarCierre();
  });

  btn.addEventListener("click", e => {
    if (window.matchMedia("(max-width: 760px)").matches) {
      e.preventDefault();
      abrirBottomSheetCategorias();
      return;
    }
    e.preventDefault();
    if (wrap.classList.contains("abierto")) cerrarMegaMenu();
    else abrir();
  });
}

/* ---------- Eventos ---------- */
document.addEventListener("click", (e) => {
  const t = e.target;

  // Cerrar Bottom Sheet
  if (t.closest("[data-cerrar-bs]") || t.id === "bottomSheetModal") {
    return cerrarBottomSheet();
  }

  // Abrir Bottom Sheet de categorías o de orden
  if (t.closest("#btnCatsMovil") || t.closest("#btnToolbarCats")) {
    return abrirBottomSheetCategorias();
  }
  if (t.closest("#btnOrdenMovil")) {
    return abrirBottomSheetOrden();
  }

  // Abrir Bottom Sheet de variantes desde una tarjeta
  const btnAbrirVars = t.closest("[data-abrir-vars]");
  if (btnAbrirVars) {
    e.stopPropagation();
    return abrirBottomSheetVariantes(btnAbrirVars.dataset.abrirVars);
  }

  // Selección de variante dentro de la tarjeta (actualiza precio al instante sin abrir modal)
  const pillVar = t.closest("[data-card-var]");
  if (pillVar) {
    e.stopPropagation();
    return seleccionarVarianteTarjeta(pillVar.dataset.cardVar, pillVar.dataset.varNom);
  }

  // Selección dentro del Mobile Bottom Sheet
  const bsCat = t.closest("[data-bs-cat]");
  if (bsCat) {
    pub.tipo = bsCat.dataset.bsCat;
    cerrarBottomSheet();
    render();
    const sec = $("#productosSec");
    if (sec) sec.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }

  const bsVar = t.closest("[data-bs-var]");
  if (bsVar) {
    seleccionarVarianteTarjeta(bsVar.dataset.bsVar, bsVar.dataset.varNom);
    return;
  }

  const bsAdd = t.closest("[data-bs-add]");
  if (bsAdd) {
    const id = bsAdd.dataset.bsAdd;
    agregarRapido(id);
    cerrarBottomSheet();
    return;
  }

  const bsOrden = t.closest("[data-bs-orden]");
  if (bsOrden) {
    pub.orden = bsOrden.dataset.bsOrden;
    const selOrden = $("#orden");
    if (selOrden) selOrden.value = pub.orden;
    cerrarBottomSheet();
    render();
    return;
  }

  // Mega Menu en escritorio
  const megaCat = t.closest("[data-mega-cat]");
  if (megaCat) {
    pub.tipo = megaCat.dataset.megaCat;
    cerrarMegaMenu();
    render();
    const sec = $("#productosSec");
    if (sec) sec.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }
  if (t.closest("[data-mega-todas]")) {
    pub.tipo = "todos";
    cerrarMegaMenu();
    render();
    const sec = $("#productosSec");
    if (sec) sec.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }
  const megaProd = t.closest("[data-mega-prod]");
  if (megaProd) {
    cerrarMegaMenu();
    return abrirDetalle(megaProd.dataset.megaProd);
  }

  if (t.closest("#fab") || t.closest("#btnPedidoTop") || t.closest("#btnPedidoPie")) return abrirPedido();
  if (t.closest("#btnLimpiarFiltros") || t.closest("#btnVerTodasCats")) return limpiarFiltros();

  const opcInicio = t.closest("[data-opcion-inicio]");
  if (opcInicio) {
    const modo = opcInicio.dataset.opcionInicio;
    if (modo === "pedido") return abrirPedido();
    if (modo === "categorias") {
      if (window.matchMedia("(max-width: 760px)").matches) {
        return abrirBottomSheetCategorias();
      }
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
  if (add) {
    e.stopPropagation();
    return agregarRapido(add.dataset.add);
  }

  const agregarDet = t.closest("[data-agregar-detalle]");
  if (agregarDet && detalle) return agregarAlPedido(detalle.id, detalle.variante);

  const compartirBtn = t.closest("[data-compartir]");
  if (compartirBtn) return compartir(compartirBtn.dataset.compartir);

  const opcion = t.closest("[data-var]");
  if (opcion && detalle) {
    detalle.variante = opcion.dataset.var;
    seleccionarVarianteTarjeta(detalle.id, detalle.variante);
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
  if (e.key === "Escape") {
    const bs = $("#bottomSheetModal");
    if (bs && !bs.hidden) {
      cerrarBottomSheet();
      return;
    }
    cerrarMegaMenu();
  }
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
  pub.categoriasOk = !cats.error;
  if (!cats.error) fijarCategorias(cats.data || []);
  const filtrados = (cat.data || []).filter(p => !pub.categoriasOk || CATEGORIAS[p.tipo]);
  pub.items = consolidarProductosCatalogo(filtrados);
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
  configurarMegaMenuHover();
  configurarGestoBottomSheet();

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
  sb.channel("catalogo-publico")
    .on("postgres_changes", { event: "*", schema: "public", table: "catalogo_meta" }, () => cargar())
    .subscribe();
}

iniciar();

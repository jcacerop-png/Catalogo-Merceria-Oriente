"use strict";
/* =========================================================
   Catálogo público. Solo lee las vistas y tablas públicas:
   "catalogo_publico" (productos sin costos ni cantidades exactas)
   y "carrusel" (fotos activas que se muestran en la entrada).
   ========================================================= */

const pub = { items: [], fotos: [], tipo: "todos", q: "", orden: "destacados" };
let rotFondo = null;
let rotBanner = null;

const urlSegura = u => (/^https?:\/\//i.test(String(u || "")) ? String(u) : "");
const fotosDe = p => (Array.isArray(p.fotos) ? p.fotos.map(urlSegura).filter(Boolean) : []);

function estadoDe(p) {
  const vars = Array.isArray(p.variantes) ? p.variantes : [];
  if (!vars.length) return { ok: true, txt: "Disponible" };
  return vars.some(v => v.disponible)
    ? { ok: true, txt: "Disponible" }
    : { ok: false, txt: "Agotado" };
}

/* ---------- Rotación de fotos (entrada y banner) ---------- */
function iniciarRotacion(imgs, ms, alCambiar) {
  let i = 0;
  let timer = null;

  const pintar = n => {
    if (!imgs.length) return;
    i = (n + imgs.length) % imgs.length;
    imgs.forEach((im, k) => im.classList.toggle("on", k === i));
    if (alCambiar) alCambiar(i);
  };
  const parar = () => clearInterval(timer);
  const arrancar = () => {
    parar();
    if (imgs.length > 1) timer = setInterval(() => pintar(i + 1), ms);
  };

  pintar(0);
  arrancar();
  return {
    ir: n => { pintar(n); arrancar(); },
    actual: () => i,
    parar,
    arrancar,
  };
}

function detenerRotaciones() {
  if (rotFondo) rotFondo.parar();
  if (rotBanner) rotBanner.parar();
  rotFondo = null;
  rotBanner = null;
}

function pintarCarruseles() {
  const fotos = pub.fotos;
  const fondo = $("#entradaFondo");
  const slides = $("#bannerSlides");
  const puntos = $("#bannerPuntos");
  const banner = $("#banner");

  detenerRotaciones();
  fondo.innerHTML = fotos.map((u, i) => `<img src="${esc(u)}" alt="" class="${i === 0 ? "on" : ""}">`).join("");
  slides.innerHTML = fotos.map((u, i) => `<img src="${esc(u)}" alt="" class="${i === 0 ? "on" : ""}">`).join("");
  puntos.innerHTML = fotos.map((_, i) => `<button type="button" data-punto="${i}" aria-label="Ver foto ${i + 1}" class="${i === 0 ? "on" : ""}"></button>`).join("");
  banner.hidden = fotos.length === 0;

  if (!fotos.length) return;

  rotFondo = iniciarRotacion($$("img", fondo), 6000);
  rotBanner = iniciarRotacion($$("img", slides), 5000, n => {
    $("#bannerContador").textContent = `${String(n + 1).padStart(2, "0")} / ${String(fotos.length).padStart(2, "0")}`;
    $$("button", puntos).forEach((b, k) => b.classList.toggle("on", k === n));
  });
}

function visibles() {
  const q = pub.q.trim().toLowerCase();
  const orden = {
    destacados: (a, b) => (Number(b.destacado) - Number(a.destacado)) || a.nombre.localeCompare(b.nombre, "es"),
    "precio-asc": (a, b) => Number(a.precio) - Number(b.precio),
    "precio-desc": (a, b) => Number(b.precio) - Number(a.precio),
    nombre: (a, b) => a.nombre.localeCompare(b.nombre, "es"),
  }[pub.orden];

  return pub.items
    .filter(p => (pub.tipo === "todos" || p.tipo === pub.tipo)
      && (!q || `${p.nombre} ${p.descripcion || ""} ${TIPOS[p.tipo] || ""}`.toLowerCase().includes(q)))
    .sort(orden);
}

function tarjeta(p) {
  const e = estadoDe(p);
  const foto = fotosDe(p)[0] || "";
  return `
  <article class="card-prod" data-id="${esc(p.id)}" tabindex="0" role="button" aria-label="Ver ${esc(p.nombre)}">
    <div class="foto">${foto ? `<img src="${esc(foto)}" alt="${esc(p.nombre)}" loading="lazy">` : `<span class="sin-foto">Sin foto</span>`}</div>
    <div class="cuerpo">
      <span class="tipo">${esc(TIPOS[p.tipo] || "")}</span>
      <h3>${esc(p.nombre)}</h3>
      <div class="fila-precio">
        <strong>${usd(p.precio)}</strong>
        <span class="pill ${e.ok ? "ok" : "agotado"}">${e.txt}</span>
      </div>
    </div>
  </article>`;
}

function render() {
  $("#chips").innerHTML = [["todos", "Todos"], ...Object.entries(TIPOS)]
    .map(([k, l]) => `<button class="chip ${pub.tipo === k ? "on" : ""}" data-tipo="${k}">${esc(l)}</button>`)
    .join("");

  const lista = visibles();
  $("#grid").innerHTML = lista.map(tarjeta).join("");
  $("#conteo").textContent = `${lista.length} producto(s)`;
  $("#vacio").textContent = pub.items.length
    ? "No hay productos con esos criterios."
    : "Pronto subiremos nuestros productos. ¡Vuelve pronto!";
  $("#vacio").hidden = lista.length > 0;
}

function abrirDetalle(id) {
  const p = pub.items.find(x => x.id === id);
  if (!p) return;

  const fotos = fotosDe(p);
  const caracteristicas = (Array.isArray(p.caracteristicas) ? p.caracteristicas : [])
    .filter(c => c && c.campo && c.valor);
  const accesorios = Array.isArray(p.accesorios) ? p.accesorios : [];
  const usos = Array.isArray(p.usos) ? p.usos : [];
  const documentos = (Array.isArray(p.documentos) ? p.documentos : []).filter(d => urlSegura(d.url));
  const variantes = Array.isArray(p.variantes) ? p.variantes : [];
  const e = estadoDe(p);
  const mensaje = `Hola, me interesa: ${p.nombre} (${usd(p.precio)}).`;
  const wa = `https://wa.me/${CONFIG.WHATSAPP}?text=${encodeURIComponent(mensaje)}`;

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
      <span class="tipo">${esc(TIPOS[p.tipo] || "")}</span>
      <h2>${esc(p.nombre)}</h2>
      <p class="precio-grande">${usd(p.precio)} <span class="pill ${e.ok ? "ok" : "agotado"}">${e.txt}</span></p>
      ${p.descripcion ? `<p class="desc">${esc(p.descripcion)}</p>` : ""}

      ${variantes.length ? `
        <h4>Disponibilidad</h4>
        <div class="vars">
          ${variantes.map(v => `<span class="pill ${v.disponible ? "ok" : "agotado"}">${esc(v.nombre)} · ${v.disponible ? "Disponible" : "Agotado"}</span>`).join("")}
        </div>` : ""}

      <p style="margin:18px 0"><a class="btn wa" href="${wa}" target="_blank" rel="noopener">Consultar por WhatsApp</a></p>

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
  abrirModal();
}

/* ---------- Eventos ---------- */
document.addEventListener("click", (e) => {
  const t = e.target;

  const chip = t.closest("[data-tipo]");
  if (chip) {
    pub.tipo = chip.dataset.tipo;
    return render();
  }

  const mini = t.closest("[data-foto]");
  if (mini) {
    const grande = $("#fotoGrande");
    if (grande) grande.innerHTML = `<img src="${esc(mini.dataset.foto)}" alt="" data-zoom="${esc(mini.dataset.foto)}">`;
    $$("[data-foto]").forEach(b => b.classList.toggle("on", b === mini));
    return;
  }

  const punto = t.closest("[data-punto]");
  if (punto && rotBanner) return rotBanner.ir(Number(punto.dataset.punto));
  if (t.closest("#bannerPrev") && rotBanner) return rotBanner.ir(rotBanner.actual() - 1);
  if (t.closest("#bannerNext") && rotBanner) return rotBanner.ir(rotBanner.actual() + 1);

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
  const [cat, car] = await Promise.all([
    sb.from("catalogo_publico").select("*"),
    sb.from("carrusel").select("url").eq("activo", true).order("orden", { ascending: true }),
  ]);
  const aviso = $("#avisoCarga");
  if (cat.error) {
    aviso.textContent = "No pudimos cargar el catálogo. Revisa tu conexión e intenta de nuevo.";
    aviso.hidden = false;
    return;
  }
  pub.items = cat.data || [];
  pub.fotos = car.error ? [] : (car.data || []).map(f => urlSegura(f.url)).filter(Boolean);
  aviso.hidden = true;
  pintarCarruseles();
  render();
}

function iniciar() {
  $("#buscar").addEventListener("input", e => { pub.q = e.target.value; render(); });
  $("#orden").addEventListener("change", e => { pub.orden = e.target.value; render(); });
  $("#btnWa").href = `https://wa.me/${CONFIG.WHATSAPP}`;

  const banner = $("#banner");
  banner.addEventListener("mouseenter", () => rotBanner && rotBanner.parar());
  banner.addEventListener("mouseleave", () => rotBanner && rotBanner.arrancar());
  let tx = null;
  banner.addEventListener("touchstart", e => { tx = e.touches[0].clientX; }, { passive: true });
  banner.addEventListener("touchend", e => {
    if (tx === null || !rotBanner) return;
    const dx = e.changedTouches[0].clientX - tx;
    if (Math.abs(dx) > 50) rotBanner.ir(rotBanner.actual() + (dx < 0 ? 1 : -1));
    tx = null;
  });

  render();

  if (!CONFIGURADO) {
    const aviso = $("#avisoCarga");
    aviso.textContent = "Falta configurar Supabase en config.js.";
    aviso.hidden = false;
    return;
  }

  cargar();
  // Cuando el panel guarda algo (productos o carrusel), la tabla catalogo_meta cambia y se vuelve a cargar
  sb.channel("catalogo-publico")
    .on("postgres_changes", { event: "*", schema: "public", table: "catalogo_meta" }, () => cargar())
    .subscribe();
}

iniciar();

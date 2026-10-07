/* =========================================================
   CALCULADORA LABORAL · EL SALVADOR
   Lógica principal comentada.
   ========================================================= */

(() => {
  "use strict";

  /* ---------------------------------------------------------
     Constantes legales/fórmulas derivadas de los documentos
     entregados por el usuario.
     --------------------------------------------------------- */
  const CONSTANTES = {
    DIAS_MES_COMERCIAL: 30,
    DIAS_ANIO_COMERCIAL: 360,
    RECARGO_ASUETO: 2,
    RECARGO_DESCANSO: 1.5,
    RECARGO_VACACIONES: 1.30,
    RECARGO_NOCTURNO: 1.25,
    RECARGO_HORA_EXTRA: 2,
    PORCENTAJE_ALOJAMIENTO: 0.25,
    PORCENTAJE_ALIMENTACION: 0.25,
    ISSS_PORCENTAJE: 0.03,
    ISSS_TOPE_BASE: 1000,
    AFP_PORCENTAJE: 0.0725,
    TOPE_DESPIDO_VECES_SALARIO_MINIMO: 4,
    TOPE_RENUNCIA_VECES_SALARIO_MINIMO: 2,
    // Salario mínimo comercio/servicios vigente desde junio de 2025,
    // utilizado como valor predeterminado editable en el código.
    SALARIO_MINIMO_COMERCIO: 408.80,
    SALARIO_MINIMO_INDUSTRIA: 408.80,
    SALARIO_MINIMO_MAQUILA: 402.26,
    SALARIO_MINIMO_AGRICOLA: 272.72
  };

  const estado = {
    pasoActual: 1,
    resultado: null,
    horasExtra: 0
  };

  const $ = (id) => document.getElementById(id);
  const $$ = (selector) => Array.from(document.querySelectorAll(selector));

  /* ---------------------------------------------------------
     Utilidades de formato y lectura de campos.
     --------------------------------------------------------- */
  function numero(valor) {
    const n = parseFloat(valor);
    return Number.isFinite(n) ? n : 0;
  }

  function dinero(valor) {
    return new Intl.NumberFormat("es-SV", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2
    }).format(numero(valor));
  }

  function fechaLocalISO(fecha = new Date()) {
    const zona = new Date(fecha.getTime() - fecha.getTimezoneOffset() * 60000);
    return zona.toISOString().slice(0, 10);
  }

  function fechaBonita(valor) {
    if (!valor) return "—";
    const [anio, mes, dia] = valor.split("-").map(Number);
    return new Intl.DateTimeFormat("es-SV", {
      day: "2-digit",
      month: "long",
      year: "numeric"
    }).format(new Date(anio, mes - 1, dia));
  }

  function fechaCorta(valor) {
    if (!valor) return "—";
    const [anio, mes, dia] = valor.split("-").map(Number);
    return `${String(dia).padStart(2,"0")}/${String(mes).padStart(2,"0")}/${anio}`;
  }

  function escapeHtml(texto) {
    return String(texto ?? "").replace(/[&<>"']/g, (caracter) => ({
      "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#039;"
    }[caracter]));
  }

  function mostrarToast(mensaje) {
    const toast = $("toast");
    toast.textContent = mensaje;
    toast.classList.add("visible");
    clearTimeout(mostrarToast.temporizador);
    mostrarToast.temporizador = setTimeout(() => toast.classList.remove("visible"), 3000);
  }

  /* ---------------------------------------------------------
     Antigüedad: componentes calendario con días residuales
     expresados comercialmente (30 días).
     --------------------------------------------------------- */
function calcularAntiguedad(fechaInicio, fechaFin) {
  if (!fechaInicio || !fechaFin) return null;

  const [anioInicio, mesInicio, diaInicio] = fechaInicio.split("-").map(Number);
  const [anioFin, mesFin, diaFin] = fechaFin.split("-").map(Number);

  // Validación básica de fechas.
  const inicio = new Date(anioInicio, mesInicio - 1, diaInicio);
  const fin = new Date(anioFin, mesFin - 1, diaFin);

  if (fin < inicio) return null;

  /*
    Cálculo comercial 30/360:
    - Cada año tiene 360 días.
    - Cada mes tiene 30 días.
    - Los días 31 se consideran día 30.
  */
  const diaInicialComercial = Math.min(diaInicio, 30);
  const diaFinalComercial = Math.min(diaFin, 30);

  const diasComercialesTotales =
    (anioFin - anioInicio) * 360 +
    (mesFin - mesInicio) * 30 +
    (diaFinalComercial - diaInicialComercial);

  if (diasComercialesTotales < 0) return null;

  // Convertimos nuevamente los días comerciales
  // a años, meses y días.
  const anios = Math.floor(diasComercialesTotales / 360);
  const restoAnual = diasComercialesTotales % 360;

  const meses = Math.floor(restoAnual / 30);
  const dias = restoAnual % 30;

  return {
    anios,
    meses,
    dias,
    diasComerciales: diasComercialesTotales
  };
}

  function actualizarAntiguedad() {
    const antiguedad = calcularAntiguedad($("fechaInicio").value, $("fechaFin").value);
    if (!antiguedad) {
      $("antiguedadTexto").textContent = "—";
      $("antiguedadDetalle").textContent = "Selecciona las dos fechas.";
      return;
    }

    $("antiguedadTexto").textContent =
      `${antiguedad.anios} año(s), ${antiguedad.meses} mes(es) y ${antiguedad.dias} día(s)`;

    const tipo = document.querySelector('input[name="tipoBaja"]:checked')?.value;
    let detalle = `${antiguedad.diasComerciales} días comerciales (360 días por año / 30 por mes).`;

    // La antigüedad no bloquea la liquidación por renuncia.
    // Si son menos de 2 años, únicamente se elimina la prestación
    // económica específica por renuncia; los demás derechos adquiridos
    // continúan calculándose.
    if (tipo === "renuncia" && antiguedad.diasComerciales < CONSTANTES.DIAS_ANIO_COMERCIAL * 2) {
      detalle += " No genera prestación económica por renuncia antes de 2 años; se mantienen las prestaciones proporcionales que correspondan.";
    }

    $("antiguedadDetalle").textContent = detalle;
    actualizarCategoriaAguinaldo(antiguedad.anios);
  }

  /* ---------------------------------------------------------
     Salarios mínimos por sector.
     --------------------------------------------------------- */
  function salarioMinimoSector() {
    const sector = $("sectorEconomico").value;
    return {
      comercio: CONSTANTES.SALARIO_MINIMO_COMERCIO,
      industria: CONSTANTES.SALARIO_MINIMO_INDUSTRIA,
      maquila: CONSTANTES.SALARIO_MINIMO_MAQUILA,
      agricola: CONSTANTES.SALARIO_MINIMO_AGRICOLA
    }[sector] || CONSTANTES.SALARIO_MINIMO_COMERCIO;
  }

  function salarioBasicoDiario() {
    return numero($("salarioMensual").value) / CONSTANTES.DIAS_MES_COMERCIAL;
  }

  /* ---------------------------------------------------------
     Configuración inicial de fechas y controles.
     --------------------------------------------------------- */
  function inicializarFechas() {
    /*const hoy = fechaLocalISO();
    $("fechaFin").value = hoy;
    $("fechaFin").max = hoy;
    $("fechaInicio").max = hoy;*/
    const hoy = fechaLocalISO();

     // Por defecto, el cálculo inicia como despido:
      // la fecha de finalización queda fijada en hoy.
    $("fechaFin").value = hoy;

     // La fecha de inicio puede ser cualquier fecha del calendario.
      $("fechaInicio").removeAttribute("max");

       // La fecha de finalización se restringe a hoy únicamente
       // mientras la causa sea despido.
       $("fechaFin").max = hoy;
  }

  function actualizarBloqueoFechaFin() {
    /*const tipo = document.querySelector('input[name="tipoBaja"]:checked').value;
    const esDespido = tipo === "despido";
    $("fechaFin").disabled = esDespido;
    if (esDespido) $("fechaFin").value = fechaLocalISO();
    $("bloqueRenuncia").classList.toggle("oculto", esDespido);
    actualizarAntiguedad();
    actualizarAvisoRenuncia();*/
    const tipo = document.querySelector('input[name="tipoBaja"]:checked').value;
  const esDespido = tipo === "despido";
  const hoy = fechaLocalISO();

  if (esDespido) {
    // DESPIDO:
    // La fecha de finalización queda fijada en hoy.
    $("fechaFin").disabled = true;
    $("fechaFin").value = hoy;
    $("fechaFin").max = hoy;
  } else {
    // RENUNCIA:
    // Se permite seleccionar cualquier fecha futura o pasada.
    $("fechaFin").disabled = false;
    $("fechaFin").removeAttribute("max");
  }

  // La fecha de inicio siempre queda libre.
  $("fechaInicio").removeAttribute("max");

  $("bloqueRenuncia").classList.toggle("oculto", esDespido);

  actualizarAntiguedad();
  actualizarAvisoRenuncia();
  }

  function actualizarAvisoRenuncia() {
    const aviso = $("avisoRenuncia");
    if (!aviso) return;
    const preaviso = $("dioPreaviso").value;
    const cargo = $("tipoCargo").value;
    if (preaviso === "no") {
      aviso.innerHTML = "<strong>Sin preaviso:</strong> la prestación económica por renuncia voluntaria se deja en $0.00 porque no se cumple el requisito utilizado por este módulo.";
      return;
    }
    const dias = cargo === "jefatura" ? 30 : 15;
    aviso.innerHTML = `<strong>Preaviso requerido:</strong> ${dias} días. Se conserva la elegibilidad si se cumplen los demás requisitos.`;
  }

  /* ---------------------------------------------------------
     Lista de asuetos.
     Semana Santa se calcula con el algoritmo de Pascua.
     --------------------------------------------------------- */
  function calcularPascua(anio) {
    const a = anio % 19;
    const b = Math.floor(anio / 100);
    const c = anio % 100;
    const d = Math.floor(b / 4);
    const e = b % 4;
    const f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4);
    const k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const mes = Math.floor((h + l - 7 * m + 114) / 31);
    const dia = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(anio, mes - 1, dia);
  }

  function fechaISODesdeDate(fecha) {
    return fechaLocalISO(fecha);
  }

  function construirAsuetos(anio) {
    const pascua = calcularPascua(anio);
    const jueves = new Date(pascua); jueves.setDate(pascua.getDate() - 3);
    const viernes = new Date(pascua); viernes.setDate(pascua.getDate() - 2);
    const sabado = new Date(pascua); sabado.setDate(pascua.getDate() - 1);

    return [
      {fecha:`${anio}-01-01`, nombre:"1 de enero · Año Nuevo", tipo:" Nacional"},
      {fecha:fechaISODesdeDate(jueves), nombre:"Jueves Santo", tipo:" Nacional"},
      {fecha:fechaISODesdeDate(viernes), nombre:"Viernes Santo", tipo:" Nacional"},
      {fecha:fechaISODesdeDate(sabado), nombre:"Sábado Santo", tipo:" Nacional"},
      {fecha:`${anio}-05-01`, nombre:"1 de mayo · Día del Trabajo", tipo:" Nacional"},
      {fecha:`${anio}-05-10`, nombre:"10 de mayo · Día de la Madre", tipo:" Nacional"},
      {fecha:`${anio}-06-17`, nombre:"17 de junio · Día del Padre", tipo:" Nacional"},
      {fecha:`${anio}-08-06`, nombre:"6 de agosto · Divino Salvador del Mundo", tipo:" Nacional"},
      {fecha:`${anio}-09-15`, nombre:"15 de septiembre · Independencia", tipo:" Nacional"},
      {fecha:`${anio}-09-21`, nombre:"21 de septiembre · Fiesta patronal de San Miguel", tipo:" Local · San Miguel"},
      {fecha:`${anio}-11-02`, nombre:"2 de noviembre · Día de los Difuntos", tipo:" Nacional"},
      {fecha:`${anio}-12-25`, nombre:"25 de diciembre · Navidad", tipo:" Nacional"}
    ];
  }

  function construirListaAsuetos() {
    const inicio = $("fechaInicio").value;
    const fin = $("fechaFin").value;
    const anioInicio = inicio ? new Date(`${inicio}T00:00:00`).getFullYear() : new Date().getFullYear();
    const anioFin = fin ? new Date(`${fin}T00:00:00`).getFullYear() : anioInicio;
    const todos = [];
    for (let anio = anioInicio; anio <= anioFin; anio++) todos.push(...construirAsuetos(anio));

    const rango = todos.filter(item => (!inicio || item.fecha >= inicio) && (!fin || item.fecha <= fin));
    const lista = $("listaAsuetos");
    lista.innerHTML = rango.length ? rango.map((item, indice) => `
      <label class="check-item">
        <input type="checkbox" class="asueto-check" data-fecha="${item.fecha}" data-nombre="${escapeHtml(item.nombre)}">
        <span><b>${escapeHtml(item.nombre)}</b><small>${escapeHtml(item.tipo)} · ${fechaCorta(item.fecha)}</small></span>
      </label>
    `).join("") : `<div class="info-box">No hay asuetos dentro del período seleccionado.</div>`;

    $$(".asueto-check").forEach(c => c.addEventListener("change", actualizarContadorAsuetos));
    actualizarContadorAsuetos();
  }

  function actualizarContadorAsuetos() {
    const cantidad = $$(".asueto-check:checked").length;
    $("contadorAsuetos").textContent = `${cantidad} seleccionado${cantidad === 1 ? "" : "s"}`;
  }

  /* ---------------------------------------------------------
     Fechas de descanso semanal.
     --------------------------------------------------------- */
  function agregarFilaDescanso(valor = "") {
    const fila = document.createElement("div");
    fila.className = "fila-dinamica";
    fila.innerHTML = `<input type="date" class="fecha-descanso" value="${valor}" min="${$("fechaInicio").value || ""}" max="${$("fechaFin").value || ""}">
      <button type="button" title="Quitar fecha">×</button>`;
    fila.querySelector("button").addEventListener("click", () => fila.remove());
    $("fechasDescanso").appendChild(fila);
  }

  /* ---------------------------------------------------------
     Horas extra: intervalos, cruce de medianoche y clasificación.
     --------------------------------------------------------- */
  function agregarFilaHoraExtra() {
    estado.horasExtra++;
    const fila = document.createElement("div");
    fila.className = "fila-hora";
    fila.dataset.id = estado.horasExtra;
    fila.innerHTML = `
      <input type="date" class="he-fecha" value="${$("fechaFin").value || fechaLocalISO()}">
      <input type="time" class="he-inicio">
      <input type="time" class="he-fin">
      <span class="he-horas">0.00</span>
      <span class="clasificacion">—</span>
      <span class="monto">$0.00</span>
      <button type="button" class="btn-quitar" title="Quitar">×</button>`;
    fila.querySelector(".btn-quitar").addEventListener("click", () => fila.remove());
    ["he-fecha","he-inicio","he-fin"].forEach(clase => fila.querySelector(`.${clase}`).addEventListener("change", actualizarHorasExtra));
    $("horasExtras").appendChild(fila);
    actualizarHorasExtra();
  }

  function minutos(hora) {
    const [h,m] = hora.split(":").map(Number);
    return h * 60 + m;
  }

  function horasIntervalo(inicio, fin) {
    let a = minutos(inicio);
    let b = minutos(fin);
    if (b <= a) b += 1440;
    return (b - a) / 60;
  }

  function clasificarIntervalo(inicio, fin) {
    let a = minutos(inicio);
    let b = minutos(fin);
    if (b <= a) b += 1440;

    // Cuenta cuántos minutos caen dentro de la franja nocturna.
    // Art. 161: la jornada mixta se considera nocturna si abarca 3.5 horas
    // nocturnas o más (210 minutos).
    let nocturnos = 0;
    for (let minuto = a; minuto < b; minuto++) {
      const reloj = minuto % 1440;
      if (reloj >= 19 * 60 || reloj < 6 * 60) nocturnos++;
    }
    const total = b - a;
    const diurnos = total - nocturnos;

    if (nocturnos === 0) return {tipo:"Diurna", horasDiurnas:total/60, horasNocturnas:0};
    if (diurnos === 0) return {tipo:"Nocturna", horasDiurnas:0, horasNocturnas:total/60};
    if (nocturnos >= 210) return {tipo:"Mixta → nocturna", horasDiurnas:0, horasNocturnas:total/60};
    return {tipo:"Mixta", horasDiurnas:diurnos/60, horasNocturnas:nocturnos/60};
  }

  function actualizarHorasExtra() {
    $$(".fila-hora").forEach(fila => {
      const inicio = fila.querySelector(".he-inicio").value;
      const fin = fila.querySelector(".he-fin").value;
      if (!inicio || !fin) return;
      const horas = horasIntervalo(inicio, fin);
      const clasificacion = clasificarIntervalo(inicio, fin);
      fila.querySelector(".he-horas").textContent = horas.toFixed(2);
      fila.querySelector(".clasificacion").textContent = clasificacion.tipo;

      const sbd = salarioBasicoDiario();
      const horaDiurna = sbd / 8;
      const tarifaMixta = horaDiurna;
      const horaNocturna = horaDiurna * CONSTANTES.RECARGO_NOCTURNO;

      let monto = 0;
      if (clasificacion.tipo === "Diurna") {
        monto = horaDiurna * horas * CONSTANTES.RECARGO_HORA_EXTRA;
      } else if (clasificacion.tipo.includes("nocturna") && clasificacion.horasDiurnas === 0) {
        monto = horaNocturna * horas * CONSTANTES.RECARGO_HORA_EXTRA;
      } else {
        monto = (
          clasificacion.horasDiurnas * tarifaMixta * CONSTANTES.RECARGO_HORA_EXTRA +
          clasificacion.horasNocturnas * horaNocturna * CONSTANTES.RECARGO_HORA_EXTRA
        );
      }
      fila.querySelector(".monto").textContent = dinero(monto);
    });
  }

  /* ---------------------------------------------------------
     Vacaciones y aguinaldo.
     --------------------------------------------------------- */
  function actualizarCategoriaAguinaldo(anios) {
    let dias = 15;
    let categoria = "Menos de 3 años · 15 días";
    if (anios >= 10) { dias = 21; categoria = "Más de 10 años · 21 días"; }
    else if (anios >= 3) { dias = 19; categoria = "3 a 10 años · 19 días"; }
    $("categoriaAguinaldo").textContent = `Categoría: ${categoria}.`;
    return dias;
  }

  function calcularDiasEntreFechasComerciales(inicio, fin) {
    const a = new Date(`${inicio}T00:00:00`);
    const b = new Date(`${fin}T00:00:00`);
    if (b < a) return 0;
    return calcularAntiguedad(inicio, fin)?.diasComerciales || 0;
  }

  /* ---------------------------------------------------------
     Cálculo de aguinaldo proporcional:
     monto anual completo / 360 × días desde el último pago.
     --------------------------------------------------------- */
  function calcularAguinaldo(antiguedad, salarioDiario) {
    if (!antiguedad) return 0;
    const diasCategoria = actualizarCategoriaAguinaldo(antiguedad.anios);
    const aguinaldoCompleto = salarioDiario * diasCategoria;
    /*
       La interfaz solo conserva el checkbox "Ya me pagaron el aguinaldo
       de este año (12 de diciembre)". La fecha de referencia es la fecha
       de finalización del contrato y el último pago se determina con base
       en el estado del checkbox.
    */
    const referencia = $("fechaFin").value;
    if (!referencia) return 0;

    const anioReferencia = Number(referencia.slice(0, 4));
    const pagoEsteAnio = $("aguinaldoPagadoEsteAnio").checked;
    const anioUltimoPago = pagoEsteAnio ? anioReferencia : anioReferencia - 1;
    const ultimoPago = `${anioUltimoPago}-12-12`;

    // Si la persona ingresó después del último 12 de diciembre,
    // el aguinaldo proporcional se cuenta desde su fecha de ingreso.
    const fechaIngreso = $("fechaInicio").value;
    const desde = fechaIngreso && fechaIngreso > ultimoPago ? fechaIngreso : ultimoPago;
    if (referencia < desde) return 0;

    const dias = calcularDiasEntreFechasComerciales(desde, referencia);
    // Si se completó el ciclo anual, se reconoce el aguinaldo completo.
    return Math.min(aguinaldoCompleto, (aguinaldoCompleto / 360) * dias);
  }

  function calcularVacaciones(antiguedad, salarioDiario) {
    let dias = numero($("diasVacaciones").value);
    if ($("modalidadVacaciones").value === "completa") dias = 15;
    if (dias <= 0) return 0;

    // Para proporcionalidad anual se usa la fracción de días de servicio
    // dentro del año correspondiente, con 360 días comerciales.
    if ($("modalidadVacaciones").value === "proporcional") {
      const inicio = $("fechaInicio").value;
      const fin = $("fechaFin").value;
      if (inicio && fin && antiguedad && antiguedad.anios < 1) {
        dias = 15 * (antiguedad.diasComerciales / 360);
      }
    }

    let base = salarioDiario * dias;
    let total = base * CONSTANTES.RECARGO_VACACIONES;

    if ($("alojamiento").value === "si") total += base * CONSTANTES.PORCENTAJE_ALOJAMIENTO;
    if ($("alimentacion").value === "si") total += base * CONSTANTES.PORCENTAJE_ALIMENTACION;
    return total;
  }

  /* ---------------------------------------------------------
     Indemnización por despido.
     Art. 58: 30 días por año + proporcional, con salario topado.
     --------------------------------------------------------- */
  function calcularIndemnizacionDespido(antiguedad) {
    if (!antiguedad) return 0;
    const tope = CONSTANTES.SALARIO_MINIMO_COMERCIO * CONSTANTES.TOPE_DESPIDO_VECES_SALARIO_MINIMO;
    const salarioBaseTopado = Math.min(numero($("salarioMensual").value), tope);

    const montoAnios = antiguedad.anios * salarioBaseTopado;
    const diasFraccion = antiguedad.meses * 30 + antiguedad.dias;
    const montoFraccion = (salarioBaseTopado / 360) * diasFraccion;
    const total = montoAnios + montoFraccion;

    // El material indica que nunca debe ser menor a 15 días de salario.
    const minimo = salarioBaseTopado / 2;
    return Math.max(total, minimo);
  }

  /* ---------------------------------------------------------
     Prestación por renuncia voluntaria.
     La fuente adjunta indica 15 días por año y tope de 2 salarios
     mínimos, además de mínimo 2 años y preaviso.
     --------------------------------------------------------- */
  function calcularRenuncia(antiguedad) {
    if (!antiguedad || antiguedad.diasComerciales < 720) return 0;
    if ($("dioPreaviso").value !== "si") return 0;

    const salarioMinimo = salarioMinimoSector();
    const salarioTopado = Math.min(numero($("salarioMensual").value), salarioMinimo * CONSTANTES.TOPE_RENUNCIA_VECES_SALARIO_MINIMO);
    const salarioDiarioTopado = salarioTopado / 30;
    return salarioDiarioTopado * 15 * (antiguedad.diasComerciales / 360);
  }

  /* ---------------------------------------------------------
     Asuetos y descanso semanal.
     --------------------------------------------------------- */
  function calcularAsuetos(salarioDiario) {
    return $$(".asueto-check:checked").length * salarioDiario * CONSTANTES.RECARGO_ASUETO;
  }

  function calcularDescanso(salarioDiario) {
    const fechas = $$(".fecha-descanso").map(c => c.value).filter(Boolean);
    const asuetos = new Set($$(".asueto-check:checked").map(c => c.dataset.fecha));
    let cantidad = 0;
    fechas.forEach(fecha => { if (!asuetos.has(fecha)) cantidad++; });
    return cantidad * salarioDiario * CONSTANTES.RECARGO_DESCANSO;
  }

  /* ---------------------------------------------------------
     Horas extras total y desglose.
     --------------------------------------------------------- */
  function calcularTotalHorasExtras() {
    let diurnas = 0, nocturnas = 0, mixtas = 0;
    $$(".fila-hora").forEach(fila => {
      const inicio = fila.querySelector(".he-inicio").value;
      const fin = fila.querySelector(".he-fin").value;
      if (!inicio || !fin) return;
      const c = clasificarIntervalo(inicio, fin);
      const horas = horasIntervalo(inicio, fin);
      const sbd = salarioBasicoDiario();
      const horaDiurna = sbd / 8;
      const horaNocturna = horaDiurna * CONSTANTES.RECARGO_NOCTURNO;

      if (c.tipo === "Diurna") diurnas += horaDiurna * horas * 2;
      else if (c.tipo.includes("nocturna") && c.horasDiurnas === 0) nocturnas += horaNocturna * horas * 2;
      else {
        mixtas += c.horasDiurnas * horaDiurna * 2 + c.horasNocturnas * horaNocturna * 2;
      }
    });
    return {diurnas, nocturnas, mixtas, total:diurnas+nocturnas+mixtas};
  }

  /* ---------------------------------------------------------
     Deducciones: ISSS 3% sobre base máxima $1,000 y AFP 7.25%.
     El ISR se excluye expresamente del módulo.
     --------------------------------------------------------- */
  function calcularDeducciones(totalBruto) {
    const baseIsss = Math.min(totalBruto, CONSTANTES.ISSS_TOPE_BASE);
    const isss = baseIsss * CONSTANTES.ISSS_PORCENTAJE;
    const afp = totalBruto * CONSTANTES.AFP_PORCENTAJE;
    return {isss, afp, total:isss+afp};
  }

  /* ---------------------------------------------------------
     Construcción del resultado.
     --------------------------------------------------------- */
  function calcularLiquidacion() {
    const salario = numero($("salarioMensual").value);
    if (salario <= 0) throw new Error("Ingrese un salario mensual válido.");
    const antiguedad = calcularAntiguedad($("fechaInicio").value, $("fechaFin").value);
    if (!antiguedad) throw new Error("Verifique las fechas del período de labor.");

    const sbd = salarioBasicoDiario();

    const tipo = document.querySelector('input[name="tipoBaja"]:checked').value;
    const indemnizacion = tipo === "despido" ? calcularIndemnizacionDespido(antiguedad) : calcularRenuncia(antiguedad);
    const vacaciones = calcularVacaciones(antiguedad, sbd);
    const aguinaldo = calcularAguinaldo(antiguedad, sbd);
    const asuetos = calcularAsuetos(sbd);
    const descanso = calcularDescanso(sbd);
    const extras = calcularTotalHorasExtras();

    const totalBruto = indemnizacion + vacaciones + aguinaldo + asuetos + descanso + extras.total;
    const deducciones = calcularDeducciones(totalBruto);
    const neto = totalBruto - deducciones.total;

    estado.resultado = {
      tipo, salario, sbd, antiguedad, indemnizacion, vacaciones, aguinaldo,
      asuetos, descanso, extras, totalBruto, deducciones, neto,
      nombre: $("nombreCompleto").value,
      dui: $("dui").value,
      empresa: $("nombreEmpresa").value,
      cargo: $("cargo").value,
      fechaInicio: $("fechaInicio").value,
      fechaFin: $("fechaFin").value,
      sector: $("sectorEconomico").value,
      anonimato: $("modoAnonimo").checked
    };

    renderizarResultado();
    return estado.resultado;
  }

  function renderizarResultado() {
    const r = estado.resultado;
    const filas = [
      ["Indemnización / renuncia", r.indemnizacion, r.tipo === "despido" ? "Art. 58 C.T." : "Ley de Renuncia Voluntaria"],
      ["Vacaciones", r.vacaciones, "Arts. 177 y 190 C.T."],
      ["Aguinaldo", r.aguinaldo, "Arts. 196–198 C.T."],
      ["Días de asueto", r.asuetos, "Art. 192 C.T."],
      ["Descanso semanal", r.descanso, "Arts. 171–175 C.T."],
      ["Horas extras diurnas", r.extras.diurnas, "Art. 169 C.T."],
      ["Horas extras nocturnas / mixtas", r.extras.nocturnas + r.extras.mixtas, "Arts. 168–169 C.T."]
    ];
    const avisoDerechos = r.tipo === "renuncia" && r.antiguedad.diasComerciales < (CONSTANTES.DIAS_ANIO_COMERCIAL * 2)
      ? `<div class="info-box advertencia" style="grid-column:1 / -1"><strong>Renuncia con menos de 2 años:</strong> no se genera la prestación económica por renuncia voluntaria. Se mantienen los derechos adquiridos que correspondan, como vacaciones y aguinaldo proporcionales, asuetos, descanso semanal y horas extras registradas.</div>`
      : "";

    $("resumenResultado").innerHTML = avisoDerechos + filas.map(([nombre,monto,base]) => `
      <div class="resultado-item"><span>${nombre}</span><b>${dinero(monto)}</b><small>${base}</small></div>
    `).join("");

    $("totalBruto").textContent = dinero(r.totalBruto);
    $("totalDeducciones").textContent = `-${dinero(r.deducciones.total)}`;
    $("totalNeto").textContent = dinero(r.neto);
  }

  /* ---------------------------------------------------------
     Número en letras para el comprobante.
     Se usa una implementación compacta para dólares.
     --------------------------------------------------------- */
  const UNIDADES = ["cero","uno","dos","tres","cuatro","cinco","seis","siete","ocho","nueve","diez","once","doce","trece","catorce","quince","dieciséis","diecisiete","dieciocho","diecinueve","veinte","veintiuno","veintidós","veintitrés","veinticuatro","veinticinco","veintiséis","veintisiete","veintiocho","veintinueve"];
  const DECENAS = ["","","treinta","cuarenta","cincuenta","sesenta","setenta","ochenta","noventa"];
  const CENTENAS = ["","ciento","doscientos","trescientos","cuatrocientos","quinientos","seiscientos","setecientos","ochocientos","novecientos"];

  function numeroMenorMil(n) {
    n = Math.floor(n);
    if (n < 30) return UNIDADES[n];
    if (n < 100) {
      const d = Math.floor(n/10), u = n%10;
      return DECENAS[d] + (u ? ` y ${UNIDADES[u]}` : "");
    }
    if (n === 100) return "cien";
    const c = Math.floor(n/100), r = n%100;
    return CENTENAS[c] + (r ? ` ${numeroMenorMil(r)}` : "");
  }

  function numeroEnLetras(n) {
    n = Math.floor(n);
    if (n === 0) return "cero";
    if (n < 1000) return numeroMenorMil(n);
    if (n < 1000000) {
      const miles = Math.floor(n/1000), resto = n%1000;
      return `${miles === 1 ? "mil" : numeroMenorMil(miles)+" mil"}${resto ? " "+numeroMenorMil(resto) : ""}`;
    }
    const millones = Math.floor(n/1000000), resto = n%1000000;
    return `${millones === 1 ? "un millón" : numeroEnLetras(millones)+" millones"}${resto ? " "+numeroEnLetras(resto) : ""}`;
  }

  function montoEnLetras(monto) {
    const entero = Math.floor(Math.max(0,monto));
    const centavos = Math.round((monto - entero) * 100);
    return `${numeroEnLetras(entero).toUpperCase()} ${String(centavos).padStart(2,"0")}/100 DÓLARES DE LOS ESTADOS UNIDOS DE AMÉRICA`;
  }

  /* ---------------------------------------------------------
     Documento formal de previsualización.
     --------------------------------------------------------- */
  function construirDocumento() {
    const r = estado.resultado;
    if (!r) return;
    const anon = r.anonimato;
    const nombre = anon ? "XXXXXXXXXXXXXXXX" : (r.nombre || "—");
    const dui = anon ? "XXXXXXXXXXXXXXXX" : (r.dui || "—");
    const causa = r.tipo === "despido" ? "Despido sin causa justificada" : "Renuncia voluntaria";

    const filas = [
      ["Vacación proporcional", "Arts. 177 y 190 CT", r.vacaciones],
      ["Aguinaldo proporcional", "Arts. 196-198 CT", r.aguinaldo],
      [r.tipo === "despido" ? "Indemnización por despido injustificado" : "Prestación por renuncia voluntaria", r.tipo === "despido" ? "Art. 58 CT" : "Ley de Renuncia Voluntaria", r.indemnizacion],
      ["Horas extras diurnas", "Art. 169 CT", r.extras.diurnas],
      ["Horas extras nocturnas / mixtas", "Arts. 168 y 169 CT", r.extras.nocturnas + r.extras.mixtas],
      ["Días de asueto laborados", "Art. 192 CT", r.asuetos],
      ["Días de descanso semanal laborados", "Arts. 171-175 CT", r.descanso]
    ];

    const filasHtml = filas.map(f => `<tr><td>${escapeHtml(f[0])}</td><td>${escapeHtml(f[1])}</td><td>${dinero(f[2])}</td></tr>`).join("");

    $("documentoReporte").innerHTML = `
      <h1 class="doc-titulo">COMPROBANTE DE LIQUIDACIÓN DE PRESTACIONES LABORALES</h1>
      <div class="doc-pais">República de El Salvador</div>
      <div class="doc-linea"></div>

      <h2 class="doc-seccion">I. Datos de las partes</h2>
      <div class="doc-datos">
        <div class="doc-dato"><span>Persona trabajadora</span><b>${escapeHtml(nombre)}</b></div>
        <div class="doc-dato"><span>Patrono</span><b>${escapeHtml(r.empresa || "—")}</b></div>
        <div class="doc-dato"><span>Cargo desempeñado</span><b>${escapeHtml(r.cargo || "—")}</b></div>
        <div class="doc-dato"><span>Salario mensual</span><b>${dinero(r.salario)}</b></div>
        <div class="doc-dato"><span>Fecha de ingreso</span><b>${fechaBonita(r.fechaInicio)}</b></div>
        <div class="doc-dato"><span>Fecha de terminación</span><b>${fechaBonita(r.fechaFin)}</b></div>
        <div class="doc-dato"><span>Antigüedad reconocida</span><b>${r.antiguedad.anios} años, ${r.antiguedad.meses} meses, ${r.antiguedad.dias} días</b></div>
        <div class="doc-dato"><span>Causa de terminación</span><b>${causa}</b></div>
      </div>

      ${r.tipo === "renuncia" && r.antiguedad.diasComerciales < (CONSTANTES.DIAS_ANIO_COMERCIAL * 2) ? `
        <div class="doc-advertencia"><b>Nota sobre la renuncia:</b> por no cumplir 2 años de servicio continuo, no se genera la prestación económica específica por renuncia voluntaria. Este cálculo conserva las prestaciones y derechos proporcionales que correspondan.</div>
      ` : ""}

      <h2 class="doc-seccion">II. Desglose de prestaciones liquidadas</h2>
      <table class="doc-tabla">
        <thead><tr><th>Concepto</th><th>Base legal</th><th>Monto</th></tr></thead>
        <tbody>${filasHtml}
          <tr class="total"><td colspan="2">TOTAL DEVENGADO (BRUTO)</td><td>${dinero(r.totalBruto)}</td></tr>
        </tbody>
      </table>

      <div class="doc-deduccion">
        <h2 class="doc-seccion">III. Deducciones de ley y neto a pagar</h2>
        <p style="font-size:10px;color:#666">Este módulo no calcula ISR, conforme a la configuración solicitada. Se aplican ISSS y AFP.</p>
        <table class="doc-tabla">
          <tbody>
            <tr><td>Cotización ISSS (trabajador)</td><td>Base máxima $1,000 · 3%</td><td>-${dinero(r.deducciones.isss)}</td></tr>
            <tr><td>Cotización AFP (trabajador)</td><td>7.25%</td><td>-${dinero(r.deducciones.afp)}</td></tr>
            <tr class="total"><td colspan="2">TOTAL DE DEDUCCIONES</td><td>-${dinero(r.deducciones.total)}</td></tr>
          </tbody>
        </table>
        <div class="doc-neto"><span>MONTO NETO A PAGAR</span><span>${dinero(r.neto)}</span></div>
      </div>

      <div class="doc-letras"><small>Monto neto en letras</small><b>${montoEnLetras(r.neto)}</b></div>

      <div class="doc-declaracion">
        <h2 class="doc-seccion">IV. Declaración</h2>
        <p>La persona trabajadora declara haber recibido el detalle de las prestaciones económicas que anteceden, calculadas conforme a las fórmulas y referencias laborales configuradas en esta herramienta, así como el desglose de las deducciones aplicadas y el monto neto resultante. Este documento es informativo y debe ser revisado por las partes antes de cualquier suscripción.</p>
        <div class="doc-firmas">
          <div class="doc-firma">Persona trabajadora<br>Nombre: ${escapeHtml(nombre)}<br>DUI: ${escapeHtml(dui)}<br>Fecha: ____________________</div>
          <div class="doc-firma">Patrono o representante legal<br>Nombre: ____________________<br>DUI: ____________________<br>Fecha: ____________________</div>
        </div>
      </div>

      <div class="doc-advertencia"><b>Advertencia legal.</b> Este documento es un comprobante informativo del cálculo de prestaciones y <b>NO constituye el finiquito laboral</b>. El modelo adjunto advierte que los documentos de terminación y recibos pueden requerir las formalidades previstas por el Art. 402 del Código de Trabajo. Se recomienda asesoría profesional antes de suscribir un finiquito.</div>

      <div class="doc-footer"><span>Generado el ${fechaCorta(fechaLocalISO())}</span><span>1 / 1</span></div>
    `;
  }

  /* ---------------------------------------------------------
     Exportación PDF con jsPDF + html2canvas.
     --------------------------------------------------------- */
  async function exportarPDF() {
    if (!estado.resultado) return;
    if (!window.jspdf || !window.html2canvas) {
      mostrarToast("No se cargaron las librerías PDF. Verifique su conexión a internet.");
      return;
    }
    const boton = $("btnExportarPdf");
    boton.disabled = true;
    boton.textContent = "Generando PDF…";
    try {
      const elemento = $("documentoReporte");
      const canvas = await html2canvas(elemento, {
        scale: 2,
        backgroundColor: "#ffffff",
        useCORS: true
      });
      const { jsPDF } = window.jspdf;
      const pdf = new jsPDF("p","mm","a4");
      const ancho = 210;
      const alto = canvas.height * ancho / canvas.width;
      pdf.addImage(canvas.toDataURL("image/jpeg",0.95), "JPEG", 0, 0, ancho, alto);
      const nombreArchivo = `liquidacion-laboral-${fechaLocalISO()}.pdf`;
      pdf.save(nombreArchivo);
    } catch (error) {
      console.error(error);
      mostrarToast("No fue posible generar el PDF.");
    } finally {
      boton.disabled = false;
      boton.textContent = "Exportar a PDF";
    }
  }

  /* ---------------------------------------------------------
     Navegación del Wizard y validaciones.
     --------------------------------------------------------- */
  function validarPaso(paso) {
    if (paso === 1) {
      if (!numero($("salarioMensual").value) || numero($("salarioMensual").value) <= 0) {
        mostrarToast("Ingrese un salario mensual mayor que cero.");
        $("salarioMensual").focus();
        return false;
      }
      if (!$("modoAnonimo").checked) {
        if (!$("nombreCompleto").value.trim()) { mostrarToast("Ingrese el nombre completo o active el modo anónimo."); return false; }
        if (!/^\d{8}-\d$/.test($("dui").value.trim())) { mostrarToast("El DUI debe tener el formato 00000000-0 y solo contener números."); $("dui").focus(); return false; }
      }
    }
    if (paso === 2) {
      // El paso 2 solo selecciona la causa de terminación.
      // Las fechas se validan exclusivamente al salir del paso 3.
      const causaSeleccionada = document.querySelector('input[name="tipoBaja"]:checked');
      if (!causaSeleccionada) {
        mostrarToast("Seleccione una causa de terminación.");
        return false;
      }
    }
    if (paso === 3) {
      const inicio = $("fechaInicio").value, fin = $("fechaFin").value;
      if (!inicio || !fin || fin < inicio) {
        mostrarToast("Revise las fechas del período de labor.");
        return false;
      }

      // Tener menos de 2 años NO impide continuar con la liquidación.
      // En renuncia, la prestación económica específica será $0.00,
      // pero se calculan vacaciones, aguinaldo y demás derechos adquiridos.
    }
    return true;
  }

  function irAPaso(paso) {
    if (paso < 1 || paso > 7) return;
    if (paso > estado.pasoActual && !validarPaso(estado.pasoActual)) return;
    estado.pasoActual = paso;
    $$(".paso-panel").forEach(panel => panel.classList.toggle("visible", Number(panel.dataset.panel) === paso));
    $$(".paso").forEach(btn => {
      const n = Number(btn.dataset.paso);
      btn.classList.toggle("activo", n === paso);
      btn.classList.toggle("completado", n < paso);
    });
    window.scrollTo({top:0, behavior:"smooth"});
    if (paso === 4) construirListaAsuetos();
    if (paso === 6) actualizarHorasExtra();
  }

  /* ---------------------------------------------------------
     Limpiar formulario completamente.
     --------------------------------------------------------- */
  function limpiarTodo() {
    if (!confirm("¿Desea borrar todos los datos y comenzar de nuevo?")) return;
    $("formularioLiquidacion").reset();
    $("fechaInicio").value = "";
    inicializarFechas();
    $("fechaFin").disabled = true;
    $("listaAsuetos").innerHTML = "";
    $("fechasDescanso").innerHTML = "";
    $("horasExtras").innerHTML = `<div class="tabla-head"><span>Fecha</span><span>Inicio</span><span>Fin</span><span>Horas</span><span>Clasificación</span><span>Monto</span><span></span></div>`;
    estado.horasExtra = 0;
    estado.resultado = null;
    irAPaso(1);
    actualizarBloqueoFechaFin();
    mostrarToast("Formulario limpiado.");
  }

  /* ---------------------------------------------------------
     Eventos.
     --------------------------------------------------------- */
  function inicializar() {
    inicializarFechas();
    actualizarBloqueoFechaFin();

    $$(".paso").forEach(btn => btn.addEventListener("click", () => irAPaso(Number(btn.dataset.paso))));
    $$("[data-siguiente]").forEach(btn => btn.addEventListener("click", () => irAPaso(estado.pasoActual + 1)));
    $$("[data-anterior]").forEach(btn => btn.addEventListener("click", () => irAPaso(estado.pasoActual - 1)));

    $$('input[name="tipoBaja"]').forEach(radio => radio.addEventListener("change", actualizarBloqueoFechaFin));
    $("dioPreaviso").addEventListener("change", actualizarAvisoRenuncia);
    $("tipoCargo").addEventListener("change", actualizarAvisoRenuncia);
    $("aguinaldoPagadoEsteAnio").addEventListener("change", () => {
      if (estado.resultado) calcularLiquidacion();
    });

    $("fechaInicio").addEventListener("change", () => {
      actualizarAntiguedad();
      construirListaAsuetos();
    });
    $("fechaFin").addEventListener("change", () => {
      actualizarAntiguedad();
      construirListaAsuetos();
    });
    $("salarioMensual").addEventListener("input", () => {
      actualizarHorasExtra();
    });
    $("sectorEconomico").addEventListener("change", actualizarHorasExtra);

    $$('input[name="trabajoAsueto"]').forEach(r => r.addEventListener("change", () => {
      $("bloqueAsuetos").classList.toggle("oculto", document.querySelector('input[name="trabajoAsueto"]:checked').value !== "si");
    }));
    $$('input[name="trabajoDescanso"]').forEach(r => r.addEventListener("change", () => {
      const activo = document.querySelector('input[name="trabajoDescanso"]:checked').value === "si";
      $("bloqueDescanso").classList.toggle("oculto", !activo);
      if (activo && !$("fechasDescanso").children.length) agregarFilaDescanso();
    }));
    $("agregarDescanso").addEventListener("click", () => agregarFilaDescanso());
    $("agregarHoraExtra").addEventListener("click", agregarFilaHoraExtra);
    $("btnCalcular").addEventListener("click", () => {
      try {
        if (!validarPaso(6)) return;
        calcularLiquidacion();
        irAPaso(7);
      } catch (error) {
        mostrarToast(error.message || "No fue posible calcular.");
      }
    });
    $("btnPrevisualizar").addEventListener("click", () => {
      construirDocumento();
      $("modalReporte").classList.remove("oculto");
    });
    $("cerrarModal").addEventListener("click", () => $("modalReporte").classList.add("oculto"));
    $("btnCerrarModal").addEventListener("click", () => $("modalReporte").classList.add("oculto"));
    $("btnExportarPdf").addEventListener("click", exportarPDF);
    $("btnLimpiar").addEventListener("click", limpiarTodo);

    // Impide letras en DUI y conserva solo la estructura 8 dígitos-guion-dígito.
    $("dui").addEventListener("input", (evento) => {
      let valor = evento.target.value.replace(/\D/g, "");
      if (valor.length > 9) valor = valor.slice(0,9);
      evento.target.value = valor.length > 8 ? `${valor.slice(0,8)}-${valor.slice(8)}` : valor;
    });

    actualizarAntiguedad();
    actualizarAvisoRenuncia();
  }

  document.addEventListener("DOMContentLoaded", inicializar);
})();
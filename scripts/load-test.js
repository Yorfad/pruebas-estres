#!/usr/bin/env node
/**
 * Generador de carga simple (sin dependencias externas) para pruebas de
 * carga/estres/estabilidad, como alternativa a JMeter cuando no se puede
 * instalar software adicional.
 *
 * Modo simple (una sola corrida):
 *   node scripts/load-test.js --escenario carga
 *   node scripts/load-test.js --path /factorial --vueltas 20000 --usuarios 100 --rampup 10 --duracion 30
 *
 * Modo escaneo (varios niveles de usuarios en una sola ejecucion, para
 * encontrar el punto de quiebre y generar la tabla/grafica de la tarea):
 *   node scripts/load-test.js --path /hash --steps 50,100,200,300,500,800,1000
 *
 * Cada corrida guarda un CSV en resultados/ listo para graficar en Excel/Sheets.
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const ESCENARIOS = {
  carga: { usuarios: 500, rampup: 10, duracion: 60 },
  estres: { usuarios: 2000, rampup: 10, duracion: 60 },
  estabilidad: { usuarios: 200, rampup: 5, duracion: 60 },
};

const VUELTAS_POR_DEFECTO = {
  '/hash': 200000,
  '/factorial': 20000,
  '/procesar-json': 500000,
};

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].slice(2);
      const value = args[i + 1];
      opts[key] = value;
      i++;
    }
  }
  return opts;
}

function construirConfig() {
  const opts = parseArgs();
  const preset = ESCENARIOS[opts.escenario] || {};
  const path_ = opts.path || '/hash';

  const config = {
    url: opts.url || 'https://pruebas-estres-production.up.railway.app',
    path: path_,
    vueltas: parseInt(opts.vueltas) || VUELTAS_POR_DEFECTO[path_] || 200000,
    usuarios: parseInt(opts.usuarios) || preset.usuarios || 50,
    rampupSeg: parseInt(opts.rampup) || preset.rampup || 10,
    duracionSeg: parseInt(opts.duracion) || preset.duracion || 60,
    timeoutMs: parseInt(opts.timeout) || 8000,
    steps: opts.steps
      ? opts.steps.split(',').map((n) => parseInt(n.trim())).filter(Boolean)
      : null,
    stepDuracionSeg: parseInt(opts['step-duracion']) || 10,
    stepRampupSeg: parseInt(opts['step-rampup']) || 3,
    pausaEntrePasosSeg: opts.pausa !== undefined ? parseInt(opts.pausa) : 3,
    umbralQuiebrePct: parseFloat(opts.umbral) || 20,
  };

  return config;
}

function construirUrlCompleta(config) {
  const base = new URL(config.url);
  const rutaConQuery = new URL(config.path, base);
  if (config.path.includes('/hash')) {
    rutaConQuery.searchParams.set('vueltas', config.vueltas);
  } else if (config.path.includes('/factorial')) {
    rutaConQuery.searchParams.set('n', config.vueltas);
  } else if (config.path.includes('/procesar-json')) {
    rutaConQuery.searchParams.set('cantidad', config.vueltas);
  }
  return new URL(rutaConQuery.pathname + rutaConQuery.search, base);
}

function crearAgente(esHttps) {
  const Agente = esHttps ? https.Agent : http.Agent;
  return new Agente({ keepAlive: true, maxSockets: Infinity });
}

function hacerPeticion(targetUrl, agente, timeoutMs) {
  return new Promise((resolve) => {
    const lib = targetUrl.protocol === 'https:' ? https : http;
    const inicio = Date.now();

    const req = lib.get(
      targetUrl,
      { agent: agente, timeout: timeoutMs },
      (res) => {
        res.resume(); // descarta el body, solo interesa status y tiempo
        res.on('end', () => {
          resolve({
            ok: res.statusCode >= 200 && res.statusCode < 300,
            statusCode: res.statusCode,
            duracionMs: Date.now() - inicio,
          });
        });
      }
    );

    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, statusCode: 'TIMEOUT', duracionMs: Date.now() - inicio });
    });

    req.on('error', (err) => {
      resolve({ ok: false, statusCode: err.code || 'ERROR', duracionMs: Date.now() - inicio });
    });
  });
}

async function usuarioVirtual(targetUrl, agente, timeoutMs, tiempoFinGlobal, resultados) {
  while (Date.now() < tiempoFinGlobal) {
    const resultado = await hacerPeticion(targetUrl, agente, timeoutMs);
    resultados.push(resultado);
  }
}

function percentil(valoresOrdenados, p) {
  if (valoresOrdenados.length === 0) return 0;
  const idx = Math.min(
    valoresOrdenados.length - 1,
    Math.floor((p / 100) * valoresOrdenados.length)
  );
  return valoresOrdenados[idx];
}

async function ejecutarCorrida(targetUrl, agente, usuarios, rampupSeg, duracionSeg, timeoutMs, mostrarProgreso) {
  const resultados = [];
  const inicioGlobal = Date.now();
  const tiempoFinGlobal = inicioGlobal + duracionSeg * 1000;
  const retrasoEntreUsuariosMs = (rampupSeg * 1000) / Math.max(usuarios, 1);

  const promesasUsuarios = [];
  for (let i = 0; i < usuarios; i++) {
    const promesa = new Promise((resolveInicio) => {
      setTimeout(() => {
        usuarioVirtual(targetUrl, agente, timeoutMs, tiempoFinGlobal, resultados).then(resolveInicio);
      }, i * retrasoEntreUsuariosMs);
    });
    promesasUsuarios.push(promesa);
  }

  let reportero;
  if (mostrarProgreso) {
    reportero = setInterval(() => {
      const transcurridoSeg = (Date.now() - inicioGlobal) / 1000;
      console.log(`  [${transcurridoSeg.toFixed(0)}s] peticiones enviadas: ${resultados.length}`);
    }, 5000);
  }

  await Promise.all(promesasUsuarios);
  if (reportero) clearInterval(reportero);

  const duracionRealSeg = (Date.now() - inicioGlobal) / 1000;
  return { resultados, duracionRealSeg };
}

function calcularResumen(usuarios, resultados, duracionRealSeg) {
  const total = resultados.length;
  const exitosos = resultados.filter((r) => r.ok);
  const fallidos = resultados.filter((r) => !r.ok);
  const latencias = resultados.map((r) => r.duracionMs).sort((a, b) => a - b);

  const promedio = latencias.reduce((a, b) => a + b, 0) / (latencias.length || 1);
  const min = latencias[0] || 0;
  const max = latencias[latencias.length - 1] || 0;

  const codigosError = {};
  fallidos.forEach((r) => {
    codigosError[r.statusCode] = (codigosError[r.statusCode] || 0) + 1;
  });

  return {
    usuarios,
    total,
    exitosos: exitosos.length,
    fallidos: fallidos.length,
    pctError: total ? (fallidos.length / total) * 100 : 0,
    throughput: total / duracionRealSeg,
    promedio,
    min,
    max,
    p90: percentil(latencias, 90),
    p95: percentil(latencias, 95),
    p99: percentil(latencias, 99),
    codigosError,
    duracionRealSeg,
  };
}

function imprimirReporte(config, resumen) {
  console.log('\n========== REPORTE FINAL ==========');
  console.log(`URL objetivo:        ${config.url}${config.path}`);
  console.log(`Usuarios simulados:  ${resumen.usuarios}`);
  console.log(`Duracion real:       ${resumen.duracionRealSeg.toFixed(1)}s`);
  console.log('------------------------------------');
  console.log(`Total peticiones:    ${resumen.total}`);
  console.log(`Exitosas:            ${resumen.exitosos}`);
  console.log(`Fallidas:            ${resumen.fallidos}`);
  console.log(`% Error:             ${resumen.pctError.toFixed(2)}%`);
  console.log(`Throughput:          ${resumen.throughput.toFixed(2)} req/s`);
  console.log('------------------------------------');
  console.log(`Latencia promedio:   ${resumen.promedio.toFixed(0)} ms`);
  console.log(`Latencia minima:     ${resumen.min} ms`);
  console.log(`Latencia maxima:     ${resumen.max} ms`);
  console.log(`Percentil 90:        ${resumen.p90} ms`);
  console.log(`Percentil 95:        ${resumen.p95} ms`);
  console.log(`Percentil 99:        ${resumen.p99} ms`);
  if (Object.keys(resumen.codigosError).length > 0) {
    console.log('------------------------------------');
    console.log('Codigos de error encontrados:');
    Object.entries(resumen.codigosError).forEach(([codigo, cantidad]) => {
      console.log(`  ${codigo}: ${cantidad}`);
    });
  }
  console.log('====================================\n');
}

function barraAscii(valor, maxValor, ancho = 30) {
  const largo = maxValor > 0 ? Math.round((valor / maxValor) * ancho) : 0;
  return '#'.repeat(largo) + '-'.repeat(Math.max(ancho - largo, 0));
}

function imprimirTablaComparativa(filas) {
  console.log('\n===================================================================');
  console.log(' TABLA DE METRICAS CLAVE (usuarios vs tiempo de respuesta / errores)');
  console.log('===================================================================');
  console.log(
    'Usuarios | Peticiones | %Error  | Throughput | Prom.(ms) | Max(ms) | p95(ms)'
  );
  console.log('---------|------------|---------|------------|-----------|---------|--------');
  filas.forEach((f) => {
    console.log(
      `${String(f.usuarios).padEnd(8)} | ${String(f.total).padEnd(10)} | ${
        f.pctError.toFixed(1).padStart(6)
      }% | ${f.throughput.toFixed(2).padStart(10)} | ${f.promedio.toFixed(0).padStart(9)} | ${
        String(f.max).padStart(7)
      } | ${String(f.p95).padStart(6)}`
    );
  });
  console.log('===================================================================');

  const maxLatencia = Math.max(...filas.map((f) => f.promedio), 1);
  console.log('\nGrafica ASCII: latencia promedio vs usuarios (response time vs usuarios)');
  filas.forEach((f) => {
    console.log(
      `${String(f.usuarios).padStart(5)} usuarios | ${barraAscii(f.promedio, maxLatencia)} | ${f.promedio.toFixed(0)} ms`
    );
  });
  console.log('');
}

function describirFallo(filas, umbralQuiebrePct) {
  const filaQuiebre = filas.find((f) => f.pctError >= umbralQuiebrePct);
  console.log('===================================================================');
  console.log(' DESCRIPCION DEL FALLO OBSERVADO');
  console.log('===================================================================');
  if (!filaQuiebre) {
    console.log(
      `No se alcanzo el umbral de fallo (${umbralQuiebrePct}% de error) en ningun nivel probado (maximo probado: ${
        filas[filas.length - 1].usuarios
      } usuarios). El servicio resistio toda la prueba.`
    );
  } else {
    const codigosTexto = Object.entries(filaQuiebre.codigosError)
      .map(([codigo, cantidad]) => `${codigo} (x${cantidad})`)
      .join(', ');
    console.log(
      `A partir de ${filaQuiebre.usuarios} usuarios concurrentes, el servicio empezo a fallar de forma significativa: ${filaQuiebre.pctError.toFixed(
        1
      )}% de error, con codigos: ${codigosTexto || 'sin codigo (timeout)'}.`
    );
    console.log(
      `La latencia promedio en ese punto fue de ${filaQuiebre.promedio.toFixed(
        0
      )} ms (maxima ${filaQuiebre.max} ms), frente a niveles previos mas bajos.`
    );
  }
  console.log('===================================================================\n');
}

// Se usa ";" como separador (no ",") porque Excel en configuracion regional
// en espanol usa la coma como separador decimal, y espera ";" para separar
// columnas. Con "," el CSV se ve como una sola columna al abrirlo.
const BOM_UTF8 = '﻿';
const ENCABEZADO_CSV =
  'usuarios;peticiones;exitosas;fallidas;pct_error;throughput_req_s;latencia_prom_ms;latencia_min_ms;latencia_max_ms;p90_ms;p95_ms;p99_ms\n';

function filaACsv(f) {
  return `${f.usuarios};${f.total};${f.exitosos};${f.fallidos};${f.pctError.toFixed(2)};${f.throughput.toFixed(
    2
  )};${f.promedio.toFixed(0)};${f.min};${f.max};${f.p90};${f.p95};${f.p99}`;
}

function crearArchivoCsv(config) {
  const dir = path.join(process.cwd(), 'resultados');
  fs.mkdirSync(dir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const nombreRuta = config.path.replace(/\//g, '');
  const archivo = path.join(dir, `metricas-${nombreRuta}-${timestamp}.csv`);
  fs.writeFileSync(archivo, BOM_UTF8 + ENCABEZADO_CSV, 'utf8');
  return archivo;
}

function agregarFilaCsv(archivo, fila) {
  fs.appendFileSync(archivo, filaACsv(fila) + '\n', 'utf8');
}

function guardarCsv(config, filas) {
  const archivo = crearArchivoCsv(config);
  filas.forEach((f) => agregarFilaCsv(archivo, f));
  console.log(`CSV guardado en: ${archivo}`);
  console.log('(Abrelo en Excel/Sheets para hacer la grafica de "tiempo de respuesta vs usuarios" que pide la tarea)\n');
}

async function modoEscaneo(config, targetUrl, agente) {
  console.log('Iniciando ESCANEO por niveles de usuarios (buscar punto de quiebre)...');
  console.log(`Objetivo: ${targetUrl.toString()}`);
  console.log(`Niveles a probar: ${config.steps.join(', ')}`);
  console.log(`Duracion por nivel: ${config.stepDuracionSeg}s | Ramp-up por nivel: ${config.stepRampupSeg}s\n`);

  const archivoCsv = crearArchivoCsv(config);
  console.log(`Guardando resultados en vivo en: ${archivoCsv}`);
  console.log('(si cancelas con Ctrl+C, los niveles ya completados quedan guardados ahi)\n');

  const filas = [];

  const manejarInterrupcion = () => {
    console.log('\n\nInterrumpido por el usuario. Mostrando resultados parciales...');
    if (filas.length > 0) {
      imprimirTablaComparativa(filas);
      describirFallo(filas, config.umbralQuiebrePct);
    } else {
      console.log('Ningun nivel llego a completarse todavia.');
    }
    console.log(`Los niveles completados ya estan guardados en: ${archivoCsv}\n`);
    process.exit(0);
  };
  process.once('SIGINT', manejarInterrupcion);

  for (let i = 0; i < config.steps.length; i++) {
    const usuarios = config.steps[i];
    console.log(`--- Nivel ${i + 1}/${config.steps.length}: ${usuarios} usuarios ---`);
    const { resultados, duracionRealSeg } = await ejecutarCorrida(
      targetUrl,
      agente,
      usuarios,
      config.stepRampupSeg,
      config.stepDuracionSeg,
      config.timeoutMs,
      false
    );
    const resumen = calcularResumen(usuarios, resultados, duracionRealSeg);
    console.log(
      `  -> ${resumen.total} peticiones, ${resumen.pctError.toFixed(1)}% error, latencia prom ${resumen.promedio.toFixed(
        0
      )} ms, throughput ${resumen.throughput.toFixed(2)} req/s`
    );
    filas.push(resumen);
    agregarFilaCsv(archivoCsv, resumen);

    if (i < config.steps.length - 1 && config.pausaEntrePasosSeg > 0) {
      console.log(`  Esperando ${config.pausaEntrePasosSeg}s antes del siguiente nivel...\n`);
      await new Promise((r) => setTimeout(r, config.pausaEntrePasosSeg * 1000));
    }
  }

  process.removeListener('SIGINT', manejarInterrupcion);
  imprimirTablaComparativa(filas);
  describirFallo(filas, config.umbralQuiebrePct);
  console.log(`CSV completo guardado en: ${archivoCsv}\n`);
}

async function modoSimple(config, targetUrl, agente) {
  console.log('Iniciando prueba de carga...');
  console.log(`Objetivo: ${targetUrl.toString()}`);
  console.log(
    `Usuarios: ${config.usuarios} | Ramp-up: ${config.rampupSeg}s | Duracion: ${config.duracionSeg}s\n`
  );

  const { resultados, duracionRealSeg } = await ejecutarCorrida(
    targetUrl,
    agente,
    config.usuarios,
    config.rampupSeg,
    config.duracionSeg,
    config.timeoutMs,
    true
  );

  const resumen = calcularResumen(config.usuarios, resultados, duracionRealSeg);
  imprimirReporte(config, resumen);
  guardarCsv(config, [resumen]);
}

async function main() {
  const config = construirConfig();
  const targetUrl = construirUrlCompleta(config);
  const esHttps = targetUrl.protocol === 'https:';
  const agente = crearAgente(esHttps);

  if (config.steps && config.steps.length > 0) {
    await modoEscaneo(config, targetUrl, agente);
  } else {
    await modoSimple(config, targetUrl, agente);
  }
}

main();

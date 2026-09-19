#!/usr/bin/env node
/**
 * Generador de carga simple (sin dependencias externas) para pruebas de
 * carga/estres/estabilidad, como alternativa a JMeter cuando no se puede
 * instalar software adicional.
 *
 * Uso:
 *   node scripts/load-test.js --escenario carga
 *   node scripts/load-test.js --escenario estres
 *   node scripts/load-test.js --escenario estabilidad
 *
 * Tambien se puede correr a la medida:
 *   node scripts/load-test.js --url https://pruebas-estres.onrender.com --path /hash --vueltas 200000 --usuarios 500 --rampup 60 --duracion 300
 */

const http = require('http');
const https = require('https');

const ESCENARIOS = {
  carga: { usuarios: 500, rampup: 60, duracion: 300 },
  estres: { usuarios: 2000, rampup: 60, duracion: 300 },
  estabilidad: { usuarios: 200, rampup: 30, duracion: 600 },
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

  const config = {
    url: opts.url || 'https://pruebas-estres.onrender.com',
    path: opts.path || '/hash',
    vueltas: parseInt(opts.vueltas) || 200000,
    usuarios: parseInt(opts.usuarios) || preset.usuarios || 50,
    rampupSeg: parseInt(opts.rampup) || preset.rampup || 30,
    duracionSeg: parseInt(opts.duracion) || preset.duracion || 60,
    timeoutMs: parseInt(opts.timeout) || 20000,
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

async function usuarioVirtual(id, targetUrl, agente, timeoutMs, tiempoFinGlobal, resultados) {
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

function imprimirReporte(config, resultados, duracionRealSeg) {
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

  console.log('\n========== REPORTE FINAL ==========');
  console.log(`URL objetivo:        ${config.url}${config.path}`);
  console.log(`Usuarios simulados:  ${config.usuarios}`);
  console.log(`Ramp-up:             ${config.rampupSeg}s`);
  console.log(`Duracion configurada:${config.duracionSeg}s`);
  console.log(`Duracion real:       ${duracionRealSeg.toFixed(1)}s`);
  console.log('------------------------------------');
  console.log(`Total peticiones:    ${total}`);
  console.log(`Exitosas:            ${exitosos.length}`);
  console.log(`Fallidas:            ${fallidos.length}`);
  console.log(`% Error:             ${((fallidos.length / (total || 1)) * 100).toFixed(2)}%`);
  console.log(`Throughput:          ${(total / duracionRealSeg).toFixed(2)} req/s`);
  console.log('------------------------------------');
  console.log(`Latencia promedio:   ${promedio.toFixed(0)} ms`);
  console.log(`Latencia minima:     ${min} ms`);
  console.log(`Latencia maxima:     ${max} ms`);
  console.log(`Percentil 90:        ${percentil(latencias, 90)} ms`);
  console.log(`Percentil 95:        ${percentil(latencias, 95)} ms`);
  console.log(`Percentil 99:        ${percentil(latencias, 99)} ms`);
  if (Object.keys(codigosError).length > 0) {
    console.log('------------------------------------');
    console.log('Codigos de error encontrados:');
    Object.entries(codigosError).forEach(([codigo, cantidad]) => {
      console.log(`  ${codigo}: ${cantidad}`);
    });
  }
  console.log('====================================\n');
}

async function main() {
  const config = construirConfig();
  const targetUrl = construirUrlCompleta(config);
  const esHttps = targetUrl.protocol === 'https:';
  const agente = crearAgente(esHttps);

  console.log('Iniciando prueba de carga...');
  console.log(`Objetivo: ${targetUrl.toString()}`);
  console.log(
    `Usuarios: ${config.usuarios} | Ramp-up: ${config.rampupSeg}s | Duracion: ${config.duracionSeg}s\n`
  );

  const resultados = [];
  const inicioGlobal = Date.now();
  const tiempoFinGlobal = inicioGlobal + config.duracionSeg * 1000;
  const retrasoEntreUsuariosMs = (config.rampupSeg * 1000) / config.usuarios;

  const promesasUsuarios = [];
  for (let i = 0; i < config.usuarios; i++) {
    const promesa = new Promise((resolveInicio) => {
      setTimeout(() => {
        usuarioVirtual(i, targetUrl, agente, config.timeoutMs, tiempoFinGlobal, resultados).then(
          resolveInicio
        );
      }, i * retrasoEntreUsuariosMs);
    });
    promesasUsuarios.push(promesa);
  }

  const reportero = setInterval(() => {
    const transcurridoSeg = (Date.now() - inicioGlobal) / 1000;
    console.log(
      `[${transcurridoSeg.toFixed(0)}s] peticiones enviadas: ${resultados.length}`
    );
  }, 5000);

  await Promise.all(promesasUsuarios);
  clearInterval(reportero);

  const duracionRealSeg = (Date.now() - inicioGlobal) / 1000;
  imprimirReporte(config, resultados, duracionRealSeg);
}

main();

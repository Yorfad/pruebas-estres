const express = require('express');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// ---------- Endpoint raiz: informacion de la API ----------
app.get('/', (req, res) => {
  res.json({
    mensaje: 'API de pruebas de carga y estres',
    endpoints: [
      'GET /health',
      'GET /factorial?n=10000',
      'GET /hash?texto=hola&vueltas=100000',
      'GET /procesar-json?cantidad=100000'
    ]
  });
});

// ---------- Health check ----------
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// ---------- Operacion costosa 1: factorial de un numero grande ----------
// Usa BigInt para poder calcular factoriales grandes (consume CPU y memoria).
app.get('/factorial', (req, res) => {
  const n = Math.min(parseInt(req.query.n) || 10000, 50000);

  const inicio = Date.now();
  let resultado = 1n;
  for (let i = 2n; i <= BigInt(n); i++) {
    resultado *= i;
  }
  const duracionMs = Date.now() - inicio;

  res.json({
    operacion: 'factorial',
    n,
    digitos: resultado.toString().length,
    duracionMs
  });
});

// ---------- Operacion costosa 2: hash SHA256 repetido en bucle ----------
app.get('/hash', (req, res) => {
  const texto = req.query.texto || 'carga-estres';
  const vueltas = Math.min(parseInt(req.query.vueltas) || 100000, 1000000);

  const inicio = Date.now();
  let hash = texto;
  for (let i = 0; i < vueltas; i++) {
    hash = crypto.createHash('sha256').update(hash).digest('hex');
  }
  const duracionMs = Date.now() - inicio;

  res.json({
    operacion: 'hash-sha256',
    vueltas,
    hashFinal: hash,
    duracionMs
  });
});

// ---------- Operacion costosa 3: procesar un arreglo grande en memoria ----------
app.get('/procesar-json', (req, res) => {
  const cantidad = Math.min(parseInt(req.query.cantidad) || 100000, 2000000);

  const inicio = Date.now();

  const datos = [];
  for (let i = 0; i < cantidad; i++) {
    datos.push({ id: i, valor: Math.random() * 1000 });
  }

  let suma = 0;
  for (const item of datos) {
    suma += item.valor;
  }
  const duracionMs = Date.now() - inicio;

  res.json({
    operacion: 'procesar-json',
    cantidad,
    suma,
    duracionMs
  });
});

app.listen(PORT, () => {
  console.log(`Servidor escuchando en el puerto ${PORT}`);
});

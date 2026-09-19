# API para pruebas de carga y estres

API sencilla en Node.js/Express con endpoints que ejecutan operaciones costosas en CPU/memoria, pensada para pruebas de carga con JMeter.

## Endpoints

- `GET /health` — verifica que el servicio esta activo.
- `GET /factorial?n=10000` — calcula el factorial de `n` (maximo 50000) usando BigInt.
- `GET /hash?texto=hola&vueltas=100000` — calcula SHA256 en bucle `vueltas` veces (maximo 1,000,000).
- `GET /procesar-json?cantidad=100000` — genera y recorre un arreglo de `cantidad` objetos en memoria (maximo 2,000,000).

## Correr en local

```bash
npm install
npm start
```

La API queda disponible en `http://localhost:3000`.

Pruebas rapidas:

```bash
curl "http://localhost:3000/factorial?n=20000"
curl "http://localhost:3000/hash?vueltas=200000"
curl "http://localhost:3000/procesar-json?cantidad=500000"
```

## Desplegar gratis en Render (recomendado)

1. Sube esta carpeta a un repositorio de GitHub.
2. Entra a https://render.com y crea una cuenta gratuita.
3. Click en "New +" -> "Web Service" y conecta tu repositorio de GitHub.
4. Configura:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Plan:** Free
5. Espera el despliegue. Render te da una URL publica tipo `https://tu-app.onrender.com`.
6. Usa esa URL como endpoint objetivo en JMeter, por ejemplo:
   `https://tu-app.onrender.com/hash?vueltas=200000`

> Nota: en el plan gratuito de Render, el servicio "duerme" tras 15 minutos de inactividad y la primera peticion tarda mas en responder (cold start). Ten esto en cuenta al interpretar las metricas de la primera corrida.

## Desplegar gratis en Vercel (alternativa)

Vercel usa funciones serverless. Para usar este mismo codigo:

1. Crea la carpeta `api/` y mueve la logica de cada endpoint a un archivo por ruta (ej. `api/hash.js`), exportando un handler `(req, res) => {...}`, en vez de usar `app.listen`.
2. Instala Vercel CLI: `npm i -g vercel`.
3. Ejecuta `vercel` dentro de la carpeta del proyecto y sigue las instrucciones.

(Si tu grupo prefiere no adaptar el codigo, usa Render, que soporta el servidor Express tal cual esta.)

## Configuracion sugerida en JMeter

- Thread Group:
  - Usuarios concurrentes: 50 -> 500 -> 1000 (en pasos).
  - Ramp-up period: 60 segundos.
  - Duracion: 300 segundos (5 minutos).
- HTTP Request Sampler:
  - Metodo: GET
  - Path: `/hash` (o el endpoint costoso elegido) con parametros de query.
- Response Assertion:
  - Verificar que el JSON de respuesta contenga el campo `"operacion"`.
- Listeners:
  - Summary Report
  - Graph Results

### Escenarios

- **Carga:** 50 -> 500 usuarios concurrentes.
- **Estres:** subir hasta 2000 usuarios (muy por encima del limite esperado).
- **Estabilidad:** mantener 200 usuarios constantes durante 10 minutos.

Registra tiempo de respuesta promedio/maximo, throughput, % de errores y, si el hosting lo permite, uso de CPU/memoria, para identificar el punto de quiebre del servicio.

## Planes de JMeter listos (`jmeter/`)

Ya incluidos, uno por escenario:

- `jmeter/carga.jmx` — 500 usuarios, ramp-up 60s, duracion 300s.
- `jmeter/estres.jmx` — 2000 usuarios, ramp-up 60s, duracion 300s (por encima del limite esperado, para forzar el quiebre).
- `jmeter/estabilidad.jmx` — 200 usuarios, ramp-up 30s, duracion 600s (10 min).

Cada uno apunta por defecto a `http://localhost:3000/hash?vueltas=200000` y ya trae Response Assertion (verifica que la respuesta contenga `"operacion"`) mas los listeners **Summary Report** y **Graph Results**.

### Como usarlos

1. Abre el archivo en JMeter (`jmeter.bat` en Windows -> File > Open).
2. En el arbol, entra a **Test Plan > Variables Definidas por el Usuario** y cambia:
   - `HOST` -> tu dominio de Render (ej. `tu-app.onrender.com`), sin `http://`.
   - `PORT` -> `443` si usas Render (HTTPS) o `3000` si pruebas en local.
   - `PROTOCOLO` -> `https` para Render, `http` para local.
   - `RUTA` -> el endpoint a probar (`/hash`, `/factorial` o `/procesar-json`).
   - `VUELTAS` -> intensidad de la carga que le pides a la API por peticion.
3. Corre el plan (boton verde de Play). Revisa **Summary Report** para las metricas y **Graph Results** para la grafica.

Importante: estos planes **no limitan ni bajan la carga automaticamente** aunque la API empiece a fallar — mandan exactamente los usuarios/duracion configurados y solo marcan como error las peticiones que fallen o se pasen del timeout. Esa es la idea: llevar la API hasta su punto de quiebre y que quede reflejado como fallos/timeouts en el reporte, no que JMeter se autorregule.

Para correrlos sin abrir la interfaz grafica (modo linea de comandos, mas realista para generar carga real):

```bash
jmeter -n -t jmeter/carga.jmx -l resultados-carga.jtl -e -o reporte-carga
```

## Alternativa sin instalar nada: `scripts/load-test.js`

Si no quieres instalar JMeter, este proyecto incluye un generador de carga en Node.js puro (sin dependencias) que simula usuarios concurrentes y da un reporte similar al Summary Report de JMeter: total de peticiones, % de error, throughput, latencia promedio/min/max y percentiles 90/95/99.

Correr los 3 escenarios ya definidos (apuntando a `https://pruebas-estres.onrender.com` por defecto):

```bash
npm run carga        # 500 usuarios, ramp-up 60s, duracion 300s
npm run estres        # 2000 usuarios, ramp-up 60s, duracion 300s
npm run estabilidad   # 200 usuarios, ramp-up 30s, duracion 600s
```

O a la medida:

```bash
node scripts/load-test.js --url https://pruebas-estres.onrender.com --path /hash --vueltas 200000 --usuarios 300 --rampup 30 --duracion 120
```

Parametros disponibles: `--url`, `--path` (`/hash`, `/factorial` o `/procesar-json`), `--vueltas` (intensidad de la operacion), `--usuarios`, `--rampup` (segundos), `--duracion` (segundos), `--timeout` (ms, default 20000).

> Nota para Windows con Git Bash: si el path (ej. `/hash`) aparece convertido en una ruta de Windows en el reporte, antepon `MSYS_NO_PATHCONV=1` al comando, o corre el script desde PowerShell en vez de Git Bash.

Igual que con JMeter, este script **no se autolimita**: manda exactamente los usuarios/duracion indicados y solo cuenta como fallo las peticiones con timeout o codigo de error — asi puedes observar el punto real de quiebre de la API.

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

## Despliegue actual: Railway (plan pago)

Este proyecto esta desplegado en Railway en un plan pago con **4 CPU / 4GB RAM**, en:

```
https://pruebas-estres-production.up.railway.app
```

Se eligio Railway en lugar de Render porque el plan gratuito de Render no muestra metricas de CPU/memoria durante las pruebas de carga (esa vista requiere plan pago), y para esta practica es indispensable observar el consumo real de recursos durante el estres. En Railway, las metricas de CPU/memoria/red se ven en la pestaña **Metrics** del servicio, en tiempo real.

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

### Escenarios (ajustados a 1 minuto por prueba, servicio en Railway con 4 CPU / 4GB RAM)

- **Carga:** hasta 500 usuarios concurrentes, ramp-up 10s, duracion 1 minuto.
- **Estres:** hasta 2000 usuarios (muy por encima del limite esperado), ramp-up 10s, duracion 1 minuto.
- **Estabilidad:** 200 usuarios constantes durante 1 minuto.

Registra tiempo de respuesta promedio/maximo, throughput, % de errores y, si el hosting lo permite, uso de CPU/memoria, para identificar el punto de quiebre del servicio.

## Planes de JMeter listos (`jmeter/`)

Ya incluidos, uno por escenario, apuntando a `pruebas-estres-production.up.railway.app` y con duracion de 1 minuto cada uno:

- `jmeter/carga.jmx` — 500 usuarios, ramp-up 10s, duracion 60s.
- `jmeter/estres.jmx` — 2000 usuarios, ramp-up 10s, duracion 60s (por encima del limite esperado, para forzar el quiebre).
- `jmeter/estabilidad.jmx` — 200 usuarios, ramp-up 5s, duracion 60s.

Cada uno ya trae Response Assertion (verifica que la respuesta contenga `"operacion"`) mas los listeners **Summary Report** y **Graph Results**.

### Como usarlos

1. Abre el archivo en JMeter (`jmeter.bat` en Windows -> File > Open).
2. Si quieres cambiar el objetivo, entra a **Test Plan > Variables Definidas por el Usuario**:
   - `HOST` -> `pruebas-estres-production.up.railway.app` (ya configurado).
   - `PORT` -> `443` (HTTPS) o `3000` si pruebas en local.
   - `PROTOCOLO` -> `https` en Railway, `http` en local.
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

Correr los 3 escenarios ya definidos (apuntando a `https://pruebas-estres-production.up.railway.app` por defecto, 1 minuto cada uno):

```bash
npm run carga        # 500 usuarios, ramp-up 10s, duracion 60s
npm run estres        # 2000 usuarios, ramp-up 10s, duracion 60s
npm run estabilidad   # 200 usuarios, ramp-up 5s, duracion 60s
```

O a la medida:

```bash
node scripts/load-test.js --url https://pruebas-estres-production.up.railway.app --path /hash --vueltas 200000 --usuarios 300 --rampup 10 --duracion 60
```

Parametros disponibles: `--url`, `--path` (`/hash`, `/factorial` o `/procesar-json`), `--vueltas` (intensidad de la operacion), `--usuarios`, `--rampup` (segundos), `--duracion` (segundos), `--timeout` (ms, default 20000).

> Nota para Windows con Git Bash: si el path (ej. `/hash`) aparece convertido en una ruta de Windows en el reporte, antepon `MSYS_NO_PATHCONV=1` al comando, o corre el script desde PowerShell en vez de Git Bash.

Igual que con JMeter, este script **no se autolimita**: manda exactamente los usuarios/duracion indicados y solo cuenta como fallo las peticiones con timeout o codigo de error — asi puedes observar el punto real de quiebre de la API.

### Modo escaneo: encontrar el punto de quiebre automaticamente

En vez de correr un solo nivel de usuarios, `--steps` prueba varios niveles **uno tras otro en una sola ejecucion** y arma directamente los entregables que pide la tarea (tabla de metricas, grafica de tiempo de respuesta vs usuarios, y la descripcion del fallo):

```bash
npm run escaneo:hash              # prueba /hash con 50,100,200,300,500,800,1000 usuarios
npm run escaneo:factorial         # lo mismo con /factorial
npm run escaneo:procesar-json     # lo mismo con /procesar-json
```

O a la medida:

```bash
node scripts/load-test.js --path /hash --steps 50,100,200,300,500,800,1000 --step-duracion 20 --step-rampup 5 --pausa 5 --umbral 20
```

- `--steps` — lista de niveles de usuarios a probar, separados por coma.
- `--step-duracion` — segundos que dura cada nivel (default 20).
- `--step-rampup` — segundos de ramp-up dentro de cada nivel (default 5).
- `--pausa` — segundos de espera entre un nivel y el siguiente, para dejar que el servidor se recupere (default 5).
- `--umbral` — % de error a partir del cual se considera que el servicio "se quebro" (default 20).

Al terminar, el script imprime:
1. Una **tabla comparativa** (usuarios, peticiones, % error, throughput, latencia promedio/max/p95) — para pegar directo en el reporte.
2. Una **grafica ASCII** de latencia promedio vs usuarios (vista rapida en terminal).
3. Una **descripcion automatica del fallo**, tipo: *"a los 800 usuarios el servicio devolvio 20.5% de error, codigo 502/TIMEOUT"*.
4. Un **archivo CSV** en `resultados/` con todos los datos, listo para abrir en Excel/Sheets y hacer ahi la grafica final para la presentacion.

> Cuidado con `--path /factorial`: usa `n` en vez de `vueltas`, y con numeros muy grandes (arriba de ~50000) el bucle de BigInt puede tardar mucho por peticion; para el escaneo, `--vueltas` en este caso controla el valor de `n`.

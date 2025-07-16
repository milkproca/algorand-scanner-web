#!/usr/bin/env node
import algosdk from 'algosdk';
import bip39 from 'bip39';
import axios from 'axios';
import fs from 'fs';
import chalk from 'chalk';
import readline from 'readline';

// ⚙️ Configuración
const HISTORIAL = 'frases_analizadas_algorand.txt';
const RESULTADOS = 'resultados_algorand_rapido.txt';
const CANTIDAD_FRASES = 200;
const LOTES_CONCURRENCIA = 10;
const PAUSA_MS_ENTRE_LOTES = 700;
const ESCRITURA_BUFFER = 1;
const REINTENTOS_MAXIMOS = 3;
const ENTROPIA_MINIMA = 60;
const ENDPOINTS = [
  'https://mainnet-api.algonode.cloud',
  'https://algoexplorerapi.io',
  'https://node.algoapi.dev'
];

const BIP39_WORDS = bip39.wordlists.english;
const frasesEscaneadas = new Set();
const resumen = {
  verificadas: 0,
  encontradas: 0,
  errores: 0,
  inicio: Date.now()
};

// 📂 Cargar historial
if (fs.existsSync(HISTORIAL)) {
  const rl = readline.createInterface({ input: fs.createReadStream(HISTORIAL) });
  for await (const line of rl) {
    if (line.trim()) frasesEscaneadas.add(line.trim());
  }
}

// 📊 Dashboard
function contarFrasesDesdeArchivo() {
  if (!fs.existsSync(HISTORIAL)) return 0;
  const contenido = fs.readFileSync(HISTORIAL, 'utf8');
  return contenido.split('\n').filter(line => line.trim()).length;
}

function mostrarDashboard(estado, lote) {
  console.clear();
  console.log(chalk.blue.bold('📊 Algorand Scanner'));
  console.log(chalk.gray(`🕒 Tiempo: ${(estado.tiempo / 1000).toFixed(1)}s`));
  console.log(`🧪 Frases analizadas (archivo): ${contarFrasesDesdeArchivo()}`);
  console.log(`🔍 Verificadas (entropía ≥ ${ENTROPIA_MINIMA}): ${resumen.verificadas}`);
  console.log(`✅ Direcciones encontradas: ${resumen.encontradas}`);
  console.log(`🚨 Errores: ${resumen.errores}`);
  console.log(`📦 Lote actual: ${lote + 1}`);
}

// 🧠 Entropía
function evaluarFrase(frase) {
  const palabras = frase.trim().split(/\s+/);
  const total = palabras.length;
  const únicas = new Set(palabras).size;
  const populares = palabras.filter(p => BIP39_WORDS.indexOf(p) < 500).length;
  const repeticiones = total - únicas;
  const entropíaBase = únicas / total;
  const pesoPopularidad = populares / total;
  const índice =
    (entropíaBase * 40) +
    ((únicas / 25) * 20) +
    ((1 - repeticiones / 25) * 20) +
    (pesoPopularidad * 20);
  return Math.round(índice);
}

// 🔍 Verificador blindado
async function verificarFrase(frase) {
  const cuenta = algosdk.mnemonicToSecretKey(frase);
  const direccion = cuenta.addr;
  const entropia = evaluarFrase(frase);

  process.stdout.write(`Entropía: ${entropia}\n`);
  console.log(chalk.gray(`Entropía: ${entropia}`));

  if (entropia < ENTROPIA_MINIMA) return null;
  resumen.verificadas++;

  for (let intento = 1; intento <= REINTENTOS_MAXIMOS; intento++) {
    for (let i = 0; i < ENDPOINTS.length; i++) {
      const endpoint = ENDPOINTS[i];
      try {
        const res = await axios.get(`${endpoint}/v2/accounts/${direccion}`, {
          timeout: 10000,
          headers: { 'User-Agent': 'Mozilla/5.0' }
        });

        const saldo = (res.data.amount || 0) / 1e6;
        const activos = res.data.assets?.length || 0;

        if (saldo > 0 || activos > 0) {
          resumen.encontradas++;
          return {
            fecha: new Date().toISOString(),
            frase,
            direccion,
            saldo: saldo.toFixed(6),
            activos,
            entropia
          };
        }
        return null;
      } catch (err) {
        resumen.errores++;
        const msg = err?.message || 'Error desconocido';
        const endpointInfo = `⛔ ${endpoint} → ${direccion}`;
        const errorFinal = `${new Date().toISOString()} ${msg} ${endpointInfo}\n`;
        fs.appendFileSync('errores_scanner.txt', errorFinal);

        if (msg.includes('ENOTFOUND') || msg.includes('timeout')) {
          console.log(chalk.yellow(`[⚠️ Eliminando endpoint por falla] ${endpoint} (${msg})`));
          ENDPOINTS.splice(i, 1);
          i--;
        } else {
          console.log(chalk.red(`[🧨 Error en ${endpoint}] ${msg}`));
          await new Promise(r => setTimeout(r, 1000 * intento));
        }
      }
    }

    if (ENDPOINTS.length === 0) {
      console.log(chalk.red(`❌ Todos los endpoints han fallado. No se pudo verificar: ${direccion}`));
      break;
    }
  }

  return null;
}

// 🧾 Resumen final
function enviarResumenFinal() {
  const tiempo = Date.now() - resumen.inicio;
  const reporte = {
    total: contarFrasesDesdeArchivo(),
    verificadas: resumen.verificadas,
    encontradas: resumen.encontradas,
    errores: resumen.errores,
    tiempo: Math.round(tiempo / 1000)
  };
  console.log(`__RESUMEN_FINAL__${JSON.stringify(reporte)}`);
}

process.on('exit', enviarResumenFinal);
process.on('SIGINT', () => process.exit());

// 🚀 Escaneo principal
(async () => {
  console.log(chalk.magenta(`🚀 Iniciando escaneo Algorand (${CANTIDAD_FRASES} frases)`));

  const frases = [];
  while (frases.length < CANTIDAD_FRASES) {
    const cuenta = algosdk.generateAccount();
    const fraseValida = algosdk.secretKeyToMnemonic(cuenta.sk);
    if (!frasesEscaneadas.has(fraseValida)) {
      frases.push(fraseValida);
      frasesEscaneadas.add(fraseValida);
      fs.appendFileSync(HISTORIAL, fraseValida + '\n');
      process.stdout.write(`Generada frase #${frases.length}\n`);
    }
  }

  let buffer = [];
  for (let i = 0; i < frases.length; i += LOTES_CONCURRENCIA) {
    process.stdout.write(`📦 Lote actual ${Math.floor(i / LOTES_CONCURRENCIA) + 1}\n`);

    const lote = frases.slice(i, i + LOTES_CONCURRENCIA);
    const resultados = await Promise.all(lote.map(verificarFrase));
    resultados.filter(Boolean).forEach(r => {
      fs.appendFileSync(RESULTADOS, JSON.stringify(r) + '\n'); // ✅ Guardado inmediato
      console.log(chalk.green(`✅ ${r.direccion} → ${r.saldo} ALGOs | Entropía: ${r.entropia}`));
    });

    const tiempo = Date.now() - resumen.inicio;
    resumen.tiempo = tiempo;
    mostrarDashboard(resumen, i / LOTES_CONCURRENCIA);
    await new Promise(r => setTimeout(r, PAUSA_MS_ENTRE_LOTES));
  }

  console.log(chalk.cyan(`🏁 Escaneo finalizado. Revisa "${RESULTADOS}"`));
})();

import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = 4000;

let scannerProcess = null;

app.use(express.static(path.join(__dirname, 'public')));

io.on('connection', (socket) => {
  console.log('🧠 Cliente conectado');

  socket.on('start-scan', () => {
    if (scannerProcess) return;

    scannerProcess = spawn('node', ['scanner.js']);

    scannerProcess.stdout.on('data', (data) => {
      const lines = data.toString().split('\n');
      for (const line of lines) {
        if (!line.trim()) continue;

        if (line.startsWith('__RESUMEN_FINAL__')) {
          const json = line.replace('__RESUMEN_FINAL__', '');
          socket.emit('resumen', JSON.parse(json));
        } else {
          socket.emit('metrics', line.trim());

          // 🧠 Emitir hallazgo si la línea contiene una dirección con saldo
          if (line.includes('✅')) {
            const match = line.match(/→ ([0-9.]+) ALGOs \| Entropía: (\d+)/);
            if (match) {
              const direccionMatch = line.match(/✅ (.+?) →/);
              if (direccionMatch) {
                const resultado = {
                  direccion: direccionMatch[1],
                  saldo: match[1],
                  entropia: parseInt(match[2])
                };
                socket.emit('hallazgo', resultado);
              }
            }
          }
        }
      }
      
    });

    scannerProcess.stderr.on('data', (data) => {
      const err = data.toString();
      fs.appendFileSync('errores_scanner.txt', err);
    });

    scannerProcess.on('close', () => {
      scannerProcess = null;
      socket.emit('metrics', '🛑 Escaneo detenido');

      // ✅ Emitir todas las frases encontradas desde archivo
      const resultadosPath = path.join(__dirname, 'resultados_algorand_rapido.txt');
      if (fs.existsSync(resultadosPath)) {
        const contenido = fs.readFileSync(resultadosPath, 'utf8');
        const lineas = contenido
          .split('\n')
          .filter(line => line.trim())
          .map(line => {
            try {
              return JSON.parse(line);
            } catch {
              return null;
            }
          })
          .filter(Boolean);

        socket.emit('hallazgos', lineas);
      }
    });
  });

  socket.on('stop-scan', () => {
    if (scannerProcess) {
      scannerProcess.kill();
      scannerProcess = null;
    }
  });
});

server.listen(PORT, () => {
  console.log(`🚀 Dashboard disponible en http://localhost:${PORT}`);
});

import 'dotenv/config';
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { initDb } from './db';
import { createRouter } from './routes';
import { setupSockets } from './socket';

const PORT = process.env.PORT || 3001;

async function bootstrap() {
  const app = express();
  
  // Enable CORS
  app.use(cors({
    origin: '*', // For development allow any origin
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    credentials: true
  }));

  app.use(express.json());

  // Database initialization
  try {
    await initDb();
    console.log('Database successfully initialized.');
  } catch (err) {
    console.error('Failed to initialize database:', err);
    process.exit(1);
  }

  // Create HTTP and WebSocket Server
  const server = http.createServer(app);
  const io = new Server(server, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST']
    }
  });

  // Setup routes
  app.use('/api', createRouter(io));

  // Setup sockets
  setupSockets(io);

  // Status check endpoint
  app.get('/status', (req, res) => {
    res.json({ status: 'healthy', timestamp: new Date().toISOString() });
  });

  server.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
  });
}

bootstrap().catch(err => {
  console.error('Bootstrap error:', err);
});

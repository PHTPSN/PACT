import express, { type NextFunction, type Request, type Response } from 'express';
import { resolve } from 'node:path';
import { ProductStore, type ProductAction } from './store.js';

const app = express();
const store = new ProductStore();
const port = Number.parseInt(process.env.PORT ?? process.env.PACT_PRODUCT_PORT ?? '4180', 10);
const host = process.env.HOST ?? '0.0.0.0';
const publicDir = resolve(process.cwd(), 'product');

app.use(express.json({ limit: '32kb' }));

app.get('/api/state', (_request, response) => response.json(store.getState()));

app.post('/api/reset', (_request, response) => response.json(store.reset()));

app.post('/api/actions/:action', (request, response) => {
  const action = request.params.action as ProductAction;
  const allowed: ProductAction[] = ['save-pact', 'verify-member', 'accept-pact', 'activate-pact', 'fund-treasury', 'create-budget', 'approve-budget', 'issue-budget', 'run-agent', 'set-low-balance'];
  if (!allowed.includes(action)) return response.status(404).json({ error: 'Unknown product action.' });
  store.act(action, request.body as Record<string, unknown>);
  return response.json(store.getState());
});

app.use(express.static(publicDir, { extensions: ['html'] }));
app.get('*path', (_request, response) => response.sendFile(resolve(publicDir, 'index.html')));

app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
  const message = error instanceof Error ? error.message : 'Unexpected product error.';
  response.status(400).json({ error: message });
});

app.listen(port, host, () => {
  console.log(`Pact product is listening on ${host}:${port}`);
  console.log('Product sandbox actions never submit blockchain transactions.');
});

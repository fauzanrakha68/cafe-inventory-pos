import express from 'express';
import cors from 'cors';
import { authRouter } from './routes/auth';
import { usersRouter } from './routes/users';
import { ingredientsRouter } from './routes/ingredients';
import { menusRouter } from './routes/menus';
import { stockRouter } from './routes/stock';
import { salesRouter } from './routes/sales';
import { wasteRouter } from './routes/waste';
import { opnamesRouter } from './routes/opnames';

export const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => res.json({ ok: true }));
app.use('/auth', authRouter);
app.use('/users', usersRouter);
app.use('/ingredients', ingredientsRouter);
app.use('/menus', menusRouter);
app.use('/stock', stockRouter);
app.use('/sales', salesRouter);
app.use('/waste', wasteRouter);
app.use('/opnames', opnamesRouter);

app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: 'Terjadi kesalahan server' });
});
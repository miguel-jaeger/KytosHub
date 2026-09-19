import { copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const dist = 'dist';

copyFileSync(join(dist, 'index.html'), join(dist, '404.html'));

const routes = [
  '/login',
  '/garita',
  '/parking',
  '/visitor',
  '/profile',
  '/setup',
  '/admin/condominiums',
  '/admin/users'
];

for (const route of routes) {
  const rel = route.replace(/^\/+/, '');
  mkdirSync(join(dist, rel), { recursive: true });
  copyFileSync(join(dist, 'index.html'), join(dist, rel, 'index.html'));
}
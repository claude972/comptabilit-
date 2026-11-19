// Relit des originaux dans le stockage objet et compare leur SHA-256 à celui enregistré en base.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../packages/plateforme/package.json', import.meta.url));
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');

for (const l of readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(l.trim());
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}
const s3 = new S3Client({
  endpoint: process.env.S3_ENDPOINT,
  region: process.env.S3_REGION,
  forcePathStyle: true,
  credentials: { accessKeyId: process.env.S3_ACCESS_KEY, secretAccessKey: process.env.S3_SECRET_KEY },
});
const lignes = readFileSync(process.argv[2], 'utf8').split('\n').filter(Boolean);
let ok = 0;
for (const ligne of lignes) {
  const [cle, attendu] = ligne.split(' ');
  const r = await s3.send(new GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: cle }));
  const h = createHash('sha256');
  for await (const m of r.Body) h.update(m);
  if (h.digest('hex') !== attendu) {
    console.error(`ÉCHEC : empreinte différente pour un original (${cle.slice(-12)})`);
    process.exit(1);
  }
  ok++;
}
console.log(`Originaux relus et conformes à leur empreinte : ${ok}/${lignes.length}`);

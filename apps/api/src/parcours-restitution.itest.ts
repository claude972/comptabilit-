/** Export de restitution complet d'un dossier — pile réelle locale. L'archive est rouverte et vérifiée fichier par fichier. */
import { createHash } from 'node:crypto';
import { DEMO } from '@comtaple/db/amorcer';
import { beforeAll, describe, expect, it } from 'vitest';
import yauzl from 'yauzl';
import { api, attendre, ouvrirSessions, sha } from './essais/outils.js';

function ouvrirZip(contenu: Buffer): Promise<Map<string, Buffer>> {
  return new Promise((ok, ko) => {
    yauzl.fromBuffer(contenu, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) return ko(err);
      const fichiers = new Map<string, Buffer>();
      zip.on('entry', (entree) => {
        zip.openReadStream(entree, (e, flux) => {
          if (e || !flux) return ko(e);
          const morceaux: Buffer[] = [];
          flux.on('data', (m) => morceaux.push(m));
          flux.on('end', () => {
            fichiers.set(entree.fileName, Buffer.concat(morceaux));
            zip.readEntry();
          });
        });
      });
      zip.on('end', () => ok(fichiers));
      zip.on('error', ko);
      zip.readEntry();
    });
  });
}

beforeAll(ouvrirSessions);

describe('restitution d’un dossier', () => {
  it('est réservée au niveau de validation sur le dossier', async () => {
    expect((await api('remi', 'POST', `/v1/dossiers/${DEMO.dupain}/restitutions`)).statut).toBe(403); // révision ≠ validation
    expect((await api('client', 'POST', `/v1/dossiers/${DEMO.dupain}/restitutions`)).statut).toBe(403);
    expect((await api('bruno', 'POST', `/v1/dossiers/${DEMO.dupain}/restitutions`)).statut).toBe(404);
    expect((await api('alice', 'POST', `/v1/dossiers/${DEMO.martin}/restitutions`)).statut).toBe(404); // gestionnaire non habilitée
  });

  it('produit une archive complète dont chaque fichier correspond au manifeste d’empreintes', async () => {
    // Une pièce au nom hostile, pour vérifier que les noms d'origine ne dictent pas les chemins de l'archive.
    const hostile = Buffer.from(`%PDF-1.4 restitution ${Date.now()}`);
    const depot = (nomFichier: string) => api('chloe', 'POST', '/v1/televersements', { entiteId: DEMO.dupain, nomFichier, taille: hostile.length, sha256: sha(hostile), canal: 'ordinateur' });
    expect((await depot('facture\u0000.pdf')).statut).toBe(400); // caractère nul refusé proprement
    const o = await depot('../../etc/passwd:*?.pdf');
    expect(o.statut).toBe(201);
    await api('chloe', 'PUT', `/v1/televersements/${o.json.id}/morceaux?decalage=0`, hostile);
    await api('chloe', 'POST', `/v1/televersements/${o.json.id}/terminer`);

    const demande = await api('alice', 'POST', `/v1/dossiers/${DEMO.dupain}/restitutions`);
    expect(demande.statut).toBe(202);
    const liste = await attendre(
      () => api('alice', 'GET', `/v1/dossiers/${DEMO.dupain}/restitutions`),
      (r) => ['termine', 'echec'].includes(r.json?.find((x: any) => x.id === demande.json.id)?.statut),
      180_000,
    );
    const r = liste.json.find((x: any) => x.id === demande.json.id);
    expect(r.statut).toBe('termine');

    const archive = await api('alice', 'GET', `/v1/restitutions/${r.id}/archive`);
    expect(archive.statut).toBe(200);
    expect(archive.brut.length).toBe(r.taille);
    expect(sha(archive.brut)).toBe(r.sha256);
    expect((await api('remi', 'GET', `/v1/restitutions/${r.id}/archive`)).statut).toBe(403);
    expect((await api('bruno', 'GET', `/v1/restitutions/${r.id}/archive`)).statut).toBe(404);

    const fichiers = await ouvrirZip(archive.brut);
    const manifeste = JSON.parse(fichiers.get('manifeste.json')!.toString('utf8'));
    expect(manifeste.format).toBe('comtaple.restitution/1');
    // Tout fichier de l'archive (hors manifeste) est au manifeste, avec la bonne taille et la bonne empreinte.
    expect([...fichiers.keys()].filter((n) => n !== 'manifeste.json').sort()).toEqual(manifeste.fichiers.map((f: any) => f.chemin).sort());
    for (const f of manifeste.fichiers) {
      const contenu = fichiers.get(f.chemin)!;
      expect(contenu.length, f.chemin).toBe(f.taille);
      expect(createHash('sha256').update(contenu).digest('hex'), f.chemin).toBe(f.sha256);
    }
    // Aucun chemin ne sort de l'archive, quel que soit le nom d'origine.
    for (const nom of fichiers.keys()) {
      expect(nom).not.toMatch(/\.\.|^\/|\\|\u0000/);
      expect(nom.split('/').length).toBeLessThanOrEqual(3);
    }
    // Les originaux sont restitués à l'identique : leur nom commence par leur propre empreinte.
    const originaux = [...fichiers.entries()].filter(([n]) => n.startsWith('originaux/'));
    expect(originaux.length).toBe(manifeste.originaux);
    expect(originaux.length).toBeGreaterThan(0);
    for (const [nom, contenu] of originaux) expect(nom.slice('originaux/'.length, 'originaux/'.length + 64)).toBe(createHash('sha256').update(contenu).digest('hex'));
    expect(originaux.some(([, c]) => c.equals(hostile))).toBe(true);
    // Le fichier écarté par l'antivirus n'est pas restitué, et le manifeste le dit.
    expect(manifeste.originauxExclus.some((x: any) => /antivirus/.test(x.motif))).toBe(true);
    expect(originaux.some(([, c]) => c.toString('latin1').includes('EICAR-STANDARD-ANTIVIRUS-TEST-FILE'))).toBe(false);

    // Contenu : uniquement ce dossier, avec pièces, révision, décisions et écritures.
    const dossier = JSON.parse(fichiers.get('donnees/dossier.json')!.toString('utf8'));
    expect(dossier.dossier.id).toBe(DEMO.dupain);
    const pieces = JSON.parse(fichiers.get('donnees/pieces.json')!.toString('utf8'));
    expect(pieces.documents.length).toBe(manifeste.pieces);
    expect(pieces.documents.every((d: any) => d.entiteId === DEMO.dupain && d.cabinetId === DEMO.cabinetA)).toBe(true);
    expect(pieces.documents.some((d: any) => d.extractions.length > 0 && d.receptions.length > 0)).toBe(true);
    const revision = JSON.parse(fichiers.get('donnees/revision.json')!.toString('utf8'));
    expect(revision.constats.every((c: any) => c.entiteId === DEMO.dupain)).toBe(true);
    expect(JSON.parse(fichiers.get('donnees/decisions.json')!.toString('utf8')).length).toBe(manifeste.decisions);
    const ecritures = [...fichiers.keys()].filter((n) => n.startsWith('donnees/ecritures/'));
    expect(ecritures.length).toBeGreaterThan(0);
    const lignes = ecritures.reduce((n, nom) => n + fichiers.get(nom)!.toString('utf8').trimEnd().split('\n').length - 1, 0);
    expect(lignes).toBe(manifeste.lignesEcriture);
    expect(fichiers.get('LISEZMOI.txt')!.toString('utf8')).toMatch(/PROJETS/);
    // Aucun secret ni jeton dans l'archive.
    for (const [nom, contenu] of fichiers) if (nom.startsWith('donnees/')) expect(contenu.toString('utf8')).not.toMatch(/jetons?_?chiffres|access_token|refresh_token/i);
  });
});

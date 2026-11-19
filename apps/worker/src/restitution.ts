import { createHash } from 'node:crypto';
import { PassThrough } from 'node:stream';
import { asc, eq, journaliser, or, isNull, schema as s, sql, and, inArray } from '@comtaple/db';
import { cles, type TacheRestitution } from '@comtaple/plateforme';
import yazl from 'yazl';
import type { Contexte } from './contexte.js';

const LISEZMOI = `RESTITUTION D'UN DOSSIER — Comtaple
====================================

Cette archive contient les données du dossier telles qu'elles existaient à la date de génération.

  manifeste.json        Liste de tous les fichiers de l'archive avec leur taille et leur empreinte SHA-256.
  donnees/              Données structurées (JSON, UTF-8) et écritures normalisées (CSV, séparateur « ; », UTF-8).
  originaux/            Fichiers reçus, non modifiés, nommés par leur empreinte SHA-256 suivie du nom d'origine.

Montants : chaînes décimales (point décimal), jamais des nombres flottants.
Les productions du logiciel (extractions, constats, rapprochements) sont des PROJETS sauf mention d'une
validation, avec son auteur et sa date.

Non inclus : les sauvegardes, les journaux techniques, les jetons de connexion, et les originaux
écartés par l'antivirus (listés dans le manifeste, rubrique « originauxExclus »).
`;

/** Nom de fichier sûr dans l'archive : aucun séparateur de chemin, aucun caractère de contrôle (noms d'origine non fiables). */
const nomSur = (n: string) => n.normalize('NFC').replace(/[\\/\u0000-\u001f\u007f:*?"<>|]/g, '_').replace(/\.{2,}/g, '_').replace(/^\.+/, '_').slice(0, 120) || 'fichier';
const csv = (v: unknown) => {
  const t = v === null || v === undefined ? '' : String(v);
  // Neutralise les formules de tableur et protège le séparateur.
  const neutre = /^[=+\-@\t\r]/.test(t) && !/^-?\d+(\.\d+)?$/.test(t) ? `'${t}` : t;
  return /[";\n\r]/.test(neutre) ? `"${neutre.replace(/"/g, '""')}"` : neutre;
};

/**
 * Restitution complète d'un dossier : originaux, données, liens, constats, décisions et règles applicables.
 * L'archive est construite en flux et son empreinte est enregistrée. Aucune donnée d'un autre dossier n'y entre.
 */
export async function genererRestitution(c: Contexte, t: TacheRestitution): Promise<void> {
  const ctx = { cabinetId: t.cabinetId };
  const debut = await c.bd.avecContexte(ctx, async (tx) => {
    const [r] = await tx.select().from(s.restitutions).where(eq(s.restitutions.id, t.restitutionId));
    if (!r || r.statut === 'termine') return null;
    await tx.update(s.restitutions).set({ statut: 'en_cours' }).where(eq(s.restitutions.id, r.id));
    return r;
  });
  if (!debut) return;
  const e = debut.entiteId;

  try {
    const d = await c.bd.avecContexte(ctx, async (tx) => {
      const par = <T extends { entiteId: unknown }>(table: T) => eq((table as unknown as { entiteId: typeof s.documents.entiteId }).entiteId, e);
      const [entite] = await tx.select().from(s.entites).where(eq(s.entites.id, e));
      const documents = await tx.select().from(s.documents).where(par(s.documents)).orderBy(asc(s.documents.creeLe));
      const lots = await tx.select().from(s.lotsImport).where(par(s.lotsImport)).orderBy(asc(s.lotsImport.creeLe));
      const idsFichiers = [...new Set([...documents.map((x) => x.fichierId), ...lots.map((x) => x.fichierId).filter((x): x is string => Boolean(x))])];
      const fichiers = idsFichiers.length ? await tx.select().from(s.fichiers).where(inArray(s.fichiers.id, idsFichiers)) : [];
      return {
        entite,
        exercices: await tx.select().from(s.exercices).where(par(s.exercices)).orderBy(asc(s.exercices.debut)),
        documents,
        receptions: await tx.select().from(s.receptions).where(par(s.receptions)),
        extractions: await tx.select().from(s.extractions).where(par(s.extractions)).orderBy(asc(s.extractions.version)),
        echanges: await tx.select().from(s.echangesDocument).where(par(s.echangesDocument)),
        lots,
        fichiers,
        executions: await tx.select().from(s.executionsControles).where(par(s.executionsControles)),
        resultats: await tx.select().from(s.resultatsControles).where(par(s.resultatsControles)),
        constats: await tx.select().from(s.constats).where(par(s.constats)),
        decisions: await tx.select().from(s.decisions).where(par(s.decisions)).orderBy(asc(s.decisions.creeLe)),
        releves: await tx.select().from(s.relevesBancaires).where(par(s.relevesBancaires)),
        mouvements: await tx.select().from(s.mouvementsBancaires).where(par(s.mouvementsBancaires)).orderBy(asc(s.mouvementsBancaires.dateOperation)),
        executionsRapprochement: await tx.select().from(s.executionsRapprochement).where(par(s.executionsRapprochement)),
        rapprochements: await tx.select().from(s.rapprochements).where(par(s.rapprochements)),
        regles: await tx.select().from(s.reglesCabinet).where(or(isNull(s.reglesCabinet.entiteId), eq(s.reglesCabinet.entiteId, e))),
        audit: await tx.select().from(s.journalAudit).where(eq(s.journalAudit.entiteId, e)).orderBy(asc(s.journalAudit.id)),
        utilisateurs: (await tx.execute(sql`select u.id, u.nom from utilisateurs u where exists (select 1 from appartenances a where a.utilisateur_id = u.id and a.cabinet_id = ${t.cabinetId}::uuid)`)).rows,
      };
    });
    if (!d.entite) throw new Error('Dossier introuvable');

    const zip = new yazl.ZipFile();
    const manifeste: Array<{ chemin: string; taille: number; sha256: string }> = [];
    const ajouter = (chemin: string, contenu: Buffer) => {
      zip.addBuffer(contenu, chemin);
      manifeste.push({ chemin, taille: contenu.length, sha256: createHash('sha256').update(contenu).digest('hex') });
    };
    const json = (chemin: string, valeur: unknown) => ajouter(chemin, Buffer.from(JSON.stringify(valeur, null, 2), 'utf8'));

    // L'archive part dans le stockage au fil de sa construction ; son empreinte est calculée au passage.
    const hache = createHash('sha256');
    let taille = 0;
    const sortie = new PassThrough();
    zip.outputStream.on('data', (m: Buffer) => {
      hache.update(m);
      taille += m.length;
    });
    zip.outputStream.pipe(sortie);
    const cle = cles.restitution(t.cabinetId, debut.id);
    const envoi = c.stockage.deposerFlux(cle, sortie, 'application/zip');

    ajouter('LISEZMOI.txt', Buffer.from(LISEZMOI, 'utf8'));
    json('donnees/dossier.json', { dossier: d.entite, exercices: d.exercices, personnes: d.utilisateurs });
    json('donnees/pieces.json', {
      documents: d.documents.map((doc) => ({
        ...doc,
        sha256: d.fichiers.find((f) => f.id === doc.fichierId)?.sha256 ?? null,
        receptions: d.receptions.filter((r) => r.documentId === doc.id),
        extractions: d.extractions.filter((x) => x.documentId === doc.id),
        echanges: d.echanges.filter((x) => x.documentId === doc.id),
      })),
    });
    json('donnees/imports.json', d.lots.map((l) => ({ ...l, sha256: d.fichiers.find((f) => f.id === l.fichierId)?.sha256 ?? null })));
    json('donnees/revision.json', { executions: d.executions, resultats: d.resultats, constats: d.constats });
    json('donnees/decisions.json', d.decisions);
    json('donnees/banque.json', { releves: d.releves.map(({ brut: _b, ...r }) => r), mouvements: d.mouvements.map(({ brut: _b, ...m }) => m) });
    json('donnees/rapprochements.json', { executions: d.executionsRapprochement, rapprochements: d.rapprochements });
    json('donnees/regles-cabinet.json', d.regles);
    json('donnees/journal-audit.json', d.audit);

    // Écritures normalisées : un CSV par lot comptable, lu par tranches (jamais tout en mémoire).
    const COLONNES = ['numeroLigne', 'journalCode', 'journalLib', 'ecritureNum', 'ecritureDate', 'compteNum', 'compteLib', 'compAuxNum', 'compAuxLib', 'pieceRef', 'pieceDate', 'ecritureLib', 'debit', 'credit', 'ecritureLet', 'dateLet', 'validDate', 'montantDevise', 'idevise'] as const;
    let nbLignes = 0;
    for (const lot of d.lots.filter((l) => l.type === 'fec')) {
      const morceaux: Buffer[] = [Buffer.from(`${COLONNES.join(';')}\n`, 'utf8')];
      for (let decalage = 0; ; decalage += 5000) {
        const tranche = await c.bd.avecContexte(ctx, (tx) =>
          tx.select().from(s.lignesEcriture).where(eq(s.lignesEcriture.lotImportId, lot.id)).orderBy(asc(s.lignesEcriture.numeroLigne)).limit(5000).offset(decalage),
        );
        if (!tranche.length) break;
        morceaux.push(Buffer.from(tranche.map((l) => COLONNES.map((k) => csv(l[k])).join(';')).join('\n') + '\n', 'utf8'));
        nbLignes += tranche.length;
      }
      if (morceaux.length > 1) ajouter(`donnees/ecritures/lot-v${lot.version}-${lot.id}.csv`, Buffer.concat(morceaux));
    }

    // Originaux : relus du stockage, vérifiés contre leur empreinte ; ceux que l'antivirus a écartés ne sont pas restitués.
    const exclus: Array<{ sha256: string; motif: string }> = [];
    const noms = new Map<string, string>();
    for (const doc of d.documents) noms.set(doc.fichierId, doc.nomOrigine);
    for (const l of d.lots) if (l.fichierId) noms.set(l.fichierId, (l.rapport as { nomFichier?: string } | null)?.nomFichier ?? 'import');
    let nbOriginaux = 0;
    for (const f of d.fichiers) {
      if (f.analyseAntivirus === 'infecte') {
        exclus.push({ sha256: f.sha256, motif: 'écarté par l’antivirus' });
        continue;
      }
      const contenu = await c.stockage.lire(f.cleStockage, 600 * 1024 * 1024);
      if (createHash('sha256').update(contenu).digest('hex') !== f.sha256) {
        exclus.push({ sha256: f.sha256, motif: 'empreinte différente de celle enregistrée : fichier non restitué, à examiner' });
        continue;
      }
      ajouter(`originaux/${f.sha256}-${nomSur(noms.get(f.id) ?? 'fichier')}`, contenu);
      nbOriginaux++;
    }

    const resume = {
      genereLe: new Date().toISOString(),
      dossier: d.entite.raisonSociale,
      pieces: d.documents.length,
      originaux: nbOriginaux,
      originauxExclus: exclus,
      lotsImport: d.lots.length,
      lignesEcriture: nbLignes,
      constats: d.constats.length,
      decisions: d.decisions.length,
      mouvementsBancaires: d.mouvements.length,
      rapprochements: d.rapprochements.length,
      reglesCabinet: d.regles.length,
      evenementsAudit: d.audit.length,
    };
    zip.addBuffer(Buffer.from(JSON.stringify({ format: 'comtaple.restitution/1', ...resume, fichiers: manifeste }, null, 2), 'utf8'), 'manifeste.json');
    zip.end();
    await envoi;

    await c.bd.avecContexte(ctx, async (tx) => {
      await tx.update(s.restitutions).set({ statut: 'termine', cleArchive: cle, sha256: hache.digest('hex'), taille, resume, termineLe: sql`now()` }).where(and(eq(s.restitutions.id, debut.id)));
      await journaliser(tx, { cabinetId: t.cabinetId, acteurType: 'systeme', action: 'restitution.generee', cibleType: 'restitution', cibleId: debut.id, entiteId: e, details: { taille, originaux: nbOriginaux, exclus: exclus.length } });
    });
  } catch (err) {
    await c.bd.avecContexte(ctx, (tx) => tx.update(s.restitutions).set({ statut: 'echec', erreur: err instanceof Error ? err.message.slice(0, 500) : 'erreur' }).where(eq(s.restitutions.id, debut.id)));
    throw err;
  }
}

import { createHash } from 'node:crypto';
import { asc, eq, journaliser, schema as s, sql } from '@comtaple/db';
import { cles, type TacheDossierRevision } from '@comtaple/plateforme';
import { chromium } from 'playwright';
import type { Contexte } from './contexte.js';

/** Échappement HTML systématique : libellés d'écritures, noms de fichiers et commentaires sont des contenus non fiables. */
const e = (v: unknown): string =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const LIBELLE_STATUT: Record<string, string> = {
  sans_anomalie: 'Exécuté sans anomalie détectée',
  constat: 'Constat(s) à examiner',
  non_applicable: 'Non applicable',
  non_realise: 'Non réalisé faute de données',
  erreur: 'Erreur technique',
};
const LIBELLE_REVUE: Record<string, string> = {
  a_examiner: 'À examiner',
  en_cours: 'En cours',
  piece_demandee: 'Pièce demandée',
  accepte: 'Accepté',
  corrige: 'Corrigé',
  rejete: 'Rejeté',
  anomalie_confirmee: 'Anomalie confirmée',
  cloture: 'Clôturé',
};
const montantFr = (v: string | null) => (v === null ? '—' : `${v.replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} €`);

/**
 * Génère le dossier de révision : PDF lisible + export structuré + inventaire des pièces et empreintes.
 * Tout le contenu provient de la base (résultats du moteur, décisions humaines) ; rien n'est rédigé par une IA.
 */
export async function genererDossierRevision(c: Contexte, t: TacheDossierRevision): Promise<void> {
  const ctx = { cabinetId: t.cabinetId };
  const d = await c.bd.avecContexte(ctx, async (tx) => {
    const [exp] = await tx.select().from(s.exportsRevision).where(eq(s.exportsRevision.id, t.exportId));
    if (!exp || exp.statut === 'termine') return null;
    await tx.update(s.exportsRevision).set({ statut: 'en_cours' }).where(eq(s.exportsRevision.id, exp.id));
    const [cabinet] = await tx.select().from(s.cabinets).where(eq(s.cabinets.id, t.cabinetId));
    const [entite] = await tx.select().from(s.entites).where(eq(s.entites.id, exp.entiteId));
    const [exercice] = await tx.select().from(s.exercices).where(eq(s.exercices.id, exp.exerciceId));
    const [execution] = await tx.select().from(s.executionsControles).where(eq(s.executionsControles.id, exp.executionId));
    const [lot] = execution ? await tx.select().from(s.lotsImport).where(eq(s.lotsImport.id, execution.lotImportId)) : [];
    const [fichierLot] = lot?.fichierId ? await tx.select().from(s.fichiers).where(eq(s.fichiers.id, lot.fichierId)) : [];
    const resultats = await tx.select().from(s.resultatsControles).where(eq(s.resultatsControles.executionId, exp.executionId)).orderBy(asc(s.resultatsControles.controleId));
    const constats = await tx.select().from(s.constats).where(eq(s.constats.executionId, exp.executionId)).orderBy(asc(s.constats.controleId), asc(s.constats.cle));
    const decisions = (
      await tx.execute(sql`
        select d.cible_id, d.action, d.motif, d.version_cible, d.cree_le, u.nom as auteur
        from decisions d join utilisateurs u on u.id = d.auteur_id
        where d.entite_id = ${exp.entiteId}::uuid and d.cible_type = 'constat'
          and d.cible_id in (select id from constats where execution_id = ${exp.executionId}::uuid)
        order by d.cree_le`)
    ).rows as Array<{ cible_id: string; action: string; motif: string | null; version_cible: number; cree_le: string; auteur: string }>;
    const pieces = (
      await tx.execute(sql`
        select d.id, d.nom_origine, d.nature, d.statut, f.sha256, f.taille, f.type_mime_detecte, d.cree_le,
               (select count(*)::int from receptions r where r.document_id = d.id) as receptions
        from documents d join fichiers f on f.id = d.fichier_id
        where d.entite_id = ${exp.entiteId}::uuid order by d.cree_le`)
    ).rows as Array<Record<string, unknown>>;
    return { exp, cabinet, entite, exercice, execution, lot, fichierLot, resultats, constats, decisions, pieces };
  });
  if (!d || !d.entite || !d.exercice || !d.execution) return;

  try {
    const parConstat = new Map<string, typeof d.decisions>();
    for (const x of d.decisions) parConstat.set(x.cible_id, [...(parConstat.get(x.cible_id) ?? []), x]);
    const genereLe = new Date().toISOString();
    const donnees = {
      format: 'comtaple.dossier-revision/1',
      mention: 'PROJET — document de travail non validé par un professionnel habilité',
      genereLe,
      cabinet: d.cabinet?.nom,
      dossier: { id: d.entite.id, raisonSociale: d.entite.raisonSociale, territoireFiscal: d.entite.territoireFiscal, regimeFiscal: d.entite.regimeFiscal },
      exercice: { debut: d.exercice.debut, fin: d.exercice.fin },
      donneesComptables: {
        lotImportId: d.lot?.id,
        version: d.lot?.version,
        statutDonnees: d.lot?.statutDonnees,
        sha256Original: d.fichierLot?.sha256,
        versionDonnees: d.execution.versionDonnees,
        obsolete: d.execution.obsolete,
        rapportImport: d.lot?.rapport
          ? (({ anomalies: _a, ...reste }) => reste)(d.lot.rapport as Record<string, unknown>)
          : null,
      },
      controles: d.resultats.map((r) => ({
        id: r.controleId,
        version: r.versionControle,
        statut: r.statut,
        motif: r.motif,
        parametres: r.parametres,
        mesures: r.mesures,
        source: r.source,
      })),
      constats: d.constats.map((k) => ({
        id: k.id,
        controleId: k.controleId,
        gravite: k.gravite,
        titre: k.titre,
        explication: k.explication,
        actionProposee: k.actionProposee,
        montant: k.montant,
        preuves: k.preuves,
        lignesConcernees: k.lignesConcernees,
        statutRevue: k.statutRevue,
        aRevoir: k.aRevoir,
        decisions: (parConstat.get(k.id) ?? []).map((x) => ({ action: x.action, motif: x.motif, auteur: x.auteur, date: x.cree_le, versionDonnees: x.version_cible })),
      })),
      inventairePieces: d.pieces,
    };

    const realises = d.resultats.filter((r) => r.statut === 'sans_anomalie' || r.statut === 'constat');
    const nonRealises = d.resultats.filter((r) => r.statut !== 'sans_anomalie' && r.statut !== 'constat');
    const titreControle = (r: (typeof d.resultats)[number]) => e((r.source as { titre?: string }).titre ?? r.controleId);
    const refSource = (r: (typeof d.resultats)[number]) => {
      const src = r.source as { type?: string; reference?: string; verification?: string; dateVerification?: string | null };
      const etat = src.type === 'reglementaire' ? (src.verification === 'verifiee' ? `source vérifiée le ${e(src.dateVerification)}` : 'source NON vérifiée') : 'règle interne';
      return `${e(src.reference ?? '')} <span class="discret">(${etat})</span>`;
    };

    const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Dossier de révision</title><style>
      @page { size: A4; margin: 18mm 15mm 20mm; }
      * { box-sizing: border-box; } body { font: 10pt/1.45 -apple-system, "Helvetica Neue", Arial, sans-serif; color: #1a1a1a; margin: 0; }
      h1 { font-size: 20pt; margin: 0 0 4pt; } h2 { font-size: 13pt; margin: 20pt 0 6pt; border-bottom: 1px solid #999; padding-bottom: 3pt; break-after: avoid; }
      h3 { font-size: 10.5pt; margin: 10pt 0 2pt; break-after: avoid; }
      .projet { border: 2px solid #b45309; color: #92400e; padding: 6pt 9pt; font-weight: 600; margin: 10pt 0; }
      .alerte { border: 2px solid #b91c1c; color: #991b1b; padding: 6pt 9pt; font-weight: 600; margin: 10pt 0; }
      table { width: 100%; border-collapse: collapse; margin: 4pt 0 8pt; } th, td { text-align: left; vertical-align: top; padding: 3pt 5pt; border-bottom: 1px solid #ddd; }
      th { font-size: 8.5pt; text-transform: uppercase; letter-spacing: .03em; color: #555; } td.num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
      .discret { color: #666; font-size: 8.5pt; } .mono { font: 8pt ui-monospace, Menlo, monospace; word-break: break-all; }
      .constat { break-inside: avoid; border-left: 3px solid #888; padding: 2pt 0 2pt 8pt; margin: 6pt 0; }
      .g-critique { border-color: #b91c1c; } .g-elevee { border-color: #c2410c; } .g-moyenne { border-color: #a16207; } .g-faible { border-color: #6b7280; }
      dl { display: grid; grid-template-columns: 42mm 1fr; gap: 2pt 8pt; margin: 6pt 0; } dt { color: #555; } dd { margin: 0; }
    </style></head><body>
    <h1>Dossier de révision</h1>
    <div>${e(d.entite.raisonSociale)} — exercice du ${e(d.exercice.debut)} au ${e(d.exercice.fin)}</div>
    <div class="discret">${e(d.cabinet?.nom)} · généré le ${e(genereLe)}</div>
    <div class="projet">PROJET — document de travail préparé par le logiciel. Il ne constitue ni une validation comptable ni un avis professionnel. Les constats sont à examiner par un professionnel habilité.</div>
    ${d.execution.obsolete ? '<div class="alerte">Les données comptables ont été modifiées depuis l’exécution de ces contrôles : ce dossier est OBSOLÈTE et les travaux sont à revoir.</div>' : ''}
    <h2>1. Périmètre et données utilisées</h2>
    <dl>
      <dt>Territoire fiscal</dt><dd>${e(d.entite.territoireFiscal)}</dd>
      <dt>Régime / référentiel</dt><dd>${e(d.entite.regimeFiscal ?? 'non renseigné')} / ${e(d.entite.referentielComptable)}</dd>
      <dt>Nature des données</dt><dd>${d.lot?.statutDonnees === 'fec' ? 'FEC' : 'Données de travail avant clôture'} (import n° ${e(d.lot?.version)})</dd>
      <dt>Empreinte de l’original</dt><dd class="mono">${e(d.fichierLot?.sha256)}</dd>
      <dt>Version des données</dt><dd>${e(d.execution.versionDonnees)}</dd>
      <dt>Lecture du fichier</dt><dd>${(() => {
        const r = (d.lot?.rapport ?? {}) as { lisible?: boolean; conforme?: boolean; suffisantPourTravaux?: boolean; nbLignesNormalisees?: number };
        const o = (b?: boolean) => (b ? 'oui' : 'non');
        return `lisible : ${o(r.lisible)} · conforme au référentiel contrôlé : ${o(r.conforme)} · suffisant pour les travaux : ${o(r.suffisantPourTravaux)} · ${e(r.nbLignesNormalisees ?? 0)} lignes`;
      })()}</dd>
    </dl>
    <h2>2. Contrôles réalisés (${realises.length})</h2>
    <table><thead><tr><th>Contrôle</th><th>Version</th><th>Résultat</th><th>Règle ou source</th></tr></thead><tbody>
    ${realises.map((r) => `<tr><td><b>${e(r.controleId)}</b> ${titreControle(r)}</td><td>${e(r.versionControle)}</td><td>${e(LIBELLE_STATUT[r.statut])}</td><td>${refSource(r)}</td></tr>`).join('')}
    </tbody></table>
    <h2>3. Contrôles non réalisés (${nonRealises.length})</h2>
    ${nonRealises.length === 0 ? '<p>Aucun.</p>' : `<p class="discret">Un contrôle non réalisé n’est pas un résultat favorable.</p><table><thead><tr><th>Contrôle</th><th>Statut</th><th>Motif</th></tr></thead><tbody>
    ${nonRealises.map((r) => `<tr><td><b>${e(r.controleId)}</b> ${titreControle(r)}</td><td>${e(LIBELLE_STATUT[r.statut])}</td><td>${e(r.motif ?? '')}</td></tr>`).join('')}</tbody></table>`}
    <h2>4. Constats et traitement (${d.constats.length})</h2>
    ${d.constats.length === 0 ? '<p>Aucun constat sur les contrôles réalisés.</p>' : d.constats.slice(0, 400).map((k) => `<div class="constat g-${e(k.gravite)}">
      <h3>${e(k.controleId)} — ${e(k.titre)}</h3>
      <div>${e(k.explication)}</div>
      <div class="discret">Gravité : ${e(k.gravite)} · Montant : ${e(montantFr(k.montant))} · ${(k.lignesConcernees as string[]).length} ligne(s) d’écriture · Statut : <b>${e(LIBELLE_REVUE[k.statutRevue])}</b>${k.aRevoir ? ' · <b>À REVOIR (données modifiées)</b>' : ''}</div>
      <div class="discret">Preuves : ${(k.preuves as Array<{ libelle: string; valeur: string }>).slice(0, 8).map((p) => `${e(p.libelle)} = ${e(p.valeur)}`).join(' ; ')}</div>
      <div class="discret">Action proposée : ${e(k.actionProposee)}</div>
      ${(parConstat.get(k.id) ?? []).map((x) => `<div class="discret">→ ${e(x.cree_le)} · ${e(x.auteur)} · ${e(x.action)}${x.motif ? ` : ${e(x.motif)}` : ''} (données v${e(x.version_cible)})</div>`).join('')}
    </div>`).join('')}
    ${d.constats.length > 400 ? `<p class="discret">${d.constats.length - 400} constats supplémentaires figurent dans l’export structuré.</p>` : ''}
    <h2>5. Inventaire des pièces (${d.pieces.length})</h2>
    ${d.pieces.length === 0 ? '<p>Aucune pièce collectée pour ce dossier.</p>' : `<table><thead><tr><th>Pièce</th><th>Nature</th><th>Statut</th><th>Réceptions</th><th>Empreinte SHA-256</th></tr></thead><tbody>
    ${d.pieces.map((p) => `<tr><td>${e(p.nom_origine)}</td><td>${e(p.nature)}</td><td>${e(p.statut)}</td><td class="num">${e(p.receptions)}</td><td class="mono">${e(p.sha256)}</td></tr>`).join('')}</tbody></table>`}
    <h2>6. Validations</h2>
    <p>Aucune validation professionnelle d’ensemble n’est enregistrée pour ce dossier. Les décisions individuelles figurent sous chaque constat.</p>
    </body></html>`;

    // Rendu hors ligne : JavaScript désactivé et toute requête réseau refusée.
    const navigateur = await chromium.launch();
    let pdf: Buffer;
    try {
      const contexte = await navigateur.newContext({ javaScriptEnabled: false, offline: true });
      const page = await contexte.newPage();
      await page.route('**/*', (route) => route.abort());
      await page.setContent(html, { waitUntil: 'load' });
      pdf = await page.pdf({
        format: 'A4',
        printBackground: true,
        displayHeaderFooter: true,
        headerTemplate: '<span></span>',
        footerTemplate:
          '<div style="font-size:7pt;color:#666;width:100%;padding:0 15mm;display:flex;justify-content:space-between"><span>PROJET — non validé</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>',
      });
    } finally {
      await navigateur.close();
    }

    const json = Buffer.from(JSON.stringify(donnees, null, 2), 'utf8');
    const clePdf = cles.export(t.cabinetId, `${d.exp.id}.pdf`);
    const cleDonnees = cles.export(t.cabinetId, `${d.exp.id}.json`);
    await c.stockage.deposer(clePdf, pdf, 'application/pdf');
    await c.stockage.deposer(cleDonnees, json, 'application/json');
    const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
    await c.bd.avecContexte(ctx, async (tx) => {
      await tx
        .update(s.exportsRevision)
        .set({ statut: 'termine', clePdf, cleDonnees, sha256Pdf: sha(pdf), sha256Donnees: sha(json), termineLe: sql`now()` })
        .where(eq(s.exportsRevision.id, d.exp.id));
      await journaliser(tx, {
        cabinetId: t.cabinetId,
        acteurType: 'systeme',
        action: 'dossier_revision.genere',
        cibleType: 'export_revision',
        cibleId: d.exp.id,
        entiteId: d.exp.entiteId,
        details: { sha256Pdf: sha(pdf), sha256Donnees: sha(json), constats: d.constats.length },
      });
    });
  } catch (err) {
    await c.bd.avecContexte(ctx, (tx) =>
      tx.update(s.exportsRevision).set({ statut: 'echec', erreur: err instanceof Error ? err.message.slice(0, 500) : 'erreur' }).where(eq(s.exportsRevision.id, d.exp.id)),
    );
    throw err;
  }
}

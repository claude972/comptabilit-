/**
 * Annulation réversible des imports, reprise, et campagnes d'import sur plusieurs dossiers — pile réelle locale.
 * Quatre dossiers neufs par exécution. Rien n'est supprimé par une annulation : c'est ce que ces parcours vérifient.
 */
import { randomBytes } from 'node:crypto';
import { analyserFec, enBlocs, genererFecSynthetique, genererReleveSynthetique, type LigneFec } from '@comtaple/core';
import { DEMO } from '@comtaple/db/amorcer';
import { beforeAll, describe, expect, it } from 'vitest';
import { api, attendre, attendreLot, deposer, ouvrirSessions } from './essais/outils.js';

const SEL = randomBytes(4).toString('hex');
const g = Number.parseInt(SEL.slice(0, 6), 16);
const EX = { debut: '2025-01-01', fin: '2025-12-31' };
const d: Record<'A' | 'B' | 'C' | 'D', { entite: string; exercice: string }> = { A: { entite: '', exercice: '' }, B: { entite: '', exercice: '' }, C: { entite: '', exercice: '' }, D: { entite: '', exercice: '' } };
const fecAnomalie = genererFecSynthetique({ exercice: EX, nbEcritures: 150, graine: g, anomalies: ['caisse_crediteur'] });
const fecPropre = genererFecSynthetique({ exercice: EX, nbEcritures: 160, graine: g + 1 });
const fec = (qui: string, cle: keyof typeof d, f: { contenu: Uint8Array; nomFichier: string }, extra: Record<string, unknown> = {}) =>
  deposer(qui, d[cle].entite, Buffer.from(f.contenu), { usage: 'fec', exerciceId: d[cle].exercice, statutDonnees: 'travail_avant_cloture', ...extra }, f.nomFichier);
const lots = async (cle: keyof typeof d, qui = 'remi') => (await api(qui, 'GET', `/v1/exercices/${d[cle].exercice}/imports`)).json as any[];
const revueSur = (cle: keyof typeof d, lot: string) =>
  attendre(
    () => api('remi', 'GET', `/v1/exercices/${d[cle].exercice}/revue`),
    (r) => r.json?.execution?.lotImportId === lot && r.json.execution.statut === 'termine',
  );

beforeAll(async () => {
  await ouvrirSessions();
  for (const cle of ['A', 'B', 'C', 'D'] as const) {
    const e = await api('alice', 'POST', '/v1/dossiers', { raisonSociale: `Essai imports ${cle} ${SEL} (fictif)`, territoireFiscal: 'metropole' });
    d[cle].entite = e.json.id;
    await api('alice', 'PUT', `/v1/dossiers/${e.json.id}/habilitations/${DEMO.alice}`, { niveau: 'validation' });
    if (cle !== 'D') {
      await api('alice', 'PUT', `/v1/dossiers/${e.json.id}/habilitations/${DEMO.remi}`, { niveau: 'revision' });
      await api('alice', 'PUT', `/v1/dossiers/${e.json.id}/habilitations/${DEMO.chloe}`, { niveau: 'collaboration' });
    }
    d[cle].exercice = (await api('alice', 'POST', `/v1/dossiers/${e.json.id}/exercices`, EX)).json.id;
  }
});

describe('annulation réversible d’un import comptable', () => {
  let v1 = '';
  let v2 = '';
  let constatDecide = '';

  it('annuler le lot actif réactive le précédent, sans rien supprimer, et marque les travaux à revoir', async () => {
    v1 = (await fec('chloe', 'A', fecAnomalie)).fin.json.lotImportId;
    await attendreLot('remi', v1);
    const r1 = await revueSur('A', v1);
    constatDecide = r1.json.constats.find((c: any) => c.controleId === 'TRE-001').id;
    await api('remi', 'PATCH', `/v1/constats/${constatDecide}`, { action: 'confirmer_anomalie', motif: 'Caisse créditrice avérée' });
    v2 = (await fec('chloe', 'A', fecPropre)).fin.json.lotImportId;
    await attendreLot('remi', v2);
    await revueSur('A', v2);
    const versionAvant = (await api('remi', 'GET', `/v1/dossiers/${d.A.entite}/exercices`)).json[0].versionDonnees;

    expect((await api('chloe', 'POST', `/v1/imports/${v2}/annulation`, { motif: 'Mauvais fichier' })).statut).toBe(403); // révision requise
    expect((await api('bruno', 'POST', `/v1/imports/${v2}/annulation`, { motif: 'Mauvais fichier' })).statut).toBe(404);
    expect((await api('remi', 'POST', `/v1/imports/${v2}/annulation`, {})).statut).toBe(400); // motif requis
    const a = await api('remi', 'POST', `/v1/imports/${v2}/annulation`, { motif: 'Fichier d’un autre exercice importé par erreur' });
    expect(a.json).toMatchObject({ statut: 'annule', actif: false, statutAvantAnnulation: expect.stringMatching(/^termine/), annulePar: DEMO.remi });

    const apres = await lots('A');
    expect(apres.find((l) => l.id === v1)).toMatchObject({ actif: true });
    // Rien n'est supprimé : le lot annulé garde son rapport, son fichier et son nombre de lignes.
    expect(apres.find((l) => l.id === v2)).toMatchObject({ actif: false, statut: 'annule', progression: fecPropre.nbLignes });
    expect(apres.find((l) => l.id === v2).fichierId).toBeTruthy();
    expect(apres.find((l) => l.id === v2).annuleParNom).toBe('Rémi Réviseur');
    expect((await api('remi', 'GET', `/v1/dossiers/${d.A.entite}/exercices`)).json[0].versionDonnees).toBe(versionAvant + 1);
    // Les contrôles sont relancés sur le lot redevenu actif : l'anomalie de la première version réapparaît.
    const revue = await revueSur('A', v1);
    expect(revue.json.execution.obsolete).toBe(false);
    expect(revue.json.resultats.find((x: any) => x.controleId === 'TRE-001').statut).toBe('constat');
    expect((await api('remi', 'GET', `/v1/constats/${constatDecide}`)).json.constat.aRevoir).toBe(true);
    expect((await api('remi', 'POST', `/v1/imports/${v2}/annulation`, { motif: 'encore une fois' })).statut).toBe(409);
  });

  it('rétablir remet le lot annulé en lot actif ; l’annulation et le rétablissement sont tracés', async () => {
    expect((await api('remi', 'POST', `/v1/imports/${v1}/retablissement`, { motif: 'pas annulé' })).statut).toBe(409);
    expect((await api('chloe', 'POST', `/v1/imports/${v2}/retablissement`, { motif: 'Finalement le bon fichier' })).statut).toBe(403);
    const r = await api('remi', 'POST', `/v1/imports/${v2}/retablissement`, { motif: 'Vérification faite : c’était le bon fichier' });
    expect(r.json).toMatchObject({ statut: expect.stringMatching(/^termine/), actif: true, statutAvantAnnulation: null, annulePar: null });
    const apres = await lots('A');
    expect(apres.filter((l) => l.actif).map((l) => l.id)).toEqual([v2]);
    const revue = await revueSur('A', v2);
    expect(revue.json.constats.filter((c: any) => c.controleId === 'TRE-001')).toEqual([]);
    const actions = (await api('alice', 'GET', '/v1/audit?limite=80')).json.lignes.filter((l: any) => l.cibleId === v2).map((l: any) => l.action);
    expect(actions).toEqual(expect.arrayContaining(['import.annule', 'import.retabli']));
  });

  it('annuler le seul import d’un exercice le laisse sans données actives : les travaux le disent, rien n’est inventé', async () => {
    const seul = (await fec('chloe', 'B', fecPropre)).fin.json.lotImportId;
    await attendreLot('remi', seul);
    await revueSur('B', seul);
    expect((await api('remi', 'POST', `/v1/imports/${seul}/annulation`, { motif: 'Import à refaire' })).statut).toBe(200);
    expect((await lots('B')).filter((l) => l.actif)).toEqual([]);
    expect((await api('chloe', 'POST', `/v1/exercices/${d.B.exercice}/controles`)).statut).toBe(409);
    expect((await api('remi', 'GET', `/v1/exercices/${d.B.exercice}/etats`)).statut).toBe(409);
    expect((await api('remi', 'GET', `/v1/exercices/${d.B.exercice}/revue`)).json.execution.obsolete).toBe(true);
    expect((await api('remi', 'POST', `/v1/imports/${seul}/retablissement`, { motif: 'Rétabli pour la suite' })).json.actif).toBe(true);
    await revueSur('B', seul);
  });

  it('un import en échec se reprend ou s’annule, mais ne se « rétablit » pas', async () => {
    const faux = Buffer.from(`pas un FEC ${SEL}\nligne\n`);
    const id = (await deposer('chloe', d.A.entite, faux, { usage: 'fec', exerciceId: d.A.exercice, statutDonnees: 'fec' }, 'faux.txt')).fin.json.lotImportId;
    expect((await attendreLot('remi', id)).json.statut).toBe('echec');
    expect((await api('client', 'POST', `/v1/imports/${id}/reprise`)).statut).toBe(404);
    expect((await api('chloe', 'POST', `/v1/imports/${id}/reprise`)).statut).toBe(202);
    const repris = await attendre(() => api('remi', 'GET', `/v1/imports/${id}`), (r) => r.json.statut === 'echec' && r.json.termineLe !== null);
    expect(repris.json.actif).toBe(false);
    expect((await api('remi', 'POST', `/v1/imports/${id}/annulation`, { motif: 'Fichier inutilisable' })).json.statut).toBe('annule');
    expect((await api('remi', 'POST', `/v1/imports/${id}/retablissement`, { motif: 'essai de rétablissement' })).statut).toBe(409);
    // Les données actives de l'exercice n'ont jamais été touchées par cet import raté.
    expect((await lots('A')).filter((l) => l.actif)).toHaveLength(1);
  });
});

describe('annulation d’un import en cours de traitement', () => {
  it('l’import est interrompu sans laisser de données partielles, et les données actives ne changent pas', async () => {
    // Un fichier volumineux, pour que l'annulation arrive pendant le traitement (plusieurs points de contrôle).
    const gros = genererFecSynthetique({ exercice: EX, nbEcritures: 110_000, graine: g + 77 });
    const actifAvant = (await lots('A')).filter((l) => l.actif).map((l) => l.id);
    const versionAvant = (await api('remi', 'GET', `/v1/dossiers/${d.A.entite}/exercices`)).json[0].versionDonnees;
    const id = (await fec('chloe', 'A', gros)).fin.json.lotImportId;
    // Détection rapide du passage « en cours » (sondage toutes les 40 ms), pour annuler pendant le traitement.
    for (let i = 0; i < 1500; i++) {
      const etat = (await api('remi', 'GET', `/v1/imports/${id}`)).json.statut as string;
      if (etat !== 'en_attente') break;
      await new Promise((r) => setTimeout(r, 40));
    }
    const annulation = await api('remi', 'POST', `/v1/imports/${id}/annulation`, { motif: 'Mauvais fichier, annulé pendant l’import' });
    expect(annulation.statut).toBe(200);
    // Laisse au worker le temps d'atteindre un point de contrôle ou la fin de sa transaction.
    await new Promise((r) => setTimeout(r, 6000));
    const lot = (await api('remi', 'GET', `/v1/imports/${id}`)).json;
    expect(lot).toMatchObject({ statut: 'annule', actif: false });
    if (annulation.json.statutAvantAnnulation === null) {
      // Annulé AVANT la fin : aucune ligne conservée, lot actif et version des données inchangés.
      expect((await lots('A')).filter((l) => l.actif).map((l) => l.id)).toEqual(actifAvant);
      expect((await api('remi', 'GET', `/v1/dossiers/${d.A.entite}/exercices`)).json[0].versionDonnees).toBe(versionAvant);
      expect((await api('remi', 'POST', `/v1/imports/${id}/retablissement`, { motif: 'tentative de rétablissement' })).statut).toBe(409); // jamais abouti
      // Aucune ligne du lot interrompu n'a été conservée.
      expect(lot.progression).toBeLessThan(gros.nbLignes);
      const etats = await api('remi', 'GET', `/v1/exercices/${d.A.exercice}/etats`);
      if (actifAvant.length) expect(etats.json.donnees.lotImportId).toBe(actifAvant[0]);
      else expect(etats.statut).toBe(409); // toujours aucune donnée active
    } else {
      // La machine a été plus rapide que l'annulation : l'import avait abouti, il a été annulé comme un import terminé.
      expect((await lots('A')).filter((l) => l.actif).map((l) => l.id)).toEqual(actifAvant);
    }
    // Le fichier est assez volumineux pour que l'annulation arrive pendant le traitement : c'est ce cas qui doit être exercé.
    expect(annulation.json.statutAvantAnnulation, 'l’import devait être interrompu en cours de traitement').toBeNull();
    console.log(`import en cours : ${annulation.json.statutAvantAnnulation === null ? 'interrompu pendant le traitement' : 'terminé avant l’annulation'} (${gros.nbLignes} lignes)`);
  }, 300_000);
});

describe('annulation réversible d’un relevé bancaire', () => {
  it('un mouvement présent dans deux relevés reste pris en compte tant que l’un des deux est actif', async () => {
    const lignes: LigneFec[] = [];
    await analyserFec(enBlocs(fecPropre.contenu), { surLigne: (l) => void lignes.push(l) });
    const releve = genererReleveSynthetique({ graine: g, format: 'camt.053', debut: EX.debut, fin: EX.fin, nbMouvements: 5000, coherentAvec: lignes });
    // Second fichier : mêmes mouvements, octets différents (un commentaire XML) — comme un relevé retéléchargé.
    const bis = `${releve.contenu}\n<!-- réédition ${SEL} -->\n`;
    const deposerReleve = (contenu: string, nom: string) => deposer('chloe', d.A.entite, Buffer.from(contenu, 'utf8'), { usage: 'banque' }, nom);
    const l1 = (await deposerReleve(releve.contenu, releve.nomFichier)).fin.json.lotImportId;
    expect((await attendreLot('remi', l1)).json.rapport.nbNouveaux).toBe(releve.attendu.nbMouvements);
    const l2 = (await deposerReleve(bis, `bis-${releve.nomFichier}`)).fin.json.lotImportId;
    expect((await attendreLot('remi', l2)).json.rapport).toMatchObject({ nbNouveaux: 0, nbDejaConnus: releve.attendu.nbMouvements });
    const nb = async () => (await api('remi', 'GET', `/v1/dossiers/${d.A.entite}/banque`)).json;
    expect((await nb()).nbMouvements).toBe(releve.attendu.nbMouvements);

    const lance = await api('remi', 'POST', `/v1/exercices/${d.A.exercice}/rapprochements`, {});
    await attendre(() => api('remi', 'GET', `/v1/exercices/${d.A.exercice}/rapprochements`), (r) => r.json?.execution?.id === lance.json.id && r.json.execution.statut === 'termine');

    expect((await api('remi', 'POST', `/v1/imports/${l1}/annulation`, { motif: 'Doublon du relevé' })).json.statut).toBe('annule');
    const apres1 = await nb();
    expect(apres1.nbMouvements).toBe(releve.attendu.nbMouvements); // toujours vus par le second relevé
    expect(apres1.releves.map((r: any) => r.lotImportId)).toEqual([l2]);
    expect((await api('remi', 'GET', `/v1/exercices/${d.A.exercice}/rapprochements`)).json.execution.obsolete).toBe(true);

    expect((await api('remi', 'POST', `/v1/imports/${l2}/annulation`, { motif: 'Relevé d’un autre compte' })).statut).toBe(200);
    expect((await nb()).nbMouvements).toBe(0); // écartés, pas supprimés
    expect((await api('remi', 'POST', `/v1/exercices/${d.A.exercice}/rapprochements`, {})).statut).toBe(409); // plus aucun mouvement pris en compte
    expect((await api('remi', 'POST', `/v1/imports/${l1}/retablissement`, { motif: 'Relevé finalement correct' })).json.actif).toBe(true);
    expect((await nb()).nbMouvements).toBe(releve.attendu.nbMouvements); // revenus intacts
  });
});

describe('campagne d’import sur plusieurs dossiers', () => {
  let campagneId = '';
  let lotD = '';

  it('chaque dossier est traité isolément : un échec n’empêche pas les autres, et le suivi respecte les habilitations', async () => {
    expect((await api('client', 'POST', '/v1/campagnes', { libelle: 'x', type: 'fec' })).statut).toBe(403);
    campagneId = (await api('remi', 'POST', '/v1/campagnes', { libelle: `Balances 2025 — ${SEL}`, type: 'fec' })).json.id;
    expect((await api('bruno', 'GET', `/v1/campagnes/${campagneId}`)).statut).toBe(404);
    // Un relevé bancaire n'entre pas dans une campagne comptable.
    expect((await deposer('remi', d.C.entite, Buffer.from('<Document/>'), { usage: 'banque', campagneId }, 'r.xml')).ouverture.statut).toBe(400);

    const bon = await fec('remi', 'C', genererFecSynthetique({ exercice: EX, nbEcritures: 120, graine: g + 2 }), { campagneId });
    const mauvais = await deposer('remi', d.B.entite, Buffer.from(`fichier illisible ${SEL}\n`), { usage: 'fec', exerciceId: d.B.exercice, statutDonnees: 'fec', campagneId }, 'illisible.txt');
    const cache = await fec('alice', 'D', genererFecSynthetique({ exercice: EX, nbEcritures: 110, graine: g + 3 }), { campagneId });
    lotD = cache.fin.json.lotImportId;
    await attendreLot('remi', bon.fin.json.lotImportId);
    await attendreLot('remi', mauvais.fin.json.lotImportId);
    await attendreLot('alice', lotD);

    const suivi = (await api('remi', 'GET', `/v1/campagnes/${campagneId}`)).json;
    expect(suivi.elements.map((e: any) => [e.entiteId, e.statut]).sort()).toEqual([[d.B.entite, 'echec'], [d.C.entite, expect.stringMatching(/^termine/)]].sort());
    expect(suivi.dossiersHorsHabilitation).toBe(1); // le dossier D existe dans la campagne, sans rien en dire de plus
    expect(suivi.synthese).toMatchObject({ lots: 2, enCours: 0 });
    expect(suivi.elements.find((e: any) => e.entiteId === d.C.entite).rapport).toMatchObject({ lisible: true, suffisantPourTravaux: true });
    expect(suivi.elements.find((e: any) => e.entiteId === d.B.entite).rapport.lisible).toBe(false);
    expect(JSON.stringify(suivi)).not.toContain(d.D.entite);
    // L'échec du dossier B n'a pas touché ses données actives, ni empêché le dossier C d'aboutir.
    expect((await lots('B')).filter((l) => l.actif)).toHaveLength(1);
    expect((await lots('C')).filter((l) => l.actif).map((l) => l.id)).toEqual([bon.fin.json.lotImportId]);
    // Alice (habilitée sur les quatre dossiers) voit les trois éléments.
    expect((await api('alice', 'GET', `/v1/campagnes/${campagneId}`)).json).toMatchObject({ dossiersHorsHabilitation: 0, synthese: { lots: 3 } });
  });

  it('reprise des échecs, clôture, puis annulation de la campagne limitée aux dossiers où l’on est habilité', async () => {
    expect((await api('remi', 'POST', `/v1/campagnes/${campagneId}/reprise-echecs`)).json).toEqual({ repris: 1 });
    await attendre(() => api('remi', 'GET', `/v1/campagnes/${campagneId}`), (r) => r.json.synthese.enCours === 0 && r.json.elements.find((e: any) => e.entiteId === d.B.entite).statut === 'echec');
    expect((await api('remi', 'POST', `/v1/campagnes/${campagneId}/cloture`)).json.statut).toBe('close');
    expect((await fec('remi', 'C', genererFecSynthetique({ exercice: EX, nbEcritures: 100, graine: g + 9 }), { campagneId })).ouverture.statut).toBe(409);

    expect((await api('chloe', 'POST', `/v1/campagnes/${campagneId}/annulation`, { motif: 'Campagne à refaire' })).statut).toBe(400); // aucune habilitation de révision
    expect((await api('remi', 'GET', `/v1/campagnes/${campagneId}`)).json.campagne.statut).toBe('close'); // la tentative sans effet n'a rien changé
    const a = await api('remi', 'POST', `/v1/campagnes/${campagneId}/annulation`, { motif: 'Mauvaise période exportée pour toute la campagne' });
    expect(a.json).toEqual({ annules: 2, laissesFauteHabilitation: 1 });
    expect((await lots('C')).filter((l) => l.actif)).toEqual([]);
    // Le dossier D, hors de l'habilitation de Rémi, n'a pas été touché ; et chaque import reste rétablissable.
    expect((await api('alice', 'GET', `/v1/imports/${lotD}`)).json).toMatchObject({ actif: true, statut: expect.stringMatching(/^termine/) });
    const lotC = (await lots('C'))[0].id;
    expect((await api('remi', 'POST', `/v1/imports/${lotC}/retablissement`, { motif: 'Ce dossier-là était correct' })).json.actif).toBe(true);
    expect((await api('remi', 'GET', `/v1/campagnes/${campagneId}`)).json.campagne.statut).toBe('annulee');
  });
});

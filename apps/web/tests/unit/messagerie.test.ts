import { describe, expect, it } from 'vitest';
import { type ConfigurationMail, codeRetour, corpsDepuis, dateDebutParDefaut, decrireSignalement, estGestionnaire, formulaireDepuis, libelleRaison, lignes, messageRetour } from '@/lib/messagerie';

const A = 'aaaaaaaa-0000-4000-8000-0000000000e1';
const B = 'aaaaaaaa-0000-4000-8000-0000000000e2';
const config = (c: Partial<ConfigurationMail> = {}): ConfigurationMail => ({
  fournisseur: 'gmail',
  boite: { type: 'personnelle' },
  dossiers: [],
  filtres: { expediteursAutorises: [], objetContient: [], avecPieceJointeUniquement: false },
  rattachement: { dossiersComptables: [A, B], regles: [] },
  tailleMaxPieceJointeOctets: 25 * 1024 * 1024,
  ...c,
});

describe('configuration d’une connexion de messagerie', () => {
  it('propose 30 jours avant la connexion quand aucune date n’est choisie', () => {
    expect(dateDebutParDefaut('2026-11-19T10:00:00.000Z')).toBe('2026-10-20');
    expect(formulaireDepuis(config(), '2026-11-19T10:00:00.000Z').dateDebut).toBe('2026-10-20');
    expect(formulaireDepuis(config({ dateDebut: '2026-01-05T00:00:00Z' }), '2026-11-19T10:00:00.000Z').dateDebut).toBe('2026-01-05');
    expect(dateDebutParDefaut('pas une date')).toBe('');
  });
  it('découpe les listes sans doublon ni ligne vide', () => {
    expect(lignes(' a@x.fr \n\nb.fr, a@x.fr ; c.fr\n')).toEqual(['a@x.fr', 'b.fr', 'c.fr']);
    expect(lignes('')).toEqual([]);
  });
  it('aller-retour formulaire → corps : rien n’est perdu ni inventé', () => {
    const c = config({
      dossiers: ['Label_12', 'INBOX'],
      filtres: { expediteursAutorises: ['compta@exemple.fr', 'exemple.org'], objetContient: ['facture'], avecPieceJointeUniquement: true },
      rattachement: { dossiersComptables: [A, B], dossierParDefaut: B, regles: [{ type: 'expediteur', valeur: 'exemple.org', dossierComptable: A }] },
      dateDebut: '2026-02-01T00:00:00Z',
      tailleMaxPieceJointeOctets: 10 * 1024 * 1024,
    });
    const r = corpsDepuis(formulaireDepuis(c, '2026-11-19T10:00:00Z'));
    expect(r).toEqual({ ok: true, corps: { dossiers: c.dossiers, filtres: c.filtres, rattachement: c.rattachement, dateDebut: c.dateDebut, tailleMaxPieceJointeOctets: c.tailleMaxPieceJointeOctets } });
    // Le fournisseur et la boîte ne font pas partie du corps : ils ne peuvent pas être changés ici.
    expect(r.ok && Object.keys(r.corps)).not.toContain('boite');
  });
  it('normalise la casse et omet le dossier par défaut quand il est vide', () => {
    const f = formulaireDepuis(config(), '2026-11-19T10:00:00Z');
    const r = corpsDepuis({ ...f, expediteurs: 'Compta@Exemple.FR', regles: [{ type: 'destinataire', valeur: ' Dupain@Cabinet.test ', dossierComptable: A }] });
    expect(r.ok && r.corps.filtres.expediteursAutorises).toEqual(['compta@exemple.fr']);
    expect(r.ok && r.corps.rattachement.regles).toEqual([{ type: 'destinataire', valeur: 'dupain@cabinet.test', dossierComptable: A }]);
    expect(r.ok && 'dossierParDefaut' in r.corps.rattachement).toBe(false);
  });
  it('refuse localement ce que le schéma de l’API refuserait', () => {
    const f = formulaireDepuis(config(), '2026-11-19T10:00:00Z');
    const erreurs = (m: Partial<typeof f>) => {
      const r = corpsDepuis({ ...f, ...m });
      return r.ok ? [] : r.erreurs;
    };
    expect(erreurs({ dossiersComptables: [] })[0]).toContain('au moins un dossier');
    expect(erreurs({ dossierParDefaut: 'autre' })[0]).toContain('dossier par défaut');
    expect(erreurs({ expediteurs: 'pas une adresse' })[0]).toContain('Expéditeur autorisé invalide');
    expect(erreurs({ regles: [{ type: 'destinataire', valeur: 'exemple.fr', dossierComptable: A }] })[0]).toContain('adresse de destination');
    expect(erreurs({ regles: [{ type: 'expediteur', valeur: 'exemple.fr', dossierComptable: '' }] })[0]).toContain('Règle n° 1');
    expect(erreurs({ dossiersComptables: [B], regles: [{ type: 'expediteur', valeur: 'exemple.fr', dossierComptable: A }] })[0]).toContain('dossiers destinataires');
    for (const t of ['0', '151', '2.5', 'dix', '']) expect(erreurs({ tailleMaxMo: t })[0]).toContain('Taille maximale');
    expect(erreurs({ tailleMaxMo: '150' })).toEqual([]);
    expect(erreurs({ dateDebut: '19/11/2026' })[0]).toContain('Date de début');
  });
});

describe('retour OAuth', () => {
  it('traduit les réponses de l’API en codes d’affichage', () => {
    expect(codeRetour(400, { code: 'refus_fournisseur:access_denied' })).toBe('consentement_refuse');
    for (const c of ['state_invalide', 'state_autre_session', 'demande_expiree', 'demande_inconnue']) expect(codeRetour(400, { code: c })).toBe('state_invalide');
    expect(codeRetour(400, { code: 'scope_refuse' })).toBe('permission_non_accordee');
    expect(codeRetour(503, { code: 'connecteur_non_configure' })).toBe('connecteur_non_configure');
    expect(codeRetour(503, { message: 'x' })).toBe('fournisseur_indisponible');
    expect(codeRetour(403, null)).toBe('reserve_gestionnaires');
    expect(codeRetour(400, { code: 'code_refuse' })).toBe('echec');
    expect(codeRetour(500, 'texte')).toBe('echec');
  });
  it('n’affiche un message que pour un code connu (jamais un texte venu de l’URL)', () => {
    expect(messageRetour('consentement_refuse')).toContain('refusée chez le fournisseur');
    expect(messageRetour('state_invalide')).toContain('expirée');
    expect(messageRetour('<script>alert(1)</script>')).toBeNull();
    expect(messageRetour('constructor')).toBeNull();
    expect(messageRetour(undefined)).toBeNull();
  });
});

describe('libellés', () => {
  it('explique les raisons d’ambiguïté', () => {
    expect(libelleRaison('aucune_regle_applicable')).toContain('Aucune règle');
    expect(libelleRaison('plusieurs_dossiers_possibles')).toContain('Plusieurs dossiers');
    expect(libelleRaison('regle_2:destinataire')).toBe('La règle n° 2 (adresse de destination) s’applique.');
    expect(libelleRaison('inconnue')).toBe('inconnue');
  });
  it('facture derrière un lien : domaine seul, et mention que le lien n’a pas été suivi', () => {
    const d = decrireSignalement({ type: 'facture_derriere_lien', detail: { domaines: ['espace.operateur.test', 'https://piege.test/chemin?jeton=1', 42] } });
    expect(d.precision).toContain('Domaine : espace.operateur.test.');
    expect(d.precision).not.toContain('piege');
    expect(d.precision).toContain('Le lien n’a pas été suivi');
    expect(decrireSignalement({ type: 'facture_derriere_lien', detail: null }).precision).toContain('Le lien n’a pas été suivi');
    expect(decrireSignalement({ type: 'piece_ignoree', detail: { nomFichier: 'a.zip', motif: 'archive' } }).precision).toBe('a.zip — archive.');
  });
  it('seuls administrateur et associé sont gestionnaires', () => {
    expect(['administrateur', 'associe', 'reviseur', 'collaborateur', 'client_deposant', 'client_lecture', 'support'].filter(estGestionnaire)).toEqual(['administrateur', 'associe']);
  });
});

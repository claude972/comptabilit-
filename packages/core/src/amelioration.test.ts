import { describe, expect, it } from 'vitest';
import {
  CRITERES_AMELIORATION,
  type ControleAmelioration,
  type DecisionConstatRevue,
  controlesPourAmelioration,
  fondementControle,
  suggererAmeliorations,
} from './amelioration.js';
import { CATALOGUE_CONTROLES } from './controles/catalogue.js';

const CONTROLES = controlesPourAmelioration(CATALOGUE_CONTROLES);
const MOTIF = 'Avance client conforme au contrat, sans enjeu';
let n = 0;
/** Décision sur un constat ; chaque appel crée une anomalie distincte sauf si `cle` est fournie. */
function decision(p: Partial<DecisionConstatRevue> & { dossierId: string; controleId: string; action: string }): DecisionConstatRevue {
  n += 1;
  return { decisionId: `d${String(n).padStart(4, '0')}`, constatId: `k${n}`, exerciceId: 'ex-2025', executionId: 'x1', cle: `cle-${n}`, motif: MOTIF, montant: '120.00', date: `2026-03-${String((n % 27) + 1).padStart(2, '0')}T10:00:00.000Z`, ...p };
}
const rejets = (dossierId: string, controleId: string, nb: number, plus: Partial<DecisionConstatRevue> = {}) => Array.from({ length: nb }, () => decision({ dossierId, controleId, action: 'rejeter', ...plus }));
const base = { corrections: [], rapprochements: [], controles: CONTROLES };

describe('critères et classification des contrôles', () => {
  it('les critères sont versionnés et déclarés comme conventions internes non validées', () => {
    expect(CRITERES_AMELIORATION.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(CRITERES_AMELIORATION.statut).toContain('non validées');
    expect(CRITERES_AMELIORATION.exceptionDossier.rejetsMotivesMin).toBeGreaterThanOrEqual(3);
    expect(CRITERES_AMELIORATION.preferenceCabinet.dossiersMin).toBeGreaterThanOrEqual(3);
  });

  it('un contrôle réglementaire ou du cycle TVA n’est jamais « interne » ; le paramètre seuil n’est désigné que là où sa sémantique est établie', () => {
    const par = new Map(CONTROLES.map((c) => [c.id, c]));
    expect(par.get('TRE-001')?.fondement).toBe('reglementaire');
    expect(par.get('TVA-001')).toMatchObject({ fondement: 'fiscal', parametreSeuil: null });
    expect(par.get('TVA-002')?.fondement).toBe('fiscal');
    expect(par.get('TIE-001')).toMatchObject({ fondement: 'interne', parametreSeuil: 'seuil', seuilParDefaut: '0.00' });
    expect(par.get('GEN-004')).toMatchObject({ fondement: 'interne', parametreSeuil: null });
    for (const c of CATALOGUE_CONTROLES) if (c.source.type === 'reglementaire') expect(fondementControle(c), c.id).toBe('reglementaire');
    expect(CONTROLES.filter((c) => c.fondement !== 'interne').every((c) => c.parametreSeuil === null)).toBe(true);
  });
});

describe('exception propre à un dossier', () => {
  it('récurrence atteinte : suggestion proposable, avec preuves, décomptes, période, paramètre indicatif et limites', () => {
    const constats = [...rejets('A', 'TIE-001', 2, { montant: '80.00' }), decision({ dossierId: 'A', controleId: 'TIE-001', action: 'rejeter', montant: '450.50', executionId: 'x2' })];
    const r = suggererAmeliorations({ ...base, constats });
    expect(r.sansDecision).toBe(false);
    expect(r.suggestions).toHaveLength(1);
    const s = r.suggestions[0]!;
    expect(s).toMatchObject({ empreinte: 'exception_dossier|TIE-001|A', categorie: 'exception_dossier', controleId: 'TIE-001', dossierIds: ['A'], portee: 'dossier', proposable: true, renvoi: null, dejaEcartee: null });
    expect(s.preuves.decomptes).toEqual({ rejetsMotives: 3, rejetsNonMotives: 0, decisionsContraires: 0, executions: 2, dossiers: 1 });
    expect(s.preuves.decisions.map((d) => d.decisionId).sort()).toEqual(constats.map((d) => d.decisionId).sort());
    expect(s.preuves.decisions.every((d) => d.motif === MOTIF && d.dossierId === 'A')).toBe(true);
    expect(s.preuves.periode).toEqual({ du: [...constats].map((d) => d.date).sort()[0], au: [...constats].map((d) => d.date).sort()[2] });
    // Paramètre : plus grand montant rejeté, en chaîne décimale (jamais un flottant).
    expect(s.parametre).toMatchObject({ cle: 'seuil', valeurParDefaut: '0.00', valeurIndicative: '450.50' });
    expect(s.proposition).toMatchObject({ controleId: 'TIE-001', entiteId: 'A', parametres: { seuil: '450.50' } });
    expect(typeof s.proposition?.parametres.seuil).toBe('string');
    expect(s.critere).toContain(`v${CRITERES_AMELIORATION.version}`);
    expect(s.neFaitPas.join(' ')).toMatch(/N’active rien/);
    expect(s.neFaitPas.join(' ')).toMatch(/AUTRE personne/);
    expect(s.neFaitPas.join(' ')).toMatch(/aucune donnée d’un autre cabinet/);
  });

  it('récurrence non atteinte : deux rejets motivés ne suffisent pas ; ils sont dits « corrections ponctuelles »', () => {
    const r = suggererAmeliorations({ ...base, constats: rejets('A', 'TIE-001', 2) });
    expect(r.suggestions.map((s) => s.categorie)).toEqual(['correction_donnee']);
    expect(r.suggestions[0]).toMatchObject({ proposable: false, proposition: null, parametre: null });
    expect(r.suggestions[0]!.constat).toContain('2 rejet(s) de constat');
    expect(r.suggestions[0]!.neFaitPas[0]).toContain('Ne propose aucune règle');
  });

  it('un rejet sans motif suffisant ne compte pas', () => {
    const r = suggererAmeliorations({ ...base, constats: [...rejets('A', 'TIE-001', 2), decision({ dossierId: 'A', controleId: 'TIE-001', action: 'rejeter', motif: 'ok' }), decision({ dossierId: 'A', controleId: 'TIE-001', action: 'rejeter', motif: null })] });
    expect(r.suggestions.some((s) => s.categorie === 'exception_dossier')).toBe(false);
  });

  it('décisions contradictoires : une acceptation, une confirmation ou une correction dans le dossier bloque la suggestion', () => {
    for (const contraire of ['accepter', 'confirmer_anomalie', 'corriger']) {
      const r = suggererAmeliorations({ ...base, constats: [...rejets('A', 'TIE-001', 4), decision({ dossierId: 'A', controleId: 'TIE-001', action: contraire })] });
      expect(r.suggestions.some((s) => s.proposable), contraire).toBe(false);
    }
    // Une décision contraire dans un AUTRE dossier ne bloque pas l'exception de celui-ci.
    const r = suggererAmeliorations({ ...base, constats: [...rejets('A', 'TIE-001', 3), decision({ dossierId: 'B', controleId: 'TIE-001', action: 'confirmer_anomalie' })] });
    expect(r.suggestions.filter((s) => s.proposable).map((s) => s.empreinte)).toEqual(['exception_dossier|TIE-001|A']);
  });

  it('seule la DERNIÈRE décision d’une même anomalie compte : rejet puis réouverture, ou rejet répété après ré-exécution', () => {
    const k = { dossierId: 'A', controleId: 'TIE-001', cle: 'meme-anomalie' };
    const rouverte = [...rejets('A', 'TIE-001', 2), decision({ ...k, action: 'rejeter', date: '2026-01-01T00:00:00.000Z' }), decision({ ...k, action: 'rouvrir', date: '2026-01-02T00:00:00.000Z' })];
    expect(suggererAmeliorations({ ...base, constats: rouverte }).suggestions.some((s) => s.proposable)).toBe(false);
    // La même anomalie rejetée trois fois (constat recréé à chaque exécution) ne vaut qu'UNE anomalie.
    const repetee = [1, 2, 3].map((i) => decision({ ...k, action: 'rejeter', executionId: `x${i}`, date: `2026-02-0${i}T00:00:00.000Z` }));
    expect(suggererAmeliorations({ ...base, constats: repetee }).suggestions.some((s) => s.proposable)).toBe(false);
    // Rejetée puis confirmée : c'est la confirmation qui vaut, et elle bloque.
    const retournee = [...rejets('A', 'TIE-001', 3), decision({ ...k, action: 'rejeter', date: '2026-01-01T00:00:00.000Z' }), decision({ ...k, action: 'confirmer_anomalie', date: '2026-04-30T00:00:00.000Z' })];
    expect(suggererAmeliorations({ ...base, constats: retournee }).suggestions.some((s) => s.proposable)).toBe(false);
  });

  it('sans montant sur tous les constats, ou pour un contrôle sans seuil établi : aucun paramètre désigné, proposition sans paramètre', () => {
    const sansMontant = suggererAmeliorations({ ...base, constats: [...rejets('A', 'TIE-001', 2), decision({ dossierId: 'A', controleId: 'TIE-001', action: 'rejeter', montant: null })] }).suggestions[0]!;
    expect(sansMontant).toMatchObject({ categorie: 'exception_dossier', parametre: null, proposition: { parametres: {} } });
    const sansSeuil = suggererAmeliorations({ ...base, constats: rejets('A', 'GEN-004', 3) }).suggestions[0]!;
    expect(sansSeuil).toMatchObject({ categorie: 'exception_dossier', controleId: 'GEN-004', parametre: null, proposable: true });
  });
});

describe('préférence du cabinet', () => {
  it('récurrence sur plusieurs dossiers : une seule suggestion de cabinet, qui remplace les exceptions de dossier', () => {
    const constats = [...rejets('A', 'TIE-001', 3), ...rejets('B', 'TIE-001', 2, { montant: '900.00' }), ...rejets('C', 'TIE-001', 1)];
    const r = suggererAmeliorations({ ...base, constats });
    expect(r.suggestions.map((s) => s.empreinte)).toEqual(['preference_cabinet|TIE-001']);
    expect(r.suggestions[0]).toMatchObject({ categorie: 'preference_cabinet', portee: 'cabinet', proposable: true, dossierIds: ['A', 'B', 'C'], proposition: { entiteId: null, parametres: { seuil: '900.00' } } });
    expect(r.suggestions[0]!.preuves.decomptes).toMatchObject({ rejetsMotives: 6, dossiers: 3 });
  });

  it('deux dossiers seulement, ou une décision contraire dans le cabinet : pas de préférence de cabinet (l’exception de dossier reste possible)', () => {
    const deux = suggererAmeliorations({ ...base, constats: [...rejets('A', 'TIE-001', 3), ...rejets('B', 'TIE-001', 3)] });
    expect(deux.suggestions.map((s) => s.empreinte)).toEqual(['exception_dossier|TIE-001|A', 'exception_dossier|TIE-001|B']);
    const contraire = suggererAmeliorations({ ...base, constats: [...rejets('A', 'TIE-001', 3), ...rejets('B', 'TIE-001', 2), ...rejets('C', 'TIE-001', 1), decision({ dossierId: 'D', controleId: 'TIE-001', action: 'accepter' })] });
    expect(contraire.suggestions.filter((s) => s.proposable).map((s) => s.empreinte)).toEqual(['exception_dossier|TIE-001|A']);
  });
});

describe('contrôles à fondement réglementaire ou fiscal', () => {
  it('jamais de règle de cabinet : renvoi vers la veille, avec la référence et le motif, sans proposition ni paramètre', () => {
    for (const controleId of ['TRE-001', 'TVA-001']) {
      const r = suggererAmeliorations({ ...base, constats: [...rejets('A', controleId, 4), ...rejets('B', controleId, 3), ...rejets('C', controleId, 3)] });
      expect(r.suggestions).toHaveLength(1);
      const s = r.suggestions[0]!;
      expect(s, controleId).toMatchObject({ empreinte: `modification_regle_reglementaire|${controleId}`, categorie: 'modification_regle_reglementaire', proposable: false, renvoi: 'veille', proposition: null, parametre: null, portee: null, dossierIds: ['A', 'B', 'C'] });
      expect(s.constat).toContain(CONTROLES.find((c) => c.id === controleId)!.reference);
      expect(s.neFaitPas[0]).toContain('Ne propose AUCUNE règle de cabinet');
      expect(s.neFaitPas.join(' ')).toContain('veille réglementaire');
    }
  });

  it('aucune suggestion proposable ne porte sur un contrôle non interne, quel que soit le volume de rejets', () => {
    const constats = CONTROLES.flatMap((c) => ['A', 'B', 'C', 'D'].flatMap((d) => rejets(d, c.id, 5)));
    const r = suggererAmeliorations({ ...base, constats });
    const internes = new Set(CONTROLES.filter((c) => c.fondement === 'interne').map((c) => c.id));
    for (const s of r.suggestions.filter((x) => x.proposable)) expect(internes.has(s.controleId ?? '')).toBe(true);
    expect(r.suggestions.filter((s) => s.categorie === 'modification_regle_reglementaire').map((s) => s.controleId).sort()).toEqual(CONTROLES.filter((c) => c.fondement !== 'interne').map((c) => c.id).sort());
  });
});

describe('nouvelle règle métier : simple signalement', () => {
  it('corrections répétées d’un même champ pour un même émetteur : signalement à instruire par l’éditeur, rien n’est créé ni transmis', () => {
    const piece = (i: number, emetteur: string | null, champs: string[]) => ({ documentId: `doc-${i}`, dossierId: i % 2 ? 'A' : 'B', emetteur, emetteurLibelle: emetteur ? 'Papeterie Durand' : null, champs, date: `2026-02-0${i}T00:00:00.000Z` });
    const r = suggererAmeliorations({ ...base, constats: [], corrections: [piece(1, 'siren:552100554', ['totalTtc', 'numero']), piece(2, 'siren:552100554', ['totalTtc']), piece(3, 'siren:552100554', ['totalTtc']), piece(4, null, ['totalTtc']), piece(5, 'siren:111111118', ['totalTtc'])] });
    expect(r.suggestions.map((s) => s.categorie)).toEqual(['nouvelle_regle_metier', 'correction_donnee']);
    const s = r.suggestions[0]!;
    expect(s).toMatchObject({ empreinte: 'nouvelle_regle_metier|extraction|siren:552100554|totalTtc', proposable: false, renvoi: 'editeur', proposition: null, dossierIds: ['A', 'B'] });
    expect(s.preuves.decomptes).toEqual({ piecesCorrigees: 3, dossiers: 2 });
    expect(s.neFaitPas.join(' ')).toContain('Ne transmet rien à l’éditeur');
    // Le champ « numero » (une pièce), l'émetteur inconnu et l'autre émetteur restent des corrections ponctuelles.
    expect(r.suggestions[1]!.preuves.decomptes.champsCorriges).toBe(3);
  });

  it('rapprochements d’une même règle rejetés avec motif dans un dossier, sans aucune validation', () => {
    const rappro = (i: number, action: string, regle = 'montant_date', dossierId = 'A') => ({ decisionId: `r${i}`, rapprochementId: `rap-${i}`, dossierId, regle, action, motif: action === 'rejeter' ? 'Écriture sans lien avec ce mouvement' : null, date: `2026-02-${String(i).padStart(2, '0')}T00:00:00.000Z` });
    const cinq = [1, 2, 3, 4, 5].map((i) => rappro(i, 'rejeter'));
    const r = suggererAmeliorations({ ...base, constats: [], rapprochements: cinq });
    expect(r.suggestions).toHaveLength(1);
    expect(r.suggestions[0]).toMatchObject({ empreinte: 'nouvelle_regle_metier|rapprochement|montant_date|A', categorie: 'nouvelle_regle_metier', proposable: false, renvoi: 'editeur' });
    // Une validation par la même règle dans le dossier : plus de signalement.
    expect(suggererAmeliorations({ ...base, constats: [], rapprochements: [...cinq, rappro(6, 'valider')] }).suggestions.map((s) => s.categorie)).toEqual(['correction_donnee']);
    // Un rejet remis en proposition ne compte plus.
    const remis = [...cinq.slice(0, 4), rappro(5, 'rejeter'), { ...rappro(5, 'remettre_en_proposition'), decisionId: 'r5b', date: '2026-03-01T00:00:00.000Z' }];
    expect(suggererAmeliorations({ ...base, constats: [], rapprochements: remis }).suggestions.some((s) => s.categorie === 'nouvelle_regle_metier')).toBe(false);
  });
});

describe('suggestions écartées et règles déjà en cours', () => {
  it('une suggestion écartée n’est pas reproposée à l’identique ; elle revient si des décisions postérieures atteignent seules le seuil', () => {
    const anciens = rejets('A', 'TIE-001', 3, { date: '2026-01-10T00:00:00.000Z' });
    const ecartee = { empreinte: 'exception_dossier|TIE-001|A', le: '2026-02-01T00:00:00.000Z', motif: 'Cas particuliers, pas une règle' };
    const maintenue = suggererAmeliorations({ ...base, constats: anciens, ecartees: [ecartee] });
    expect(maintenue.suggestions.some((s) => s.proposable)).toBe(false);
    expect(maintenue.ecarteesMaintenues).toEqual([ecartee]);
    const deuxNouveaux = suggererAmeliorations({ ...base, constats: [...anciens, ...rejets('A', 'TIE-001', 2, { date: '2026-03-10T00:00:00.000Z' })], ecartees: [ecartee] });
    expect(deuxNouveaux.suggestions.some((s) => s.proposable)).toBe(false);
    const revenue = suggererAmeliorations({ ...base, constats: [...anciens, ...rejets('A', 'TIE-001', 3, { date: '2026-03-10T00:00:00.000Z' })], ecartees: [ecartee] });
    expect(revenue.suggestions[0]).toMatchObject({ empreinte: ecartee.empreinte, proposable: true, dejaEcartee: { le: ecartee.le, motif: ecartee.motif } });
    expect(revenue.ecarteesMaintenues).toEqual([]);
  });

  it('aucune suggestion redondante quand une règle est déjà proposée ou approuvée pour la même cible', () => {
    const r = suggererAmeliorations({ ...base, constats: rejets('A', 'TIE-001', 3), reglesEnCours: ['exception_dossier|TIE-001|A'] });
    expect(r.suggestions.some((s) => s.proposable)).toBe(false);
    expect(r.dejaEnCours).toEqual(['exception_dossier|TIE-001|A']);
    // Préférence de cabinet déjà en cours : ni préférence, ni exceptions de dossier pour ce contrôle.
    const cabinet = suggererAmeliorations({ ...base, constats: [...rejets('A', 'TIE-001', 3), ...rejets('B', 'TIE-001', 2), ...rejets('C', 'TIE-001', 1)], reglesEnCours: ['preference_cabinet|TIE-001'] });
    expect(cabinet.suggestions.some((s) => s.proposable)).toBe(false);
  });
});

describe('cas limites', () => {
  it('cabinet sans décision : aucune suggestion, et c’est dit', () => {
    expect(suggererAmeliorations({ ...base, constats: [] })).toMatchObject({ suggestions: [], sansDecision: true, ecarteesMaintenues: [], dejaEnCours: [] });
  });

  it('déterministe : l’ordre des décisions en entrée ne change pas le résultat ; contrôle inconnu ignoré', () => {
    const constats = [...rejets('B', 'TIE-002', 3), ...rejets('A', 'TIE-001', 3), ...rejets('A', 'ZZZ-999', 5)];
    const a = suggererAmeliorations({ ...base, constats });
    const b = suggererAmeliorations({ ...base, constats: [...constats].reverse() });
    expect(b).toEqual(a);
    expect(a.suggestions.filter((s) => s.proposable).map((s) => s.empreinte)).toEqual(['exception_dossier|TIE-001|A', 'exception_dossier|TIE-002|B']);
    expect(a.suggestions.some((s) => s.controleId === 'ZZZ-999')).toBe(false);
  });

  it('les preuves listées sont bornées, et le reste est décompté', () => {
    const r = suggererAmeliorations({ ...base, constats: rejets('A', 'TIE-001', 27) });
    expect(r.suggestions[0]!.preuves.decisions).toHaveLength(20);
    expect(r.suggestions[0]!.preuves.decisionsNonListees).toBe(7);
    expect(r.suggestions[0]!.preuves.decomptes.rejetsMotives).toBe(27);
  });
});

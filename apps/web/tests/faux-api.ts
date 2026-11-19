/**
 * ╔══════════════════════════════════════════════════════════════════════════════════════════════╗
 * ║  SIMULATEUR DE TEST de l'API métier Comtaple — NE JAMAIS UTILISER HORS DES TESTS.            ║
 * ║  Données fictives en mémoire, aucun stockage, aucun traitement réel (ni antivirus, ni OCR,   ║
 * ║  ni analyse de FEC, ni contrôles). Lancé uniquement par Playwright (`API_URL` pointant ici). ║
 * ╚══════════════════════════════════════════════════════════════════════════════════════════════╝
 *
 * Il reproduit les routes, les codes de statut et les formes de réponses lus dans
 * `apps/api/src/*.controller.ts` (et les règles d'accès de `acces.ts` / des politiques RLS), pour tester les écrans
 * quand l'API réelle n'est pas démarrée. Les jetons sont de VRAIS jetons du Keycloak de développement, vérifiés
 * comme le fait l'API (signature, émetteur, audience).
 *
 * Les routes `/__test/*` n'existent pas dans l'API : elles servent à réinitialiser l'état et à provoquer des pannes.
 * Les traitements asynchrones du worker (import, contrôles, dossier de révision) sont imités par des minuteries.
 */
import { createHash, randomUUID } from 'node:crypto';
import http from 'node:http';
import {
  type LigneEcriture, type LigneFec, type MouvementBancaire, PARAMETRES_RAPPROCHEMENT_PAR_DEFAUT, REGLES_RAPPROCHEMENT, type RapportReleve, analyserFec, decoderTexteReleve, detecterFormatReleve, elementDepuisMouvement,
  elementsBanqueDepuisEcritures, enBlocs, lireCamt053, lireCsvBanque, lireOfx, proposerProfilCsv, rapprocher, schemaParametresRapprochement, schemaProfilCsvBanque,
} from '@comtaple/core';
import { createRemoteJWKSet, jwtVerify } from 'jose';

const PORT = Number(process.env.FAUX_API_PORT ?? 4100);
const EMETTEUR = (process.env.OIDC_ISSUER ?? '').replace(/\/+$/, '');
const AUDIENCE = process.env.OIDC_AUDIENCE ?? 'comtaple-api';
const TAILLE_MORCEAU = Number(process.env.TAILLE_MORCEAU ?? 4 * 1024 * 1024);
const TAILLE_MAX_PIECE = 50 * 1024 * 1024;
const DELAI_WORKER_MS = Number(process.env.FAUX_API_DELAI_MS ?? 1200);
if (!EMETTEUR) throw new Error('OIDC_ISSUER requis pour le simulateur');

type Niveau = 'depot' | 'lecture' | 'collaboration' | 'revision' | 'validation';
const ORDRE: Niveau[] = ['depot', 'lecture', 'collaboration', 'revision', 'validation'];
const auMoins = (n: Niveau, min: Niveau) => ORDRE.indexOf(n) >= ORDRE.indexOf(min);

class ErreurHttp extends Error {
  statut: number;
  corps: Record<string, unknown> | string;
  constructor(statut: number, corps: Record<string, unknown> | string) {
    super(typeof corps === 'string' ? corps : String(corps.message));
    this.statut = statut;
    this.corps = corps;
  }
}
const NOMS: Record<number, string> = { 400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found', 409: 'Conflict', 413: 'Payload Too Large', 422: 'Unprocessable Entity' };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function exigerUuid(v: string | undefined, nom = 'identifiant'): string {
  if (!v || !UUID.test(v)) throw new ErreurHttp(400, `${nom} invalide`);
  return v;
}

// ───────────── Données de démonstration (mêmes identifiants que packages/db/src/amorcer.ts) ─────────────
const DEMO = {
  cabinetA: 'aaaaaaaa-0000-4000-8000-000000000001',
  cabinetB: 'bbbbbbbb-0000-4000-8000-000000000001',
  alice: '11111111-1111-4111-8111-111111111101',
  remi: '11111111-1111-4111-8111-111111111102',
  chloe: '11111111-1111-4111-8111-111111111103',
  client: '11111111-1111-4111-8111-111111111104',
  bruno: '22222222-2222-4222-8222-222222222201',
  dupain: 'aaaaaaaa-0000-4000-8000-0000000000e1',
  martin: 'aaaaaaaa-0000-4000-8000-0000000000e2',
  leroy: 'bbbbbbbb-0000-4000-8000-0000000000e1',
  exDupain2025: 'aaaaaaaa-0000-4000-8000-0000000000f1',
  exMartin2025: 'aaaaaaaa-0000-4000-8000-0000000000f2',
  exLeroy2025: 'bbbbbbbb-0000-4000-8000-0000000000f1',
} as const;

const CABINETS = [
  { id: DEMO.cabinetA, nom: 'Cabinet Alpha Expertise (fictif)', siren: null, creeLe: '2026-11-19T00:00:00.000Z' },
  { id: DEMO.cabinetB, nom: 'Cabinet Bêta Conseil (fictif)', siren: null, creeLe: '2026-11-19T00:00:00.000Z' },
];
const UTILISATEURS = [
  { id: DEMO.alice, email: 'alice.admin@cabinet-a.test', nom: 'Alice Admin', cabinetId: DEMO.cabinetA, role: 'administrateur' },
  { id: DEMO.remi, email: 'remi.reviseur@cabinet-a.test', nom: 'Rémi Réviseur', cabinetId: DEMO.cabinetA, role: 'reviseur' },
  { id: DEMO.chloe, email: 'chloe.collab@cabinet-a.test', nom: 'Chloé Collab', cabinetId: DEMO.cabinetA, role: 'collaborateur' },
  { id: DEMO.client, email: 'client.depot@client-a.test', nom: 'Camille Client', cabinetId: DEMO.cabinetA, role: 'client_deposant' },
  { id: DEMO.bruno, email: 'bruno.admin@cabinet-b.test', nom: 'Bruno Admin', cabinetId: DEMO.cabinetB, role: 'administrateur' },
];
const ENTITES_INITIALES: Enr0[] = [
  { id: DEMO.dupain, cabinetId: DEMO.cabinetA, raisonSociale: 'Boulangerie Dupain SAS (fictive)', formeJuridique: 'SAS' },
  { id: DEMO.martin, cabinetId: DEMO.cabinetA, raisonSociale: 'Garage Martin SARL (fictif)', formeJuridique: 'SARL' },
  { id: DEMO.leroy, cabinetId: DEMO.cabinetB, raisonSociale: 'Menuiserie Leroy SAS (fictive)', formeJuridique: 'SAS' },
];
const HABILITATIONS_INITIALES: Array<{ entiteId: string; utilisateurId: string; niveau: Niveau }> = [
  { entiteId: DEMO.dupain, utilisateurId: DEMO.alice, niveau: 'validation' },
  { entiteId: DEMO.dupain, utilisateurId: DEMO.remi, niveau: 'revision' },
  { entiteId: DEMO.martin, utilisateurId: DEMO.remi, niveau: 'revision' },
  { entiteId: DEMO.dupain, utilisateurId: DEMO.chloe, niveau: 'collaboration' },
  { entiteId: DEMO.dupain, utilisateurId: DEMO.client, niveau: 'depot' },
  { entiteId: DEMO.leroy, utilisateurId: DEMO.bruno, niveau: 'validation' },
];

type Enr0 = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
/** Dossiers, habilitations et appartenances supplémentaires : modifiables par les routes d'administration, remis à zéro entre les tests. */
let ENTITES: Enr0[] = structuredClone(ENTITES_INITIALES);
let HABILITATIONS = structuredClone(HABILITATIONS_INITIALES);
/** Appartenances ajoutées par un test (compte multi-cabinets : aucun compte de démonstration n'en a plusieurs). */
let APPARTENANCES_EN_PLUS: Array<{ utilisateurId: string; cabinetId: string; role: string }> = [];
const appartenancesDe = (utilisateurId: string) => [
  ...UTILISATEURS.filter((u) => u.id === utilisateurId).map((u) => ({ cabinetId: u.cabinetId as string, role: u.role })),
  ...APPARTENANCES_EN_PLUS.filter((x) => x.utilisateurId === utilisateurId).map((x) => ({ cabinetId: x.cabinetId, role: x.role })),
];

interface Acces {
  cabinetId: string;
  utilisateurId: string;
  role: string;
  email: string;
  nom: string;
}

// ───────────── État en mémoire ─────────────
type Enr = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
interface Etat {
  exercices: Enr[];
  fichiers: Enr[];
  contenus: Map<string, Buffer>;
  documents: Enr[];
  receptions: Enr[];
  extractions: Enr[];
  echanges: Enr[];
  televersements: Enr[];
  morceaux: Map<string, Map<number, Buffer>>;
  lots: Enr[];
  executions: Enr[];
  resultats: Enr[];
  constats: Enr[];
  lignes: Enr[];
  decisions: Enr[];
  exports: Enr[];
  fichiersExports: Map<string, Buffer>;
  releves: Enr[];
  mouvements: Enr[];
  rapprochementsExec: Enr[];
  propositions: Enr[];
}
let etat: Etat;
/** Pannes programmées par les tests (routes /__test/pannes). */
let pannes = { couperMorceauNumero: 0, conflitMorceauNumero: 0, ralentirMorceauxMs: 0, erreurTerminer: 0 };
let compteurMorceaux = 0;
let journal: Array<{ methode: string; chemin: string; statut: number; utilisateur: string | null }> = [];
let horloge = Date.parse('2026-11-18T08:00:00.000Z');
const instant = () => new Date((horloge += 1000)).toISOString();

const sha256 = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');

/** PDF minimal valide d'une page (contenu fictif). */
function pdfFictif(texte: string): Buffer {
  const objets = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    '',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  const flux = `BT /F1 18 Tf 60 760 Td (${texte.replace(/[()\\]/g, '')}) Tj ET`;
  objets[3] = `<< /Length ${flux.length} >>\nstream\n${flux}\nendstream`;
  let corps = '%PDF-1.4\n';
  const positions: number[] = [];
  objets.forEach((o, i) => {
    positions.push(corps.length);
    corps += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = corps.length;
  corps += `xref\n0 ${objets.length + 1}\n0000000000 65535 f \n${positions.map((p) => `${String(p).padStart(10, '0')} 00000 n \n`).join('')}`;
  corps += `trailer\n<< /Size ${objets.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(corps, 'latin1');
}
/** PNG 1×1 valide. */
const PNG_FICTIF = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==', 'base64');

const champ = (valeur: string, page: number | null, extrait: string | null, methode = 'regle') => ({ valeur, page, extrait, boite: null, methode, confiance: 'non_evaluee' });
const SOURCE_INTERNE = { type: 'interne', reference: 'Méthode de révision Comtaple (contrôle de cohérence interne).', url: null, dateVerification: null, verification: 'sans_objet', periodeApplication: null };
const SOURCE_CAISSE = {
  type: 'reglementaire',
  reference: 'PCG (règlement ANC n° 2014-03), art. 1215-53 « 53 : Caisse » : « Son solde est soit débiteur soit nul. »',
  url: 'https://www.anc.gouv.fr/files/anc/files/1_Normes_fran%C3%A7aises/Plans%20comptables/2026/PCG--1er-janvier-2026.pdf',
  dateVerification: '2026-11-19',
  verification: 'verifiee',
  periodeApplication: 'Règlement ANC n° 2014-03, version consolidée au 1er janvier 2026.',
};
const CATALOGUE = [
  ['GEN_001', 'general', 'Équilibre des écritures', SOURCE_INTERNE],
  ['GEN_002', 'general', 'Comptes d’attente non soldés', SOURCE_INTERNE],
  ['GEN_003', 'general', 'Écritures hors exercice', SOURCE_INTERNE],
  ['GEN_004', 'general', 'Doublons d’écritures', SOURCE_INTERNE],
  ['GEN_005', 'general', 'Écritures à montant rond élevé', SOURCE_INTERNE],
  ['TRE_001', 'tresorerie', 'Caisse créditrice', SOURCE_CAISSE],
  ['TRE_002', 'tresorerie', 'Banques créditrices non reclassées', SOURCE_INTERNE],
  ['TIE_001', 'clients', 'Clients créditeurs', SOURCE_INTERNE],
  ['TIE_002', 'fournisseurs', 'Fournisseurs débiteurs', SOURCE_INTERNE],
  ['TIE_003', 'clients', 'Créances anciennes non lettrées', SOURCE_INTERNE],
  ['CAP_001', 'capitaux_propres', 'Comptes courants d’associés débiteurs', SOURCE_INTERNE],
  ['TVA_001', 'tva', 'Cohérence TVA collectée / chiffre d’affaires', SOURCE_INTERNE],
] as const;
const STATUTS_FIXES: Record<string, [string, string | null]> = {
  GEN_001: ['sans_anomalie', null],
  GEN_002: ['constat', null],
  GEN_003: ['sans_anomalie', null],
  GEN_004: ['non_applicable', 'Aucune écriture candidate dans le périmètre du contrôle.'],
  GEN_005: ['sans_anomalie', null],
  TRE_001: ['constat', null],
  TRE_002: ['sans_anomalie', null],
  TIE_001: ['constat', null],
  TIE_002: ['sans_anomalie', null],
  TIE_003: ['non_realise', 'Dates de lettrage absentes du fichier importé : contrôle non réalisable.'],
  CAP_001: ['erreur', 'Erreur pendant l’exécution du contrôle : paramètre invalide.'],
  TVA_001: ['non_realise', 'Aucune écriture de TVA collectée dans les données importées.'],
};

function rapportFec(nomFichier: string, nbAnomalies: number) {
  const anomalies = Array.from({ length: nbAnomalies }, (_, i) => ({
    ligne: i + 2,
    colonne: i % 2 ? 'PieceDate' : 'EcritureLib',
    code: i % 2 ? 'DATE_INVALIDE' : 'CHAMP_VIDE',
    gravite: i % 2 ? 'majeure' : 'mineure',
    message: i % 2 ? `Date de pièce invalide (ligne ${i + 2}).` : `Libellé d’écriture vide (ligne ${i + 2}).`,
  }));
  return {
    nomFichier,
    encodage: 'utf-8',
    separateur: 'tabulation',
    variante: 'debit_credit',
    entetes: ['JournalCode', 'JournalLib', 'EcritureNum', 'EcritureDate', 'CompteNum', 'CompteLib', 'CompAuxNum', 'CompAuxLib', 'PieceRef', 'PieceDate', 'EcritureLib', 'Debit', 'Credit', 'EcritureLet', 'DateLet', 'ValidDate', 'Montantdevise', 'Idevise'],
    nbLignesLues: 1250,
    nbLignesNormalisees: 1250,
    anomalies,
    nbAnomaliesParCode: nbAnomalies ? { CHAMP_VIDE: Math.ceil(nbAnomalies / 2), DATE_INVALIDE: Math.floor(nbAnomalies / 2) } : {},
    lisible: true,
    conforme: nbAnomalies === 0,
    suffisantPourTravaux: true,
    totalDebit: '1234567.89',
    totalCredit: '1234567.89',
    dateMin: '2025-01-02',
    dateMax: '2025-12-31',
    referentiel: {
      type: 'reglementaire',
      reference: 'Livre des procédures fiscales, article A47 A-1.',
      url: 'https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000027804775',
      dateVerification: '2026-11-19',
      verification: 'verifiee',
      periodeApplication: 'Version en vigueur depuis le 2 août 2013.',
      sourcesComplementaires: [],
      controlesImplementes: [{ code: 'CHAMP_VIDE', description: 'Champ obligatoire vide', ecartAuReferentiel: true }],
      controlesNonImplementes: ['Contrôle de la continuité de la numérotation des écritures'],
    },
  };
}

function creerExecution(e: Etat, exerciceId: string, entiteId: string, lotImportId: string, versionDonnees: number, statut: string): Enr {
  const execution = { id: randomUUID(), cabinetId: DEMO.cabinetA, entiteId, exerciceId, lotImportId, versionDonnees, statut, obsolete: false, lancePar: DEMO.chloe, creeLe: instant(), termineLe: statut === 'termine' ? instant() : null };
  e.executions.push(execution);
  return execution;
}

function produireResultats(e: Etat, execution: Enr): void {
  const lignes = e.lignes.filter((l) => l.lotImportId === execution.lotImportId);
  const precedents = e.constats.filter((c) => c.exerciceId === execution.exerciceId && c.executionId !== execution.id);
  for (const [controleId, cycle, titre, source] of CATALOGUE) {
    const [statut, motif] = STATUTS_FIXES[controleId]!;
    const resultat = { id: randomUUID(), cabinetId: execution.cabinetId, entiteId: execution.entiteId, executionId: execution.id, controleId, versionControle: '1.0.0', statut, motif, parametres: {}, mesures: {}, source: { ...source, titre, cycle } };
    e.resultats.push(resultat);
    if (statut !== 'constat') continue;
    const modele = {
      GEN_002: { cle: '471000', gravite: 'moyenne', titre: 'Compte d’attente 471000 non soldé en fin d’exercice', montant: '1520.00', explication: 'Le compte 471000 présente un solde débiteur à la clôture.', actionProposee: 'Reclasser les opérations dans les comptes définitifs.' },
      TRE_001: { cle: '530000', gravite: 'critique', titre: 'Caisse créditrice au 14/03/2025', montant: '-320.50', explication: 'Le solde du compte 530000 devient créditeur, ce qui est impossible pour une caisse.', actionProposee: 'Rechercher une recette non enregistrée ou une erreur de date.' },
      TIE_001: { cle: '411DUPONT', gravite: 'faible', titre: 'Client 411DUPONT créditeur', montant: '89.90', explication: 'Le compte auxiliaire présente un solde créditeur.', actionProposee: 'Vérifier un avoir ou un double règlement.' },
    }[controleId as 'GEN_002' | 'TRE_001' | 'TIE_001'];
    const ancien = precedents.filter((c) => c.controleId === controleId && c.cle === modele.cle).at(-1);
    const reporte = ancien && ancien.statutRevue !== 'a_examiner';
    e.constats.push({
      id: randomUUID(),
      cabinetId: execution.cabinetId,
      entiteId: execution.entiteId,
      exerciceId: execution.exerciceId,
      executionId: execution.id,
      resultatId: resultat.id,
      controleId,
      ...modele,
      lignesConcernees: controleId === 'TRE_001' ? lignes.slice(0, 3).map((l) => l.id) : [],
      preuves: [
        { libelle: 'Compte', valeur: modele.cle },
        { libelle: 'Solde constaté', valeur: modele.montant },
      ],
      statutRevue: reporte ? ancien.statutRevue : 'a_examiner',
      affecteA: ancien?.affecteA ?? null,
      aRevoir: Boolean(reporte),
      creeLe: instant(),
    });
  }
}

function etatInitial(): Etat {
  horloge = Date.parse('2026-11-18T08:00:00.000Z');
  const e: Etat = {
    exercices: [
      { id: DEMO.exDupain2025, cabinetId: DEMO.cabinetA, entiteId: DEMO.dupain, debut: '2025-01-01', fin: '2025-12-31', statut: 'ouvert', versionDonnees: 2, creeLe: instant() },
      { id: DEMO.exMartin2025, cabinetId: DEMO.cabinetA, entiteId: DEMO.martin, debut: '2025-01-01', fin: '2025-12-31', statut: 'ouvert', versionDonnees: 0, creeLe: instant() },
      { id: DEMO.exLeroy2025, cabinetId: DEMO.cabinetB, entiteId: DEMO.leroy, debut: '2025-01-01', fin: '2025-12-31', statut: 'ouvert', versionDonnees: 0, creeLe: instant() },
    ],
    fichiers: [], contenus: new Map(), documents: [], receptions: [], extractions: [], echanges: [], televersements: [], morceaux: new Map(),
    lots: [], executions: [], resultats: [], constats: [], lignes: [], decisions: [], exports: [], fichiersExports: new Map(), releves: [], mouvements: [], rapprochementsExec: [], propositions: [],
  };
  const piece = (nom: string, contenu: Buffer, type: string | null, antivirus: string, statut: string, nature: string, deposant: string, canal: string, motifStatut: string | null = null) => {
    const fichier = { id: randomUUID(), cabinetId: DEMO.cabinetA, sha256: sha256(contenu), taille: contenu.length, typeMimeDeclare: type, typeMimeDetecte: type, cleStockage: `fictif/${nom}`, nature: 'original', analyseAntivirus: antivirus };
    e.fichiers.push(fichier);
    e.contenus.set(fichier.id, contenu);
    const creeLe = instant();
    const doc = { id: randomUUID(), cabinetId: DEMO.cabinetA, entiteId: DEMO.dupain, exerciceId: null, fichierId: fichier.id, nature, statut, nomOrigine: nom, commentaire: null as string | null, version: 1, remplaceDocumentId: null, nbPages: type === 'application/pdf' ? 1 : null, motifStatut, creeLe, majLe: creeLe };
    e.documents.push(doc);
    e.receptions.push({ id: randomUUID(), cabinetId: DEMO.cabinetA, entiteId: DEMO.dupain, documentId: doc.id, canal, deposantId: deposant, doublonBinaire: false, provenance: {}, recuLe: creeLe });
    return doc;
  };
  const d1 = piece('facture-meunerie-2025-03.pdf', pdfFictif('Facture fictive Meunerie du Moulin'), 'application/pdf', 'sain', 'a_controler', 'facture_achat', DEMO.client, 'telephone');
  d1.commentaire = 'Facture de farine de mars';
  e.extractions.push({
    id: randomUUID(), cabinetId: DEMO.cabinetA, entiteId: DEMO.dupain, documentId: d1.id, version: 1, methode: 'couche_texte', moteur: 'pdfjs-dist ; IA : non connectée',
    champs: {
      typeDocument: champ('facture', 1, 'FACTURE'), numero: champ('FA-2025-0312', 1, 'Facture n° FA-2025-0312'), dateEmission: champ('2025-03-12', 1, 'Date : 12/03/2025'), dateEcheance: null,
      emetteurNom: champ('Meunerie du Moulin (fictive)', 1, 'Meunerie du Moulin'), emetteurSiren: null, emetteurSiret: null, emetteurTva: null,
      totalHt: champ('1234.56', 1, 'Total HT 1 234,56'), totalTva: champ('67.90', 1, 'TVA 5,5 % 67,90'), totalTtc: champ('1302.50', 1, 'Total TTC 1 302,50'), devise: champ('EUR', 1, '€'),
      ventilationTva: [{ taux: '5.5', base: '1234.56', montant: '67.90' }],
    },
    verifications: [
      { code: 'TOTAUX_HT_TVA_TTC', statut: 'ecart', message: 'Total HT + total TVA = total TTC : écart de 0.04 (attendu 1302.46, constaté 1302.50).', ecart: '0.04' },
      { code: 'VENTILATION_TOTAL_HT', statut: 'ok', message: 'Somme des bases de la ventilation = total HT : cohérent.', ecart: '0.00' },
      { code: 'IDENTIFIANTS', statut: 'non_verifiable', message: 'SIREN de l’émetteur non extrait : contrôle de clé non vérifiable.', ecart: null },
    ],
    statut: 'projet', actuelle: true, creeLe: instant(),
  });
  const d2 = piece('photo-ticket-caisse.png', PNG_FICTIF, 'image/png', 'sain', 'a_completer', 'a_qualifier', DEMO.client, 'telephone', 'Pièce illisible ou incomplète : merci de la photographier à nouveau');
  e.echanges.push({ id: randomUUID(), cabinetId: DEMO.cabinetA, entiteId: DEMO.dupain, documentId: d2.id, type: 'demande_complement', message: 'Le bas du ticket est coupé : pouvez-vous le reprendre en photo en entier ?', auteurId: DEMO.chloe, resolu: false, creeLe: instant() });
  piece('facture-electronique.xml', Buffer.from('<Invoice>fictif</Invoice>'), null, 'non_analyse', 'recu', 'a_qualifier', DEMO.chloe, 'ordinateur', 'Analyse antivirus en attente (service indisponible)');
  const d4 = piece('facture-levure-2025-02.pdf', pdfFictif('Facture fictive Levures Martin'), 'application/pdf', 'sain', 'traite', 'facture_achat', DEMO.client, 'telephone');
  e.extractions.push({
    id: randomUUID(), cabinetId: DEMO.cabinetA, entiteId: DEMO.dupain, documentId: d4.id, version: 2, methode: 'saisie_humaine', moteur: null,
    champs: { typeDocument: champ('facture', null, null, 'structure'), numero: champ('F-88', null, null, 'structure'), totalHt: champ('100.00', null, null, 'structure'), totalTva: champ('5.50', null, null, 'structure'), totalTtc: champ('105.50', null, null, 'saisie_humaine'), devise: champ('EUR', null, null, 'structure'), ventilationTva: [] },
    verifications: [{ code: 'TOTAUX_HT_TVA_TTC', statut: 'ok', message: 'Total HT + total TVA = total TTC : cohérent.', ecart: '0.00' }],
    statut: 'valide', actuelle: true, creeLe: instant(),
  });

  // Comptabilité de l'exercice Dupain 2025 : deux versions importées, la seconde active.
  const lot = (version: number, actif: boolean, statutDonnees: string, nom: string, nbAnomalies: number) => {
    const creeLe = instant();
    const l = { id: randomUUID(), cabinetId: DEMO.cabinetA, entiteId: DEMO.dupain, exerciceId: DEMO.exDupain2025, type: 'fec', statutDonnees, fichierId: null, cleIdempotence: `fec:${DEMO.exDupain2025}:${version}`, version, remplaceLotId: null, actif, statut: nbAnomalies ? 'termine_avec_erreurs' : 'termine', progression: 1250, rapport: rapportFec(nom, nbAnomalies), lancePar: DEMO.chloe, creeLe, termineLe: instant() };
    e.lots.push(l);
    return l;
  };
  lot(1, false, 'travail_avant_cloture', 'extraction-travail-2025-10.txt', 120);
  const actif = lot(2, true, 'fec', '123456789FEC20251231.txt', 0);
  const ligne = (n: number, compte: string, lib: string, debit: string, credit: string) => ({
    id: randomUUID(), cabinetId: DEMO.cabinetA, entiteId: DEMO.dupain, exerciceId: DEMO.exDupain2025, lotImportId: actif.id, numeroLigne: n, journalCode: 'CA', journalLib: 'Caisse', ecritureNum: `CA${n}`,
    ecritureDate: '2025-03-14', compteNum: compte, compteLib: lib, compAuxNum: null, compAuxLib: null, pieceRef: `TK-${n}`, pieceDate: '2025-03-14',
    ecritureLib: n === 12 ? 'Retrait espèces <script>alert(1)</script>' : 'Vente comptoir', debit, credit, ecritureLet: null, dateLet: null, validDate: '2025-03-31', montantDevise: null, idevise: null,
  });
  e.lignes.push(ligne(11, '530000', 'Caisse', '0.00', '500.00'), ligne(12, '580000', 'Virements internes', '500.00', '0.00'), ligne(13, '530000', 'Caisse', '179.50', '0.00'));
  const execution = creerExecution(e, DEMO.exDupain2025, DEMO.dupain, actif.id, 2, 'termine');
  produireResultats(e, execution);
  const tie = e.constats.find((c) => c.controleId === 'TIE_001')!;
  tie.statutRevue = 'accepte';
  tie.aRevoir = true;
  e.decisions.push({ cibleType: 'constat', cibleId: tie.id, action: 'accepter', motif: 'Avoir à établir en janvier, montant non significatif.', versionCible: 1, creeLe: instant(), auteurId: DEMO.remi });
  const exp = { id: randomUUID(), cabinetId: DEMO.cabinetA, entiteId: DEMO.dupain, exerciceId: DEMO.exDupain2025, executionId: execution.id, versionDonnees: 2, statut: 'termine', mention: 'projet', clePdf: 'fictif/pdf', cleDonnees: 'fictif/json', sha256Pdf: null, sha256Donnees: null, erreur: null, demandePar: DEMO.chloe, creeLe: instant(), termineLe: instant() };
  e.exports.push(exp);
  e.fichiersExports.set(`${exp.id}:pdf`, pdfFictif('Dossier de revision PROJET fictif'));
  e.fichiersExports.set(`${exp.id}:donnees`, Buffer.from(JSON.stringify({ mention: 'projet', exerciceId: DEMO.exDupain2025 })));
  return e;
}
etat = etatInitial();

// ───────────── Accès (calqué sur apps/api/src/acces.ts) ─────────────
const jwks = createRemoteJWKSet(new URL(`${EMETTEUR}/protocol/openid-connect/certs`));
async function authentifier(req: http.IncomingMessage, sansCabinet = false): Promise<Acces> {
  const entete = req.headers.authorization;
  if (!entete?.startsWith('Bearer ')) throw new ErreurHttp(401, 'Jeton manquant');
  let sujet: string;
  try {
    const { payload } = await jwtVerify(entete.slice(7), jwks, { issuer: EMETTEUR, audience: AUDIENCE, algorithms: ['RS256', 'ES256', 'PS256'] });
    if (!payload.sub) throw new Error('sub absent');
    sujet = payload.sub;
  } catch {
    throw new ErreurHttp(401, 'Jeton invalide ou expiré');
  }
  const u = UTILISATEURS.find((x) => x.id === sujet);
  if (!u) throw new ErreurHttp(403, 'Compte non rattaché à un cabinet');
  const appartenances = appartenancesDe(u.id);
  const demande = req.headers['x-cabinet-id'];
  let choisie = appartenances.length === 1 ? appartenances[0] : undefined;
  if (typeof demande === 'string' && demande) {
    choisie = appartenances.find((x) => x.cabinetId === demande);
    if (!choisie) throw new ErreurHttp(403, 'Cabinet non autorisé');
  }
  if (!choisie) {
    if (sansCabinet) return { cabinetId: '', utilisateurId: u.id, role: '', email: u.email, nom: u.nom };
    throw new ErreurHttp(400, 'Plusieurs cabinets : préciser l’en-tête X-Cabinet-Id');
  }
  return { cabinetId: choisie.cabinetId, utilisateurId: u.id, role: choisie.role, email: u.email, nom: u.nom };
}
function niveauSur(a: Acces, entiteId: string): Niveau | null {
  const entite = ENTITES.find((x) => x.id === entiteId && x.cabinetId === a.cabinetId);
  if (!entite) return null;
  return HABILITATIONS.find((h) => h.entiteId === entiteId && h.utilisateurId === a.utilisateurId)?.niveau ?? null;
}
function exigerNiveau(a: Acces, entiteId: string, minimum: Niveau): Niveau {
  const n = niveauSur(a, entiteId);
  if (!n) throw new ErreurHttp(404, 'Dossier introuvable');
  if (!auMoins(n, minimum)) throw new ErreurHttp(403, 'Habilitation insuffisante sur ce dossier');
  return n;
}
/** Politique RLS des tables de révision : ligne invisible sans niveau « lecture ». */
const visibleEnLecture = (a: Acces, entiteId: string) => {
  const n = niveauSur(a, entiteId);
  return !!n && auMoins(n, 'lecture');
};
const nomDe = (id: string) => UTILISATEURS.find((u) => u.id === id)?.nom ?? '?';

function chargerDocument(a: Acces, id: string): { doc: Enr; niveau: Niveau } {
  const doc = etat.documents.find((d) => d.id === id && d.cabinetId === a.cabinetId && niveauSur(a, d.entiteId));
  if (!doc) throw new ErreurHttp(404, 'Document introuvable');
  const niveau = exigerNiveau(a, doc.entiteId, 'depot');
  if (niveau === 'depot' && !etat.receptions.some((r) => r.documentId === id && r.deposantId === a.utilisateurId)) throw new ErreurHttp(404, 'Document introuvable');
  return { doc, niveau };
}
function chargerTeleversement(a: Acces, id: string): Enr {
  const t = etat.televersements.find((x) => x.id === id && x.cabinetId === a.cabinetId);
  if (!t) throw new ErreurHttp(404, 'Téléversement introuvable');
  if (t.utilisateurId !== a.utilisateurId) throw new ErreurHttp(403, 'Ce téléversement appartient à un autre utilisateur');
  return t;
}
const vueT = (t: Enr) => ({ id: t.id, statut: t.statut, octetsRecus: t.octetsRecus, tailleAttendue: t.tailleAttendue, tailleMorceau: TAILLE_MORCEAU, documentId: t.documentId, lotImportId: t.lotImportId, expireLe: t.expireLe });
function chargerExercice(a: Acces, id: string, minimum: Niveau): Enr {
  const ex = etat.exercices.find((x) => x.id === id && x.cabinetId === a.cabinetId && visibleEnLecture(a, x.entiteId));
  if (!ex) throw new ErreurHttp(404, 'Exercice introuvable');
  exigerNiveau(a, ex.entiteId, minimum);
  return ex;
}

// ───────────── Validation des corps (mêmes contraintes que les schémas Zod des contrôleurs) ─────────────
const NATURES = ['facture_achat', 'facture_vente', 'avoir', 'releve_bancaire', 'lettre_mission', 'contrat', 'autre', 'a_qualifier'];
const invalide = (champ: string, probleme: string) => new ErreurHttp(400, { message: 'Requête invalide', erreurs: [{ champ, probleme }] });
const DECIMAL = /^-?\d{1,13}(\.\d{1,6})?$/;
const ACTIONS: Record<string, { statut: string | null; niveau: Niveau; motifRequis: boolean }> = {
  prendre_en_charge: { statut: 'en_cours', niveau: 'collaboration', motifRequis: false },
  affecter: { statut: null, niveau: 'collaboration', motifRequis: false },
  commenter: { statut: null, niveau: 'collaboration', motifRequis: true },
  demander_piece: { statut: 'piece_demandee', niveau: 'collaboration', motifRequis: true },
  corriger: { statut: 'corrige', niveau: 'collaboration', motifRequis: true },
  accepter: { statut: 'accepte', niveau: 'revision', motifRequis: true },
  rejeter: { statut: 'rejete', niveau: 'revision', motifRequis: true },
  confirmer_anomalie: { statut: 'anomalie_confirmee', niveau: 'revision', motifRequis: true },
  cloturer: { statut: 'cloture', niveau: 'revision', motifRequis: true },
  rouvrir: { statut: 'a_examiner', niveau: 'revision', motifRequis: true },
};

/** Vérification arithmétique réduite au seul contrôle HT + TVA = TTC (le moteur réel est dans @comtaple/core). */
function verifier(champs: Enr): Enr[] {
  const v = (n: string) => (champs[n] && DECIMAL.test(champs[n].valeur) ? centimes(champs[n].valeur) : null);
  const ht = v('totalHt');
  const tva = v('totalTva');
  const ttc = v('totalTtc');
  if (ht === null || tva === null || ttc === null) return [{ code: 'TOTAUX_HT_TVA_TTC', statut: 'non_verifiable', message: 'Total HT, total TVA ou total TTC non extrait : égalité HT + TVA = TTC non vérifiable.', ecart: null }];
  const ecart = ttc - (ht + tva);
  return ecart === 0n
    ? [{ code: 'TOTAUX_HT_TVA_TTC', statut: 'ok', message: 'Total HT + total TVA = total TTC : cohérent.', ecart: '0.00' }]
    : [{ code: 'TOTAUX_HT_TVA_TTC', statut: 'ecart', message: `Total HT + total TVA = total TTC : écart de ${versDecimal(ecart)}.`, ecart: versDecimal(ecart) }];
}
/** Montant décimal → millionièmes en entier (aucun flottant). */
function centimes(v: string): bigint {
  const [entier = '0', dec = ''] = v.replace('-', '').split('.');
  const n = BigInt(entier) * 1_000_000n + BigInt(dec.padEnd(6, '0'));
  return v.startsWith('-') ? -n : n;
}
function versDecimal(n: bigint): string {
  const abs = n < 0n ? -n : n;
  const dec = String(abs % 1_000_000n).padStart(6, '0').replace(/0{1,4}$/, '');
  return `${n < 0n ? '-' : ''}${abs / 1_000_000n}.${dec}`;
}

// ───────────── Routes ─────────────
interface Requete {
  methode: string;
  segments: string[];
  query: URLSearchParams;
  corps: Buffer;
  json: () => Enr;
  req: http.IncomingMessage;
  res: http.ServerResponse;
}

async function routerV1(r: Requete): Promise<unknown> {
  const { methode: m, segments: s } = r;
  const chemin = s.join('/');
  if (m === 'GET' && chemin === 'sante') return { statut: 'ok' };
  const a = await authentifier(r.req, m === 'GET' && chemin === 'cabinets');
  (r.req as Enr).utilisateur = a.nom;
  if (m === 'GET' && chemin === 'cabinets') {
    return appartenancesDe(a.utilisateurId).map((x) => ({ id: x.cabinetId, nom: CABINETS.find((c) => c.id === x.cabinetId)!.nom, role: x.role })).sort((x, y) => x.nom.localeCompare(y.nom));
  }
  {
    const admin = routerAdministration(r, a);
    if (admin !== undefined || r.res.writableEnded) return admin;
    const banque = routerBanque(r, a);
    if (banque !== undefined) return banque;
  }

  if (m === 'GET' && chemin === 'moi') return { utilisateur: { id: a.utilisateurId, nom: a.nom, email: a.email }, cabinet: CABINETS.find((c) => c.id === a.cabinetId), role: a.role };
  if (m === 'GET' && chemin === 'dossiers') {
    const gestionnaire = a.role === 'administrateur' || a.role === 'associe';
    return ENTITES.filter((e) => e.cabinetId === a.cabinetId && (gestionnaire || niveauSur(a, e.id)))
      .map((e) => ({ id: e.id, raisonSociale: e.raisonSociale, formeJuridique: e.formeJuridique ?? null, regimeFiscal: e.regimeFiscal ?? 'IS', territoireFiscal: e.territoireFiscal ?? 'metropole', niveau: niveauSur(a, e.id) }))
      .sort((x, y) => x.raisonSociale.localeCompare(y.raisonSociale));
  }
  if (m === 'GET' && s[0] === 'dossiers' && s[2] === 'exercices' && s.length === 3) {
    const entiteId = exigerUuid(s[1]);
    exigerNiveau(a, entiteId, 'lecture');
    return etat.exercices.filter((x) => x.entiteId === entiteId).sort((x, y) => y.debut.localeCompare(x.debut));
  }
  if (m === 'GET' && chemin === 'integrations') {
    const messagerie = (f: string) => ({ statut: 'non_connecte', detail: mail.configure ? 'Simulateur de test : aucune connexion réelle.' : DETAIL_NON_CONFIGURE[f] });
    return {
      antivirus: { statut: 'indisponible', obligatoire: true }, ocr: { statut: 'indisponible', detail: 'injoignable' }, ia: { statut: 'non_connecte', detail: 'Aucun traitement n’appelle l’IA à ce jour.' },
      messagerie: { gmail: messagerie('gmail'), microsoft365: messagerie('microsoft') },
      agregationBancaire: { statut: 'non_implemente', detail: 'Aucun prestataire choisi. Les imports de fichiers bancaires n’en dépendent pas.' },
    };
  }
  if (s[0] === 'mail' && s[1] !== 'notifications') return routerMail(r, a);
  if (m === 'GET' && chemin === 'reference/controles') {
    return CATALOGUE.map(([id, cycle, titre, source]) => ({
      id, version: '1.0.0', cycle, titre, objectif: `Objectif fictif du contrôle ${id}.`, perimetre: 'Écritures de l’exercice.', donneesObligatoires: ['CompteNum', 'Debit', 'Credit'],
      logique: 'Logique déterministe décrite dans le catalogue réel.', parametresParDefaut: id === 'GEN_005' ? { seuil: '10000.00' } : {}, exceptions: 'Aucune.', source, resultatsAttendus: 'Un constat par compte concerné.',
    }));
  }

  // ── Téléversements ──
  if (s[0] === 'televersements') {
    if (m === 'POST' && s.length === 1) {
      const d = r.json();
      if (typeof d.entiteId !== 'string' || !UUID.test(d.entiteId)) throw invalide('entiteId', 'identifiant invalide');
      if (typeof d.nomFichier !== 'string' || !d.nomFichier || d.nomFichier.length > 255) throw invalide('nomFichier', 'chaîne de 1 à 255 caractères attendue');
      if (!Number.isInteger(d.taille) || d.taille <= 0) throw invalide('taille', 'entier positif attendu');
      if (typeof d.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(d.sha256)) throw invalide('sha256', 'empreinte SHA-256 hexadécimale attendue');
      if (d.canal !== 'telephone' && d.canal !== 'ordinateur') throw invalide('canal', 'valeur inconnue');
      const usage = d.usage ?? 'piece';
      if (usage !== 'piece' && usage !== 'fec' && usage !== 'banque') throw invalide('usage', 'valeur inconnue');
      if (d.profilCsv !== undefined && (typeof d.profilCsv !== 'object' || d.profilCsv === null || Array.isArray(d.profilCsv))) throw invalide('profilCsv', 'objet attendu');
      const nature = d.nature ?? 'a_qualifier';
      if (!NATURES.includes(nature)) throw invalide('nature', 'valeur inconnue');
      if (d.commentaire !== undefined && (typeof d.commentaire !== 'string' || d.commentaire.length > 2000)) throw invalide('commentaire', 'trop long');
      if (d.statutDonnees !== undefined && !['travail_avant_cloture', 'fec'].includes(d.statutDonnees)) throw invalide('statutDonnees', 'valeur inconnue');
      if (d.taille > TAILLE_MAX_PIECE * (usage === 'fec' ? 10 : 1)) throw new ErreurHttp(413, 'Fichier trop volumineux');
      if (usage === 'fec' && (!d.exerciceId || !d.statutDonnees)) throw new ErreurHttp(400, 'exerciceId et statutDonnees sont requis pour un import comptable');
      exigerNiveau(a, d.entiteId, usage === 'piece' ? 'depot' : 'collaboration');
      if (d.exerciceId && !etat.exercices.some((x) => x.id === d.exerciceId && x.entiteId === d.entiteId)) throw new ErreurHttp(404, 'Exercice introuvable pour ce dossier');
      const existant = etat.televersements.findLast((t) => t.entiteId === d.entiteId && t.utilisateurId === a.utilisateurId && t.sha256Attendu === d.sha256 && t.usage === usage && t.statut === 'ouvert');
      if (existant && existant.tailleAttendue === d.taille) return vueT(existant);
      const t = {
        id: randomUUID(), cabinetId: a.cabinetId, entiteId: d.entiteId, utilisateurId: a.utilisateurId, canal: d.canal, nomFichier: d.nomFichier, typeMimeDeclare: d.typeMime ?? null, tailleAttendue: d.taille,
        sha256Attendu: d.sha256, octetsRecus: 0, nature, commentaire: d.commentaire ?? null, usage, exerciceId: d.exerciceId ?? null, statutDonnees: d.statutDonnees ?? null, parametres: d.profilCsv ? { profilCsv: d.profilCsv } : null, lotImportId: null, statut: 'ouvert', documentId: null,
        creeLe: instant(), expireLe: new Date(Date.now() + 7 * 86400_000).toISOString(),
      };
      etat.televersements.push(t);
      etat.morceaux.set(t.id, new Map());
      r.res.statusCode = 201;
      return vueT(t);
    }
    const id = exigerUuid(s[1]);
    if (m === 'GET' && s.length === 2) return vueT(chargerTeleversement(a, id));
    if (m === 'DELETE' && s.length === 2) {
      const t = chargerTeleversement(a, id);
      if (t.statut === 'complet') throw new ErreurHttp(409, 'Ce téléversement est terminé : la pièce a été reçue et ne peut pas être retirée ici');
      if (t.statut === 'ouvert') {
        etat.morceaux.delete(t.id);
        t.statut = 'abandonne';
      }
      return null;
    }
    if (m === 'PUT' && s[2] === 'morceaux' && s.length === 3) {
      const decalage = Number(r.query.get('decalage'));
      if (!Number.isSafeInteger(decalage) || decalage < 0) throw new ErreurHttp(400, 'decalage invalide');
      if (r.req.headers['content-type'] !== 'application/octet-stream' || r.corps.length === 0) throw new ErreurHttp(400, 'Corps binaire attendu (application/octet-stream)');
      if (r.corps.length > TAILLE_MORCEAU) throw new ErreurHttp(413, 'Morceau trop volumineux');
      const t = chargerTeleversement(a, id);
      compteurMorceaux++;
      if (pannes.ralentirMorceauxMs) await new Promise((ok) => setTimeout(ok, pannes.ralentirMorceauxMs));
      if (pannes.conflitMorceauNumero === compteurMorceaux) throw new ErreurHttp(409, { message: 'Décalage inattendu', octetsRecus: t.octetsRecus });
      if (t.statut !== 'ouvert') throw new ErreurHttp(409, { message: 'Téléversement clos', statut: t.statut });
      if (decalage + r.corps.length <= t.octetsRecus) return vueT(t);
      if (decalage !== t.octetsRecus) throw new ErreurHttp(409, { message: 'Décalage inattendu', octetsRecus: t.octetsRecus });
      if (decalage + r.corps.length > t.tailleAttendue) throw new ErreurHttp(400, 'Dépassement de la taille annoncée');
      etat.morceaux.get(t.id)!.set(decalage, r.corps);
      t.octetsRecus = decalage + r.corps.length;
      if (pannes.couperMorceauNumero === compteurMorceaux) {
        // Coupure APRÈS enregistrement : le client ne reçoit pas la confirmation (cas le plus piégeux).
        r.req.socket.destroy();
        return undefined;
      }
      return vueT(t);
    }
    if (m === 'POST' && s[2] === 'terminer' && s.length === 3) {
      const t = chargerTeleversement(a, id);
      if (pannes.erreurTerminer > 0) {
        pannes.erreurTerminer--;
        throw new ErreurHttp(503, 'Service indisponible (panne simulée)');
      }
      let doublonBinaire = false;
      let dejaImporte = false;
      if (t.statut === 'complet') {
        doublonBinaire = Boolean(t.doublonBinaire);
        dejaImporte = Boolean(t.dejaImporte);
      }
      if (t.statut !== 'complet') {
        if (t.statut !== 'ouvert') throw new ErreurHttp(409, { message: 'Téléversement clos', statut: t.statut });
        if (t.octetsRecus !== t.tailleAttendue) throw new ErreurHttp(409, { message: 'Téléversement incomplet', octetsRecus: t.octetsRecus, tailleAttendue: t.tailleAttendue });
        const contenu = Buffer.concat([...etat.morceaux.get(t.id)!.entries()].sort((x, y) => x[0] - y[0]).map((x) => x[1]));
        etat.morceaux.delete(t.id);
        const empreinte = sha256(contenu);
        if (contenu.length !== t.tailleAttendue || empreinte !== t.sha256Attendu) {
          t.statut = 'refuse';
          throw new ErreurHttp(422, 'Le fichier reçu ne correspond pas à l’empreinte annoncée : dépôt refusé, à recommencer.');
        }
        let fichier = etat.fichiers.find((f) => f.cabinetId === a.cabinetId && f.sha256 === empreinte);
        if (!fichier) {
          // Pas de worker ici : le fichier reste « non analysé » (aperçu indisponible), comme avant le passage de l'antivirus.
          fichier = { id: randomUUID(), cabinetId: a.cabinetId, sha256: empreinte, taille: contenu.length, typeMimeDeclare: t.typeMimeDeclare, typeMimeDetecte: null, cleStockage: `fictif/${empreinte}`, nature: 'original', analyseAntivirus: 'non_analyse' };
          etat.fichiers.push(fichier);
          etat.contenus.set(fichier.id, contenu);
        }
        if (t.usage === 'fec') {
          const cle = `fec:${t.exerciceId}:${empreinte}`;
          let lot = etat.lots.find((l) => l.cleIdempotence === cle);
          dejaImporte = Boolean(lot);
          if (!lot) {
            const max = Math.max(0, ...etat.lots.filter((l) => l.exerciceId === t.exerciceId).map((l) => l.version));
            lot = { id: randomUUID(), cabinetId: a.cabinetId, entiteId: t.entiteId, exerciceId: t.exerciceId, type: 'fec', statutDonnees: t.statutDonnees, fichierId: fichier.id, cleIdempotence: cle, version: max + 1, remplaceLotId: null, actif: false, statut: 'en_attente', progression: 0, rapport: { nomFichier: t.nomFichier }, lancePar: a.utilisateurId, creeLe: instant(), termineLe: null };
            etat.lots.push(lot);
            imiterImport(lot.id);
          }
          t.lotImportId = lot.id;
        } else if (t.usage === 'banque') {
          const cle = `banque:${t.entiteId}:${empreinte}`;
          let lot = etat.lots.find((l) => l.cleIdempotence === cle);
          dejaImporte = Boolean(lot);
          if (!lot) {
            lot = { id: randomUUID(), cabinetId: a.cabinetId, entiteId: t.entiteId, exerciceId: null, type: 'releve_bancaire', statutDonnees: null, fichierId: fichier.id, cleIdempotence: cle, version: 1, remplaceLotId: null, actif: false, statut: 'en_attente', progression: 0, rapport: { nomFichier: t.nomFichier, ...(t.parametres ?? {}) }, lancePar: a.utilisateurId, creeLe: instant(), termineLe: null };
            etat.lots.push(lot);
            imiterReleve(lot.id);
          }
          t.lotImportId = lot.id;
        } else {
          let doc = etat.documents.find((d) => d.entiteId === t.entiteId && d.fichierId === fichier.id);
          doublonBinaire = Boolean(doc);
          if (!doc) {
            const creeLe = instant();
            doc = { id: randomUUID(), cabinetId: a.cabinetId, entiteId: t.entiteId, exerciceId: null, fichierId: fichier.id, nature: t.nature, statut: 'recu', nomOrigine: t.nomFichier, commentaire: t.commentaire, version: 1, remplaceDocumentId: null, nbPages: null, motifStatut: null, creeLe, majLe: creeLe };
            etat.documents.push(doc);
          }
          etat.receptions.push({ id: randomUUID(), cabinetId: a.cabinetId, entiteId: t.entiteId, documentId: doc.id, canal: t.canal, deposantId: a.utilisateurId, doublonBinaire, provenance: { televersementId: t.id }, recuLe: instant() });
          t.documentId = doc.id;
        }
        Object.assign(t, { statut: 'complet', doublonBinaire, dejaImporte });
      }
      return { ...vueT(t), recu: true, doublonBinaire, dejaImporte };
    }
  }

  // ── Documents ──
  if (s[0] === 'documents') {
    if (m === 'GET' && s.length === 1) {
      const entiteId = exigerUuid(r.query.get('entiteId') ?? undefined, 'entiteId');
      const statut = r.query.get('statut');
      if (statut && !['recu', 'en_analyse', 'a_completer', 'a_controler', 'traite', 'quarantaine', 'rejete'].includes(statut)) throw new ErreurHttp(400, 'statut inconnu');
      const niveau = exigerNiveau(a, entiteId, 'depot');
      const documents = etat.documents
        .filter((d) => d.entiteId === entiteId && (!statut || d.statut === statut) && ((niveau !== 'depot' && r.query.get('deposant') !== 'moi') || etat.receptions.some((x) => x.documentId === d.id && x.deposantId === a.utilisateurId)))
        .sort((x, y) => y.creeLe.localeCompare(x.creeLe))
        .map((d) => ({
          id: d.id, nomOrigine: d.nomOrigine, nature: d.nature, statut: d.statut, motifStatut: d.motifStatut, creeLe: d.creeLe, majLe: d.majLe,
          nbReceptions: etat.receptions.filter((x) => x.documentId === d.id).length,
          demandesOuvertes: etat.echanges.filter((x) => x.documentId === d.id && x.type === 'demande_complement' && !x.resolu).length,
        }));
      const page = Math.max(Number(r.query.get('page')) || 1, 1);
      const TAILLE = 100;
      return { niveau, page, taillePage: TAILLE, suite: documents.length > page * TAILLE, documents: documents.slice((page - 1) * TAILLE, page * TAILLE) };
    }
    const id = exigerUuid(s[1]);
    if (m === 'GET' && s.length === 2) {
      const { doc, niveau } = chargerDocument(a, id);
      const f = etat.fichiers.find((x) => x.id === doc.fichierId);
      return {
        niveau,
        document: doc,
        fichier: f && { sha256: f.sha256, taille: f.taille, typeMimeDetecte: f.typeMimeDetecte, analyseAntivirus: f.analyseAntivirus },
        receptions: etat.receptions.filter((x) => x.documentId === id).map((x) => ({ id: x.id, canal: x.canal, recuLe: x.recuLe, doublonBinaire: x.doublonBinaire, parMoi: x.deposantId === a.utilisateurId })),
        extraction: etat.extractions.find((x) => x.documentId === id && x.actuelle) ?? null,
        echanges: etat.echanges.filter((x) => x.documentId === id).map((x) => ({ id: x.id, type: x.type, message: x.message, resolu: x.resolu, creeLe: x.creeLe, auteur: nomDe(x.auteurId) })),
      };
    }
    if (m === 'GET' && s[2] === 'contenu' && s.length === 3) {
      const { doc } = chargerDocument(a, id);
      const f = etat.fichiers.find((x) => x.id === doc.fichierId);
      if (!f) throw new ErreurHttp(404, 'Fichier introuvable');
      if (f.analyseAntivirus !== 'sain') throw new ErreurHttp(409, 'Fichier indisponible : analyse antivirus non concluante ou en attente');
      const sur = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/tiff'];
      const type = f.typeMimeDetecte && sur.includes(f.typeMimeDetecte) ? f.typeMimeDetecte : 'application/octet-stream';
      r.res.writeHead(200, {
        'Content-Type': type, 'Content-Length': String(f.taille), 'Content-Disposition': type === 'application/octet-stream' ? 'attachment' : 'inline',
        'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox",
      });
      r.res.end(etat.contenus.get(f.id));
      return undefined;
    }
    if (m === 'POST' && s[2] === 'echanges' && s.length === 3) {
      const d = r.json();
      if (!['signalement_erreur', 'demande_complement', 'reponse'].includes(d.type)) throw invalide('type', 'valeur inconnue');
      if (typeof d.message !== 'string' || d.message.length < 1 || d.message.length > 4000) throw invalide('message', 'chaîne de 1 à 4000 caractères attendue');
      const { doc, niveau } = chargerDocument(a, id);
      if (d.type === 'demande_complement' && !auMoins(niveau, 'collaboration')) throw new ErreurHttp(403, 'Seul un collaborateur habilité peut demander un complément');
      const e = { id: randomUUID(), cabinetId: a.cabinetId, entiteId: doc.entiteId, documentId: id, type: d.type, message: d.message, auteurId: a.utilisateurId, resolu: false, creeLe: instant() };
      etat.echanges.push(e);
      if (d.type === 'demande_complement') Object.assign(doc, { statut: 'a_completer', majLe: instant() });
      if (d.type === 'reponse') {
        for (const x of etat.echanges) if (x.documentId === id && x.type === 'demande_complement') x.resolu = true;
        if (doc.statut === 'a_completer') Object.assign(doc, { statut: 'a_controler', majLe: instant() });
      }
      r.res.statusCode = 201;
      return e;
    }
    if (m === 'PATCH' && s.length === 2) {
      const d = r.json();
      if (d.nature === undefined && d.exerciceId === undefined) throw invalide('', 'aucune modification');
      if (d.nature !== undefined && !NATURES.includes(d.nature)) throw invalide('nature', 'valeur inconnue');
      if (d.exerciceId !== undefined && d.exerciceId !== null && !UUID.test(d.exerciceId)) throw invalide('exerciceId', 'identifiant invalide');
      const { doc } = chargerDocument(a, id);
      exigerNiveau(a, doc.entiteId, 'collaboration');
      if (d.exerciceId && !etat.exercices.some((x) => x.id === d.exerciceId && x.entiteId === doc.entiteId)) throw new ErreurHttp(404, 'Exercice introuvable pour ce dossier');
      if (d.nature) doc.nature = d.nature;
      if (d.exerciceId !== undefined) doc.exerciceId = d.exerciceId;
      doc.majLe = instant();
      return doc;
    }
    if (m === 'PUT' && s[2] === 'extraction' && s.length === 3) {
      const d = r.json();
      const champs = d.champs;
      const permis = ['typeDocument', 'numero', 'dateEmission', 'dateEcheance', 'emetteurNom', 'emetteurSiren', 'emetteurSiret', 'emetteurTva', 'totalHt', 'totalTva', 'totalTtc', 'devise'];
      if (!champs || typeof champs !== 'object' || Object.keys(champs).length === 0) throw invalide('champs', 'au moins un champ à corriger');
      for (const [nom, valeur] of Object.entries(champs)) {
        if (!permis.includes(nom) || typeof valeur !== 'string') throw invalide(`champs.${nom}`, 'champ inconnu ou valeur invalide');
        if (nom.startsWith('total') && !DECIMAL.test(valeur)) throw invalide(`champs.${nom}`, 'Montant invalide : attendu une chaîne décimale du type "1234.56"');
        if (nom.startsWith('date') && !/^\d{4}-\d{2}-\d{2}$/.test(valeur)) throw invalide(`champs.${nom}`, 'date AAAA-MM-JJ attendue');
        if (nom === 'devise' && valeur.length !== 3) throw invalide('champs.devise', '3 caractères attendus');
        if (nom === 'typeDocument' && !['facture', 'avoir', 'inconnu'].includes(valeur)) throw invalide('champs.typeDocument', 'valeur inconnue');
      }
      const { doc } = chargerDocument(a, id);
      exigerNiveau(a, doc.entiteId, 'collaboration');
      const actuelle = etat.extractions.find((x) => x.documentId === id && x.actuelle);
      const nouveaux: Enr = { ...(actuelle?.champs ?? { ventilationTva: [] }) };
      for (const [nom, valeur] of Object.entries(champs)) nouveaux[nom] = { valeur, page: null, extrait: null, boite: null, methode: 'saisie_humaine', confiance: 'non_evaluee', corrigePar: a.utilisateurId };
      if (actuelle) actuelle.actuelle = false;
      const nouvelle = { id: randomUUID(), cabinetId: a.cabinetId, entiteId: doc.entiteId, documentId: id, version: (actuelle?.version ?? 0) + 1, methode: 'saisie_humaine', moteur: null, champs: nouveaux, verifications: verifier(nouveaux), statut: 'projet', actuelle: true, creeLe: instant() };
      etat.extractions.push(nouvelle);
      return nouvelle;
    }
    if (m === 'POST' && s[2] === 'validation' && s.length === 3) {
      const d = r.json();
      if (d.decision !== 'valider' && d.decision !== 'rejeter') throw invalide('decision', 'valeur inconnue');
      if (d.motif !== undefined && (typeof d.motif !== 'string' || d.motif.length > 2000)) throw invalide('motif', 'trop long');
      if (d.decision === 'rejeter' && !d.motif) throw new ErreurHttp(400, 'Un motif est requis pour rejeter');
      const { doc } = chargerDocument(a, id);
      exigerNiveau(a, doc.entiteId, 'revision');
      const actuelle = etat.extractions.find((x) => x.documentId === id && x.actuelle);
      if (!actuelle) throw new ErreurHttp(409, 'Aucune extraction à valider : le document est encore en analyse');
      actuelle.statut = d.decision === 'valider' ? 'valide' : 'rejete';
      Object.assign(doc, { statut: d.decision === 'valider' ? 'traite' : 'rejete', motifStatut: d.motif ?? null, majLe: instant() });
      etat.decisions.push({ cibleType: 'extraction', cibleId: actuelle.id, action: d.decision, motif: d.motif ?? null, versionCible: actuelle.version, creeLe: instant(), auteurId: a.utilisateurId });
      return { documentId: id, statut: doc.statut, versionExtraction: actuelle.version };
    }
    if (m === 'POST' && s[2] === 'reanalyse' && s.length === 3) {
      const { doc } = chargerDocument(a, id);
      exigerNiveau(a, doc.entiteId, 'collaboration');
      if (doc.statut === 'traite') throw new ErreurHttp(409, 'Document déjà validé');
      r.res.statusCode = 202;
      return { accepte: true };
    }
  }

  // ── Comptabilité et révision ──
  if (s[0] === 'exercices' && s.length === 3) {
    const id = exigerUuid(s[1]);
    if (m === 'GET' && s[2] === 'imports') {
      chargerExercice(a, id, 'lecture');
      return etat.lots.filter((l) => l.exerciceId === id).sort((x, y) => y.version - x.version);
    }
    if (m === 'GET' && s[2] === 'revue') {
      const ex = chargerExercice(a, id, 'lecture');
      const execution = etat.executions.filter((e) => e.exerciceId === id).at(-1);
      if (!execution) return { exercice: ex, execution: null, resultats: [], constats: [] };
      return {
        exercice: ex,
        execution,
        resultats: etat.resultats.filter((x) => x.executionId === execution.id).sort((x, y) => x.controleId.localeCompare(y.controleId)),
        constats: etat.constats.filter((c) => c.executionId === execution.id).sort((x, y) => x.controleId.localeCompare(y.controleId) || x.cle.localeCompare(y.cle)),
      };
    }
    if (m === 'POST' && s[2] === 'controles') {
      const ex = chargerExercice(a, id, 'collaboration');
      const lot = etat.lots.find((l) => l.exerciceId === id && l.type === 'fec' && l.actif);
      if (!lot) throw new ErreurHttp(409, 'Aucune donnée comptable importée pour cet exercice : les contrôles ne peuvent pas être réalisés');
      const execution = creerExecution(etat, id, ex.entiteId, lot.id, ex.versionDonnees, 'en_attente');
      imiterControles(execution.id);
      r.res.statusCode = 202;
      return execution;
    }
    if (m === 'POST' && s[2] === 'dossier-revision') {
      const ex = chargerExercice(a, id, 'collaboration');
      const execution = etat.executions.filter((e) => e.exerciceId === id && e.statut === 'termine').at(-1);
      if (!execution) throw new ErreurHttp(409, 'Aucune exécution de contrôles terminée pour cet exercice');
      const exp = { id: randomUUID(), cabinetId: a.cabinetId, entiteId: ex.entiteId, exerciceId: id, executionId: execution.id, versionDonnees: execution.versionDonnees, statut: 'en_attente', mention: 'projet', clePdf: null, cleDonnees: null, sha256Pdf: null, sha256Donnees: null, erreur: null, demandePar: a.utilisateurId, creeLe: instant(), termineLe: null as string | null };
      etat.exports.push(exp);
      const reference = etat;
      setTimeout(() => {
        if (etat !== reference) return;
        reference.fichiersExports.set(`${exp.id}:pdf`, pdfFictif('Dossier de revision PROJET fictif'));
        reference.fichiersExports.set(`${exp.id}:donnees`, Buffer.from(JSON.stringify({ mention: 'projet', exerciceId: id })));
        Object.assign(exp, { statut: 'termine', clePdf: 'fictif/pdf', cleDonnees: 'fictif/json', termineLe: instant() });
      }, DELAI_WORKER_MS);
      r.res.statusCode = 202;
      return exp;
    }
    if (m === 'GET' && s[2] === 'dossiers-revision') {
      chargerExercice(a, id, 'lecture');
      return etat.exports.filter((e) => e.exerciceId === id).sort((x, y) => y.creeLe.localeCompare(x.creeLe));
    }
  }
  if (m === 'GET' && s[0] === 'imports' && s[2] === 'anomalies' && s.length === 3) {
    const id = exigerUuid(s[1]);
    const lot = etat.lots.find((l) => l.id === id && l.cabinetId === a.cabinetId && visibleEnLecture(a, l.entiteId));
    if (!lot) throw new ErreurHttp(404, 'Import introuvable');
    const page = Math.max(Number(r.query.get('page')) || 1, 1);
    const code = r.query.get('code');
    const TAILLE = 100;
    const toutes = ((lot.rapport?.anomalies ?? []) as Array<{ code: string }>).filter((x) => !code || x.code === code);
    return { page, taillePage: TAILLE, total: toutes.length, suite: page * TAILLE < toutes.length, anomalies: toutes.slice((page - 1) * TAILLE, page * TAILLE) };
  }
  if (m === 'GET' && s[0] === 'imports' && s.length === 2) {
    const id = exigerUuid(s[1]);
    const lot = etat.lots.find((l) => l.id === id && l.cabinetId === a.cabinetId && visibleEnLecture(a, l.entiteId));
    if (!lot) throw new ErreurHttp(404, 'Import introuvable');
    return lot;
  }
  if (s[0] === 'constats' && s.length === 2) {
    const id = exigerUuid(s[1]);
    const c = etat.constats.find((x) => x.id === id && x.cabinetId === a.cabinetId && visibleEnLecture(a, x.entiteId));
    if (!c) throw new ErreurHttp(404, 'Constat introuvable');
    if (m === 'GET') {
      const ids: string[] = c.lignesConcernees.slice(0, 200);
      return {
        constat: c,
        lignes: etat.lignes.filter((l) => ids.includes(l.id)).sort((x, y) => x.numeroLigne - y.numeroLigne),
        nbLignesTotal: c.lignesConcernees.length,
        decisions: etat.decisions.filter((d) => d.cibleType === 'constat' && d.cibleId === id).map((d) => ({ action: d.action, motif: d.motif, versionCible: d.versionCible, creeLe: d.creeLe, auteur: nomDe(d.auteurId) })),
        controle: etat.resultats.find((x) => x.id === c.resultatId),
      };
    }
    if (m === 'PATCH') {
      const d = r.json();
      const regle = ACTIONS[d.action];
      if (!regle) throw invalide('action', 'valeur inconnue');
      if (d.motif !== undefined && (typeof d.motif !== 'string' || d.motif.length < 1 || d.motif.length > 4000)) throw invalide('motif', 'chaîne de 1 à 4000 caractères attendue');
      if (regle.motifRequis && !d.motif) throw new ErreurHttp(400, 'Un motif est requis pour cette action');
      if (d.action === 'affecter' && !d.affecteA) throw new ErreurHttp(400, 'affecteA requis');
      exigerNiveau(a, c.entiteId, regle.niveau);
      if (d.affecteA && !HABILITATIONS.some((h) => h.entiteId === c.entiteId && h.utilisateurId === d.affecteA)) throw new ErreurHttp(400, 'La personne désignée n’est pas habilitée sur ce dossier');
      if (regle.statut) c.statutRevue = regle.statut;
      if (d.action === 'affecter') c.affecteA = d.affecteA;
      if (d.action === 'prendre_en_charge') c.affecteA = a.utilisateurId;
      c.aRevoir = false;
      const execution = etat.executions.find((e) => e.id === c.executionId);
      etat.decisions.push({ cibleType: 'constat', cibleId: id, action: d.action, motif: d.motif ?? null, versionCible: execution?.versionDonnees ?? 0, creeLe: instant(), auteurId: a.utilisateurId });
      return c;
    }
  }
  if (m === 'GET' && s[0] === 'dossiers-revision' && s.length === 3) {
    const id = exigerUuid(s[1]);
    const format = s[2];
    if (format !== 'pdf' && format !== 'donnees') throw new ErreurHttp(400, 'format inconnu');
    const exp = etat.exports.find((e) => e.id === id && e.cabinetId === a.cabinetId && visibleEnLecture(a, e.entiteId));
    if (!exp) throw new ErreurHttp(404, 'Dossier de révision introuvable');
    if (exp.statut !== 'termine') throw new ErreurHttp(409, `Dossier de révision non disponible (statut : ${exp.statut})`);
    const contenu = etat.fichiersExports.get(`${id}:${format}`);
    if (!contenu) throw new ErreurHttp(404, 'Fichier absent');
    r.res.writeHead(200, {
      'Content-Type': format === 'pdf' ? 'application/pdf' : 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="dossier-revision-${id}.${format === 'pdf' ? 'pdf' : 'json'}"`,
      'Cache-Control': 'private, no-store',
    });
    r.res.end(contenu);
    return undefined;
  }
  throw new ErreurHttp(404, `Cannot ${m} /v1/${chemin}`);
}

// ───────────── Collecte par mail (calqué sur apps/api/src/mail.controller.ts et integrations.controller.ts) ─────────────
// Aucun fournisseur n'est contacté : l'« autorisation » est une page de test servie par ce simulateur (/__test/fournisseur).
type Mail = {
  configure: boolean;
  demandes: Enr[];
  connexions: Enr[];
  pieces: Enr[];
  vues: Enr[];
  signalements: Enr[];
};
const mailInitial = (): Mail => ({ configure: false, demandes: [], connexions: [], pieces: [], vues: [], signalements: [] });
let mail: Mail = mailInitial();
const URI_RETOUR_MAIL = `${(process.env.WEB_URL ?? 'http://localhost:3000').replace(/\/+$/, '')}/connexions-mail/retour`;
const DETAIL_NON_CONFIGURE: Record<string, string> = {
  gmail: 'Connecteur non configuré : aucune application OAuth Google (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET).',
  microsoft: 'Connecteur non configuré : aucune application OAuth Microsoft (MICROSOFT_CLIENT_ID / MICROSOFT_CLIENT_SECRET).',
};
const etatConnecteurs = () =>
  Object.fromEntries(['gmail', 'microsoft'].map((f) => [f, mail.configure ? { configure: true, detail: 'Simulateur de test : aucune connexion réelle.' } : { configure: false, detail: DETAIL_NON_CONFIGURE[f] }]));
const estGestionnaire = (a: Acces) => a.role === 'administrateur' || a.role === 'associe';
function exigerGestionnaire(a: Acces): void {
  if (!estGestionnaire(a)) throw new ErreurHttp(403, 'Réservé aux gestionnaires du cabinet (administrateur, associé)');
}
const SCOPES: Record<string, Array<[string, string]>> = {
  gmail: [['https://www.googleapis.com/auth/gmail.readonly', 'Lecture de TOUS les messages, pièces jointes, libellés et paramètres de la boîte Gmail. Aucun envoi, aucune modification, aucune suppression.']],
  microsoft: [
    ['openid', 'Identification de l’utilisateur (aucun accès aux messages).'],
    ['offline_access', 'Maintien de l’accès dans le temps (jeton de rafraîchissement), sans élargir les données accessibles.'],
    ['Mail.Read', 'Lecture de TOUS les messages et pièces jointes de la boîte de l’utilisateur connecté. Aucun envoi, aucune modification, aucune suppression.'],
  ],
};
const ADRESSE_OU_DOMAINE = /^(?:[^\s@<>,;]+@)?[a-z0-9.-]+\.[a-z]{2,}$/;
const ADRESSE_MAIL = /^[^\s@<>,;]+@[a-z0-9.-]+\.[a-z]{2,}$/;

/** Validation réduite aux contraintes de `schemaConfigurationConnexion` utiles aux écrans (le schéma réel est dans @comtaple/mail). */
function configurationValidee(a: Acces, fournisseur: string, boite: Enr, brute: Enr | undefined): Enr {
  const dossiersCabinet: string[] = ENTITES.filter((e) => e.cabinetId === a.cabinetId).map((e) => e.id);
  const erreur = (champ: string, probleme: string) => new ErreurHttp(400, { message: 'Configuration invalide', erreurs: [{ champ, probleme }] });
  const b = brute ?? {};
  const liste = (v: unknown, champ: string, max: number): string[] => {
    if (v === undefined) return [];
    if (!Array.isArray(v) || v.length > max || v.some((x) => typeof x !== 'string' || !x.trim())) throw erreur(champ, 'liste de chaînes attendue');
    return v.map((x: string) => x.trim());
  };
  const filtres = (b.filtres ?? {}) as Enr;
  const expediteurs = liste(filtres.expediteursAutorises, 'filtres.expediteursAutorises', 1000).map((v) => v.toLowerCase().replace(/^@/, ''));
  expediteurs.forEach((v, i) => {
    if (!ADRESSE_OU_DOMAINE.test(v)) throw erreur(`filtres.expediteursAutorises.${i}`, 'Adresse ou domaine invalide.');
  });
  const r = (b.rattachement ?? { dossiersComptables: dossiersCabinet }) as Enr;
  const dossiersComptables = liste(r.dossiersComptables, 'rattachement.dossiersComptables', 5000);
  if (dossiersComptables.length === 0) throw erreur('rattachement.dossiersComptables', 'au moins un dossier attendu');
  const connus = new Set(dossiersComptables);
  const regles = (Array.isArray(r.regles) ? r.regles : []).map((x: Enr, i: number) => {
    if (x.type !== 'expediteur' && x.type !== 'destinataire') throw erreur(`rattachement.regles.${i}.type`, 'valeur inconnue');
    const valeur = String(x.valeur ?? '').trim().toLowerCase().replace(x.type === 'expediteur' ? /^@/ : /^$/, '');
    if (!(x.type === 'expediteur' ? ADRESSE_OU_DOMAINE : ADRESSE_MAIL).test(valeur)) throw erreur(`rattachement.regles.${i}.valeur`, x.type === 'expediteur' ? 'Adresse ou domaine invalide.' : 'Adresse de messagerie invalide.');
    if (!connus.has(x.dossierComptable)) throw erreur(`rattachement.regles.${i}.dossierComptable`, 'La règle vise un dossier comptable qui ne figure pas dans la liste des destinataires.');
    return { type: x.type, valeur, dossierComptable: x.dossierComptable };
  });
  if (r.dossierParDefaut !== undefined && !connus.has(r.dossierParDefaut)) throw erreur('rattachement.dossierParDefaut', 'Le dossier par défaut ne figure pas dans la liste des destinataires.');
  if (b.dateDebut !== undefined && (typeof b.dateDebut !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.test(b.dateDebut))) throw erreur('dateDebut', 'date ISO attendue');
  const taille = b.tailleMaxPieceJointeOctets ?? 25 * 1024 * 1024;
  if (!Number.isInteger(taille) || taille <= 0 || taille > 150 * 1024 * 1024) throw erreur('tailleMaxPieceJointeOctets', 'entier positif de 150 Mo au plus attendu');
  if (boite.type === 'partagee' && fournisseur !== 'microsoft') throw erreur('boite', 'Les boîtes partagées ne concernent que Microsoft 365.');
  if (dossiersComptables.some((d) => !dossiersCabinet.includes(d))) throw new ErreurHttp(400, 'Un dossier comptable destinataire est inconnu dans ce cabinet');
  return {
    fournisseur,
    boite,
    dossiers: liste(b.dossiers, 'dossiers', 50),
    filtres: { expediteursAutorises: expediteurs, objetContient: liste(filtres.objetContient, 'filtres.objetContient', 50), avecPieceJointeUniquement: filtres.avecPieceJointeUniquement === true },
    rattachement: { dossiersComptables, ...(r.dossierParDefaut !== undefined ? { dossierParDefaut: r.dossierParDefaut } : {}), regles },
    ...(b.dateDebut !== undefined ? { dateDebut: b.dateDebut } : {}),
    tailleMaxPieceJointeOctets: taille,
  };
}

function vueConnexion(l: Enr) {
  const c = l.configuration;
  const permissions = (l.scopes as Array<[string, string]>).map(([scope, portee]) => ({ scope, portee }));
  const debut = c.dateDebut ? new Date(c.dateDebut) : new Date(Date.parse(l.creeLe) - 30 * 86400_000);
  const filtres = [
    { type: 'dossiers', libelle: `${c.fournisseur === 'gmail' ? 'Libellés' : 'Dossiers'} surveillés : ${(c.dossiers.length ? c.dossiers : [c.fournisseur === 'gmail' ? 'INBOX' : 'inbox']).join(', ')}` },
    { type: 'date_debut', libelle: `Messages reçus à partir du ${debut.toISOString().slice(0, 10)}` },
    { type: 'taille_max', libelle: `Pièces jointes de ${Math.round(c.tailleMaxPieceJointeOctets / (1024 * 1024))} Mo au plus` },
    ...(c.filtres.expediteursAutorises.length ? [{ type: 'expediteurs', libelle: `Expéditeurs autorisés : ${c.filtres.expediteursAutorises.join(', ')}` }] : []),
    ...(c.filtres.objetContient.length ? [{ type: 'objet', libelle: `Objet contenant : ${c.filtres.objetContient.join(' ou ')}` }] : []),
    ...(c.filtres.avecPieceJointeUniquement ? [{ type: 'piece_jointe', libelle: 'Uniquement les messages avec pièce jointe' }] : []),
  ];
  return {
    id: l.id, fournisseur: l.fournisseur, adresse: l.adresse, statut: l.statut, motifStatut: l.derniereErreur, creeLe: l.creeLe, derniereSynchro: l.derniereSynchro, derniereIssue: l.derniereIssue,
    surveillance: l.surveillance, configuration: c, permissionsAccordees: permissions, filtresFonctionnels: filtres,
    textePerimetre: ['Ce que l’autorisation accordée permet techniquement :', ...permissions.map((p) => `• ${p.scope} — ${p.portee}`), '', 'Ce que Comtaple lit réellement (filtres du logiciel) :', ...filtres.map((f) => `• ${f.libelle}`)].join('\n'),
  };
}

function creerConnexionMail(a: Acces, fournisseur: string, boite: Enr, configuration: Enr, statut = 'active'): Enr {
  const partagee = boite.type === 'partagee';
  const l = {
    id: randomUUID(), cabinetId: a.cabinetId, fournisseur, adresse: partagee ? boite.adresse : fournisseur === 'gmail' ? 'factures@cabinet-alpha.test' : 'compta@cabinet-alpha.test', statut,
    derniereErreur: statut === 'expire' ? 'jeton_de_rafraichissement_refuse' : null, creeLe: instant(), derniereSynchro: null as string | null, derniereIssue: null as string | null,
    surveillance: fournisseur === 'gmail' ? { mode: 'gmail_watch', echeance: '2026-11-25T08:00:00.000Z', raison: null } : partagee ? { mode: 'periodique', echeance: null, raison: 'boite_partagee_sans_notifications' } : { mode: 'graph_abonnements', echeance: '2026-11-21T08:00:00.000Z', raison: null },
    configuration, scopes: [...SCOPES[fournisseur]!, ...(partagee ? [['Mail.Read.Shared', 'Lecture de TOUS les messages des boîtes et dossiers partagés auxquels l’utilisateur connecté a accès (et de sa propre boîte). Aucun envoi, aucune modification, aucune suppression.'] as [string, string]] : [])],
  };
  mail.connexions.push(l);
  return l;
}

/** Jeu de données fictif pour les écrans de suivi et la file « à qualifier » (route /__test/mail). */
function amorcerMail(): void {
  const alice = { cabinetId: DEMO.cabinetA, utilisateurId: DEMO.alice, role: 'administrateur', email: '', nom: 'Alice Admin' };
  const g = creerConnexionMail(alice, 'gmail', { type: 'personnelle' }, configurationValidee(alice, 'gmail', { type: 'personnelle' }, undefined));
  Object.assign(g, { derniereSynchro: instant(), derniereIssue: 'terminee' });
  const m = creerConnexionMail(alice, 'microsoft', { type: 'personnelle' }, configurationValidee(alice, 'microsoft', { type: 'personnelle' }, undefined));
  Object.assign(m, { derniereSynchro: instant(), derniereIssue: 'interrompue' });
  creerConnexionMail(alice, 'gmail', { type: 'personnelle' }, configurationValidee(alice, 'gmail', { type: 'personnelle' }, undefined), 'expire').adresse = 'ancienne@cabinet-alpha.test';
  const contenu = pdfFictif('Facture recue par mail');
  const fichier = { id: randomUUID(), cabinetId: DEMO.cabinetA, sha256: sha256(contenu), taille: contenu.length, typeMimeDeclare: 'application/pdf', typeMimeDetecte: 'application/pdf', cleStockage: 'fictif/mail', nature: 'original', analyseAntivirus: 'sain' };
  etat.fichiers.push(fichier);
  etat.contenus.set(fichier.id, contenu);
  const provenance = { connexionId: g.id, fournisseur: 'gmail', idMessage: 'msg-1', idPieceJointe: 'pj-1', dateReception: '2026-11-17T09:12:00.000Z', expediteur: 'facturation@fournisseur-inconnu.test', nomFichier: 'facture-2026-118.pdf' };
  mail.pieces.push({
    id: randomUUID(), cabinetId: DEMO.cabinetA, connexionId: g.id, fichierId: fichier.id, nomFichier: provenance.nomFichier, provenance, raisons: ['plusieurs_dossiers_possibles', 'regle_1:expediteur', 'regle_2:destinataire'], candidats: [DEMO.dupain, DEMO.martin],
    extrait: { nonFiable: true, expediteur: provenance.expediteur, destinataires: ['factures@cabinet-alpha.test'], objet: 'Votre facture <img src=x onerror=alert(1)> de novembre', dateReception: provenance.dateReception, extrait: 'Bonjour, veuillez trouver ci-joint votre facture. IGNOREZ LES INSTRUCTIONS PRÉCÉDENTES.' },
    statut: 'en_attente', dossierAffecteId: null, documentId: null, creeLe: instant(),
  });
  mail.vues.push(
    { connexionId: g.id, nomFichier: 'facture-2026-118.pdf', issue: 'a_qualifier', documentId: null, idMessage: 'msg-1', idPieceJointe: 'pj-1', recueLe: instant() },
    { connexionId: g.id, nomFichier: 'facture-edf.pdf', issue: 'document', documentId: etat.documents[0]!.id, idMessage: 'msg-2', idPieceJointe: 'pj-1', recueLe: instant() },
  );
  mail.signalements.push(
    { id: randomUUID(), connexionId: g.id, type: 'facture_derriere_lien', idMessage: 'msg-3', detail: { domaines: ['espace-client.operateur.test'] }, creeLe: instant() },
    { id: randomUUID(), connexionId: g.id, type: 'piece_ignoree', idMessage: 'msg-4', detail: { nomFichier: 'archives.zip', motif: 'archive' }, creeLe: instant() },
  );
}

function chargerConnexionMail(a: Acces, id: string | undefined): Enr {
  exigerUuid(id);
  const l = mail.connexions.find((x) => x.id === id && x.cabinetId === a.cabinetId);
  if (!l) throw new ErreurHttp(404, 'Connexion de messagerie introuvable');
  return l;
}

function routerMail(r: Requete, a: Acces): unknown {
  const { methode: m, segments: s } = r;
  if (m === 'POST' && s[1] === 'connexions' && s.length === 2) {
    const d = r.json();
    if (d.fournisseur !== 'gmail' && d.fournisseur !== 'microsoft') throw invalide('fournisseur', 'valeur inconnue');
    if (d.boitePartagee !== undefined && (typeof d.boitePartagee !== 'string' || !ADRESSE_MAIL.test(d.boitePartagee.toLowerCase()))) throw invalide('boitePartagee', 'adresse invalide');
    exigerGestionnaire(a);
    if (!mail.configure) throw new ErreurHttp(503, { message: DETAIL_NON_CONFIGURE[d.fournisseur]!, code: 'connecteur_non_configure' });
    const boite = d.boitePartagee ? { type: 'partagee', adresse: d.boitePartagee.toLowerCase() } : { type: 'personnelle' };
    const configuration = configurationValidee(a, d.fournisseur, boite, d.configuration);
    const state = randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '');
    const expireLe = new Date(Date.now() + 600_000).toISOString();
    mail.demandes.push({ state, utilisateurId: a.utilisateurId, cabinetId: a.cabinetId, fournisseur: d.fournisseur, boite, configuration, expireLe });
    r.res.statusCode = 201;
    return { urlAutorisation: `http://127.0.0.1:${PORT}/__test/fournisseur?fournisseur=${d.fournisseur}&state=${state}&redirect_uri=${encodeURIComponent(URI_RETOUR_MAIL)}`, expireLe };
  }
  if (m === 'POST' && s[1] === 'retour' && s.length === 2) {
    const d = r.json();
    if (typeof d.state !== 'string' || d.state.length < 1 || d.state.length > 512) throw invalide('state', 'chaîne attendue');
    if (!mail.configure) throw new ErreurHttp(503, { message: 'Connecteur non configuré', code: 'connecteur_non_configure' });
    exigerGestionnaire(a);
    const i = mail.demandes.findIndex((x) => x.state === d.state && x.utilisateurId === a.utilisateurId && x.cabinetId === a.cabinetId);
    if (i < 0) throw new ErreurHttp(400, { message: 'Demande d’autorisation inconnue, expirée ou lancée par un autre utilisateur', code: 'state_invalide' });
    const [demande] = mail.demandes.splice(i, 1); // usage unique
    if (d.error) throw new ErreurHttp(400, { message: 'Le fournisseur a refusé l’autorisation.', code: `refus_fournisseur:${d.error}` });
    if (!d.code) throw new ErreurHttp(400, { message: 'Code d’autorisation absent.', code: 'code_absent' });
    if (d.code !== 'code-de-test-valide') throw new ErreurHttp(400, { message: 'Le fournisseur refuse le code d’autorisation ou le vérifieur PKCE.', code: 'code_refuse' });
    return vueConnexion(creerConnexionMail(a, demande!.fournisseur, demande!.boite, demande!.configuration));
  }
  if (m === 'GET' && s[1] === 'connexions' && s.length === 2) {
    exigerGestionnaire(a);
    return { connecteurs: etatConnecteurs(), connexions: mail.connexions.filter((l) => l.cabinetId === a.cabinetId && l.statut !== 'supprimee').sort((x, y) => y.creeLe.localeCompare(x.creeLe)).map(vueConnexion) };
  }
  if (s[1] === 'connexions' && s.length >= 3) {
    exigerGestionnaire(a);
    const l = chargerConnexionMail(a, s[2]);
    if (m === 'GET' && s[3] === 'suivi' && s.length === 4) {
      const vues = mail.vues.filter((v) => v.connexionId === l.id);
      const imports: Record<string, number> = {};
      for (const v of vues) imports[v.issue] = (imports[v.issue] ?? 0) + 1;
      return {
        connexion: vueConnexion(l),
        imports,
        pieces: vues.map((v) => ({ nomFichier: v.nomFichier, issue: v.issue, documentId: v.documentId, idMessage: v.idMessage, recueLe: v.recueLe })).reverse(),
        signalements: mail.signalements.filter((x) => x.connexionId === l.id).map((x) => ({ id: x.id, type: x.type, idMessage: x.idMessage, detail: x.detail, creeLe: x.creeLe })),
        erreur: l.statut === 'active' ? null : { statut: l.statut, motif: l.derniereErreur },
        evenements: [],
      };
    }
    if (m === 'PUT' && s[3] === 'configuration' && s.length === 4) {
      const brute = r.json();
      if (l.statut !== 'active') throw new ErreurHttp(409, { message: 'Connexion inactive', statut: l.statut });
      l.configuration = configurationValidee(a, l.fournisseur, l.configuration.boite, brute);
      return vueConnexion(l);
    }
    if (m === 'POST' && s[3] === 'synchroniser' && s.length === 4) {
      if (l.statut !== 'active') throw new ErreurHttp(409, { message: 'Connexion inactive : reconnecter la boîte', statut: l.statut });
      horloge += 3600_000; // l'horloge simulée avance d'une heure
      Object.assign(l, { derniereSynchro: instant(), derniereIssue: 'terminee' }); // imite le worker, sans délai
      r.res.statusCode = 202;
      return { misEnFile: true };
    }
    if (m === 'DELETE' && s.length === 3) {
      const microsoft = l.fournisseur === 'microsoft';
      Object.assign(l, { statut: 'supprimee', derniereErreur: 'supprimee_par_utilisateur', surveillance: null });
      return {
        statut: 'supprimee', jetonsSupprimes: true, revoqueChezFournisseur: !microsoft,
        actionsRestantes: microsoft
          ? [
              'Comtaple a supprimé ses jetons et ses abonnements : il ne peut plus lire la boîte.',
              'Pour retirer l’autorisation elle-même, l’utilisateur doit supprimer l’application depuis « Mes applications » (compte professionnel) ou la page de confidentialité de son compte Microsoft (compte personnel).',
              'Un administrateur peut retirer le consentement dans le centre d’administration Microsoft Entra (Applications d’entreprise) ou révoquer les sessions de l’utilisateur.',
            ]
          : [],
      };
    }
  }
  if (m === 'GET' && s[1] === 'pieces-a-qualifier' && s.length === 2) {
    exigerGestionnaire(a);
    const voulu = r.query.get('statut') === 'affectee' ? 'affectee' : 'en_attente';
    return mail.pieces.filter((p) => p.cabinetId === a.cabinetId && p.statut === voulu).map((p) => ({
      id: p.id, connexionId: p.connexionId, nomFichier: p.nomFichier, provenance: p.provenance, raisons: p.raisons, candidats: p.candidats, extraitNonFiable: p.extrait, statut: p.statut, dossierAffecteId: p.dossierAffecteId, documentId: p.documentId, recueLe: p.creeLe,
    }));
  }
  if (m === 'POST' && s[1] === 'pieces-a-qualifier' && s[3] === 'affecter' && s.length === 4) {
    const id = exigerUuid(s[2]);
    const d = r.json();
    if (typeof d.entiteId !== 'string' || !UUID.test(d.entiteId)) throw invalide('entiteId', 'identifiant invalide');
    exigerGestionnaire(a);
    const p = mail.pieces.find((x) => x.id === id && x.cabinetId === a.cabinetId);
    if (!p) throw new ErreurHttp(404, 'Pièce introuvable');
    if (p.statut !== 'en_attente') throw new ErreurHttp(409, { message: 'Pièce déjà affectée', documentId: p.documentId });
    exigerNiveau(a, d.entiteId, 'depot');
    let doc = etat.documents.find((x) => x.entiteId === d.entiteId && x.fichierId === p.fichierId);
    const doublonBinaire = Boolean(doc);
    if (!doc) {
      const creeLe = instant();
      doc = { id: randomUUID(), cabinetId: a.cabinetId, entiteId: d.entiteId, exerciceId: null, fichierId: p.fichierId, nature: 'a_qualifier', statut: 'recu', nomOrigine: p.nomFichier, commentaire: null, version: 1, remplaceDocumentId: null, nbPages: null, motifStatut: null, creeLe, majLe: creeLe };
      etat.documents.push(doc);
    }
    etat.receptions.push({ id: randomUUID(), cabinetId: a.cabinetId, entiteId: d.entiteId, documentId: doc.id, canal: 'mail', deposantId: null, doublonBinaire, provenance: p.provenance, recuLe: instant() });
    Object.assign(p, { statut: 'affectee', dossierAffecteId: d.entiteId, documentId: doc.id });
    for (const v of mail.vues) if (v.connexionId === p.connexionId && v.idMessage === p.provenance.idMessage && v.idPieceJointe === p.provenance.idPieceJointe) Object.assign(v, { issue: doublonBinaire ? 'doublon_binaire' : 'document', documentId: doc.id });
    return { documentId: doc.id, doublonBinaire, statutDocument: doc.statut };
  }
  throw new ErreurHttp(404, `Cannot ${m} /v1/${s.join('/')}`);
}

/** Page de TEST tenant lieu d'écran de consentement du fournisseur (aucun fournisseur réel n'est contacté). */
function pageFournisseur(q: URLSearchParams): string {
  const retour = q.get('redirect_uri') ?? '';
  const state = encodeURIComponent(q.get('state') ?? '');
  const lien = (libelle: string, suite: string) => `<p><a href="${retour.replace(/"/g, '')}?state=${state}&${suite}">${libelle}</a></p>`;
  return `<!doctype html><html lang="fr"><meta charset="utf-8"><title>Fournisseur simulé</title><h1>SIMULATEUR DE TEST — consentement fictif (${(q.get('fournisseur') ?? '').replace(/[^a-z]/g, '')})</h1>${lien('Accepter', 'code=code-de-test-valide')}${lien('Refuser', 'error=access_denied')}${lien('Code invalide', 'code=code-errone')}</html>`;
}

// ───────────── Administration, audit, banque et rapprochements ─────────────
// Calqué sur administration.controller.ts, audit.controller.ts, banque.controller.ts et apps/worker/src/banque.ts.
// La lecture des relevés, l'analyse d'un FEC lisible et le rapprochement utilisent le VRAI moteur (@comtaple/core) ;
// seuls le stockage et l'exécution différée sont simulés.
const PLAFOND_NIVEAUX: Record<string, readonly string[]> = {
  client_deposant: ['depot'], client_lecture: ['depot', 'lecture'], collaborateur: ['depot', 'lecture', 'collaboration'], support: ['lecture'],
  reviseur: ['depot', 'lecture', 'collaboration', 'revision'], associe: ORDRE, administrateur: ORDRE,
};
const TERRITOIRES = ['metropole', 'guadeloupe', 'martinique', 'guyane', 'reunion', 'mayotte', 'autre', 'a_confirmer'];
let audit: Enr[] = [];
let ruptureAudit: number | null = null;
function tracerAudit(a: { cabinetId: string; utilisateurId?: string }, action: string, cibleType: string, cibleId: string, entiteId: string | null, details: Enr = {}): void {
  audit.push({ id: audit.length + 1, cabinetId: a.cabinetId, acteurId: a.utilisateurId ?? null, acteurType: a.utilisateurId ? 'utilisateur' : 'systeme', action, cibleType, cibleId, entiteId, details, horodatage: instant(), empreintePrecedente: null, empreinte: sha256(`${audit.length}`) });
}
const membresDuCabinet = (cabinetId: string) =>
  UTILISATEURS.flatMap((u) => appartenancesDe(u.id).filter((x) => x.cabinetId === cabinetId).map((x) => ({ utilisateurId: u.id, nom: u.nom, email: u.email, role: x.role, actif: true, expireLe: null })));
const ficheEntite = (e: Enr) => ({ id: e.id, cabinetId: e.cabinetId, raisonSociale: e.raisonSociale, siren: e.siren ?? null, formeJuridique: e.formeJuridique ?? null, regimeFiscal: e.regimeFiscal ?? 'IS', referentielComptable: 'PCG', territoireFiscal: e.territoireFiscal ?? 'metropole', codeNaf: e.codeNaf ?? null, devise: 'EUR', actif: true, creeLe: e.creeLe ?? '2026-11-18T08:00:00.000Z' });
function sirenValide(s: string): boolean {
  let somme = 0;
  for (let i = 0; i < 9; i++) {
    let c = s.charCodeAt(8 - i) - 48;
    if (i % 2 === 1 && (c *= 2) > 9) c -= 9;
    somme += c;
  }
  return somme % 10 === 0;
}
function validerDossier(d: Enr, partiel: boolean): Enr {
  const sortie: Enr = {};
  const texte = (nom: string, max: number, min = 0) => {
    if (d[nom] === undefined) return;
    if (typeof d[nom] !== 'string' || d[nom].length < min || d[nom].length > max) throw invalide(nom, 'chaîne invalide');
    sortie[nom] = d[nom];
  };
  if (!partiel && d.raisonSociale === undefined) throw invalide('raisonSociale', 'obligatoire');
  texte('raisonSociale', 200, 1);
  texte('formeJuridique', 50);
  texte('regimeFiscal', 50);
  texte('codeNaf', 10);
  if (d.siren !== undefined) {
    if (typeof d.siren !== 'string' || !/^\d{9}$/.test(d.siren)) throw invalide('siren', 'SIREN à 9 chiffres');
    sortie.siren = d.siren;
  }
  if (d.territoireFiscal === undefined ? !partiel : true) {
    if (!TERRITOIRES.includes(d.territoireFiscal)) throw invalide('territoireFiscal', 'valeur inconnue ou absente');
    sortie.territoireFiscal = d.territoireFiscal;
  }
  if (partiel && Object.keys(sortie).length === 0) throw invalide('', 'aucune modification');
  if (sortie.siren && !sirenValide(sortie.siren)) throw new ErreurHttp(400, 'SIREN invalide (clé de contrôle)');
  return sortie;
}

function routerAdministration(r: Requete, a: Acces): unknown {
  const { methode: m, segments: s } = r;
  const gestionnaire = a.role === 'administrateur' || a.role === 'associe';
  const exigerGestion = () => {
    if (!gestionnaire) throw new ErreurHttp(403, 'Réservé aux administrateurs et associés du cabinet');
  };
  /** Politique RLS des dossiers : visibles si habilité, ou si gestionnaire du cabinet. */
  const entiteVisible = (id: string) => ENTITES.find((e) => e.id === id && e.cabinetId === a.cabinetId && (gestionnaire || niveauSur(a, e.id)));
  if (m === 'GET' && s.join('/') === 'cabinet/membres') {
    exigerGestion();
    return membresDuCabinet(a.cabinetId).sort((x, y) => x.nom.localeCompare(y.nom));
  }
  if (m === 'GET' && s[0] === 'audit' && s.length === 1) {
    exigerGestion();
    const limite = Math.min(Math.max(Number(r.query.get('limite')) || 100, 1), 500);
    return { integrite: { rupture: ruptureAudit }, lignes: audit.filter((l) => l.cabinetId === a.cabinetId).reverse().slice(0, limite) };
  }
  if (s[0] !== 'dossiers') return undefined;
  if (m === 'POST' && s.length === 1) {
    const d = validerDossier(r.json(), false);
    exigerGestion();
    const e = { id: randomUUID(), cabinetId: a.cabinetId, creeLe: instant(), ...d };
    ENTITES.push(e);
    tracerAudit(a, 'dossier.cree', 'entite', e.id, e.id, { territoireFiscal: d.territoireFiscal });
    r.res.statusCode = 201;
    return ficheEntite(e);
  }
  if (s.length === 1) return undefined;
  const id = exigerUuid(s[1]);
  if (m === 'GET' && s.length === 2) {
    const e = entiteVisible(id);
    if (!e) throw new ErreurHttp(404, 'Dossier introuvable');
    return { ...ficheEntite(e), niveau: niveauSur(a, id) };
  }
  if (m === 'PATCH' && s.length === 2) {
    const d = validerDossier(r.json(), true);
    exigerGestion();
    const e = entiteVisible(id);
    if (!e) throw new ErreurHttp(404, 'Dossier introuvable');
    const avant = e.territoireFiscal ?? 'metropole';
    Object.assign(e, d);
    if (d.territoireFiscal && d.territoireFiscal !== avant) for (const x of etat.executions) if (x.entiteId === id) x.obsolete = true;
    tracerAudit(a, 'dossier.modifie', 'entite', id, id, { territoireAvant: avant, territoireApres: e.territoireFiscal ?? 'metropole' });
    return ficheEntite(e);
  }
  if (m === 'POST' && s[2] === 'exercices' && s.length === 3) {
    const d = r.json();
    for (const k of ['debut', 'fin']) if (typeof d[k] !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(d[k])) throw invalide(k, 'date AAAA-MM-JJ attendue');
    if (!(d.debut < d.fin)) throw invalide('', 'la fin doit suivre le début');
    exigerNiveau(a, id, 'collaboration');
    if (etat.exercices.some((x) => x.entiteId === id && x.debut <= d.fin && x.fin >= d.debut)) throw new ErreurHttp(409, 'Cet exercice chevauche un exercice existant du dossier');
    const ex = { id: randomUUID(), cabinetId: a.cabinetId, entiteId: id, debut: d.debut, fin: d.fin, statut: 'ouvert', versionDonnees: 0, creeLe: instant() };
    etat.exercices.push(ex);
    tracerAudit(a, 'exercice.cree', 'exercice', ex.id, id, { debut: d.debut, fin: d.fin });
    r.res.statusCode = 201;
    return ex;
  }
  if (m === 'GET' && s[2] === 'membres' && s.length === 3) {
    if (!entiteVisible(id)) throw new ErreurHttp(404, 'Dossier introuvable');
    const niveau = niveauSur(a, id);
    if (!gestionnaire && (!niveau || niveau === 'depot')) throw new ErreurHttp(403, 'Habilitation insuffisante sur ce dossier');
    const membres = membresDuCabinet(a.cabinetId);
    return HABILITATIONS.filter((h) => h.entiteId === id).flatMap((h) => membres.filter((x) => x.utilisateurId === h.utilisateurId).map((x) => ({ utilisateurId: x.utilisateurId, nom: x.nom, email: x.email, niveau: h.niveau, role: x.role })));
  }
  if (s[2] === 'habilitations' && s.length === 4) {
    const utilisateurId = exigerUuid(s[3]);
    if (m === 'PUT') {
      const d = r.json();
      if (!ORDRE.includes(d.niveau)) throw invalide('niveau', 'valeur inconnue');
      exigerGestion();
      if (!entiteVisible(id)) throw new ErreurHttp(404, 'Dossier introuvable');
      const membre = membresDuCabinet(a.cabinetId).find((x) => x.utilisateurId === utilisateurId);
      if (!membre) throw new ErreurHttp(404, 'Cette personne n’est pas membre actif du cabinet');
      if (!PLAFOND_NIVEAUX[membre.role]?.includes(d.niveau)) throw new ErreurHttp(400, `Le rôle « ${membre.role} » ne peut pas recevoir le niveau « ${d.niveau} »`);
      let h = HABILITATIONS.find((x) => x.entiteId === id && x.utilisateurId === utilisateurId);
      if (h) h.niveau = d.niveau;
      else HABILITATIONS.push((h = { entiteId: id, utilisateurId, niveau: d.niveau }));
      tracerAudit(a, 'habilitation.accordee', 'utilisateur', utilisateurId, id, { niveau: d.niveau, pourSoiMeme: utilisateurId === a.utilisateurId });
      return { ...h, cabinetId: a.cabinetId, accordeePar: a.utilisateurId };
    }
    if (m === 'DELETE') {
      exigerGestion();
      const i = HABILITATIONS.findIndex((x) => x.entiteId === id && x.utilisateurId === utilisateurId && ENTITES.some((e) => e.id === id && e.cabinetId === a.cabinetId));
      if (i < 0) throw new ErreurHttp(404, 'Habilitation introuvable');
      HABILITATIONS.splice(i, 1);
      tracerAudit(a, 'habilitation.retiree', 'utilisateur', utilisateurId, id);
      r.res.writeHead(204).end();
      return undefined;
    }
  }
  return undefined;
}

/** Imite la tâche du worker `importerReleve` (même enchaînement, vrai moteur de lecture). */
function imiterReleve(lotId: string): void {
  const reference = etat;
  setTimeout(() => {
    const lot = reference.lots.find((l) => l.id === lotId);
    if (etat !== reference || !lot) return;
    const demande = (lot.rapport ?? {}) as Enr;
    const echec = (motif: string, extra: Enr = {}) => Object.assign(lot, { statut: 'echec', actif: false, rapport: { ...demande, lisible: false, motif, ...extra }, termineLe: instant() });
    const contenu = reference.contenus.get(lot.fichierId) ?? Buffer.alloc(0);
    const { texte, encodage } = decoderTexteReleve(new Uint8Array(contenu));
    const format = detecterFormatReleve(texte.slice(0, 8192));
    let rapport: RapportReleve;
    let profilUtilise: unknown = null;
    if (format === 'camt.053') rapport = lireCamt053(texte);
    else if (format === 'ofx') rapport = lireOfx(texte);
    else if (format === 'csv') {
      let profil = demande.profilCsv ? schemaProfilCsvBanque.safeParse(demande.profilCsv) : null;
      if (profil && !profil.success) return void echec('Profil de colonnes CSV invalide', { format });
      if (!profil) {
        const proposition = proposerProfilCsv(texte);
        if (!proposition.profil) return void echec('Colonnes du fichier CSV non reconnues avec certitude : un profil de colonnes doit être confirmé', { format, profilAConfirmer: true, raisons: proposition.raisons });
        profil = { success: true, data: proposition.profil } as never;
        profilUtilise = { ...proposition.profil, origine: 'propose_automatiquement', raisons: proposition.raisons };
      } else profilUtilise = { ...profil.data, origine: 'confirme' };
      rapport = lireCsvBanque(texte, (profil as unknown as { data: Parameters<typeof lireCsvBanque>[1] }).data);
    } else return void echec('Format de relevé non reconnu (camt.053, OFX ou CSV attendus)', { format });
    if (!rapport.lisible) return void echec('Relevé illisible', { format: rapport.format, version: rapport.version, anomalies: rapport.anomalies.slice(0, 200) });

    reference.releves = reference.releves.filter((x) => x.lotImportId !== lot.id);
    const parCompte = new Map<string, string>();
    for (const compte of rapport.comptes) {
      const { nbMouvements, totalMouvements, cadrage, ecart, iban, identifiant, devise, soldeOuverture, dateOuverture, soldeCloture, dateCloture } = compte;
      const rel = { id: randomUUID(), cabinetId: lot.cabinetId, entiteId: lot.entiteId, lotImportId: lot.id, format: rapport.format, iban, identifiant, devise, soldeOuverture, dateOuverture, soldeCloture, dateCloture, totalMouvements, nbMouvements, cadrage, ecart, creeLe: instant() };
      reference.releves.push(rel);
      const cle = `${iban ?? ''}|${identifiant ?? ''}`;
      if (!parCompte.has(cle)) parCompte.set(cle, rel.id);
    }
    let nouveaux = 0;
    const connus = new Set(reference.mouvements.filter((x) => x.entiteId === lot.entiteId).map((x) => x.cleIdempotence));
    for (const mv of rapport.mouvements) {
      if (connus.has(mv.cleIdempotence)) continue;
      connus.add(mv.cleIdempotence);
      nouveaux++;
      reference.mouvements.push({
        id: randomUUID(), cabinetId: lot.cabinetId, entiteId: lot.entiteId, lotImportId: lot.id, releveId: parCompte.get(`${mv.compte.iban ?? ''}|${mv.compte.identifiant ?? ''}`) ?? null, rang: mv.rang, cleIdempotence: mv.cleIdempotence,
        iban: mv.compte.iban, identifiantCompte: mv.compte.identifiant, devise: mv.compte.devise, dateOperation: mv.dateOperation, dateValeur: mv.dateValeur, montant: mv.montant, libelle: mv.libelle,
        referenceBanque: mv.referenceBanque, referenceBoutEnBout: mv.referenceBoutEnBout, contrepartieNom: mv.contrepartie?.nom ?? null, brut: mv, creeLe: instant(),
      });
    }
    if (nouveaux > 0) for (const x of reference.rapprochementsExec) if (x.entiteId === lot.entiteId) x.obsolete = true;
    const { mouvements: _m, ...resume } = rapport;
    Object.assign(lot, {
      statut: rapport.anomalies.length > 0 ? 'termine_avec_erreurs' : 'termine', actif: true, progression: rapport.mouvements.length, termineLe: instant(),
      rapport: { ...demande, ...resume, encodage, profilCsv: profilUtilise ?? demande.profilCsv ?? null, anomalies: rapport.anomalies.slice(0, 500), nbMouvements: rapport.mouvements.length, nbNouveaux: nouveaux, nbDejaConnus: rapport.mouvements.length - nouveaux },
    });
  }, DELAI_WORKER_MS);
}

/** Imite la tâche du worker `executerRapprochement` avec le vrai moteur déterministe. */
function imiterRapprochement(executionId: string): void {
  const reference = etat;
  setTimeout(() => {
    const execution = reference.rapprochementsExec.find((x) => x.id === executionId);
    const exercice = execution && reference.exercices.find((x) => x.id === execution.exerciceId);
    if (etat !== reference || !execution || !exercice) return;
    const lignes = reference.lignes.filter((l) => l.lotImportId === execution.lotImportId).sort((x, y) => x.numeroLigne - y.numeroLigne) as unknown as LigneEcriture[];
    const cotesEcritures = elementsBanqueDepuisEcritures(lignes);
    const mouvements = reference.mouvements.filter((x) => x.entiteId === execution.entiteId && x.dateOperation >= exercice.debut && x.dateOperation <= exercice.fin).sort((x, y) => x.dateOperation.localeCompare(y.dateOperation) || x.rang - y.rang);
    const idParCle = new Map<string, string>(mouvements.map((x) => [x.cleIdempotence, x.id]));
    const versIds = (cles: readonly string[]) => cles.map((k) => idParCle.get(k) ?? k);
    const resultat = rapprocher(cotesEcritures, mouvements.map((x) => elementDepuisMouvement(x.brut as MouvementBancaire)), schemaParametresRapprochement.partial().parse(execution.parametres ?? {}));
    for (const p of resultat.rapprochements) {
      reference.propositions.push({ id: randomUUID(), cabinetId: execution.cabinetId, entiteId: execution.entiteId, exerciceId: exercice.id, executionId: execution.id, niveau: p.niveau, regle: p.regle, cotesEcritures: p.cotesA, cotesMouvements: versIds(p.cotesB), criteres: p.criteres, explication: p.explication, ecart: p.ecart, statut: 'propose', motif: null, decidePar: null, decideLe: null, creeLe: instant() });
    }
    const idsEcritures = new Set(cotesEcritures.map((x) => x.id));
    const traduire = (ids: readonly string[]) => ids.map((x) => (idsEcritures.has(x) ? x : (idParCle.get(x) ?? x)));
    Object.assign(execution, {
      statut: 'termine', termineLe: instant(), mesures: { ...resultat.mesures, ecrituresBanque: String(cotesEcritures.length), mouvementsBancaires: String(mouvements.length) },
      nonRapprochesEcritures: resultat.nonRapprochesA, nonRapprochesMouvements: versIds(resultat.nonRapprochesB),
      ambiguites: resultat.ambiguites.map((x) => ({ ...x, ids: traduire(x.ids), candidats: x.candidats.map(traduire) })), abandons: resultat.abandons.map((x) => ({ ...x, ids: traduire(x.ids) })),
    });
  }, DELAI_WORKER_MS);
}

function routerBanque(r: Requete, a: Acces): unknown {
  const { methode: m, segments: s } = r;
  if (m === 'GET' && s.join('/') === 'reference/rapprochement') return { regles: REGLES_RAPPROCHEMENT, parametresParDefaut: PARAMETRES_RAPPROCHEMENT_PAR_DEFAUT };
  if (m === 'GET' && s[0] === 'dossiers' && s[2] === 'banque') {
    const entiteId = exigerUuid(s[1]);
    if (s.length === 3) {
      exigerNiveau(a, entiteId, 'lecture');
      return {
        imports: etat.lots.filter((l) => l.entiteId === entiteId && l.type === 'releve_bancaire').sort((x, y) => y.creeLe.localeCompare(x.creeLe)),
        releves: etat.releves.filter((x) => x.entiteId === entiteId).sort((x, y) => String(y.dateCloture).localeCompare(String(x.dateCloture))),
        nbMouvements: etat.mouvements.filter((x) => x.entiteId === entiteId).length,
      };
    }
    if (s[3] === 'mouvements' && s.length === 4) {
      const du = r.query.get('du');
      const au = r.query.get('au');
      if ((du && !/^\d{4}-\d{2}-\d{2}$/.test(du)) || (au && !/^\d{4}-\d{2}-\d{2}$/.test(au))) throw new ErreurHttp(400, 'dates AAAA-MM-JJ attendues');
      const page = Math.max(Number(r.query.get('page')) || 1, 1);
      exigerNiveau(a, entiteId, 'lecture');
      const tous = etat.mouvements.filter((x) => x.entiteId === entiteId && (!du || x.dateOperation >= du) && (!au || x.dateOperation <= au)).sort((x, y) => x.dateOperation.localeCompare(y.dateOperation) || x.rang - y.rang);
      const TAILLE = 100;
      return { page, taillePage: TAILLE, suite: tous.length > page * TAILLE, mouvements: tous.slice((page - 1) * TAILLE, page * TAILLE).map(({ brut: _b, ...x }) => x) };
    }
  }
  if (m === 'POST' && s[0] === 'imports' && s[2] === 'relancer' && s.length === 3) {
    const id = exigerUuid(s[1]);
    const d = r.json();
    if (!d.profilCsv || typeof d.profilCsv !== 'object' || Array.isArray(d.profilCsv)) throw invalide('profilCsv', 'objet attendu');
    const lot = etat.lots.find((l) => l.id === id && l.cabinetId === a.cabinetId && niveauSur(a, l.entiteId) && auMoins(niveauSur(a, l.entiteId)!, 'lecture'));
    if (!lot || lot.type !== 'releve_bancaire') throw new ErreurHttp(404, 'Import de relevé introuvable');
    exigerNiveau(a, lot.entiteId, 'collaboration');
    if (lot.statut !== 'echec') throw new ErreurHttp(409, 'Seul un import en échec peut être relancé');
    Object.assign(lot, { statut: 'en_attente', rapport: { nomFichier: lot.rapport?.nomFichier, profilCsv: d.profilCsv }, termineLe: null });
    imiterReleve(lot.id);
    r.res.statusCode = 202;
    return { accepte: true };
  }
  if (s[0] === 'exercices' && s[2] === 'rapprochements' && s.length === 3) {
    const id = exigerUuid(s[1]);
    if (m === 'POST') {
      const d = r.json();
      const parametres = schemaParametresRapprochement.partial().safeParse(d.parametres ?? {});
      if (!parametres.success) throw new ErreurHttp(400, { message: 'Requête invalide', erreurs: parametres.error.issues.map((i) => ({ champ: `parametres.${i.path.join('.')}`, probleme: i.message })) });
      const ex = chargerExercice(a, id, 'collaboration');
      const lot = etat.lots.find((l) => l.exerciceId === id && l.type === 'fec' && l.actif);
      if (!lot) throw new ErreurHttp(409, 'Aucune donnée comptable importée pour cet exercice : le rapprochement ne peut pas être réalisé');
      if (!etat.mouvements.some((x) => x.entiteId === ex.entiteId && x.dateOperation >= ex.debut && x.dateOperation <= ex.fin)) throw new ErreurHttp(409, 'Aucun mouvement bancaire importé sur la période de l’exercice : le rapprochement ne peut pas être réalisé');
      const e = { id: randomUUID(), cabinetId: a.cabinetId, entiteId: ex.entiteId, exerciceId: id, lotImportId: lot.id, versionDonnees: ex.versionDonnees, statut: 'en_attente', obsolete: false, parametres: d.parametres ?? {}, mesures: null, nonRapprochesEcritures: null, nonRapprochesMouvements: null, ambiguites: null, abandons: null, erreur: null, lancePar: a.utilisateurId, creeLe: instant(), termineLe: null };
      etat.rapprochementsExec.push(e);
      imiterRapprochement(e.id);
      r.res.statusCode = 202;
      return e;
    }
    if (m === 'GET') {
      const ex = chargerExercice(a, id, 'lecture');
      const execution = etat.rapprochementsExec.filter((x) => x.exerciceId === id).at(-1);
      if (!execution) return { exercice: ex, execution: null, rapprochements: [], ecritures: {}, mouvements: {}, nonRapproches: { ecritures: [], mouvements: [], nbEcritures: 0, nbMouvements: 0 } };
      const rapprochements = etat.propositions.filter((x) => x.executionId === execution.id).sort((x, y) => x.niveau.localeCompare(y.niveau) || x.regle.localeCompare(y.regle)).slice(0, 2000);
      const PLAFOND = 300;
      const nonE: string[] = (execution.nonRapprochesEcritures ?? []).filter((x: string) => UUID.test(x));
      const nonM: string[] = (execution.nonRapprochesMouvements ?? []).filter((x: string) => UUID.test(x));
      const ids = new Set<string>([...nonE.slice(0, PLAFOND), ...nonM.slice(0, PLAFOND)]);
      for (const p of rapprochements) for (const x of [...p.cotesEcritures, ...p.cotesMouvements]) ids.add(x);
      for (const g of (execution.ambiguites ?? []).slice(0, 100)) for (const x of g.ids) ids.add(x);
      return {
        exercice: ex, execution, rapprochements,
        ecritures: Object.fromEntries(etat.lignes.filter((l) => ids.has(l.id)).map((l) => [l.id, { id: l.id, date: l.ecritureDate, journal: l.journalCode, numero: l.ecritureNum, compte: l.compteNum, piece: l.pieceRef, libelle: l.ecritureLib, debit: l.debit, credit: l.credit }])),
        mouvements: Object.fromEntries(etat.mouvements.filter((x) => ids.has(x.id)).map((x) => [x.id, { id: x.id, date: x.dateOperation, montant: x.montant, libelle: x.libelle, reference: x.referenceBoutEnBout, contrepartie: x.contrepartieNom, iban: x.iban }])),
        nonRapproches: { ecritures: nonE.slice(0, PLAFOND), mouvements: nonM.slice(0, PLAFOND), nbEcritures: nonE.length, nbMouvements: nonM.length },
      };
    }
  }
  if (m === 'PATCH' && s[0] === 'rapprochements' && s.length === 2) {
    const id = exigerUuid(s[1]);
    const d = r.json();
    if (!['valider', 'rejeter', 'remettre_en_proposition'].includes(d.decision)) throw invalide('decision', 'valeur inconnue');
    if (d.motif !== undefined && (typeof d.motif !== 'string' || d.motif.length < 1 || d.motif.length > 2000)) throw invalide('motif', 'chaîne de 1 à 2000 caractères attendue');
    if (d.decision === 'rejeter' && !d.motif) throw new ErreurHttp(400, 'Un motif est requis pour rejeter');
    const p = etat.propositions.find((x) => x.id === id && x.cabinetId === a.cabinetId && visibleEnLecture(a, x.entiteId));
    if (!p) throw new ErreurHttp(404, 'Rapprochement introuvable');
    exigerNiveau(a, p.entiteId, 'revision');
    const execution = etat.rapprochementsExec.find((x) => x.id === p.executionId);
    if (execution?.obsolete && d.decision === 'valider') throw new ErreurHttp(409, 'Les données ont changé depuis ce rapprochement : relancez-le avant de valider');
    const statut = d.decision === 'valider' ? 'valide' : d.decision === 'rejeter' ? 'rejete' : 'propose';
    Object.assign(p, { statut, motif: d.motif ?? null, decidePar: statut === 'propose' ? null : a.utilisateurId, decideLe: statut === 'propose' ? null : instant() });
    tracerAudit(a, `rapprochement.${d.decision}`, 'rapprochement', id, p.entiteId, { regle: p.regle, ecart: p.ecart });
    return p;
  }
  return undefined;
}

// ───────────── Imitation des traitements du worker (minuteries) ─────────────
function imiterImport(lotId: string): void {
  const reference = etat;
  setTimeout(() => {
    const lot = reference.lots.find((l) => l.id === lotId);
    if (etat !== reference || !lot) return;
    Object.assign(lot, { statut: 'en_cours', progression: 600 });
    setTimeout(async () => {
      if (etat !== reference) return;
      const ex = reference.exercices.find((x) => x.id === lot.exerciceId)!;
      // Un fichier réellement lisible est analysé par le vrai moteur (lignes et rapport réels) ; sinon, rapport fictif ci-dessous.
      const lues: LigneFec[] = [];
      const reel = await analyserFec(enBlocs(new Uint8Array(reference.contenus.get(lot.fichierId) ?? Buffer.alloc(0))), { exerciceDebut: ex.debut, exerciceFin: ex.fin, nomFichier: lot.rapport.nomFichier, surLigne: (l) => void lues.push(l) }).catch(() => null);
      if (etat !== reference) return;
      const analyse = reel?.lisible && lues.length > 0 ? reel : null;
      if (analyse) for (const l of lues) reference.lignes.push({ ...l, id: randomUUID(), cabinetId: lot.cabinetId, entiteId: lot.entiteId, exerciceId: lot.exerciceId, lotImportId: lot.id });
      for (const l of reference.lots) if (l.exerciceId === lot.exerciceId && l.id !== lot.id) l.actif = false;
      ex.versionDonnees += 1;
      for (const e of reference.executions) if (e.exerciceId === lot.exerciceId) e.obsolete = true;
      for (const c of reference.constats) if (c.exerciceId === lot.exerciceId && c.statutRevue !== 'a_examiner') c.aRevoir = true;
      if (analyse) Object.assign(lot, { actif: true, statut: analyse.anomalies.length > 0 ? 'termine_avec_erreurs' : 'termine', progression: lues.length, rapport: { ...analyse, nomFichier: lot.rapport.nomFichier }, termineLe: instant() });
      else Object.assign(lot, { actif: true, statut: 'termine_avec_erreurs', progression: 1250, rapport: rapportFec(lot.rapport.nomFichier, 3), termineLe: instant() });
      const execution = creerExecution(reference, lot.exerciceId, lot.entiteId, lot.id, ex.versionDonnees, 'en_attente');
      imiterControles(execution.id);
    }, DELAI_WORKER_MS);
  }, DELAI_WORKER_MS);
}
function imiterControles(executionId: string): void {
  const reference = etat;
  setTimeout(() => {
    const execution = reference.executions.find((e) => e.id === executionId);
    if (etat !== reference || !execution) return;
    produireResultats(reference, execution);
    Object.assign(execution, { statut: 'termine', termineLe: instant() });
  }, DELAI_WORKER_MS);
}

// ───────────── Serveur HTTP ─────────────
function lireCorps(req: http.IncomingMessage, limite: number): Promise<Buffer> {
  return new Promise((ok, ko) => {
    const morceaux: Buffer[] = [];
    let taille = 0;
    req.on('data', (c: Buffer) => {
      taille += c.length;
      if (taille > limite) {
        ko(new ErreurHttp(413, 'request entity too large'));
        req.destroy();
      } else morceaux.push(c);
    });
    req.on('end', () => ok(Buffer.concat(morceaux)));
    req.on('error', ko);
  });
}

const serveur = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://faux-api');
  const segments = url.pathname.split('/').filter(Boolean);
  const methode = req.method ?? 'GET';
  res.setHeader('X-Simulateur-De-Test', 'faux-api Comtaple');
  const journaliser = (statut: number) => journal.push({ methode, chemin: `${url.pathname}${url.search}`, statut, utilisateur: (req as Enr).utilisateur ?? null });
  try {
    const binaire = req.headers['content-type'] === 'application/octet-stream';
    const corps = methode === 'GET' ? Buffer.alloc(0) : await lireCorps(req, binaire ? TAILLE_MORCEAU : 256 * 1024);
    const json = () => {
      try {
        return (corps.length ? JSON.parse(corps.toString('utf8')) : {}) as Enr;
      } catch {
        throw new ErreurHttp(400, 'JSON invalide');
      }
    };
    let resultat: unknown;
    if (segments[0] === '__test') {
      // Routes de pilotage des tests : absentes de l'API réelle.
      if (methode === 'POST' && segments[1] === 'reinitialiser') {
        ENTITES = structuredClone(ENTITES_INITIALES);
        HABILITATIONS = structuredClone(HABILITATIONS_INITIALES);
        APPARTENANCES_EN_PLUS = [];
        audit = [];
        ruptureAudit = null;
        etat = etatInitial();
        tracerAudit({ cabinetId: DEMO.cabinetA }, 'import.fec.termine', 'lot_import', etat.lots[0]!.id, DEMO.dupain, { lignes: 1250, lisible: true, anomalies: { CHAMP_VIDE: 60 } });
        mail = mailInitial();
        pannes = { couperMorceauNumero: 0, conflitMorceauNumero: 0, ralentirMorceauxMs: 0, erreurTerminer: 0 };
        compteurMorceaux = 0;
        journal = [];
        resultat = { ok: true };
      } else if (methode === 'POST' && segments[1] === 'administration') {
        // Pilotage : appartenance supplémentaire (compte multi-cabinets), rupture simulée de la chaîne d'audit, masse de documents.
        const d = json();
        if (d.appartenance) APPARTENANCES_EN_PLUS.push(d.appartenance);
        if (d.rupture !== undefined) ruptureAudit = d.rupture;
        if (typeof d.documents === 'number') {
          const modele: Enr = etat.documents[0]!;
          for (let i = 0; i < d.documents; i++) {
            const doc: Enr = { ...modele, id: randomUUID(), nomOrigine: `piece-en-masse-${String(i + 1).padStart(3, '0')}.pdf`, statut: i % 2 ? 'a_controler' : 'traite', creeLe: instant() };
            etat.documents.push(doc);
            etat.receptions.push({ id: randomUUID(), cabinetId: doc.cabinetId, entiteId: doc.entiteId, documentId: doc.id, canal: 'ordinateur', deposantId: DEMO.chloe, doublonBinaire: false, provenance: {}, recuLe: doc.creeLe });
          }
        }
        if (d.obsoleteRapprochement) for (const x of etat.rapprochementsExec) x.obsolete = true;
        resultat = { entites: ENTITES.map((e) => ({ id: e.id, raisonSociale: e.raisonSociale, territoireFiscal: e.territoireFiscal ?? 'metropole' })), habilitations: HABILITATIONS, exercices: etat.exercices.map((x) => ({ id: x.id, entiteId: x.entiteId, debut: x.debut, fin: x.fin })), televersements: etat.televersements.map((t) => ({ id: t.id, statut: t.statut })), propositions: etat.propositions.map((x) => ({ id: x.id, statut: x.statut, motif: x.motif, regle: x.regle })) };
      } else if (methode === 'POST' && segments[1] === 'mail') {
        // Pilotage de la messagerie simulée : connecteur configuré ou non, jeu de données fictif.
        const d = json();
        if (typeof d.configure === 'boolean') mail.configure = d.configure;
        if (d.amorcer === true) amorcerMail();
        resultat = { configure: mail.configure, connexions: mail.connexions.map((l) => ({ id: l.id, fournisseur: l.fournisseur, statut: l.statut, configuration: l.configuration })), pieces: mail.pieces.map((x) => ({ id: x.id, statut: x.statut, dossierAffecteId: x.dossierAffecteId })), demandes: mail.demandes.length };
      } else if (methode === 'GET' && segments[1] === 'fournisseur') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(pageFournisseur(url.searchParams));
      } else if (methode === 'POST' && segments[1] === 'pannes') {
        pannes = { ...pannes, ...json() };
        compteurMorceaux = 0;
        resultat = pannes;
      } else if (methode === 'GET' && segments[1] === 'journal') resultat = journal;
      else if (methode === 'GET' && segments[1] === 'etat') {
        resultat = {
          documents: etat.documents.map((d) => {
            const f = etat.fichiers.find((x) => x.id === d.fichierId);
            const contenu = f ? etat.contenus.get(f.id) : undefined;
            return { id: d.id, nomOrigine: d.nomOrigine, nature: d.nature, statut: d.statut, commentaire: d.commentaire, sha256: f?.sha256, taille: f?.taille, entete: contenu?.subarray(0, 5).toString('latin1'), canal: etat.receptions.findLast((x) => x.documentId === d.id)?.canal };
          }),
          televersements: etat.televersements.map(vueT),
          echanges: etat.echanges.map((x) => ({ type: x.type, message: x.message, documentId: x.documentId })),
        };
      } else if (methode === 'POST' && segments[1] === 'obsolete') {
        // Marque la dernière exécution des contrôles comme obsolète (ce que fait le worker après un nouvel import).
        const derniere = etat.executions.at(-1);
        if (derniere) derniere.obsolete = true;
        resultat = { ok: Boolean(derniere) };
      }
      else throw new ErreurHttp(404, 'Route de test inconnue');
    } else if (segments[0] === 'v1') {
      resultat = await routerV1({ methode, segments: segments.slice(1), query: url.searchParams, corps, json, req, res });
    } else throw new ErreurHttp(404, `Cannot ${methode} ${url.pathname}`);
    if (res.writableEnded || res.destroyed || resultat === undefined) {
      journaliser(res.statusCode);
      return;
    }
    const sortie = Buffer.from(JSON.stringify(resultat));
    // NestJS répond 201 à un POST, sauf mention contraire (@HttpCode) : terminer et validation répondent 200.
    if (res.statusCode === 200 && methode === 'POST' && segments[0] === 'v1' && !/\/(terminer|validation|affecter|mail\/retour)$/.test(url.pathname)) res.statusCode = 201;
    res.writeHead(res.statusCode, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': sortie.length });
    res.end(sortie);
    journaliser(res.statusCode);
  } catch (e) {
    if (res.destroyed) return;
    const statut = e instanceof ErreurHttp ? e.statut : 500;
    const corps = e instanceof ErreurHttp ? (typeof e.corps === 'string' ? { message: e.corps, error: NOMS[statut] ?? 'Error', statusCode: statut } : e.corps) : { statusCode: 500, message: 'Internal server error' };
    if (!(e instanceof ErreurHttp)) console.error('[faux-api]', e);
    res.writeHead(statut, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(corps));
    journaliser(statut);
  }
});
serveur.listen(PORT, '127.0.0.1', () => console.log(`[faux-api] SIMULATEUR DE TEST à l’écoute sur http://127.0.0.1:${PORT} (morceaux de ${TAILLE_MORCEAU} octets)`));

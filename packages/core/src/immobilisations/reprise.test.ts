import iconv from 'iconv-lite';
import { describe, expect, it } from 'vitest';
import {
  CODES_CHAMPS_REPRISE,
  ErreurReprise,
  LIGNES_MAX_REPRISE,
  TAILLE_MAX_REPRISE,
  analyserReprise,
  cleDoublon,
  controlerLigne,
  lireFichierReprise,
  neutraliserCellule,
  normaliserDesignation,
  problemesCorrespondance,
  proposerCorrespondance,
} from '../index.js';

const octets = (t: string) => new Uint8Array(Buffer.from(t, 'utf8'));
const ENTETE = 'Désignation;Compte;Valeur brute;Date de mise en service;Durée (mois)';
const csv = (...lignes: string[]) => [ENTETE, ...lignes].join('\n');
const analyser = (texte: string, existantes: Array<{ libelle: string; dateMiseEnService: string; baseAmortissable: string; id?: string; composantDe?: string | null }> = [], dejaRepris?: Set<number>) => {
  const f = lireFichierReprise(octets(texte));
  const { correspondance } = proposerCorrespondance(f.entetes);
  return { f, correspondance, ...analyserReprise(f, correspondance, { existantes, dejaRepris }) };
};
const refus = (fn: () => unknown): ErreurReprise => {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(ErreurReprise);
    return e as ErreurReprise;
  }
  throw new Error('refus attendu');
};

describe('lecture du fichier : encodage, séparateur, structure', () => {
  it('UTF-8 avec point-virgule : accents lus, séparateur et encodage détectés', () => {
    const f = lireFichierReprise(octets(csv('Véhicule utilitaire;218200;18 500,00;15/03/2024;60')));
    expect(f.separateur).toBe(';');
    expect(f.encodage).toBe('utf-8');
    expect(f.entetes[0]).toBe('Désignation');
    expect(f.lignes[0]?.cellules[0]).toBe('Véhicule utilitaire');
    expect(f.lignes[0]?.numero).toBe(2);
  });

  it('ISO-8859-15 : « é », « € » et « œ » sont décodés correctement', () => {
    const texte = 'Désignation;Compte;Valeur brute;Date de mise en service;Durée (mois)\nCœur de four (≈ 1 000 €);215400;1000,00;01/02/2024;120\n'.replace('≈ ', '');
    const f = lireFichierReprise(new Uint8Array(iconv.encode(texte, 'ISO-8859-15')));
    expect(f.encodage).toBe('iso-8859-15');
    expect(f.entetes[0]).toBe('Désignation');
    expect(f.lignes[0]?.cellules[0]).toBe('Cœur de four (1 000 €)');
  });

  it('encodage imposé : remplace la détection, et un texte illisible est signalé', () => {
    const brut = new Uint8Array(iconv.encode(csv('Café;218300;100,00;01/01/2024;36'), 'ISO-8859-15'));
    const mal = lireFichierReprise(brut, { encodage: 'utf-8' });
    expect(mal.encodageImpose).toBe(true);
    expect(mal.avertissements.join(' ')).toMatch(/illisibles/);
    expect(lireFichierReprise(brut, { encodage: 'iso-8859-15' }).lignes[0]?.cellules[0]).toBe('Café');
  });

  it('BOM UTF-8 : retiré de la première en-tête', () => {
    const f = lireFichierReprise(new Uint8Array(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(csv('A;218300;1,00;01/01/2024;12'), 'utf8')])));
    expect(f.entetes[0]).toBe('Désignation');
  });

  it('virgule comme séparateur (valeurs entre guillemets), tabulation, retours chariot Windows', () => {
    const v = lireFichierReprise(octets('Désignation,Compte,Valeur brute,Date de mise en service,Durée (mois)\r\n"Table, bureau",218400,"1 200,50",01/01/2024,60\r\n'));
    expect(v.separateur).toBe(',');
    expect(v.lignes[0]?.cellules).toEqual(['Table, bureau', '218400', '1 200,50', '01/01/2024', '60']);
    const t = lireFichierReprise(octets('Désignation\tCompte\tValeur brute\tDate de mise en service\tDurée (mois)\nA\t218300\t1.00\t01/01/2024\t12\n'));
    expect(t.separateur).toBe('\t');
  });

  it('guillemets doublés et retour à la ligne dans un champ : le numéro de ligne reste celui du fichier', () => {
    const f = lireFichierReprise(octets(`${ENTETE}\n"Machine ""X""\nsuite";215400;100,00;01/01/2024;60\nB;215400;200,00;01/01/2024;60\n`));
    expect(f.lignes[0]).toMatchObject({ numero: 2, cellules: ['Machine "X"\nsuite', '215400', '100,00', '01/01/2024', '60'] });
    expect(f.lignes[1]?.numero).toBe(4);
  });

  it('lignes vides ignorées, sans décaler les numéros', () => {
    const f = lireFichierReprise(octets(`${ENTETE}\n\nA;218300;1,00;01/01/2024;12\n;;;;\n\nB;218300;2,00;01/01/2024;12\n`));
    expect(f.lignes.map((l) => l.numero)).toEqual([3, 6]);
    expect(f.lignesVidesIgnorees).toBe(3);
  });

  it('refus du fichier entier : vide, en-têtes seuls, un seul séparateur, guillemet ouvert', () => {
    expect(refus(() => lireFichierReprise(new Uint8Array(0))).code).toBe('vide');
    expect(refus(() => lireFichierReprise(octets('   \n\n'))).code).toBe('vide');
    expect(refus(() => lireFichierReprise(octets(`${ENTETE}\n`))).code).toBe('sans_donnees');
    expect(refus(() => lireFichierReprise(octets('une seule colonne\nA\n'))).code).toBe('sans_separateur');
    const g = refus(() => lireFichierReprise(octets(`${ENTETE}\nA;"ouvert;1;2;3\nB;1;2;3;4\n`)));
    expect(g.code).toBe('guillemet');
    expect(g.ligne).toBe(2);
  });

  it('refus des formats non CSV : XLSX/ZIP, XLS, PDF, binaire', () => {
    expect(refus(() => lireFichierReprise(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]))).message).toMatch(/seuls les formats CSV et XLSX|archive ZIP illisible/);
    expect(refus(() => lireFichierReprise(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0]))).code).toBe('format');
    expect(refus(() => lireFichierReprise(octets('%PDF-1.7\n...'))).code).toBe('format');
    expect(refus(() => lireFichierReprise(new Uint8Array([65, 59, 66, 0, 10, 67]))).code).toBe('binaire');
  });

  it('limites : taille (5 Mio) et nombre de lignes (5 000), refus net', () => {
    expect(refus(() => lireFichierReprise(new Uint8Array(TAILLE_MAX_REPRISE + 1).fill(65))).code).toBe('trop_gros');
    const ligne = 'A;218300;1,00;01/01/2024;12';
    const juste = lireFichierReprise(octets([ENTETE, ...Array.from({ length: LIGNES_MAX_REPRISE }, () => ligne)].join('\n')));
    expect(juste.lignes).toHaveLength(LIGNES_MAX_REPRISE);
    const trop = refus(() => lireFichierReprise(octets([ENTETE, ...Array.from({ length: LIGNES_MAX_REPRISE + 1 }, () => ligne)].join('\n'))));
    expect(trop.code).toBe('trop_de_lignes');
    expect(trop.message).toMatch(/5000/);
  });
});

describe('correspondance des colonnes', () => {
  it('propose les en-têtes usuels, durée en mois avec unité explicite', () => {
    const p = proposerCorrespondance(['Désignation', 'Compte', 'Valeur brute', 'Date d’acquisition', 'Date de mise en service', 'Durée (mois)', 'Mode d’amortissement', 'Valeur résiduelle', 'Date de sortie']);
    expect(p.correspondance).toEqual({ libelle: 0, compteImmobilisation: 1, baseAmortissable: 2, dateAcquisition: 3, dateMiseEnService: 4, dureeMois: 5, modeAmortissement: 6, valeurResiduelle: 7, dateSortie: 8 });
    expect(p.remarques).toEqual([]);
  });

  it('une durée sans unité n’est PAS proposée (jamais devinée) et la remarque le dit', () => {
    const p = proposerCorrespondance(['Libellé', 'N° compte', 'Montant', 'Mise en service', 'Durée']);
    expect(p.correspondance.dureeMois).toBeUndefined();
    expect(p.correspondance.dureeAnnees).toBeUndefined();
    expect(p.remarques.join(' ')).toMatch(/mois ou en années/);
    expect(problemesCorrespondance(p.correspondance, 5).join(' ')).toMatch(/durée d’amortissement/);
  });

  it('durée en années reconnue ; mois ET années ensemble : aucune proposition', () => {
    expect(proposerCorrespondance(['Désignation', 'Compte', 'Valeur brute', 'Date de mise en service', 'Durée (ans)']).correspondance.dureeAnnees).toBe(4);
    const deux = proposerCorrespondance(['Désignation', 'Compte', 'Valeur brute', 'Date de mise en service', 'Durée (ans)', 'Durée en mois']);
    expect(deux.correspondance.dureeAnnees).toBeUndefined();
    expect(deux.correspondance.dureeMois).toBeUndefined();
  });

  it('deux colonnes candidates pour un même champ : aucune proposition', () => {
    const p = proposerCorrespondance(['Désignation', 'Libellé', 'Compte', 'Valeur brute', 'Date de mise en service', 'Durée (mois)']);
    expect(p.correspondance.libelle).toBeUndefined();
    expect(p.remarques.join(' ')).toMatch(/Plusieurs colonnes/);
  });

  it('en-têtes inconnus : aucune proposition, colonnes obligatoires listées comme absentes', () => {
    const p = proposerCorrespondance(['Alpha', 'Beta', 'Gamma']);
    expect(p.correspondance).toEqual({});
    const manques = problemesCorrespondance(p.correspondance, 3);
    expect(manques.filter((m) => /obligatoire absente/.test(m)).length).toBeGreaterThanOrEqual(5);
  });

  it('correspondance incohérente : colonne inexistante, colonne utilisée deux fois, deux durées', () => {
    const base = { libelle: 0, compteImmobilisation: 1, baseAmortissable: 2, dateMiseEnService: 3, dureeMois: 4 };
    expect(problemesCorrespondance(base, 5)).toEqual([]);
    expect(problemesCorrespondance({ ...base, dateSortie: 9 }, 5).join(' ')).toMatch(/n’existe pas/);
    expect(problemesCorrespondance({ ...base, dateSortie: 0 }, 5).join(' ')).toMatch(/même colonne/);
    expect(problemesCorrespondance({ ...base, dureeAnnees: 2 }, 5).join(' ')).toMatch(/une seule durée/);
  });
});

describe('contrôle d’une ligne : mêmes règles que la saisie manuelle', () => {
  const ligne = (texte: string) => analyser(csv(texte)).lignes[0]!;

  it('ligne valide : montants en chaîne décimale exacte (virgule), dates JJ/MM/AAAA, durée entière', () => {
    const l = ligne('Serveur de fichiers;218300;12 345,60;15/03/2024;60');
    expect(l.statut).toBe('valide');
    expect(l.immobilisation).toMatchObject({ libelle: 'Serveur de fichiers', compteImmobilisation: '218300', baseAmortissable: '12345.60', dateMiseEnService: '2024-03-15', dureeMois: 60, modeAmortissement: 'lineaire', coefficientDegressif: null, eligibiliteDegressifConfirmee: null, dateAcquisition: null });
  });

  it('point décimal, séparateur de milliers français, AAAA-MM-JJ', () => {
    expect(ligne('A;218300;1234.50;2024-03-15;60').immobilisation?.baseAmortissable).toBe('1234.50');
    expect(ligne('A;218300;1.234,50;2024-03-15;60').immobilisation?.baseAmortissable).toBe('1234.50');
    expect(ligne('A;218300;1234;2024-03-15;60').immobilisation?.baseAmortissable).toBe('1234.00');
  });

  it('montant ambigu, à trois décimales ou illisible : rejet motivé, jamais d’arrondi', () => {
    expect(ligne('A;218300;1.234;15/03/2024;60').motifs.join(' ')).toMatch(/Valeur brute à amortir \(€\) : montant illisible ou ambigu/);
    expect(ligne('A;218300;12,345;15/03/2024;60').motifs.join(' ')).toMatch(/plus de deux décimales/);
    expect(ligne('A;218300;douze;15/03/2024;60').statut).toBe('invalide');
    expect(ligne('A;218300;0;15/03/2024;60').motifs.join(' ')).toMatch(/strictement positive/);
    expect(ligne('A;218300;-50,00;15/03/2024;60').motifs.join(' ')).toMatch(/strictement positive/);
  });

  it('dates : année à deux chiffres, mois 13, 30 février, texte, numéro de série tableur', () => {
    for (const d of ['15/03/24', '15/13/2024', '30/02/2024', 'mars 2024', '45366']) {
      const l = ligne(`A;218300;100,00;${d};60`);
      expect(l.statut, d).toBe('invalide');
      expect(l.motifs.join(' '), d).toMatch(/Date de mise en service : date/);
    }
  });

  it('durée : entière seulement (décimale, négative, texte, nulle refusées) ; années converties en mois', () => {
    for (const d of ['5,5', '-12', 'cinq', '0', '12 mois']) expect(ligne(`A;218300;100,00;15/03/2024;${d}`).statut, d).toBe('invalide');
    const a = analyser('Désignation;Compte;Valeur brute;Date de mise en service;Durée (ans)\nA;218300;100,00;15/03/2024;5\nB;218300;100,00;15/03/2024;5,5\n');
    expect(a.lignes[0]?.immobilisation?.dureeMois).toBe(60);
    expect(a.lignes[1]?.motifs.join(' ')).toMatch(/Durée d’amortissement en années : durée entière/);
  });

  it('compte : classe 20 ou 21 seulement, chiffres seuls', () => {
    expect(ligne('A;205000;100,00;15/03/2024;60').statut).toBe('valide');
    expect(ligne('A;212000;100,00;15/03/2024;60').statut).toBe('valide');
    expect(ligne('A;231000;100,00;15/03/2024;60').motifs.join(' ')).toMatch(/classe 20 \(incorporelles\) ou 21/);
    expect(ligne('A;2183xx;100,00;15/03/2024;60').motifs.join(' ')).toMatch(/chiffres seuls/);
    expect(ligne('A;2;100,00;15/03/2024;60').statut).toBe('invalide');
  });

  it('colonne obligatoire vide : refus de la ligne, motif par champ', () => {
    // Une ligne entièrement vide est ignorée par la lecture ; ici une ligne partielle.
    const p = ligne('  ;218300;100,00;15/03/2024;60');
    expect(p.motifs).toEqual(['Désignation : valeur obligatoire absente']);
  });

  it('désignation : espaces réduits, caractères de contrôle refusés, plus de 200 caractères refusés', () => {
    expect(ligne('  Table   de   réunion ;218400;100,00;15/03/2024;60').immobilisation?.libelle).toBe('Table de réunion');
    expect(analyser(csv(`A${'x'.repeat(201)};218400;100,00;15/03/2024;60`)).lignes[0]?.statut).toBe('invalide');
    const c = controlerLigne(2, ['A\u0007B', '218400', '100,00', '15/03/2024', '60'], ENTETE.split(';'), { libelle: 0, compteImmobilisation: 1, baseAmortissable: 2, dateMiseEnService: 3, dureeMois: 4 });
    expect(c.motifs.join(' ')).toMatch(/caractères de contrôle/);
  });

  it('nombre de colonnes inattendu : ligne malformée rejetée, rien n’est deviné', () => {
    expect(ligne('A;218300;100,00;15/03/2024').motifs[0]).toMatch(/Nombre de colonnes inattendu : 4 colonne\(s\) lue\(s\) au lieu de 5/);
    expect(ligne('A;218300;100;00;15/03/2024;60').motifs[0]).toMatch(/6 colonne\(s\)/);
  });

  it('valeurs croisées de la saisie manuelle : résiduelle ≥ brute, acquisition après mise en service, sortie avant mise en service, antérieurs trop grands', () => {
    const e = 'Désignation;Compte;Valeur brute;Date d’acquisition;Date de mise en service;Durée (mois);Valeur résiduelle;Date de sortie;Amortissements antérieurs';
    const a = (l: string) => analyser(`${e}\n${l}\n`).lignes[0]!;
    expect(a('A;218300;100,00;01/01/2024;15/03/2024;60;100,00;;').motifs.join(' ')).toMatch(/strictement inférieure à la valeur brute/);
    expect(a('A;218300;100,00;01/05/2024;15/03/2024;60;;;').motifs.join(' ')).toMatch(/postérieure à la mise en service/);
    expect(a('A;218300;100,00;;15/03/2024;60;;01/01/2024;').motifs.join(' ')).toMatch(/ne peut pas précéder/);
    expect(a('A;218300;100,00;;15/03/2024;60;20,00;;90,00').motifs.join(' ')).toMatch(/compris entre zéro et le montant amortissable/);
    expect(a('A;218300;100,00;01/03/2024;15/03/2024;60;20,00;;50,00').immobilisation).toMatchObject({ valeurResiduelle: '20.00', amortissementsAnterieurs: '50.00', dateAcquisition: '2024-03-01' });
  });

  const EDEG = 'Désignation;Compte;Valeur brute;Date d’acquisition;Date de mise en service;Durée (mois);Mode d’amortissement;Coefficient dégressif;Éligibilité dégressif';
  const deg = (l: string) => analyser(`${EDEG}\n${l}\n`).lignes[0]!;

  it('dégressif : la date d’acquisition est OBLIGATOIRE, comme à la saisie manuelle', () => {
    expect(deg('Four;215400;10000,00;;15/11/2025;120;dégressif;2,25;oui').motifs.join(' ')).toMatch(/Dégressif : la date d’acquisition \(ou de construction\) est obligatoire/);
  });

  it('dégressif complet : enregistré tel que déclaré (coefficient et éligibilité inclus), aucun calcul ici', () => {
    const l = deg('Four;215400;10000,00;05/11/2025;15/11/2025;120;Dégressif;2,25;oui');
    expect(l.statut).toBe('valide');
    expect(l.immobilisation).toMatchObject({ modeAmortissement: 'degressif', coefficientDegressif: '2.25', eligibiliteDegressifConfirmee: true, dateAcquisition: '2025-11-05', dureeMois: 120 });
  });

  it('dégressif : coefficient incohérent, éligibilité absente, compte hors classe 21, durée non entière en années : rejets', () => {
    expect(deg('Four;215400;10000,00;05/11/2025;15/11/2025;120;dégressif;1,75;oui').motifs.join(' ')).toMatch(/incohérent avec la durée de 10 ans/);
    expect(deg('Four;215400;10000,00;05/11/2025;15/11/2025;120;dégressif;2,25;').motifs.join(' ')).toMatch(/confirmer \(true\) ou infirmer \(false\)/);
    expect(deg('Logiciel;205000;10000,00;05/11/2025;15/11/2025;120;dégressif;2,25;oui').motifs.join(' ')).toMatch(/classe 21/);
    expect(deg('Four;215400;10000,00;05/11/2025;15/11/2025;100;dégressif;2,25;oui').motifs.join(' ')).toMatch(/années entières/);
    expect(deg('Four;215400;10000,00;05/11/2025;15/11/2025;120;dégressif;;oui').motifs.join(' ')).toMatch(/coefficient est à déclarer/);
  });

  it('linéaire avec coefficient ou éligibilité renseignés : rejet (n’a de sens qu’en dégressif) ; mode inconnu rejeté', () => {
    expect(deg('Four;215400;10000,00;05/11/2025;15/11/2025;120;linéaire;2,25;').motifs.join(' ')).toMatch(/n’a de sens qu’en mode dégressif/);
    expect(deg('Four;215400;10000,00;05/11/2025;15/11/2025;120;;;non').motifs.join(' ')).toMatch(/Éligibilité au dégressif confirmée : L’éligibilité au dégressif n’a de sens/);
    expect(deg('Four;215400;10000,00;05/11/2025;15/11/2025;120;exponentiel;;').motifs.join(' ')).toMatch(/mode inconnu/);
    expect(deg('Four;215400;10000,00;05/11/2025;15/11/2025;120;;;').immobilisation?.modeAmortissement).toBe('lineaire');
  });

  it('colonne obligatoire non associée : toutes les lignes sont rejetées avec ce motif', () => {
    const f = lireFichierReprise(octets(csv('A;218300;100,00;15/03/2024;60')));
    const r = analyserReprise(f, { libelle: 0, compteImmobilisation: 1, baseAmortissable: 2, dureeMois: 4 }, { existantes: [] });
    expect(r.problemes.join(' ')).toMatch(/Date de mise en service/);
    expect(r.lignes[0]?.statut).toBe('invalide');
    expect(r.lignes[0]?.motifs.join(' ')).toMatch(/Colonne obligatoire absente : « Date de mise en service »/);
  });
});

describe('doublons : jamais écrasants', () => {
  const existante = { libelle: 'Serveur de fichiers', dateMiseEnService: '2024-03-15', baseAmortissable: '12345.60' };

  it('même (désignation normalisée, date de mise en service, valeur) qu’une immobilisation du dossier : ignorée', () => {
    const r = analyser(csv('  SERVEUR  de  fichiers ;218300;12345,6;15/03/2024;60', 'serveur de fichier;218300;12345,60;15/03/2024;60', 'Serveur de fichiers;218300;12345,60;16/03/2024;60'), [existante]);
    expect(r.lignes.map((l) => [l.statut, l.cause])).toEqual([['doublon', 'doublon_dossier'], ['valide', null], ['valide', null]]);
    expect(r.lignes[0]?.immobilisation).toBeNull();
    expect(r.comptes).toEqual({ total: 3, valides: 2, invalides: 0, doublons: 1 });
  });

  it('accents et ponctuation sans effet sur la comparaison', () => {
    expect(normaliserDesignation('  Véhicule — Utilitaire (Renault) ')).toBe('vehicule utilitaire renault');
    expect(cleDoublon('Véhicule', '2024-01-01', '10')).toBe(cleDoublon('VEHICULE', '2024-01-01', '10.00'));
  });

  it('doublon à l’intérieur du fichier : la première occurrence est retenue, la suivante ignorée avec son renvoi', () => {
    const r = analyser(csv('Table;218400;100,00;01/01/2024;60', 'Chaise;218400;50,00;01/01/2024;60', 'table;218400;100,00;01/01/2024;36'));
    expect(r.lignes.map((l) => l.statut)).toEqual(['valide', 'valide', 'doublon']);
    expect(r.lignes[2]?.cause).toBe('doublon_fichier');
    expect(r.lignes[2]?.motifs[0]).toMatch(/identique à la ligne 2/);
  });

  it('ligne déjà reprise lors d’un import antérieur du même fichier : ignorée (idempotence par empreinte + numéro de ligne)', () => {
    const r = analyser(csv('Table;218400;100,00;01/01/2024;60', 'Chaise;218400;50,00;01/01/2024;60'), [], new Set([2]));
    expect(r.lignes.map((l) => [l.statut, l.cause])).toEqual([['doublon', 'deja_repris'], ['valide', null]]);
  });

  it('une ligne invalide n’occupe jamais la clé d’un doublon', () => {
    const r = analyser(csv('Table;218400;100,00;32/01/2024;60', 'Table;218400;100,00;01/01/2024;60'));
    expect(r.lignes.map((l) => l.statut)).toEqual(['invalide', 'valide']);
  });
});

describe('sécurité du contenu : aucune formule n’est interprétée', () => {
  it('neutralise = + - @ (et tabulation, retour chariot, formes pleine chasse) à l’affichage', () => {
    for (const v of ['=SOMME(A1)', '+33612345678', '-1+2', '@cmd', '\tx', '\rx', '＝1', ' =1']) expect(neutraliserCellule(v), v).toBe(`'${v}`);
    for (const v of ['Serveur', '12,50', '', 'a=b', '15/03/2024']) expect(neutraliserCellule(v), v).toBe(v);
  });

  it('une désignation « formule » est lue comme texte inerte : conservée telle quelle (valeur lue), jamais évaluée', () => {
    const r = analyser(csv('=HYPERLINK("http://x","a");218300;100,00;15/03/2024;60', '@SUM(1+1);218300;101,00;15/03/2024;60'));
    expect(r.lignes[0]?.statut).toBe('valide');
    expect(r.lignes[0]?.immobilisation?.libelle).toBe('=HYPERLINK("http://x","a")');
    expect(r.lignes[1]?.lues.libelle).toBe('@SUM(1+1)');
  });

  it('valeur lue tronquée à 200 caractères, octet nul retiré', () => {
    const l = controlerLigne(2, ['x'.repeat(500), '218300', '100,00', '15/03/2024', '60'], ENTETE.split(';'), { libelle: 0, compteImmobilisation: 1, baseAmortissable: 2, dateMiseEnService: 3, dureeMois: 4 });
    expect(l.lues.libelle?.length).toBe(201);
    expect(l.statut).toBe('invalide');
  });
});

describe('structure', () => {
  it('chaque champ proposé existe dans la liste des champs', () => {
    expect(CODES_CHAMPS_REPRISE).toContain('dureeAnnees');
    expect(new Set(CODES_CHAMPS_REPRISE).size).toBe(CODES_CHAMPS_REPRISE.length);
  });
});

describe('composants : rattachement par désignation du bien principal (D-125)', () => {
  const E = `${ENTETE};Composant de`;
  const f = (...l: string[]) => [E, ...l].join('\n');
  const ligne = (n: number, nom: string, compte: string, cmp = '') => `${nom};${compte};${1000 + n},00;01/01/2024;120;${cmp}`;

  it('colonne proposée d’après l’en-tête ; composant du fichier résolu sans rien deviner (accents et casse ignorés)', () => {
    const a = analyser(f(ligne(1, 'Bâtiment atelier', '213100'), ligne(2, 'Toiture', '213500', 'batiment ATELIER')));
    expect(a.correspondance.composantDe).toBe(5);
    expect(a.lignes[0]!.statut).toBe('valide');
    expect(a.lignes[0]!.composant ?? null).toBeNull();
    expect(a.lignes[1]).toMatchObject({ statut: 'valide', composant: { designation: 'batiment ATELIER', vers: { type: 'fichier', ligne: 2 } } });
  });
  it('composant d’un bien déjà au dossier : identifiant repris ; plusieurs correspondances, introuvable, composant de composant, soi-même : rejetés avec motif', () => {
    const existantes = [{ libelle: 'Entrepôt', dateMiseEnService: '2020-01-01', baseAmortissable: '9000.00', id: 'id-entrepot', composantDe: null }, { libelle: 'Chariot', dateMiseEnService: '2020-01-01', baseAmortissable: '100.00', id: 'a1', composantDe: 'id-entrepot' }, { libelle: 'Chariot', dateMiseEnService: '2021-01-01', baseAmortissable: '200.00', id: 'a2', composantDe: null }];
    const a = analyser(f(ligne(1, 'Quai', '213500', 'Entrepôt'), ligne(2, 'Roue', '215400', 'Chariot'), ligne(3, 'Fantôme', '215400', 'Absent'), ligne(4, 'Sous-toit', '213500', 'Quai'), ligne(5, 'Boucle', '213500', 'Boucle')), existantes);
    expect(a.lignes[0]).toMatchObject({ statut: 'valide', composant: { vers: { type: 'dossier', id: 'id-entrepot' } } });
    expect(a.lignes[1]).toMatchObject({ statut: 'invalide' });
    expect(a.lignes[1]!.motifs.join(' ')).toMatch(/2 biens portent cette désignation/);
    expect(a.lignes[2]!.motifs.join(' ')).toMatch(/aucun bien principal/);
    expect(a.lignes[3]!.motifs.join(' ')).toMatch(/lui-même un composant/);
    expect(a.lignes[4]!.motifs.join(' ')).toMatch(/aucun bien principal|propre composant/);
    expect(a.comptes).toMatchObject({ valides: 1, invalides: 4 });
  });
  it('un fichier sans la colonne reste inchangé ; un bien principal en doublon retombe sur l’existant', () => {
    expect(analyser(csv('A;213100;100,00;01/01/2024;12')).lignes[0]).toMatchObject({ statut: 'valide' });
    const existantes = [{ libelle: 'Atelier', dateMiseEnService: '2024-01-01', baseAmortissable: '1001.00', id: 'x', composantDe: null }];
    const a = analyser(f(ligne(1, 'Atelier', '213100'), ligne(2, 'Porte', '213500', 'Atelier')), existantes);
    expect(a.lignes[0]).toMatchObject({ statut: 'doublon', cause: 'doublon_dossier' });
    expect(a.lignes[1]).toMatchObject({ statut: 'valide', composant: { vers: { type: 'dossier', id: 'x' } } });
  });
});

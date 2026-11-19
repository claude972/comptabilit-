import iconv from 'iconv-lite';
import { describe, expect, it } from 'vitest';
import { lireFec, octets } from '../aides-tests.js';
import { CHAMPS_FEC, PLAFOND_ANOMALIES_FEC, TAILLE_MAX_LIGNE_FEC, analyserFec, enBlocs } from './analyser.js';

const ENTETE = CHAMPS_FEC.join('\t');
const L1 = 'VT\tVentes\tVT000001\t20250115\t41100000\tClients\tC0001\tDupont\tFA-1\t20250115\tFacture FA-1\t120,00\t0,00\t\t\t20250115\t\t';
const L2 = 'VT\tVentes\tVT000001\t20250115\t70700000\tVentes de marchandises\t\t\tFA-1\t20250115\tFacture FA-1\t0,00\t100,00\t\t\t20250115\t\t';
const L3 = 'VT\tVentes\tVT000001\t20250115\t44571000\tTVA collectée\t\t\tFA-1\t20250115\tFacture FA-1\t0,00\t20,00\t\t\t20250115\t\t';
const FEC = [ENTETE, L1, L2, L3, ''].join('\r\n');
const codes = (r: { nbAnomaliesParCode: Record<string, number> }): string[] => Object.keys(r.nbAnomaliesParCode).sort();

describe('analyserFec — lecture nominale', () => {
  it('normalise les lignes (dates ISO, montants à point, champs vides → null, numéro de ligne d’origine)', async () => {
    const { rapport, lignes } = await lireFec(FEC);
    expect(rapport).toMatchObject({
      encodage: 'utf-8', separateur: 'tabulation', variante: 'debit_credit', nbLignesLues: 3, nbLignesNormalisees: 3, lisible: true,
      conforme: true, suffisantPourTravaux: true, totalDebit: '120.00', totalCredit: '120.00', dateMin: '2025-01-15', dateMax: '2025-01-15', anomalies: [],
    });
    expect(rapport.entetes).toEqual([...CHAMPS_FEC]);
    expect(lignes[0]).toMatchObject({
      numeroLigne: 2, journalCode: 'VT', journalLib: 'Ventes', ecritureNum: 'VT000001', ecritureDate: '2025-01-15', compteNum: '41100000', compteLib: 'Clients',
      compAuxNum: 'C0001', compAuxLib: 'Dupont', pieceRef: 'FA-1', pieceDate: '2025-01-15', ecritureLib: 'Facture FA-1', debit: '120.00', credit: '0.00',
      ecritureLet: null, dateLet: null, validDate: '2025-01-15', montantDevise: null, idevise: null,
    });
    expect(lignes[2]?.numeroLigne).toBe(4);
    expect(lignes[2]?.compteLib).toBe('TVA collectée');
  });

  it('expose le référentiel vérifié, les contrôles implémentés et ceux qui ne le sont pas', async () => {
    const { rapport } = await lireFec(FEC);
    expect(rapport.referentiel).toMatchObject({ type: 'reglementaire', verification: 'verifiee', dateVerification: '2026-11-19' });
    expect(rapport.referentiel.url).toContain('legifrance.gouv.fr');
    expect(rapport.referentiel.reference).toContain('A47 A-1');
    expect(rapport.referentiel.controlesImplementes.length).toBeGreaterThan(20);
    expect(rapport.referentiel.controlesNonImplementes.join(' ')).toMatch(/XML/);
  });

  it.each([
    ['LF', '\n'],
    ['CRLF', '\r\n'],
    ['CR seul', '\r'],
  ])('fins de ligne %s, y compris sans fin de ligne finale', async (_nom, fin) => {
    for (const contenu of [[ENTETE, L1, L2, L3].join(fin), [ENTETE, L1, L2, L3, ''].join(fin)]) {
      const { rapport, lignes } = await lireFec(contenu);
      expect(rapport.nbLignesNormalisees).toBe(3);
      expect(rapport.conforme).toBe(true);
      expect(lignes.map((l) => l.numeroLigne)).toEqual([2, 3, 4]);
    }
  });

  it('résultat identique quel que soit le découpage en blocs (1, 2, 3, 7, 64 octets)', async () => {
    const reference = await lireFec(FEC);
    for (const taille of [1, 2, 3, 7, 64]) {
      const r = await lireFec(FEC, {}, taille);
      expect(r.lignes).toEqual(reference.lignes);
      expect(r.rapport).toEqual(reference.rapport);
    }
  });

  it('séparateur « | » et en-têtes insensibles à la casse', async () => {
    const contenu = [ENTETE.toUpperCase(), L1, L2, L3].join('\n').replaceAll('\t', '|');
    const { rapport, lignes } = await lireFec(contenu);
    expect(rapport.separateur).toBe('pipe');
    expect(rapport.conforme).toBe(true);
    expect(lignes).toHaveLength(3);
  });

  it('attend surLigne asynchrone, dans l’ordre', async () => {
    const vus: number[] = [];
    await analyserFec(enBlocs(octets(FEC)), {
      surLigne: async (l) => {
        await new Promise((r) => setTimeout(r, l.numeroLigne === 2 ? 15 : 1));
        vus.push(l.numeroLigne);
      },
    });
    expect(vus).toEqual([2, 3, 4]);
  });
});

describe('analyserFec — encodages', () => {
  const avecAccents = FEC.replace('Dupont', 'Société Générale à Noël — œuvre 15 €'.replace('—', '-'));
  it('UTF-8 avec BOM : lu, BOM signalé pour information, fichier conforme', async () => {
    const { rapport, lignes } = await lireFec(new Uint8Array([0xef, 0xbb, 0xbf, ...octets(avecAccents)]));
    expect(rapport.encodage).toBe('utf-8-bom');
    expect(codes(rapport)).toEqual(['ENCODAGE_BOM']);
    expect(rapport.conforme).toBe(true);
    expect(rapport.entetes[0]).toBe('JournalCode');
    expect(lignes[0]?.compAuxLib).toBe('Société Générale à Noël - œuvre 15 €');
  });
  it('ISO-8859-15 : œ et € correctement décodés, conforme', async () => {
    const { rapport, lignes } = await lireFec(iconv.encode(avecAccents, 'ISO-8859-15'));
    expect(rapport.encodage).toBe('iso-8859-15');
    expect(rapport.conforme).toBe(true);
    expect(lignes[0]?.compAuxLib).toBe('Société Générale à Noël - œuvre 15 €');
  });
  it('Windows-1252 (octets 0x80–0x9F) : lu correctement mais non conforme', async () => {
    const { rapport, lignes } = await lireFec(iconv.encode(avecAccents, 'windows-1252'));
    expect(rapport.encodage).toBe('windows-1252');
    expect(lignes[0]?.compAuxLib).toBe('Société Générale à Noël - œuvre 15 €');
    expect(codes(rapport)).toEqual(['ENCODAGE_NON_CONFORME']);
    expect(rapport.conforme).toBe(false);
    expect(rapport.lisible).toBe(true);
    expect(rapport.suffisantPourTravaux).toBe(true);
  });
  it('ASCII pur', async () => {
    const { rapport } = await lireFec(FEC.replace('TVA collectée', 'TVA collectee'));
    expect(rapport.encodage).toBe('ascii');
    expect(rapport.conforme).toBe(true);
  });
  it('mélange UTF-8 / Latin-9 : encodage « inconnu », non conforme, lecture poursuivie', async () => {
    const melange = Buffer.concat([Buffer.from(`${ENTETE}\n${L3}\n`, 'utf8'), iconv.encode(`${L3}\n`, 'ISO-8859-15')]);
    const { rapport } = await lireFec(melange);
    expect(rapport.encodage).toBe('inconnu');
    expect(rapport.nbAnomaliesParCode['ENCODAGE_INCONNU']).toBe(1);
    expect(rapport.conforme).toBe(false);
    expect(rapport.nbLignesNormalisees).toBe(2);
  });
  it('UTF-16 : refusé, illisible', async () => {
    const { rapport, lignes } = await lireFec(new Uint8Array([0xff, 0xfe, ...Buffer.from(FEC, 'utf16le')]));
    expect(rapport).toMatchObject({ lisible: false, conforme: false, suffisantPourTravaux: false, encodage: 'inconnu' });
    expect(codes(rapport)).toEqual(['ENCODAGE_ILLISIBLE']);
    expect(lignes).toEqual([]);
  });
});

describe('analyserFec — variantes de montants', () => {
  it('variante Montant/Sens (D, C, +1, -1) convertie en débit/crédit', async () => {
    const entete = ENTETE.replace('Debit\tCredit', 'Montant\tSens');
    const l = (montant: string, sens: string): string => L1.replace('120,00\t0,00', `${montant}\t${sens}`);
    const { rapport, lignes } = await lireFec([entete, l('120,00', 'D'), l('100,00', 'C'), l('15,00', '-1'), l('5,00', '+1'), l('10,00', 'c')].join('\n'));
    expect(rapport.variante).toBe('montant_sens');
    expect(lignes.map((x) => [x.debit, x.credit])).toEqual([['120.00', '0.00'], ['0.00', '100.00'], ['0.00', '15.00'], ['5.00', '0.00'], ['0.00', '10.00']]);
    expect(rapport.totalDebit).toBe('125.00');
    expect(rapport.totalCredit).toBe('125.00');
    expect(rapport.conforme).toBe(true);
  });
  it('Sens inconnu : ligne illisible signalée, traitement poursuivi, données insuffisantes', async () => {
    const entete = ENTETE.replace('Debit\tCredit', 'Montant\tSens');
    const { rapport, lignes } = await lireFec([entete, L1.replace('120,00\t0,00', '120,00\tX'), L1.replace('120,00\t0,00', '120,00\tD')].join('\n'));
    expect(lignes).toHaveLength(1);
    expect(rapport.nbLignesLues).toBe(2);
    expect(rapport.anomalies[0]).toMatchObject({ ligne: 2, colonne: 'Sens', code: 'LIGNE_ILLISIBLE', gravite: 'majeure' });
    expect(rapport).toMatchObject({ lisible: true, conforme: false, suffisantPourTravaux: false });
  });
  it('montants négatifs (signe à gauche ou à droite) reportés dans le sens opposé', async () => {
    const { rapport, lignes } = await lireFec([ENTETE, L1.replace('120,00\t0,00', '-120,00\t0,00'), L1.replace('120,00\t0,00', '0,00\t120,00-'), L1.replace('120,00\t0,00', '-50,00\t-30,00')].join('\n'));
    expect(lignes.map((x) => [x.debit, x.credit])).toEqual([['0.00', '120.00'], ['120.00', '0.00'], ['30.00', '50.00']]);
    expect(rapport.nbAnomaliesParCode['MONTANT_NEGATIF_NORMALISE']).toBe(3);
    expect(rapport.conforme).toBe(true); // les valeurs signées sont admises par le texte
  });
  it('point décimal, montant vide, séparateur de milliers : lus mais signalés non conformes', async () => {
    const { rapport, lignes } = await lireFec([ENTETE, L1.replace('120,00\t0,00', '120.00\t'), L2.replace('0,00\t100,00', '0\t1 100,5')].join('\n'));
    expect(lignes.map((x) => [x.debit, x.credit])).toEqual([['120.00', '0.00'], ['0.00', '1100.50']]);
    expect(codes(rapport)).toEqual(['DESEQUILIBRE_GLOBAL', 'ECRITURE_DESEQUILIBREE', 'MONTANT_FORMAT', 'MONTANT_SEPARATEUR_POINT', 'MONTANT_VIDE']);
    expect(rapport.conforme).toBe(false);
  });
  it('montant illisible : ligne écartée et comptée, le total ne l’inclut pas', async () => {
    const { rapport, lignes } = await lireFec([ENTETE, L1.replace('120,00', '12O,00'), L2, L3].join('\n'));
    expect(lignes).toHaveLength(2);
    expect(rapport.nbLignesLues).toBe(3);
    expect(rapport.nbLignesNormalisees).toBe(2);
    expect(rapport.nbAnomaliesParCode['LIGNE_ILLISIBLE']).toBe(1);
    expect(rapport.suffisantPourTravaux).toBe(false);
    expect(rapport.totalDebit).toBe('0.00');
  });
  it('plus de deux décimales conservées sans arrondi', async () => {
    const { lignes } = await lireFec([ENTETE, L1.replace('120,00', '120,125')].join('\n'));
    expect(lignes[0]?.debit).toBe('120.125');
  });
});

describe('analyserFec — écarts de structure', () => {
  it('fichier vide', async () => {
    const { rapport } = await lireFec('');
    expect(rapport).toMatchObject({ lisible: false, conforme: false, suffisantPourTravaux: false, nbLignesLues: 0, totalDebit: '0.00', dateMin: null });
    expect(codes(rapport)).toEqual(['FICHIER_VIDE']);
  });
  it('en-tête seul : conforme en structure mais ni lisible ni suffisant', async () => {
    const { rapport } = await lireFec(`${ENTETE}\r\n`);
    expect(rapport).toMatchObject({ lisible: false, conforme: true, suffisantPourTravaux: false });
  });
  it('séparateur point-virgule : lu, non conforme', async () => {
    const { rapport, lignes } = await lireFec(FEC.replaceAll('\t', ';'));
    expect(rapport.separateur).toBe('point_virgule');
    expect(lignes).toHaveLength(3);
    expect(codes(rapport)).toEqual(['SEPARATEUR_NON_CONFORME']);
    expect(rapport).toMatchObject({ lisible: true, conforme: false, suffisantPourTravaux: true });
  });
  it('aucun séparateur reconnu : bloquant', async () => {
    const { rapport } = await lireFec('JournalCode,JournalLib\nVT,Ventes\n');
    expect(rapport.separateur).toBe('inconnu');
    expect(rapport.anomalies[0]).toMatchObject({ code: 'SEPARATEUR_INCONNU', gravite: 'bloquante' });
    expect(rapport).toMatchObject({ lisible: false, conforme: false, suffisantPourTravaux: false });
  });
  it('champ obligatoire absent de l’en-tête (ValidDate) : lu, non conforme', async () => {
    const sans = (l: string): string => l.split('\t').filter((_, i) => i !== 15).join('\t');
    const { rapport, lignes } = await lireFec([ENTETE, L1, L2, L3].map(sans).join('\n'));
    expect(lignes).toHaveLength(3);
    expect(lignes[0]?.validDate).toBeNull();
    expect(rapport.anomalies).toContainEqual(expect.objectContaining({ code: 'ENTETE_CHAMP_MANQUANT', colonne: 'ValidDate', ligne: 1 }));
    expect(rapport).toMatchObject({ lisible: true, conforme: false, suffisantPourTravaux: true });
  });
  it('champ indispensable absent (CompteNum) : bloquant, rien n’est normalisé', async () => {
    const sans = (l: string): string => l.split('\t').filter((_, i) => i !== 4).join('\t');
    const { rapport, lignes } = await lireFec([ENTETE, L1, L2].map(sans).join('\n'));
    expect(lignes).toEqual([]);
    expect(rapport.nbAnomaliesParCode['ENTETE_CHAMP_ESSENTIEL_MANQUANT']).toBe(1);
    expect(rapport).toMatchObject({ lisible: false, conforme: false, suffisantPourTravaux: false });
  });
  it('ordre des colonnes différent : lu par nom, signalé', async () => {
    const permuter = (l: string): string => {
      const z = l.split('\t');
      [z[0], z[2]] = [z[2] as string, z[0] as string];
      return z.join('\t');
    };
    const { rapport, lignes } = await lireFec([ENTETE, L1, L2, L3].map(permuter).join('\n'));
    expect(lignes[0]).toMatchObject({ journalCode: 'VT', ecritureNum: 'VT000001' });
    expect(codes(rapport)).toEqual(['ENTETE_ORDRE']);
    expect(rapport.conforme).toBe(false);
  });
  it('alias CompteAuxNum et colonne supplémentaire : acceptés pour information', async () => {
    const entete = `${ENTETE.replace('CompAuxNum', 'CompteAuxNum').replace('CompAuxLib', 'CompteAuxLib')}\tCodeEtbt`;
    const { rapport, lignes } = await lireFec([entete, `${L1}\t01`, `${L2}\t01`, `${L3}\t01`].join('\n'));
    expect(lignes[0]?.compAuxNum).toBe('C0001');
    expect(codes(rapport)).toEqual(['ENTETE_ALIAS', 'ENTETE_CHAMP_SUPPLEMENTAIRE']);
    expect(rapport.conforme).toBe(true);
  });
  it('nombre de zones incorrect : zones en trop → ligne écartée ; zones manquantes en fin → ligne lue et signalée', async () => {
    const { rapport, lignes } = await lireFec([ENTETE, `${L1}\tX\tY`, L2.split('\t').slice(0, 16).join('\t'), L3].join('\n'));
    expect(lignes.map((l) => l.numeroLigne)).toEqual([3, 4]);
    expect(rapport.nbAnomaliesParCode).toMatchObject({ NB_CHAMPS: 2, LIGNE_ILLISIBLE: 1 });
    expect(rapport.suffisantPourTravaux).toBe(false);
  });
  it('dates : format non conforme toléré et signalé ; date d’écriture inexistante → ligne écartée ; date facultative illisible → null', async () => {
    const { rapport, lignes } = await lireFec([
      ENTETE,
      L1.replace('VT000001\t20250115', 'VT000001\t15/01/2025'),
      L2.replace('VT000001\t20250115', 'VT000001\t20250230'),
      L3.replace('\t\t\t20250115\t\t', '\tAA\t2025011\t20250115\t\t'),
    ].join('\n'));
    expect(lignes.map((l) => [l.numeroLigne, l.ecritureDate, l.dateLet])).toEqual([[2, '2025-01-15', null], [4, '2025-01-15', null]]);
    expect(rapport.nbAnomaliesParCode).toMatchObject({ DATE_FORMAT: 1, LIGNE_ILLISIBLE: 1, DATE_INVALIDE: 1 });
    expect(rapport.conforme).toBe(false);
  });
  it('29 février : accepté les années bissextiles seulement', async () => {
    const { lignes } = await lireFec([ENTETE, L1.replaceAll('20250115', '20240229'), L1.replaceAll('20250115', '20250229')].join('\n'));
    expect(lignes.map((l) => l.ecritureDate)).toEqual(['2024-02-29']);
  });
  it('champs obligatoires vides : signalés (mineure), ligne conservée', async () => {
    const { rapport, lignes } = await lireFec([ENTETE, L1.replace('\tFA-1\t', '\t\t').replace('Clients', '')].join('\n'));
    expect(lignes).toHaveLength(1);
    expect(rapport.nbAnomaliesParCode['CHAMP_OBLIGATOIRE_VIDE']).toBe(2);
    expect(rapport.anomalies.every((a) => a.code !== 'CHAMP_OBLIGATOIRE_VIDE' || a.gravite === 'mineure')).toBe(true);
    expect(rapport.conforme).toBe(false);
  });
  it('lignes vides intercalées : ignorées, signalées pour information, numérotation d’origine conservée', async () => {
    const { rapport, lignes } = await lireFec([ENTETE, L1, '', L2, L3, '', ''].join('\n'));
    expect(lignes.map((l) => l.numeroLigne)).toEqual([2, 4, 5]);
    expect(rapport.nbAnomaliesParCode).toEqual({ LIGNE_VIDE: 1 });
    expect(rapport.conforme).toBe(true);
  });
  it('écriture déséquilibrée et déséquilibre global : signalés sans remettre en cause la conformité de format', async () => {
    const { rapport } = await lireFec([ENTETE, L1, L2].join('\n'));
    expect(rapport.nbAnomaliesParCode).toEqual({ ECRITURE_DESEQUILIBREE: 1, DESEQUILIBRE_GLOBAL: 1 });
    expect(rapport.anomalies[0]?.message).toContain('20.00');
    expect(rapport.conforme).toBe(true);
    expect(rapport.totalDebit).toBe('120.00');
    expect(rapport.totalCredit).toBe('100.00');
  });
  it('écriture équilibrée dont les lignes ne sont pas contiguës : pas de faux positif', async () => {
    const autre = [L1, L2, L3].map((l) => l.replaceAll('VT000001', 'VT000002'));
    const { rapport } = await lireFec([ENTETE, L1, autre[0], L2, autre[1], autre[2], L3].join('\n'));
    expect(rapport.anomalies).toEqual([]);
  });
  it('ligne démesurée : lecture interrompue (garde-fou mémoire)', async () => {
    const enorme = new Uint8Array(TAILLE_MAX_LIGNE_FEC + 10).fill(65);
    const { rapport } = await lireFec(Buffer.concat([Buffer.from(`${ENTETE}\n${L1}\n`), enorme]));
    expect(rapport.nbAnomaliesParCode['LIGNE_TROP_LONGUE']).toBe(1);
    expect(rapport).toMatchObject({ lisible: true, conforme: false, suffisantPourTravaux: false, nbLignesNormalisees: 1 });
  });
  it('détail des anomalies plafonné, décompte complet par code', async () => {
    const mauvaises = Array.from({ length: PLAFOND_ANOMALIES_FEC + 250 }, () => L1.replace('20250115', '2025XX15'));
    const { rapport } = await lireFec([ENTETE, ...mauvaises].join('\n'));
    expect(rapport.anomalies).toHaveLength(PLAFOND_ANOMALIES_FEC);
    expect(rapport.nbAnomaliesParCode['LIGNE_ILLISIBLE']).toBe(PLAFOND_ANOMALIES_FEC + 250);
    expect(rapport.lisible).toBe(false);
  });
});

describe('analyserFec — options', () => {
  it('nom de fichier conforme', async () => {
    const { rapport } = await lireFec(FEC, { nomFichier: '/tmp/732829320FEC20251231.txt', siren: '732829320', exerciceFin: '2025-12-31', exerciceDebut: '2025-01-01' });
    expect(rapport.anomalies).toEqual([]);
    expect(rapport.conforme).toBe(true);
  });
  it.each([
    ['FEC_2025.txt', 'NOM_FICHIER_FORMAT'],
    ['732829321FEC20251231.txt', 'NOM_FICHIER_SIREN'],
    ['123456782FEC20251231.txt', 'NOM_FICHIER_SIREN'],
    ['732829320FEC20251131.txt', 'NOM_FICHIER_DATE'],
    ['732829320FEC20241231.txt', 'NOM_FICHIER_DATE'],
    ['732829320fec20251231.txt', 'NOM_FICHIER_FORMAT'],
  ])('nom de fichier %s → %s, non conforme', async (nomFichier, code) => {
    const { rapport } = await lireFec(FEC, { nomFichier, siren: '732829320', exerciceFin: '2025-12-31' });
    expect(codes(rapport)).toEqual([code]);
    expect(rapport.conforme).toBe(false);
    expect(rapport.suffisantPourTravaux).toBe(true);
  });
  it('suffixe de découpage (exemple BOFiP) : information', async () => {
    const { rapport } = await lireFec(FEC, { nomFichier: '732829320FEC20251231_01.txt' });
    expect(codes(rapport)).toEqual(['NOM_FICHIER_SUFFIXE']);
    expect(rapport.conforme).toBe(true);
  });
  it('dates hors exercice signalées', async () => {
    const { rapport } = await lireFec(FEC, { exerciceDebut: '2025-02-01', exerciceFin: '2025-12-31' });
    expect(rapport.nbAnomaliesParCode).toEqual({ DATE_HORS_EXERCICE: 3 });
  });
  it('options invalides : erreur explicite', async () => {
    await expect(lireFec(FEC, { exerciceFin: '31/12/2025' })).rejects.toThrow(/exerciceFin/);
    await expect(lireFec(FEC, { siren: '123' })).rejects.toThrow(/siren/);
  });
});

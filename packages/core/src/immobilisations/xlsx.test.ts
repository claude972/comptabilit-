/** Recette de la lecture XLSX de la reprise des immobilisations (D-124) : classeurs synthétiques construits ici, aucun fichier externe. */
import { crc32, deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { ErreurReprise, analyserReprise, lireFichierReprise, proposerCorrespondance } from './reprise.js';
import { lireClasseurXlsx } from './xlsx.js';

/** Construit une archive ZIP minimale (méthode deflate), avec options pour fabriquer des archives hostiles. */
function zip(parties: Record<string, string>, opts: { drapeaux?: number; tailleDeclaree?: number; stocke?: boolean } = {}): Uint8Array {
  const locaux: Buffer[] = [];
  const centraux: Buffer[] = [];
  let decalage = 0;
  for (const [nom, contenu] of Object.entries(parties)) {
    const brut = Buffer.from(contenu, 'utf8');
    const donnees = opts.stocke ? brut : deflateRawSync(brut);
    const nomB = Buffer.from(nom, 'utf8');
    const crc = crc32(brut);
    const tailleReelle = opts.tailleDeclaree ?? brut.length;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(opts.drapeaux ?? 0, 6); local.writeUInt16LE(opts.stocke ? 0 : 8, 8);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(donnees.length, 18); local.writeUInt32LE(tailleReelle, 22); local.writeUInt16LE(nomB.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(opts.drapeaux ?? 0, 8); central.writeUInt16LE(opts.stocke ? 0 : 8, 10);
    central.writeUInt32LE(crc, 16); central.writeUInt32LE(donnees.length, 20); central.writeUInt32LE(tailleReelle, 24); central.writeUInt16LE(nomB.length, 28); central.writeUInt32LE(decalage, 42);
    locaux.push(local, nomB, donnees);
    centraux.push(central, nomB);
    decalage += 30 + nomB.length + donnees.length;
  }
  const rep = Buffer.concat(centraux);
  const fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0); fin.writeUInt16LE(Object.keys(parties).length, 8); fin.writeUInt16LE(Object.keys(parties).length, 10); fin.writeUInt32LE(rep.length, 12); fin.writeUInt32LE(decalage, 16);
  return new Uint8Array(Buffer.concat([...locaux, rep, fin]));
}

const NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';
const classeur = (feuilleXml: string, extra: Record<string, string> = {}, wbExtra = '') => ({
  'xl/workbook.xml': `<?xml version="1.0"?><workbook ${NS} xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Immo" sheetId="1" r:id="rId1"/>${wbExtra}</sheets></workbook>`,
  'xl/_rels/workbook.xml.rels': '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="x" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="x" Target="worksheets/sheet2.xml"/></Relationships>',
  'xl/sharedStrings.xml': `<sst ${NS}><si><t>Désignation</t></si><si><t>Compte</t></si><si><t>Valeur brute</t></si><si><t>Date de mise en service</t></si><si><t xml:space="preserve">Camionnette </t></si><si><r><t>Ordinateur</t></r><r><t> portable</t></r></si><si><t>Durée en mois</t></si></sst>`,
  'xl/styles.xml': `<styleSheet ${NS}><numFmts count="1"><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/></numFmts><cellXfs count="3"><xf numFmtId="0"/><xf numFmtId="14"/><xf numFmtId="164"/></cellXfs></styleSheet>`,
  'xl/worksheets/sheet1.xml': `<worksheet ${NS}><sheetData>${feuilleXml}</sheetData></worksheet>`,
  ...extra,
});
const ENTETE = '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c><c r="D1" t="s"><v>3</v></c><c r="E1" t="s"><v>6</v></c></row>';
const LIGNE1 = '<row r="2"><c r="A2" t="s"><v>4</v></c><c r="B2"><v>218200</v></c><c r="C2"><v>18500.5</v></c><c r="D2" s="1"><v>45366</v></c><c r="E2"><v>60</v></c></row>';

describe('lecture XLSX', () => {
  it('lit chaînes partagées (riches, espaces), nombres en notation française, dates des deux styles', () => {
    const c = lireClasseurXlsx(zip(classeur(ENTETE + LIGNE1 + '<row r="3"><c r="A3" t="s"><v>5</v></c><c r="B3"><v>2183</v></c><c r="C3"><v>1200.1000000000001</v></c><c r="D3" s="2"><v>45000</v></c></row>')));
    expect(c.feuille).toBe('Immo');
    expect(c.lignes[0]!.cellules).toEqual(['Désignation', 'Compte', 'Valeur brute', 'Date de mise en service', 'Durée en mois']);
    expect(c.lignes[1]).toEqual({ numero: 2, cellules: ['Camionnette ', '218200', '18500,5', '15/03/2024', '60'] });
    expect(c.lignes[2]!.cellules).toEqual(['Ordinateur portable', '2183', '1200,1', '15/03/2023']);
  });
  it('passe par le même aperçu que le CSV : colonnes proposées, ligne valide', () => {
    const f = lireFichierReprise(zip(classeur(ENTETE + LIGNE1)));
    expect(f.encodage).toBe('xlsx');
    expect(f.entetes).toHaveLength(5);
    expect(f.lignes[0]!.numero).toBe(2);
    expect(f.avertissements.join(' ')).toMatch(/formules ne sont pas évaluées/);
    const { correspondance } = proposerCorrespondance(f.entetes);
    expect(correspondance).toMatchObject({ libelle: 0, compteImmobilisation: 1, baseAmortissable: 2, dateMiseEnService: 3, dureeMois: 4 });
    const r = analyserReprise(f, correspondance, { existantes: [] });
    expect(r.problemes).toEqual([]);
    expect(r.lignes[0]).toMatchObject({ ligne: 2, lues: { dateMiseEnService: '15/03/2024', baseAmortissable: '18500,5' } });
  });
  it('formules : valeur en cache lue, jamais évaluée ; sans cache : cellule vide ; booléens ; cellules en trous', () => {
    const f = '<row r="2"><c r="A2" t="str"><f>CONCAT("=a","b")</f><v>=cmd|x</v></c><c r="C2"><f>1+1</f></c><c r="D2" t="b"><v>1</v></c><c r="F2"><v>7</v></c></row>';
    const c = lireClasseurXlsx(zip(classeur(ENTETE + f)));
    expect(c.lignes[1]!.cellules).toEqual(['=cmd|x', '', '', 'oui', '', '7']);
  });
  it('feuilles : la première visible non vide est lue, les autres signalées', () => {
    const wbExtra = '<sheet name="Archive" sheetId="2" state="hidden" r:id="rId2"/>';
    const c = lireClasseurXlsx(zip(classeur(ENTETE + LIGNE1, { 'xl/worksheets/sheet2.xml': `<worksheet ${NS}><sheetData/></worksheet>` }, wbExtra)));
    expect(c.feuille).toBe('Immo');
    expect(c.avertissements.join(' ')).toMatch(/autre\(s\) feuille\(s\)/);
  });
  it('refus nets : archive qui n’est pas un classeur, DOCTYPE, chiffrement, bombe de décompression, trop de parties, trop de lignes', () => {
    const code = (o: Uint8Array) => {
      try {
        lireFichierReprise(o);
        return 'ok';
      } catch (e) {
        return e instanceof ErreurReprise ? e.code : 'autre';
      }
    };
    expect(code(zip({ 'a.txt': 'x' }))).toBe('format');
    expect(code(zip(classeur(ENTETE + LIGNE1, { 'xl/sharedStrings.xml': '<!DOCTYPE x [<!ENTITY a "b">]><sst/>' })))).toBe('format');
    expect(code(zip(classeur(ENTETE + LIGNE1), { drapeaux: 1 }))).toBe('format');
    expect(code(zip(classeur(ENTETE + LIGNE1, { 'xl/worksheets/sheet9.xml': 'x'.repeat(10) }), { tailleDeclaree: 40 * 1024 * 1024 }))).toBe('format');
    const bombe = zip({ ...classeur(ENTETE + LIGNE1), 'xl/gros.xml': 'a'.repeat(64 * 1024) }, { tailleDeclaree: 100 });
    expect(code(bombe)).toBe('format');
    const parties: Record<string, string> = classeur(ENTETE + LIGNE1);
    for (let i = 0; i < 210; i++) parties[`xl/media/i${i}.bin`] = 'x';
    expect(code(zip(parties))).toBe('format');
    const lignes = Array.from({ length: 5002 }, (_, i) => `<row r="${i + 2}"><c r="A${i + 2}"><v>${i}</v></c><c r="B${i + 2}"><v>1</v></c></row>`).join('');
    expect(code(zip(classeur(ENTETE + lignes)))).toBe('trop_de_lignes');
    expect(code(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]))).toBe('format');
  });
});

/** Données FICTIVES du parcours de démonstration (D-148) : FEC cohérent et classeur XLSX des immobilisations, partagés par le script de preuve et le test réel. */
import { crc32, deflateRawSync } from 'node:zlib';

// ── FEC fictif cohérent (tabulations, UTF-8) : ouverture, une acquisition, dotations, un produit et une charge ──
export function fec(dotationNouveau: string): Buffer {
  const L: string[] = [];
  let n = 0;
  const e = (j: string, jl: string, date: string, lignes: Array<[string, string, number, number]>, lib: string) => { n++; for (const [c, cl, d, k] of lignes) L.push([j, jl, String(n).padStart(4, '0'), date, c, cl, '', '', `${j}-${n}`, date, lib, d.toFixed(2).replace('.', ','), k.toFixed(2).replace('.', ','), '', '', date, '', ''].join('\t')); };
  e('AN', 'À nouveaux', '20250101', [
    ['211000', 'Terrains', 50000, 0], ['213000', 'Constructions', 80000, 0], ['218200', 'Matériel de transport', 30000, 0], ['218300', 'Matériel de bureau et informatique', 12000, 0],
    ['281300', 'Amortissements des constructions', 0, 40000], ['281820', 'Amortissements du matériel de transport', 0, 18000], ['281830', 'Amortissements du matériel informatique', 0, 8000],
    ['101000', 'Capital', 0, 200000], ['512000', 'Banque', 94000, 0]], 'À-nouveaux');
  e('AC', 'Achats', '20250320', [['218300', 'Matériel de bureau et informatique', 5000, 0], ['512000', 'Banque', 0, 5000]], 'Poste de travail');
  e('VT', 'Ventes', '20250630', [['512000', 'Banque', 40000, 0], ['706000', 'Prestations de services', 0, 40000]], 'Prestations');
  e('AC', 'Achats', '20250930', [['622600', 'Honoraires', 15000, 0], ['512000', 'Banque', 0, 15000]], 'Honoraires');
  const dotMat = (4000 + 6000 + 4000 + Number(dotationNouveau));
  e('OD', 'Opérations diverses', '20251231', [['681120', 'Dotations aux amortissements', dotMat, 0], ['281300', 'Amortissements des constructions', 0, 4000], ['281820', 'Amortissements du matériel de transport', 0, 6000], ['281830', 'Amortissements du matériel informatique', 0, 4000 + Number(dotationNouveau)]], 'Dotations de l’exercice');
  return Buffer.from(['JournalCode', 'JournalLib', 'EcritureNum', 'EcritureDate', 'CompteNum', 'CompteLib', 'CompAuxNum', 'CompAuxLib', 'PieceRef', 'PieceDate', 'EcritureLib', 'Debit', 'Credit', 'EcritureLet', 'DateLet', 'ValidDate', 'Montantdevise', 'Idevise'].join('\t') + '\r\n' + L.join('\r\n') + '\r\n', 'utf8');
}

// ── Classeur XLSX fictif (mêmes pièces minimales que les essais de la pile) ──
function zip(parties: Record<string, string>): Buffer {
  const locaux: Buffer[] = [], centraux: Buffer[] = []; let decalage = 0;
  for (const [nom, contenu] of Object.entries(parties)) {
    const brut = Buffer.from(contenu, 'utf8'), donnees = deflateRawSync(brut), nomB = Buffer.from(nom), crc = crc32(brut);
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8); local.writeUInt32LE(crc, 14); local.writeUInt32LE(donnees.length, 18); local.writeUInt32LE(brut.length, 22); local.writeUInt16LE(nomB.length, 26);
    const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(8, 10); central.writeUInt32LE(crc, 16); central.writeUInt32LE(donnees.length, 20); central.writeUInt32LE(brut.length, 24); central.writeUInt16LE(nomB.length, 28); central.writeUInt32LE(decalage, 42);
    locaux.push(local, nomB, donnees); centraux.push(central, nomB); decalage += 30 + nomB.length + donnees.length;
  }
  const rep = Buffer.concat(centraux), fin = Buffer.alloc(22), n = Object.keys(parties).length;
  fin.writeUInt32LE(0x06054b50, 0); fin.writeUInt16LE(n, 8); fin.writeUInt16LE(n, 10); fin.writeUInt32LE(rep.length, 12); fin.writeUInt32LE(decalage, 16);
  return Buffer.concat([...locaux, rep, fin]);
}
export function classeur(): Buffer {
  const NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';
  const enTetes = ['Désignation', 'Compte', 'Valeur brute', 'Date de mise en service', 'Durée (mois)'];
  const biens: Array<[string, number, number, number, number]> = [['Atelier (construction)', 213000, 80000, 42005, 240], ['Camionnette', 218200, 30000, 44562, 60], ['Serveurs', 218300, 12000, 44927, 36], ['Poste de travail', 218300, 5000, 45736, 36]];
  const chaines = [...enTetes, ...biens.map((b) => b[0])];
  const lignes = biens.map((b, i) => `<row r="${i + 2}"><c r="A${i + 2}" t="s"><v>${5 + i}</v></c><c r="B${i + 2}"><v>${b[1]}</v></c><c r="C${i + 2}"><v>${b[2]}</v></c><c r="D${i + 2}" s="1"><v>${b[3]}</v></c><c r="E${i + 2}"><v>${b[4]}</v></c></row>`).join('');
  return zip({
    'xl/workbook.xml': `<workbook ${NS} xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Immo" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="x" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/sharedStrings.xml': `<sst ${NS}>${chaines.map((c) => `<si><t>${c}</t></si>`).join('')}</sst>`,
    'xl/styles.xml': `<styleSheet ${NS}><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="14"/></cellXfs></styleSheet>`,
    'xl/worksheets/sheet1.xml': `<worksheet ${NS}><sheetData><row r="1">${[0, 1, 2, 3, 4].map((i) => `<c r="${'ABCDE'[i]}1" t="s"><v>${i}</v></c>`).join('')}</row>${lignes}</sheetData></worksheet>`,
  });
}


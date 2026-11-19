/** Jeux d'écritures écrits à la main pour la recette des états et des indicateurs (réservé aux tests, exclu du build). */
import { ligne } from './aides-tests.js';
import type { LigneEcriture } from './controles/types.js';

let numero = 0;
/** Écriture à plusieurs lignes : [compte, débit, crédit, auxiliaire?]. */
export function piece(date: string, lignes: Array<[compte: string, debit: string, credit: string, aux?: string]>, journal = 'OD'): LigneEcriture[] {
  numero++;
  const ecritureNum = `${journal}${String(numero).padStart(6, '0')}`;
  return lignes.map(([compteNum, debit, credit, aux]) =>
    ligne({ compteNum, debit, credit, ecritureDate: date, ecritureNum, journalCode: journal, pieceRef: `P-${ecritureNum}`, compAuxNum: aux ?? null, compAuxLib: aux === undefined ? null : `Tiers ${aux}` }));
}

/**
 * Jeu principal (négoce + prestations), équilibré, avec à-nouveaux. Valeurs attendues recalculées à la main :
 *  CA 60 000 ; marge commerciale 22 000 ; production 10 000 ; VA 26 000 ; EBE 15 500 ; résultat d'exploitation 13 500 ;
 *  résultat courant 13 100 ; résultat 13 100 ; BFR 6 700 ; trésorerie nette 33 400 ; capitaux propres 34 100 ;
 *  endettement 12 000 ; fonds de roulement 40 100 ; total du bilan 71 600.
 * Les opérations courantes sont datées de janvier à juin ; les écritures de fin de période sont datées de `fin`.
 */
export function jeuPrincipal(annee: number, fin = `${annee}-12-31`): LigneEcriture[] {
  const d = (mmjj: string): string => `${annee}-${mmjj}`;
  return [
    ...piece(d('01-01'), [['218300', '10000.00', '0.00'], ['370000', '5000.00', '0.00'], ['512000', '20000.00', '0.00'], ['281830', '0.00', '2000.00'], ['101000', '0.00', '20000.00'], ['106100', '0.00', '1000.00'], ['164000', '0.00', '12000.00']], 'AN'),
    ...piece(d('02-10'), [['411000', '60000.00', '0.00', 'C001'], ['707000', '0.00', '50000.00'], ['445710', '0.00', '10000.00']], 'VT'),
    ...piece(d('02-20'), [['411000', '12000.00', '0.00', 'C002'], ['706000', '0.00', '10000.00'], ['445710', '0.00', '2000.00']], 'VT'),
    ...piece(d('03-05'), [['607000', '30000.00', '0.00'], ['445660', '6000.00', '0.00'], ['401000', '0.00', '36000.00', 'F001']], 'AC'),
    ...piece(d('03-15'), [['613000', '6000.00', '0.00'], ['445660', '1200.00', '0.00'], ['401000', '0.00', '7200.00', 'F002']], 'AC'),
    ...piece(d('04-01'), [['512000', '54000.00', '0.00'], ['411000', '0.00', '54000.00', 'C001']], 'BQ'),
    ...piece(d('04-10'), [['401000', '34200.00', '0.00', 'F001'], ['512000', '0.00', '34200.00']], 'BQ'),
    ...piece(d('05-31'), [['641000', '8000.00', '0.00'], ['645000', '3000.00', '0.00'], ['421000', '0.00', '6500.00'], ['431000', '0.00', '4500.00']]),
    ...piece(d('06-02'), [['421000', '6500.00', '0.00'], ['512000', '0.00', '6500.00']], 'BQ'),
    ...piece(d('06-10'), [['635000', '500.00', '0.00'], ['512000', '0.00', '500.00']], 'BQ'),
    ...piece(d('06-15'), [['661000', '400.00', '0.00'], ['512000', '0.00', '400.00']], 'BQ'),
    ...piece(d('06-20'), [['512000', '1000.00', '0.00'], ['741000', '0.00', '1000.00']], 'BQ'),
    ...piece(fin, [['370000', '2000.00', '0.00'], ['603700', '0.00', '2000.00']]),
    ...piece(fin, [['681120', '2000.00', '0.00'], ['281830', '0.00', '2000.00']]),
  ];
}

/**
 * Petit jeu déficitaire : CA 20 000 ; résultat −8 000 ; EBE −8 000 ; capitaux propres −3 000 (capital 5 000) ;
 * dettes fiscales et sociales 7 000 ; trésorerie nette 5 000.
 */
export function jeuDeficitaire(annee: number): LigneEcriture[] {
  const d = (mmjj: string): string => `${annee}-${mmjj}`;
  return [
    ...piece(d('01-01'), [['512000', '5000.00', '0.00'], ['101000', '0.00', '5000.00']], 'AN'),
    ...piece(d('03-10'), [['411000', '24000.00', '0.00', 'C001'], ['707000', '0.00', '20000.00'], ['445710', '0.00', '4000.00']], 'VT'),
    ...piece(d('06-10'), [['607000', '25000.00', '0.00'], ['445660', '5000.00', '0.00'], ['401000', '0.00', '30000.00', 'F001']], 'AC'),
    ...piece(d('12-31'), [['641000', '3000.00', '0.00'], ['431000', '0.00', '3000.00']]),
  ];
}

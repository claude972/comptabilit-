import { describe, expect, it } from 'vitest';
import { decrireTranches, detailEvenement, messageServiceFerme } from '@/lib/abonnement';
import { type LigneBalance, filtrerBalance, formaterNombre, formaterValeur, libelleTotal, paginer, tauxSaisi } from '@/lib/analyse';
import { transition } from '@/lib/televersement/etats';
import { ErreurHttp, type Transport, televerser } from '@/lib/televersement/moteur';

describe('service fermé', () => {
  it('dit la cause, que ce n’est pas une panne, et ce qui reste possible', () => {
    for (const [situation, mot] of [['essai_expire', 'essai'], ['suspendu', 'suspendu'], ['resilie', 'résilié'], ['aucun', 'Aucun abonnement']] as const) {
      const m = messageServiceFerme(situation);
      expect(m.cause).toContain(mot);
      expect(m.suite).toContain('Ce n’est pas une panne');
      expect(m.suite).toContain('consultation');
      expect(m.suite).toContain('restitution');
    }
    expect(messageServiceFerme('<script>').cause).toBe('Le service est fermé pour ce cabinet.');
    expect(messageServiceFerme('constructor').cause).toBe('Le service est fermé pour ce cabinet.');
  });
  it('un 403 « abonnement_inactif » à l’ouverture n’est pas un refus définitif : le dépôt est conservé', async () => {
    const transport = { ouvrir: async () => { throw new ErreurHttp(403, { code: 'abonnement_inactif', situation: 'suspendu', message: 'x' }); } } as unknown as Transport;
    const issue = await televerser({ fichier: new Blob(['abc']), ouverture: { entiteId: 'e', nomFichier: 'f', taille: 3, sha256: 'a'.repeat(64), canal: 'telephone' }, transport });
    expect(issue).toEqual({ issue: 'service_ferme', situation: 'suspendu', televersementId: null, octetsConfirmes: 0 });
    expect(transition('envoi', { type: 'issue', issue, enLigne: true })).toBe('interrompu'); // ni « refusé », ni « reçu »
    const autre = { ouvrir: async () => { throw new ErreurHttp(403, { message: 'Habilitation insuffisante sur ce dossier' }); } } as unknown as Transport;
    expect((await televerser({ fichier: new Blob(['abc']), ouverture: { entiteId: 'e', nomFichier: 'f', taille: 3, sha256: 'a'.repeat(64), canal: 'telephone' }, transport: autre })).issue).toBe('refuse');
  });
});

describe('abonnement', () => {
  it('décrit les tranches au-delà des dossiers inclus', () => {
    expect(decrireTranches({ dossiersInclus: 2, tranches: [{ jusqua: 10, prixParDossier: '4.00' }, { jusqua: null, prixParDossier: '3.00' }] })).toEqual([
      { portee: 'Du 3ᵉ au 10ᵉ dossier', prix: '4.00' },
      { portee: 'À partir du 11ᵉ dossier', prix: '3.00' },
    ]);
    expect(decrireTranches({ dossiersInclus: 0, tranches: [] })).toEqual([]);
  });
  it('réduit le détail d’un événement à des paires simples', () => {
    expect(detailEvenement({ de: 'a', vers: 'b', objet: { x: 1 } })).toBe('de : a · vers : b');
    expect(detailEvenement(null)).toBe('');
  });
});

describe('analyse : mise en forme sans flottant', () => {
  it('formate selon l’unité, sans arrondir ni compléter', () => {
    expect(formaterValeur('1234567.89', 'euros')).toBe('1 234 567,89 €');
    expect(formaterValeur('45.3', 'jours')).toBe('45,3 jours');
    expect(formaterValeur('-12.50', 'pourcentage')).toBe('−12,50 %');
    expect(formaterValeur('1.25', 'ratio')).toBe('1,25');
    expect(formaterNombre('9007199254740993.10')).toBe('9 007 199 254 740 993,10');
    expect(formaterNombre('-0.0')).toBe('0,0');
    expect(formaterNombre('abc')).toBe('abc');
  });
  it('une valeur absente n’est jamais un zéro', () => {
    expect(formaterValeur(null, 'euros')).toBe('Non calculable');
    expect(formaterValeur(undefined, 'jours')).toBe('Non calculable');
    expect(formaterValeur('0.00', 'euros')).toBe('0,00 €');
  });
  it('recherche dans la balance par début de numéro ou fragment de libellé, et pagine localement', () => {
    const l = (compteNum: string, compteLib: string) => ({ compteNum, compteLib }) as LigneBalance;
    const lignes = [l('401000', 'Fournisseurs'), l('411000', 'Clients'), l('512000', 'Banque Crédit Coopératif'), l('530000', 'Caisse')];
    expect(filtrerBalance(lignes, '4').map((x) => x.compteNum)).toEqual(['401000', '411000']);
    expect(filtrerBalance(lignes, 'credit').map((x) => x.compteNum)).toEqual(['512000']);
    expect(filtrerBalance(lignes, '  ')).toHaveLength(4);
    expect(paginer([1, 2, 3, 4, 5], 2, 2)).toEqual({ tranche: [3, 4], page: 2, nbPages: 3 });
    expect(paginer([1, 2, 3], 99, 2).page).toBe(2);
    expect(paginer([], Number.NaN, 2)).toEqual({ tranche: [], page: 1, nbPages: 1 });
  });
  it('lit un taux de TVA saisi et humanise une clé de total', () => {
    expect(tauxSaisi('20')).toBe('20');
    expect(tauxSaisi(' 5,5 ')).toBe('5.5');
    for (const v of ['', '-5', 'vingt', '1e2', undefined]) expect(tauxSaisi(v)).toBeNull();
    expect(libelleTotal('totalActifNet')).toBe('Total actif net');
    expect(libelleTotal('resultat')).toBe('Resultat');
  });
});

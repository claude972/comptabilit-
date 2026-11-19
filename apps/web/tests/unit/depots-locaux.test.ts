import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { type DepotLocal, enregistrerDepot, listerDepots, modifierDepot, purgerDepots, purgerTout, supprimerDepot } from '@/lib/depots-locaux';
import { DUREE_CONSERVATION_MS } from '@/lib/televersement/etats';

const depot = (id: string, utilisateurId: string, creeLe: number): DepotLocal => ({
  id, utilisateurId, entiteId: 'e', dossier: 'Dossier', nomFichier: 'f.pdf', typeMime: 'application/pdf', taille: 3, sha256: 'a'.repeat(64),
  nature: 'a_qualifier', commentaire: '', assemblage: true, nbPages: 1, fichier: new Blob([new Uint8Array([1, 2, 3])]), televersementId: null,
  octetsConfirmes: 0, etat: 'en_file', message: null, creeLe, majLe: creeLe,
});

describe('dépôts en attente (IndexedDB)', () => {
  beforeEach(async () => {
    await purgerTout();
  });
  it('enregistre, liste par utilisateur dans l’ordre de création, modifie et supprime', async () => {
    await enregistrerDepot(depot('b', 'u1', 200));
    await enregistrerDepot(depot('a', 'u1', 100));
    await enregistrerDepot(depot('c', 'u2', 150));
    expect((await listerDepots('u1')).map((d) => d.id)).toEqual(['a', 'b']);
    const maj = await modifierDepot('a', { etat: 'interrompu', octetsConfirmes: 2, televersementId: 't1' });
    expect(maj).toMatchObject({ etat: 'interrompu', octetsConfirmes: 2, televersementId: 't1' });
    expect((await listerDepots('u1'))[0]).toMatchObject({ etat: 'interrompu', taille: 3 });
    await supprimerDepot('a');
    expect((await listerDepots('u1')).map((d) => d.id)).toEqual(['b']);
  });
  it('ne recrée pas un dépôt supprimé pendant un envoi', async () => {
    await enregistrerDepot(depot('a', 'u1', 100));
    await supprimerDepot('a');
    expect(await modifierDepot('a', { octetsConfirmes: 3 })).toBeNull();
    expect(await listerDepots('u1')).toEqual([]);
  });
  it('purge les dépôts de plus de 7 jours et ceux d’un autre compte', async () => {
    const maintenant = 10 * DUREE_CONSERVATION_MS;
    await enregistrerDepot(depot('recent', 'u1', maintenant - 1000));
    await enregistrerDepot(depot('limite', 'u1', maintenant - DUREE_CONSERVATION_MS));
    await enregistrerDepot(depot('vieux', 'u1', maintenant - DUREE_CONSERVATION_MS - 1));
    await enregistrerDepot(depot('autre', 'u2', maintenant));
    expect(await purgerDepots('u1', maintenant)).toBe(2);
    expect((await listerDepots('u1')).map((d) => d.id).sort()).toEqual(['limite', 'recent']);
    expect(await listerDepots('u2')).toEqual([]);
  });
  it('la purge complète (déconnexion) ne laisse rien', async () => {
    await enregistrerDepot(depot('a', 'u1', 1));
    await purgerTout();
    expect(await listerDepots('u1')).toEqual([]);
  });
});

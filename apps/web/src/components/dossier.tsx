import { Libelle, Liste } from '@/components/ui/base';
import { Bouton } from '@/components/ui/bouton';
import { formaterDate } from '@/lib/montants';
import type { Exercice } from '@/lib/types-api';

/** Choix de l'exercice par formulaire GET : fonctionne sans JavaScript, l'exercice est dans l'URL. */
export function ChoixExercice({ exercices, courant }: { exercices: Exercice[]; courant: string }) {
  return (
    <form key={courant} method="get" className="flex flex-wrap items-end gap-2">
      <div>
        <Libelle htmlFor="exercice">Exercice</Libelle>
        <Liste id="exercice" name="exercice" defaultValue={courant} className="min-w-64">
          {exercices.map((x) => (
            <option key={x.id} value={x.id}>
              Du {formaterDate(x.debut)} au {formaterDate(x.fin)} ({x.statut})
            </option>
          ))}
        </Liste>
      </div>
      <Bouton type="submit" variante="secondaire">
        Afficher
      </Bouton>
    </form>
  );
}

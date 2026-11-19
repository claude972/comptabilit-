import { Alerte } from '@/components/ui/base';
import { type Situation, messageServiceFerme } from '@/lib/abonnement';

/** Bandeau « service fermé » : dit la cause, précise que ce n'est pas une panne et ce qui reste possible. */
export function ServiceFerme({ situation, complement }: { situation: Situation | string; complement?: string }) {
  const m = messageServiceFerme(situation);
  return (
    <Alerte ton="attention" role="status" titre={m.titre} data-testid="service-ferme" data-situation={situation}>
      <p className="font-medium">{m.cause}</p>
      <p>{m.suite}</p>
      {complement ? <p className="mt-1">{complement}</p> : null}
    </Alerte>
  );
}

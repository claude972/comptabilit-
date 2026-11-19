import { Alerte } from './ui/base';

/** Retour d'une action : erreur annoncée immédiatement, succès annoncé poliment. */
export function Retours({ erreur, succes }: { erreur: string | null; succes: string | null }) {
  return (
    <>
      {erreur ? (
        <Alerte ton="danger" role="alert">
          {erreur}
        </Alerte>
      ) : null}
      <div role="status" aria-live="polite">
        {succes ? <Alerte ton="succes">{succes}</Alerte> : null}
      </div>
    </>
  );
}

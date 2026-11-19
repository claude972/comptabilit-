import type { Metadata } from 'next';
import { PieceJointeAffichee, PiecesJointes } from '@/components/document/pieces-jointes';
import { ErreurAcces } from '@/components/erreurs';
import { ActionConfirmee } from '@/components/mission/actions';
import { ConsignerFait, RedigerConseil } from '@/components/mission/conseils';
import { SousNavigationMission } from '@/components/mission/sous-navigation';
import { Alerte, Carte, Etiquette, MentionProjet, SousTitre, Tableau } from '@/components/ui/base';
import { type Conseil, FAITS, LIBELLE_FAIT, LIBELLE_STATUT_CONSEIL, MENTION_REGISTRE, type Mission, NON_ETABLI, etatFait, faitsConsignables } from '@/lib/missions';
import { formaterDate, formaterHorodatage } from '@/lib/montants';
import { tenter } from '@/lib/serveur/api';
import { contexteDossier } from '@/lib/serveur/dossier';
import { auMoins } from '@/lib/types-api';

export const metadata: Metadata = { title: 'Registre des conseils' };

function Fait({ date }: { date: string | null }) {
  const f = etatFait(date);
  return f.etabli ? <span className="whitespace-nowrap">{formaterHorodatage(f.date)}</span> : <Etiquette ton="vide">{NON_ETABLI}</Etiquette>;
}

export default async function PageConseils({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await contexteDossier(id);
  if (!ctx.ok) return null;
  const [registre, missions] = await Promise.all([tenter<Conseil[]>(`v1/dossiers/${id}/conseils`), tenter<Mission[]>(`v1/dossiers/${id}/missions`)]);
  if (!registre.ok) return <ErreurAcces statut={registre.statut} message={registre.message} retour={`/dossiers/${id}`} />;
  const collaboration = auMoins(ctx.niveau, 'collaboration');
  const validation = auMoins(ctx.niveau, 'validation');
  const listeMissions = (missions.ok ? missions.donnees : []).map((m) => ({ id: m.id, libelle: m.libelle }));
  const conseils = registre.donnees;

  return (
    <div className="space-y-6">
      <SousNavigationMission dossierId={id} courant="conseils" avecRentabilite={auMoins(ctx.niveau, 'revision')} />
      <Alerte ton="attention" data-testid="mention-registre">
        <strong>{MENTION_REGISTRE}</strong> Valider un conseil et autoriser son envoi sont deux étapes distinctes, toutes deux réservées au niveau « Validation ». L’envoi est fait par
        vous, hors de Comtaple ; vous consignez ensuite les faits établis (envoi, remise, réception, lecture), chacun avec son justificatif.
      </Alerte>

      <section aria-labelledby="titre-registre" className="space-y-2">
        <SousTitre id="titre-registre">Registre ({conseils.length})</SousTitre>
        {conseils.length === 0 ? (
          <p className="text-texte-doux">Aucun conseil au registre de ce dossier.</p>
        ) : (
          <Tableau legende="Registre des conseils du dossier">
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">Objet</th>
                <th scope="col">Destinataire</th>
                <th scope="col">Statut</th>
                {FAITS.map((f) => (
                  <th key={f} scope="col">{LIBELLE_FAIT[f]}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {conseils.map((c) => (
                <tr key={c.id} data-ligne-conseil={c.id}>
                  <td className="whitespace-nowrap">{formaterDate(c.dateConseil)}</td>
                  <th scope="row" className="!bg-transparent font-medium break-words">
                    <a href={`#conseil-${c.id}`}>{c.objet}</a>
                    <span className="block text-sm font-normal text-texte-doux">
                      version {c.version} · rédigé par {c.auteur}
                    </span>
                  </th>
                  <td className="break-words">{c.destinataire}</td>
                  <td>{c.statut === 'projet' ? <MentionProjet /> : <Etiquette ton={c.statut === 'remplace' ? 'neutre' : 'info'} className="whitespace-normal">{LIBELLE_STATUT_CONSEIL[c.statut] ?? c.statut}</Etiquette>}</td>
                  {FAITS.map((f) => (
                    <td key={f} data-fait={f} data-etabli={Boolean(c.faits?.[f])}>
                      <Fait date={c.faits?.[f] ?? null} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </Tableau>
        )}
        <p className="text-sm text-texte-doux">« {NON_ETABLI} » signifie qu’aucun fait n’a été consigné : cela ne dit pas que le fait n’a pas eu lieu, et un fait ne se déduit jamais d’un autre.</p>
      </section>

      {conseils.map((c) => {
        const possibles = faitsConsignables(c);
        return (
          <Carte key={c.id} id={`conseil-${c.id}`} className="space-y-3" data-conseil={c.id} data-statut={c.statut}>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-semibold break-words">{c.objet}</h3>
              {c.statut === 'projet' ? <MentionProjet /> : <Etiquette ton={c.statut === 'remplace' ? 'neutre' : 'info'} className="whitespace-normal">{LIBELLE_STATUT_CONSEIL[c.statut] ?? c.statut}</Etiquette>}
              <span className="text-sm text-texte-doux">version {c.version}</span>
            </div>
            <p className="text-sm text-texte-doux">
              Du {formaterDate(c.dateConseil)} · rédigé par {c.auteur} · destinataire : <span className="break-words">{c.destinataire}</span>
              {c.valideLe ? ` · validé le ${formaterHorodatage(c.valideLe)}` : ''}
              {c.envoiAutoriseLe ? ` · envoi autorisé le ${formaterHorodatage(c.envoiAutoriseLe)}` : ''}
            </p>
            <p className="rounded-lg bg-surface-2 p-3 break-words whitespace-pre-wrap" data-testid="contenu-conseil">{c.contenu}</p>
            <PiecesJointes pieces={c.piecesJointes} dossierId={id} />
            {c.evenements?.length ? (
              <div>
                <p className="font-medium">Faits consignés</p>
                <ul className="list-disc pl-5 text-sm" data-testid="evenements">
                  {c.evenements.map((e) => (
                    <li key={e.id} className="break-words">
                      {LIBELLE_FAIT[e.type] ?? e.type} le {formaterHorodatage(e.dateEvenement)} — canal : {e.canal} — justificatif : {e.justificatif}
                      {e.justificatifDocument ? (
                        <span className="block" data-testid="justificatif-piece">
                          Pièce justificative : <PieceJointeAffichee piece={e.justificatifDocument} dossierId={id} />
                        </span>
                      ) : e.justificatifDocumentId ? (
                        <span className="block text-texte-doux">Pièce justificative jointe, non consultable.</span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {c.statut === 'projet' ? (
              <>
                {collaboration ? <RedigerConseil dossierId={id} missions={listeMissions} conseil={{ id: c.id, dateConseil: c.dateConseil, objet: c.objet, contenu: c.contenu, destinataire: c.destinataire, missionId: c.missionId, piecesJointes: c.piecesJointes ?? (c.pieces ?? []).map((p) => ({ id: p, nomOrigine: null, statut: null, version: null })) }} /> : null}
                {validation ? (
                  <ActionConfirmee chemin={`v1/conseils/${c.id}/validation`} libelle="Valider ce conseil" confirmation="Confirmer la validation" explication="Étape 1 sur 2. Un conseil validé ne se modifie plus (nouvelle version). La validation n’autorise pas encore l’envoi." succes="Conseil validé. L’envoi n’est pas encore autorisé." />
                ) : (
                  <p className="text-sm text-texte-doux">La validation est réservée au niveau « Validation » sur ce dossier.</p>
                )}
              </>
            ) : null}
            {c.statut === 'valide' ? (
              validation ? (
                <ActionConfirmee chemin={`v1/conseils/${c.id}/autorisation-envoi`} libelle="Autoriser l’envoi" confirmation="Confirmer l’autorisation d’envoi" explication="Étape 2 sur 2. Vous autorisez l’envoi de ce conseil validé. Comtaple n’envoie rien : l’envoi reste à faire par vous, puis à consigner." succes="Envoi autorisé. Rien n’a été envoyé par le logiciel." variante="secondaire" />
              ) : (
                <p className="text-sm text-texte-doux">L’autorisation d’envoi est réservée au niveau « Validation » sur ce dossier.</p>
              )
            ) : null}
            {c.statut === 'envoi_autorise' && collaboration ? (
              possibles.length ? (
                <ConsignerFait key={possibles.join('|')} conseilId={c.id} dossierId={id} possibles={possibles} />
              ) : (
                <p className="text-sm text-texte-doux">Les quatre faits sont consignés pour ce conseil.</p>
              )
            ) : null}
            {(c.statut === 'valide' || c.statut === 'envoi_autorise') && collaboration ? (
              <ActionConfirmee chemin={`v1/conseils/${c.id}/nouvelle-version`} libelle="Créer une nouvelle version" confirmation="Créer le projet de nouvelle version" explication="Une nouvelle version est créée comme projet, à partir de ce texte. Cette version reste au registre avec ses faits consignés ; elle sera marquée « remplacée » quand la nouvelle sera validée." succes="Nouvelle version créée comme projet." variante="secondaire" />
            ) : null}
          </Carte>
        );
      })}

      {collaboration ? (
        <Carte className="space-y-2">
          <SousTitre className="text-base">Nouveau conseil</SousTitre>
          <RedigerConseil dossierId={id} missions={listeMissions} />
        </Carte>
      ) : null}
    </div>
  );
}

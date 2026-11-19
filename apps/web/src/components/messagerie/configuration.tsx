'use client';

import { Plus, Trash2 } from 'lucide-react';
import { type FormEvent, useId, useState } from 'react';
import { useAppel } from '@/components/appel';
import { Retours } from '@/components/retours';
import { Alerte, Libelle, Liste, Saisie, SousTitre, ZoneTexte } from '@/components/ui/base';
import { Bouton } from '@/components/ui/bouton';
import { type ConfigurationMail, type FormulaireConfiguration, TAILLE_MAX_MO, corpsDepuis, formulaireDepuis } from '@/lib/messagerie';

/** Formulaire des filtres fonctionnels d'une connexion (`PUT v1/mail/connexions/:id/configuration`). */
export function FormulaireConfigurationMail({
  connexionId,
  configuration,
  connecteeLe,
  dossiers,
}: {
  connexionId: string;
  configuration: ConfigurationMail;
  connecteeLe: string;
  dossiers: Array<{ id: string; raisonSociale: string }>;
}) {
  const [f, setF] = useState<FormulaireConfiguration>(() => formulaireDepuis(configuration, connecteeLe));
  const [erreurs, setErreurs] = useState<string[]>([]);
  const appel = useAppel();
  const id = useId();
  const gmail = configuration.fournisseur === 'gmail';
  const maj = (m: Partial<FormulaireConfiguration>) => setF((v) => ({ ...v, ...m }));
  const choisis = dossiers.filter((d) => f.dossiersComptables.includes(d.id));
  const nom = (dossierId: string) => dossiers.find((d) => d.id === dossierId)?.raisonSociale ?? 'Dossier inconnu';

  async function envoyer(e: FormEvent) {
    e.preventDefault();
    const r = corpsDepuis(f);
    if (!r.ok) {
      setErreurs(r.erreurs);
      return;
    }
    setErreurs([]);
    await appel.executer(`v1/mail/connexions/${connexionId}/configuration`, { method: 'PUT', json: r.corps }, 'Configuration enregistrée. Une synchronisation est relancée avec ces filtres.');
  }

  return (
    <form onSubmit={envoyer} className="space-y-5" data-formulaire="configuration-mail" noValidate>
      <SousTitre>Configuration de la collecte (filtres de Comtaple)</SousTitre>
      <p className="text-sm text-texte-doux">Une valeur par ligne dans les listes. Ces réglages limitent ce que Comtaple lit ; ils ne modifient pas l’autorisation accordée.</p>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div>
          <Libelle htmlFor={`${id}-dossiers`}>{gmail ? 'Libellés surveillés (identifiants Gmail)' : 'Dossiers surveillés (identifiant ou nom connu)'}</Libelle>
          <ZoneTexte id={`${id}-dossiers`} value={f.dossiers} onChange={(e) => maj({ dossiers: e.target.value })} />
          <p className="mt-1 text-sm text-texte-doux">Vide : boîte de réception uniquement.</p>
        </div>
        <div>
          <Libelle htmlFor={`${id}-expediteurs`}>Expéditeurs autorisés (adresses ou domaines)</Libelle>
          <ZoneTexte id={`${id}-expediteurs`} value={f.expediteurs} onChange={(e) => maj({ expediteurs: e.target.value })} />
          <p className="mt-1 text-sm text-texte-doux">Vide : tous les expéditeurs.</p>
        </div>
        <div>
          <Libelle htmlFor={`${id}-objets`}>L’objet doit contenir (au moins un terme)</Libelle>
          <ZoneTexte id={`${id}-objets`} value={f.objets} onChange={(e) => maj({ objets: e.target.value })} />
          <p className="mt-1 text-sm text-texte-doux">Vide : pas de critère sur l’objet.</p>
        </div>
      </div>
      <label className="flex min-h-11 items-center gap-2">
        <input type="checkbox" checked={f.avecPieceJointe} onChange={(e) => maj({ avecPieceJointe: e.target.checked })} className="size-5" />
        N’examiner que les messages avec pièce jointe
      </label>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <Libelle htmlFor={`${id}-date`}>Messages reçus à partir du</Libelle>
          <Saisie id={`${id}-date`} type="date" value={f.dateDebut} onChange={(e) => maj({ dateDebut: e.target.value })} />
          <p className="mt-1 text-sm text-texte-doux">Par défaut : 30 jours avant la connexion.</p>
        </div>
        <div>
          <Libelle htmlFor={`${id}-taille`}>Taille maximale d’une pièce jointe (Mo, 1 à {TAILLE_MAX_MO})</Libelle>
          <Saisie id={`${id}-taille`} inputMode="numeric" value={f.tailleMaxMo} onChange={(e) => maj({ tailleMaxMo: e.target.value })} />
        </div>
      </div>

      <fieldset>
        <legend className="mb-1 font-medium">Dossiers comptables destinataires</legend>
        <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
          {dossiers.map((d) => (
            <label key={d.id} className="flex min-h-11 items-center gap-2">
              <input
                type="checkbox"
                className="size-5"
                checked={f.dossiersComptables.includes(d.id)}
                onChange={(e) => maj({ dossiersComptables: e.target.checked ? [...f.dossiersComptables, d.id] : f.dossiersComptables.filter((x) => x !== d.id) })}
              />
              {d.raisonSociale}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="max-w-md">
        <Libelle htmlFor={`${id}-defaut`}>Quand aucune règle ne correspond</Libelle>
        <Liste id={`${id}-defaut`} value={f.dossierParDefaut} onChange={(e) => maj({ dossierParDefaut: e.target.value })}>
          <option value="">Placer la pièce dans « Pièces à qualifier »</option>
          {choisis.map((d) => (
            <option key={d.id} value={d.id}>
              Rattacher à {d.raisonSociale}
            </option>
          ))}
        </Liste>
      </div>

      <fieldset className="space-y-2">
        <legend className="font-medium">Règles de rattachement</legend>
        <p className="text-sm text-texte-doux">Un expéditeur (adresse ou domaine) ou une adresse de destination (alias) désigne un dossier. Si plusieurs dossiers sont désignés, la pièce part « à qualifier ».</p>
        {f.regles.length === 0 ? <p className="text-texte-doux">Aucune règle.</p> : null}
        <ol className="space-y-2">
          {f.regles.map((r, i) => {
            const changer = (m: Partial<typeof r>) => maj({ regles: f.regles.map((x, j) => (j === i ? { ...x, ...m } : x)) });
            return (
              <li key={i} className="grid grid-cols-1 items-end gap-2 rounded-lg border border-bordure p-2 md:grid-cols-[12rem_1fr_1fr_auto]" data-regle={i + 1}>
                <div>
                  <Libelle htmlFor={`${id}-r${i}-type`}>Règle {i + 1} : critère</Libelle>
                  <Liste id={`${id}-r${i}-type`} value={r.type} onChange={(e) => changer({ type: e.target.value as typeof r.type })}>
                    <option value="expediteur">Expéditeur</option>
                    <option value="destinataire">Adresse de destination</option>
                  </Liste>
                </div>
                <div>
                  <Libelle htmlFor={`${id}-r${i}-valeur`}>{r.type === 'expediteur' ? 'Adresse ou domaine' : 'Adresse (alias)'}</Libelle>
                  <Saisie id={`${id}-r${i}-valeur`} value={r.valeur} onChange={(e) => changer({ valeur: e.target.value })} autoComplete="off" />
                </div>
                <div>
                  <Libelle htmlFor={`${id}-r${i}-dossier`}>Dossier comptable</Libelle>
                  <Liste id={`${id}-r${i}-dossier`} value={r.dossierComptable} onChange={(e) => changer({ dossierComptable: e.target.value })}>
                    <option value="">Choisir…</option>
                    {/* Une règle visant un dossier retiré de la liste reste visible pour être corrigée. */}
                    {r.dossierComptable && !f.dossiersComptables.includes(r.dossierComptable) ? <option value={r.dossierComptable}>{nom(r.dossierComptable)} (hors liste)</option> : null}
                    {choisis.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.raisonSociale}
                      </option>
                    ))}
                  </Liste>
                </div>
                <Bouton variante="danger" taille="icone" aria-label={`Supprimer la règle ${i + 1}`} onClick={() => maj({ regles: f.regles.filter((_, j) => j !== i) })}>
                  <Trash2 aria-hidden="true" className="size-5" />
                </Bouton>
              </li>
            );
          })}
        </ol>
        <Bouton variante="contour" onClick={() => maj({ regles: [...f.regles, { type: 'expediteur', valeur: '', dossierComptable: '' }] })}>
          <Plus aria-hidden="true" className="size-5" /> Ajouter une règle
        </Bouton>
      </fieldset>

      {erreurs.length ? (
        <Alerte ton="danger" role="alert" titre="La configuration n’a pas été envoyée">
          <ul className="list-disc pl-5">
            {erreurs.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </Alerte>
      ) : null}
      <Bouton type="submit" disabled={appel.occupe}>
        Enregistrer la configuration
      </Bouton>
      <Retours erreur={appel.erreur} succes={appel.succes} />
    </form>
  );
}

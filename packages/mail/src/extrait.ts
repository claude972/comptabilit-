/**
 * Analyse du message LIMITÉE au nécessaire : en-têtes utiles et un court extrait borné du corps.
 * Tous les textes issus d'un message sont des contenus NON FIABLES : ils ne sont jamais interprétés
 * comme des instructions et n'influencent ni le rattachement ni le comportement du paquet.
 * Aucun lien n'est jamais suivi : on se contente de relever le DOMAINE des liens « facture ».
 */
import type { ExtraitQualification, MessageBrut } from './types.js';

export const LIMITES_EXTRAIT = {
  objet: 200,
  extrait: 500,
  destinataires: 20,
  /** Longueur maximale du corps analysé pour la détection de liens. */
  corpsAnalyse: 200_000,
  domaines: 5,
} as const;

const ENTITES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', eacute: 'é', egrave: 'è', agrave: 'à', ccedil: 'ç' };

function decoderEntites(texte: string): string {
  return texte
    .replace(/&#(\d{1,6});/g, (_, n: string) => String.fromCodePoint(Math.min(Number(n), 0x10ffff)))
    .replace(/&([a-z]{2,6});/gi, (tout, nom: string) => ENTITES[nom.toLowerCase()] ?? tout);
}

/** Conversion HTML → texte, volontairement rudimentaire (aucun rendu, aucun chargement de ressource). */
export function htmlVersTexte(html: string): string {
  const borne = html.slice(0, LIMITES_EXTRAIT.corpsAnalyse);
  return decoderEntites(
    borne
      .replace(/<(script|style|head)\b[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<[^>]{0,2000}>/g, ' '),
  );
}

/** Retire caractères de contrôle et invisibles, remplace les URL (elles peuvent porter des jetons), compacte, borne. */
export function nettoyerTexte(texte: string, longueurMax: number): string {
  const propre = texte
    .normalize('NFC')
    .replace(/https?:\/\/\S+/gi, '[lien]')
    // Contrôles C0/C1, marques directionnelles, caractères de largeur nulle.
    .replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁩﻿]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return propre.length > longueurMax ? `${propre.slice(0, longueurMax - 1)}…` : propre;
}

function corpsEnTexte(message: MessageBrut): string {
  if (message.corpsTexte !== null && message.corpsTexte.trim().length > 0) {
    return message.corpsTexte.slice(0, LIMITES_EXTRAIT.corpsAnalyse);
  }
  return message.corpsHtml !== null ? htmlVersTexte(message.corpsHtml) : '';
}

/**
 * Seule vue d'un message qui sort du paquet : expéditeur, destinataires, objet, date
 * et au plus 500 caractères nettoyés du corps. Jamais le fil, jamais le corps entier.
 */
export function extraitPourQualification(message: MessageBrut): ExtraitQualification {
  return {
    nonFiable: true,
    expediteur: message.expediteur,
    destinataires: message.destinataires.slice(0, LIMITES_EXTRAIT.destinataires),
    objet: nettoyerTexte(message.objet, LIMITES_EXTRAIT.objet),
    dateReception: message.dateReception.toISOString(),
    extrait: nettoyerTexte(corpsEnTexte(message), LIMITES_EXTRAIT.extrait),
  };
}

interface LienReleve {
  hote: string;
  /** Texte de l'ancre et texte voisin. */
  contexte: string;
}

function hoteHttp(brut: string): string | null {
  try {
    const url = new URL(decoderEntites(brut.trim()));
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** Relève les liens http(s) du corps avec leur contexte. Les URL elles-mêmes ne sont pas conservées. */
function releverLiens(message: MessageBrut): LienReleve[] {
  const liens: LienReleve[] = [];
  const html = message.corpsHtml?.slice(0, LIMITES_EXTRAIT.corpsAnalyse) ?? null;
  if (html !== null) {
    const ancre = /<a\b[^>]{0,2000}?href\s*=\s*(?:"([^"]{0,4000})"|'([^']{0,4000})'|([^\s>]{1,4000}))[^>]{0,2000}>([\s\S]{0,1000}?)<\/a>/gi;
    for (const m of html.matchAll(ancre)) {
      const hote = hoteHttp(m[1] ?? m[2] ?? m[3] ?? '');
      if (hote === null) continue;
      const avant = htmlVersTexte(html.slice(Math.max(0, m.index - 300), m.index)).slice(-160);
      liens.push({ hote, contexte: `${avant} ${htmlVersTexte(m[4] ?? '')}` });
    }
  }
  const texte = message.corpsTexte?.slice(0, LIMITES_EXTRAIT.corpsAnalyse) ?? null;
  if (texte !== null) {
    for (const m of texte.matchAll(/https?:\/\/[^\s<>"')\]]{1,4000}/gi)) {
      const hote = hoteHttp(m[0]);
      if (hote === null) continue;
      liens.push({ hote, contexte: texte.slice(Math.max(0, m.index - 160), m.index) });
    }
  }
  return liens;
}

const MOTIF_DOCUMENT = /(factur|invoice|re[çc]us?\b|receipt|\bavoirs?\b|note de frais|justificatif|relev[ée] de compte|bill\b)/i;
const MOTIF_ACTION = /(t[ée]l[ée]charg|consult|\bvoir\b|visualis|acc[ée]d|affich|r[ée]cup[ée]r|disponible|en ligne|cliqu|ci-dessous|download|view|access|available|click|\bici\b|\bhere\b)/i;
const MOTIF_EXCLU = /(d[ée]sabonn|d[ée]sinscri|unsubscribe|pr[ée]f[ée]rences|confidentialit[ée]|privacy)/i;

/**
 * Détecte « facture disponible uniquement derrière un lien » : à n'appeler que pour un message
 * sans pièce jointe pertinente. Règle interne : un lien http(s) dont l'ancre ou le texte voisin
 * évoque à la fois un document comptable et une action de consultation/téléchargement.
 * Renvoie les DOMAINES (jamais l'URL complète, qui peut contenir des jetons). Le lien n'est pas suivi.
 */
export function detecterFactureDerriereLien(message: MessageBrut): { domaines: string[] } | null {
  const domaines = new Set<string>();
  for (const lien of releverLiens(message)) {
    const contexte = lien.contexte.replace(/\s+/g, ' ');
    if (MOTIF_EXCLU.test(contexte.slice(-80))) continue;
    if (MOTIF_DOCUMENT.test(contexte) && MOTIF_ACTION.test(contexte)) domaines.add(lien.hote);
    if (domaines.size >= LIMITES_EXTRAIT.domaines) break;
  }
  return domaines.size > 0 ? { domaines: [...domaines] } : null;
}

/** Masque une adresse pour le journal : `j***@exemple.fr`. */
export function masquerAdresse(adresse: string): string {
  const [local, domaine] = adresse.split('@');
  if (local === undefined || domaine === undefined) return '***';
  return `${local.slice(0, 1)}***@${domaine}`;
}

/** Extrait les adresses d'un en-tête (From, To, Cc). Pour `"x@a.fr" <y@b.fr>`, seule l'adresse entre chevrons compte. */
export function extraireAdresses(valeur: string): string[] {
  const motif = /[a-z0-9._%+-]{1,64}@[a-z0-9.-]{1,255}\.[a-z]{2,}/gi;
  const adresses: string[] = [];
  // Retire les noms affichés entre guillemets : ils peuvent contenir une adresse trompeuse.
  for (const fragment of valeur.replace(/"(?:[^"\\]|\\.)*"/g, ' ').split(',')) {
    const entreChevrons = /<([^<>]*)>\s*$/.exec(fragment.trim())?.[1];
    const trouve = (entreChevrons ?? fragment).match(motif);
    const adresse = entreChevrons !== undefined ? trouve?.[0] : trouve?.[trouve.length - 1];
    if (adresse !== undefined) adresses.push(adresse.toLowerCase());
  }
  return [...new Set(adresses)];
}

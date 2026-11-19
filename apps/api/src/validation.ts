import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';

/** Valide une entrée avec Zod ; l'erreur renvoyée ne reproduit pas les valeurs soumises. */
export function valider<T extends z.ZodType>(schema: T, donnees: unknown): z.infer<T> {
  const r = schema.safeParse(donnees);
  if (!r.success) {
    throw new BadRequestException({
      message: 'Requête invalide',
      erreurs: r.error.issues.map((i) => ({ champ: i.path.join('.'), probleme: i.message })),
    });
  }
  return r.data;
}

/** Schéma OpenAPI dérivé du schéma Zod (source unique de vérité pour la validation et la documentation). */
export function schemaOpenApi(schema: z.ZodType): Record<string, unknown> {
  const { $schema: _ignore, ...reste } = z.toJSONSchema(schema, { unrepresentable: 'any' }) as Record<string, unknown>;
  return reste;
}

export const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, 'identifiant invalide');

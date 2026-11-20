import { FileIndisponible } from '@comtaple/plateforme';
import { describe, expect, it } from 'vitest';
import { codeSql, panneDeDependance } from './pannes.js';

describe('reconnaissance d’une panne de dépendance', () => {
  it('file des travaux, stockage objet (réseau ou 5xx) et base de données sont reconnus', () => {
    expect(panneDeDependance(new FileIndisponible('délai'))).toBe('files');
    expect(panneDeDependance(Object.assign(new Error('connect ECONNREFUSED'), { $metadata: { attempts: 3 } }))).toBe('stockage');
    expect(panneDeDependance(Object.assign(new Error('Internal'), { $metadata: { httpStatusCode: 500 } }))).toBe('stockage');
    expect(panneDeDependance(Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), { code: 'ECONNREFUSED' }))).toBe('base');
    expect(panneDeDependance(Object.assign(new Error('terminating connection'), { code: '57P01' }))).toBe('base');
    expect(panneDeDependance(new Error('Connection terminated unexpectedly'))).toBe('base');
    expect(panneDeDependance(new Error('timeout exceeded when trying to connect'))).toBe('base');
  });

  it('une erreur ordinaire, un objet absent (4xx) ou une valeur étrangère ne sont PAS prises pour une panne', () => {
    expect(panneDeDependance(new Error('bug'))).toBeNull();
    expect(panneDeDependance(Object.assign(new Error('NoSuchKey'), { $metadata: { httpStatusCode: 404 } }))).toBeNull();
    expect(panneDeDependance(Object.assign(new Error('violation'), { code: '23505' }))).toBeNull();
    expect(panneDeDependance(null)).toBeNull();
    expect(panneDeDependance('texte')).toBeNull();
  });

  it('le code SQL est lu aussi quand le pilote enveloppe l’erreur', () => {
    expect(codeSql({ code: '23505' })).toBe('23505');
    expect(codeSql({ message: 'Failed query', cause: { code: '40P01' } })).toBe('40P01');
    expect(codeSql(new Error('x'))).toBe('');
    expect(codeSql(undefined)).toBe('');
  });
});

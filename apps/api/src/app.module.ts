import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { creerAccesBd, urlBd } from '@comtaple/db';
import { agregationBancaire, arreterTraces, connecteursMail, connexionRedis, creerIa, Files, lireConfig, Stockage } from '@comtaple/plateforme';
import { GardeAcces } from './acces.js';
import { AbonnementController } from './abonnement.controller.js';
import { AdministrationController } from './administration.controller.js';
import { AuditController } from './audit.controller.js';
import { BanqueController } from './banque.controller.js';
import { ComptabiliteController } from './comptabilite.controller.js';
import { ConseilsController } from './conseils.controller.js';
import { DocumentsController } from './documents.controller.js';
import { EtatsController } from './etats.controller.js';
import { FiscalController } from './fiscal.controller.js';
import { ImportsController } from './imports.controller.js';
import { IntegrationsController } from './integrations.controller.js';
import { RechercheController } from './recherche.controller.js';
import { VeilleController } from './veille.controller.js';
import { InventaireController } from './inventaire.controller.js';
import { AGREGATION, BD, CONFIG, IA, MAIL, STOCKAGE, TACHES } from './jetons.js';
import { AssistantController } from './assistant.controller.js';
import { IaTachesController } from './ia-taches.controller.js';
import { MailController } from './mail.controller.js';
import { MissionsController } from './missions.controller.js';
import { ProfilController } from './profil.controller.js';
import { ReferenceController } from './reference.controller.js';
import { ReglesController } from './regles.controller.js';
import { NotificationsController } from './notifications.controller.js';
import { RestitutionController } from './restitution.controller.js';
import { TeleversementsController } from './televersements.controller.js';
import { TiersController } from './tiers.controller.js';

@Module({
  controllers: [NotificationsController, ProfilController, TeleversementsController, DocumentsController, ComptabiliteController, ReferenceController, AuditController, IntegrationsController, MailController, BanqueController, AdministrationController, AbonnementController, ReglesController, RestitutionController, MissionsController, ConseilsController, VeilleController, RechercheController, EtatsController, FiscalController, InventaireController, ImportsController, AssistantController, IaTachesController, TiersController],
  providers: [
    { provide: CONFIG, useFactory: () => lireConfig() },
    // Le serveur interactif se connecte avec le rôle comtaple_app : jamais propriétaire, jamais BYPASSRLS.
    { provide: BD, useFactory: () => creerAccesBd(urlBd('app')) },
    {
      provide: STOCKAGE,
      inject: [CONFIG],
      useFactory: async (cfg: ReturnType<typeof lireConfig>) => {
        const st = new Stockage(cfg);
        await st.assurerBucket();
        return st;
      },
    },
    { provide: TACHES, inject: [CONFIG], useFactory: (cfg: ReturnType<typeof lireConfig>) => new Files(connexionRedis(cfg.REDIS_URL), cfg.FILES_PREFIXE) },
    { provide: MAIL, inject: [CONFIG], useFactory: (cfg: ReturnType<typeof lireConfig>) => connecteursMail(cfg) },
    { provide: AGREGATION, inject: [CONFIG], useFactory: (cfg: ReturnType<typeof lireConfig>) => agregationBancaire(cfg) },
    // Passerelle IA : sans jeton configuré, statut « non_connecte » et aucun appel sortant. Aucun simulateur ici.
    { provide: IA, inject: [CONFIG, BD], useFactory: (cfg: ReturnType<typeof lireConfig>, bd: ReturnType<typeof creerAccesBd>) => creerIa(cfg, bd) },
    { provide: APP_GUARD, useClass: GardeAcces },
    // À l'arrêt de l'application (SIGTERM, SIGINT) : envoi des spans en attente, dans un délai borné.
    { provide: 'ARRET_TRACES', useValue: { onApplicationShutdown: () => arreterTraces() } },
  ],
})
export class AppModule {}

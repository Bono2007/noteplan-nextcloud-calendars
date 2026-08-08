# 📅 Agendas Nextcloud — plugin NotePlan

Récupère les agendas CalDAV partagés de collègues (Nextcloud) et écrit un bloc
agenda dans les notes quotidiennes, sur plusieurs jours d'avance.

```
> 📅 Agendas partagés : Mardi 09 décembre 2025
	> PC : 10:00-12:30 Evenement Laïcité LR, 18:00-20:00 Réunion IRES
	> CB : Journée : Avignon, Lundi 12/01 - TT
```

## Installation

```bash
node build.mjs --deploy
```

Le script concatène les modules de `src/` et génère `plugin/index.js`.
Avec `--deploy`, il le copie en plus dans le dossier Plugins de NotePlan.
L'application recharge seule les plugins modifiés — inutile de la relancer.

Sans `--deploy`, `node build.mjs` ne fait que régénérer `plugin/index.js` :
c'est la commande utilisée par la suite de tests, qui ne doit jamais écraser
le plugin installé par un build intermédiaire.

## Réglages

NotePlan → Preferences → Plugins → 📅 Agendas Nextcloud

| Réglage | Rôle |
|---|---|
| Racine WebDAV | Ex. `https://mynextcloud.ndd/remote.php/dav` |
| Identifiant | Identifiant CalDAV |
| Mot de passe | Mot de passe, ou mot de passe d'application |
| Nombre de jours traités | Aujourd'hui inclus. Défaut : 7 |
| Titre du bloc | Défaut : `📅 Agendas partagés` |
| Calendriers suivis | Rempli par la commande de sélection — ne pas éditer à la main |

Les réglages sont stockés en clair dans
`Plugins/data/llc.NextcloudCalendars/settings.json`. C'est le seul mécanisme
offert par la plateforme : le trousseau macOS est inaccessible depuis le bac à
sable d'un plugin.

## Commandes

Accessibles par `CMD+J`.

| Commande | Effet |
|---|---|
| `Agendas Nextcloud : choisir les calendriers` | Découvre les calendriers du serveur et permet de choisir ceux à suivre |
| `Agendas Nextcloud : rafraîchir` | Met à jour le bloc dans les prochains jours |
| `Agendas Nextcloud : bloc du jour` | Retourne le bloc sans rien écrire — pour les templates |

### Choisir les calendriers

La Command Bar ne propose pas de sélection multiple : la liste se réaffiche
après chaque choix. Les calendriers retenus portent un `●`, `✓ Terminer la
sélection` clôt la boucle, et re-sélectionner un calendrier coché le retire.
Le champ de filtre rend la recherche praticable même avec plusieurs dizaines
de calendriers.

Une étiquette courte est proposée pour chaque calendrier, déduite de son nom
(`Paul Côté (CÔTÉ Paul)` → `PC`). Elle est modifiable, et une
étiquette personnalisée est conservée d'une session à l'autre.

### Depuis un template

```
<% const bloc = await DataStore.invokePluginCommandByName("Agendas Nextcloud : bloc du jour","llc.NextcloudCalendars",[]); -%>
<%- bloc %>
```

## Limite connue

Le bloc n'est délimité par aucun marqueur technique dédié : sa fin se déduit
uniquement de sa structure (lignes indentées commençant par `>`). Conséquence :
une ligne que vous ajoutez juste sous le bloc, indentée et commençant par le
caractère chevron (`>`), sera considérée comme faisant partie du bloc et sera
donc absorbée — remplacée — au prochain rafraîchissement. Une ligne non
indentée, même si elle commence par `>`, ne risque rien. C'est un compromis
assumé pour ne pas polluer les notes de marqueurs visibles.

## Développement

```
src/dates.js      fuseau Europe/Paris, fenêtres de jours, formatage français
src/ics.js        dépliage et parsing ICS, décodage XML
src/caldav.js     PROPFIND de découverte, REPORT avec expand, contrôle des réponses
src/format.js     étiquettes, lignes d'événements, jours de télétravail, bloc
src/noteplan.js   détection et remplacement du bloc dans une note
src/commands.js   les trois commandes
```

```bash
node --test               # la suite complète — SANS argument, `node --test test/` échoue
node build.mjs             # génère seulement plugin/index.js
node build.mjs --deploy    # génère et déploie dans NotePlan
```

`plugin/index.js` est **généré** : ne pas l'éditer à la main.

### Contraintes de la plateforme

Trois pièges vérifiés expérimentalement sur NotePlan 3.21.1, à connaître avant
de toucher au code :

1. **`fetch()` retourne le corps de la réponse sous forme de chaîne**, pas un
   objet `Response`. Ni `.status`, ni `.ok`, ni `.text()`. Le code HTTP est
   inaccessible : le succès se déduit du contenu, d'où `assertMultistatus`.
2. **Pas de `require()` dans le fichier livré.** Les modules `src/` s'importent
   entre eux pour les tests ; `build.mjs` retire ces lignes et le bloc
   `module.exports` à la concaténation. Un test vérifie que le résultat compile.
3. **Ne jamais ré-encoder une URL renvoyée par le serveur.** Certains chemins
   contiennent déjà des `%20`, d'autres des `@` bruts ; les deux fonctionnent
   tels quels, un ré-encodage produirait `%2520`.

La requête d'événements utilise `<C:expand>` : le serveur développe lui-même
les occurrences récurrentes, ne renvoie pas de `VTIMEZONE` et normalise les
dates en UTC. Sans cette option, une réunion hebdomadaire n'apparaîtrait qu'une
seule fois.

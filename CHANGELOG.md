# Journal des modifications

Les numéros suivent [SemVer](https://semver.org/lang/fr/).

## [1.0.0] — 2026-08-08

Première version publique.

### Fonctionnalités

- **Découverte des calendriers** : le plugin interroge le serveur CalDAV et
  propose la liste des calendriers accessibles. Une étiquette courte est déduite
  du nom de chaque calendrier (`Paul Côté (CÔTÉ Paul)` → `PC`), puis
  reste modifiable. Les étiquettes personnalisées survivent aux reconfigurations.
- **Bloc agenda dans les notes quotidiennes**, écrit sur plusieurs jours d'avance
  (7 par défaut, réglable de 1 à 31).
- **Rafraîchissement en place** : le bloc est remplacé à chaque exécution, sans
  toucher au reste de la note. Les blocs en double éventuels sont nettoyés.
- **Appel depuis un template** : la commande « bloc du jour » retourne le bloc
  sans rien écrire, laissant le template décider de son emplacement.
- **Occurrences récurrentes développées côté serveur** via `<C:expand>` : une
  réunion hebdomadaire apparaît à chacune de ses occurrences.
- **Événements sur plusieurs jours** affichés sur chacun des jours couverts,
  y compris lorsqu'ils commencent avant la fenêtre.
- **Journées entières** affichées sans horaire.

### Robustesse

- Aucune note n'est modifiée si aucun calendrier ne répond : un agenda valide
  n'est jamais écrasé par un bloc vide à la suite d'une panne.
- Un calendrier en échec affiche son erreur sur sa propre ligne ; les autres
  s'écrivent normalement.
- Un jour dont l'écriture échoue n'interrompt pas le traitement des suivants et
  apparaît dans le compte rendu.
- Le plugin écrit via l'éditeur lorsque la note visée y est ouverte, pour ne pas
  entrer en concurrence avec une saisie en cours.

### Limite connue

Le bloc est délimité par sa structure, sans marqueur technique visible. Une ligne
indentée commençant par `>` écrite juste sous le bloc sera absorbée au
rafraîchissement suivant. Une ligne non indentée n'est pas concernée.

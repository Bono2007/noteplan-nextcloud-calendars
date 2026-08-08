import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'

const ROOT = dirname(fileURLToPath(import.meta.url))

// L'ordre compte : un module ne peut utiliser que ce qui le précède.
const MODULES = [
  'dates.js',
  'ics.js',
  'caldav.js',
  'format.js',
  'noteplan.js',
  'commands.js',
]

const NP_PLUGINS = join(
  homedir(),
  'Library/Containers/co.noteplan.NotePlan-setapp/Data/Library',
  'Application Support/co.noteplan.NotePlan-setapp/Plugins/llc.NextcloudCalendars',
)

/**
 * Retire les require() de tête et le bloc module.exports de fin.
 * Le module.exports est toujours en fin de fichier et peut s'étaler sur
 * plusieurs lignes (objet multi-lignes) : un filtrage ligne à ligne ne
 * supprime que sa première ligne et laisse le reste, ce qui casse la
 * syntaxe du fichier généré. On raisonne donc sur le texte entier : tout
 * ce qui suit le début de `module.exports` est coupé.
 */
function strip(source) {
  const withoutRequires = source
    .split('\n')
    .filter((line) => !/^\s*(const|let|var)\s+\{[^}]*\}\s*=\s*require\(/.test(line))
    .join('\n')
  const exportsStart = withoutRequires.search(/^\s*module\.exports\s*=/m)
  const withoutExports = exportsStart === -1 ? withoutRequires : withoutRequires.slice(0, exportsStart)
  return withoutExports.replace(/\n{3,}/g, '\n\n').trim()
}

const header = `/**
 * Plugin NotePlan « Agendas Nextcloud » — FICHIER GÉNÉRÉ, NE PAS ÉDITER.
 * Source : src/*.js — régénérer avec : node build.mjs
 */
`

const body = MODULES.map((name) => {
  const source = readFileSync(join(ROOT, 'src', name), 'utf8')
  return `// ─── ${name} ${'─'.repeat(Math.max(0, 60 - name.length))}\n\n${strip(source)}`
}).join('\n\n')

mkdirSync(join(ROOT, 'plugin'), { recursive: true })
writeFileSync(join(ROOT, 'plugin', 'index.js'), `${header}\n${body}\n`, 'utf8')
console.log(`✅ plugin/index.js généré (${body.length} caractères)`)

/**
 * Le déploiement copie dans le dossier Plugins de NotePlan, potentiellement
 * par-dessus l'installation active de l'utilisateur. `node build.mjs` seul ne
 * fait donc que générer plugin/index.js : lancer la suite de tests (qui
 * exécute ce script) ne doit jamais écraser un plugin installé par un build
 * intermédiaire. Le déploiement n'a lieu qu'avec l'option explicite --deploy.
 */
const shouldDeploy = process.argv.includes('--deploy')

if (!shouldDeploy) {
  console.log('ℹ️  déploiement ignoré (relancer avec --deploy pour installer dans NotePlan)')
} else if (existsSync(dirname(NP_PLUGINS))) {
  mkdirSync(NP_PLUGINS, { recursive: true })
  copyFileSync(join(ROOT, 'plugin', 'index.js'), join(NP_PLUGINS, 'index.js'))
  copyFileSync(join(ROOT, 'plugin', 'plugin.json'), join(NP_PLUGINS, 'plugin.json'))
  console.log(`✅ déployé dans ${NP_PLUGINS}`)
} else {
  console.log('ℹ️  dossier Plugins NotePlan introuvable, déploiement ignoré')
}

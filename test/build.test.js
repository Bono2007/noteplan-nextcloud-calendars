const { test } = require('node:test')
const assert = require('node:assert')
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const ROOT = path.join(__dirname, '..')

/**
 * Isole le déploiement dans un faux $HOME, jamais dans le vrai dossier
 * Plugins de l'utilisateur — c'est précisément l'écrasement accidentel que
 * le constat 6 corrige, on ne va pas le reproduire dans nos propres tests.
 */
function withFakeHome(run) {
  const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'noteplan-build-test-'))
  const pluginsParent = path.join(
    fakeHome,
    'Library/Containers/co.noteplan.NotePlan-setapp/Data/Library/Application Support/co.noteplan.NotePlan-setapp/Plugins',
  )
  fs.mkdirSync(pluginsParent, { recursive: true })
  try {
    return run(path.join(pluginsParent, 'llc.NextcloudCalendars'), { ...process.env, HOME: fakeHome })
  } finally {
    fs.rmSync(fakeHome, { recursive: true, force: true })
  }
}

test('build produit un index.js sans require ni module.exports', () => {
  execFileSync('node', ['build.mjs'], { cwd: ROOT })
  const out = fs.readFileSync(path.join(ROOT, 'plugin', 'index.js'), 'utf8')
  assert.ok(out.length > 0, 'index.js ne doit pas être vide')
  assert.ok(!/^\s*(const|let|var)\s+\{[^}]*\}\s*=\s*require\(/m.test(out), 'aucun require ne doit subsister')
  assert.ok(!/module\.exports/.test(out), 'aucun module.exports ne doit subsister')
})

test('build expose les fonctions de commande au niveau global', () => {
  const out = fs.readFileSync(path.join(ROOT, 'plugin', 'index.js'), 'utf8')
  assert.match(out, /function agendaChoisirCalendriers/)
  assert.match(out, /function agendaRafraichir/)
  assert.match(out, /function agendaBlocDuJour/)
})

test('build produit un JavaScript syntaxiquement valide', () => {
  execFileSync('node', ['build.mjs'], { cwd: ROOT })
  // Ne doit pas lever : un module.exports multi-lignes mal tronqué casse la syntaxe.
  assert.doesNotThrow(() => {
    execFileSync('node', ['--check', path.join(ROOT, 'plugin', 'index.js')])
  })
})

test('build conserve le contenu des modules (pas de sur-suppression)', () => {
  const out = fs.readFileSync(path.join(ROOT, 'plugin', 'index.js'), 'utf8')
  assert.match(out, /function parseEvents/)
  assert.match(out, /function parisLocalFromParts/)
})

// Constat 6 : lancer les tests ne doit jamais écraser le plugin installé.
// node build.mjs seul ne doit que générer plugin/index.js ; le déploiement
// n'a lieu qu'avec l'option explicite --deploy.

test('node build.mjs sans --deploy ne déploie pas dans le dossier Plugins', () => {
  withFakeHome((targetDir, env) => {
    const out = execFileSync('node', ['build.mjs'], { cwd: ROOT, env }).toString()
    assert.ok(!/déployé/.test(out), 'aucun message de déploiement ne doit apparaître sans --deploy')
    assert.ok(!fs.existsSync(path.join(targetDir, 'index.js')), 'le plugin ne doit pas être copié sans --deploy')
  })
})

test('node build.mjs --deploy déploie dans le dossier Plugins', () => {
  withFakeHome((targetDir, env) => {
    const out = execFileSync('node', ['build.mjs', '--deploy'], { cwd: ROOT, env }).toString()
    assert.match(out, /déployé/)
    assert.ok(fs.existsSync(path.join(targetDir, 'index.js')), 'le plugin doit être copié avec --deploy')
  })
})

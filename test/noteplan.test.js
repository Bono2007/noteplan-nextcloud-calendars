const { test } = require('node:test')
const assert = require('node:assert')
const { findBlockRange, replaceBlock } = require('../src/noteplan')

const TITLE = '📅 Agenda Nextcloud'
const BLOCK = '> 📅 Agenda Nextcloud : Mardi 09 décembre 2025\n\t> PC : 10:00 Réunion'

test('findBlockRange trouve le bloc et sa dernière ligne indentée', () => {
  const lines = [
    '## Tâches',
    '> 📅 Agenda Nextcloud : Mardi 09 décembre 2025',
    '\t> PC : 10:00 Réunion',
    '\t> CB : Aucun événement',
    '',
    '## Notes',
  ]
  assert.deepEqual(findBlockRange(lines, TITLE), { start: 1, end: 3 })
})

test('findBlockRange renvoie null si le bloc est absent', () => {
  assert.equal(findBlockRange(['## Notes', 'du texte'], TITLE), null)
})

test('replaceBlock remplace sans toucher au reste de la note', () => {
  const content = [
    '---',
    'todoist_id: 123',
    '---',
    '> 📅 Agenda Nextcloud : Lundi 08 décembre 2025',
    '\t> PC : ancien contenu',
    '## Notes',
    'mes notes à moi',
  ].join('\n')
  const updated = replaceBlock(content, TITLE, BLOCK)
  assert.match(updated, /todoist_id: 123/)
  assert.match(updated, /mes notes à moi/)
  assert.match(updated, /PC : 10:00 Réunion/)
  assert.ok(!updated.includes('ancien contenu'))
  assert.equal((updated.match(/Agenda Nextcloud/g) || []).length, 1)
})

test('replaceBlock insère le bloc en tête quand il est absent', () => {
  const updated = replaceBlock('## Notes\nmes notes', TITLE, BLOCK)
  assert.ok(updated.startsWith('> 📅 Agenda Nextcloud'))
  assert.match(updated, /## Notes/)
})

test('replaceBlock insère après le frontmatter quand il y en a un', () => {
  const content = '---\ntodoist_id: 9\n---\n## Notes'
  const updated = replaceBlock(content, TITLE, BLOCK)
  const lines = updated.split('\n')
  assert.equal(lines[0], '---')
  assert.equal(lines[2], '---')
  assert.equal(lines[3], '> 📅 Agenda Nextcloud : Mardi 09 décembre 2025')
})

test('replaceBlock sur une note vide produit le bloc seul', () => {
  assert.equal(replaceBlock('', TITLE, BLOCK), BLOCK)
})

test('replaceBlock est idempotent', () => {
  const once = replaceBlock('## Notes', TITLE, BLOCK)
  const twice = replaceBlock(once, TITLE, BLOCK)
  assert.equal(once, twice)
})

// Cas limites supplémentaires — exploration de risques de perte de données.

test('replaceBlock insère après un frontmatter même sans contenu ensuite', () => {
  const updated = replaceBlock('---\ntodoist_id: 9\n---', TITLE, BLOCK)
  assert.equal(updated, '---\ntodoist_id: 9\n---\n' + BLOCK)
})

test('replaceBlock conserve un bloc en toute fin de note (dernière ligne du fichier)', () => {
  const content = '## Notes\nmes notes\n> 📅 Agenda Nextcloud : Lundi\n\t> PC : ancien'
  const updated = replaceBlock(content, TITLE, BLOCK)
  assert.equal(updated, '## Notes\nmes notes\n' + BLOCK)
})

// Correctif (voir task-6-report.md, addendum) : une ligne de continuation du
// bloc doit être À LA FOIS indentée ET commencer par « > » une fois
// l'indentation retirée — le bloc généré est toujours ainsi (tabulation puis
// « > »). Une citation utilisateur en colonne 0 (non indentée), même si elle
// commence par « > », ne remplit qu'une des deux conditions et n'est donc
// plus absorbée par le bloc.
test('une citation utilisateur en colonne 0 juste après le bloc survit au remplacement', () => {
  const content = [
    '> 📅 Agenda Nextcloud : Lundi 08 décembre 2025',
    '\t> PC : ancien contenu',
    '> Une citation personnelle que je veux garder',
    '## Notes',
  ].join('\n')
  const updated = replaceBlock(content, TITLE, BLOCK)
  assert.match(updated, /Une citation personnelle que je veux garder/)
  assert.match(updated, /PC : 10:00 Réunion/)
  assert.ok(!updated.includes('ancien contenu'))
})

// Correctif (voir task-6-report.md, addendum) : si plusieurs blocs agenda
// coexistent par accident, le premier est remplacé par le nouveau bloc et
// tous les suivants sont supprimés — il ne doit rester qu'un seul bloc, et
// tout le contenu utilisateur situé entre ou après les blocs doit survivre.
test('un doublon de bloc agenda est nettoyé sans toucher au contenu utilisateur', () => {
  const content = [
    '## Tâches',
    '> 📅 Agenda Nextcloud : Lundi 08 décembre 2025',
    '\t> PC : ancien 1',
    'du contenu utilisateur entre les deux blocs',
    '> 📅 Agenda Nextcloud : Lundi 08 décembre 2025 (doublon)',
    '\t> PC : ancien 2',
    'du contenu utilisateur après les deux blocs',
  ].join('\n')
  const updated = replaceBlock(content, TITLE, BLOCK)
  assert.equal((updated.match(/Agenda Nextcloud/g) || []).length, 1)
  assert.match(updated, /du contenu utilisateur entre les deux blocs/)
  assert.match(updated, /du contenu utilisateur après les deux blocs/)
  assert.match(updated, /PC : 10:00 Réunion/)
  assert.ok(!updated.includes('ancien 1'))
  assert.ok(!updated.includes('ancien 2'))
})

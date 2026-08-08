const { test } = require('node:test')
const assert = require('node:assert')
const { guessLabel, isMondayTT, formatEventLine, buildDayBlock, flattenWhitespace } = require('../src/format')
const { replaceBlock } = require('../src/noteplan')

test('guessLabel prend les initiales du nom avant la parenthèse', () => {
  assert.equal(guessLabel('Paul Côté (CÔTÉ Paul)'), 'PC')
  assert.equal(guessLabel('BERNARD Cécile (BERNARD Cécile)'), 'BC')
})

test('guessLabel bascule sur la parenthèse quand le début est un sigle', () => {
  assert.equal(guessLabel('UE (AUBRY Damien)'), 'AD')
  assert.equal(guessLabel('UE (BLANCHARD Anaïs)'), 'BA')
})

test('guessLabel ignore les emojis en tête', () => {
  assert.equal(guessLabel('📅 Salle Cartigny (Association Locale)'), 'SC')
})

test('guessLabel gère un nom d’un seul mot', () => {
  assert.equal(guessLabel('Personal'), 'PE')
})

test('isMondayTT reconnaît les formes réelles', () => {
  assert.equal(isMondayTT('Lundi 12/01 - TT'), true)
  assert.equal(isMondayTT('Lundi 31/08 - TT (rentrée)'), true)
  assert.equal(isMondayTT('Lundi 24/08 - TT + SE17'), true)
  assert.equal(isMondayTT('Réunion TT du mardi'), false)
  assert.equal(isMondayTT('Lundi de Pentecôte'), false)
})

test('formatEventLine affiche les horaires en heure de Paris', () => {
  const line = formatEventLine({
    summary: 'Réunion IRES',
    start: new Date('2025-12-09T17:00:00Z'),
    end: new Date('2025-12-09T19:00:00Z'),
    allDay: false,
  })
  assert.equal(line, '18:00-20:00 Réunion IRES')
})

test('formatEventLine n’affiche pas d’heure pour une journée entière', () => {
  const line = formatEventLine({
    summary: 'Avignon',
    start: new Date('2025-11-30T23:00:00Z'),
    allDay: true,
  })
  assert.equal(line, 'Journée : Avignon')
})

test('formatEventLine gère un événement sans heure de fin', () => {
  const line = formatEventLine({
    summary: 'Point rapide',
    start: new Date('2025-12-09T08:00:00Z'),
    end: null,
    allDay: false,
  })
  assert.equal(line, '09:00 Point rapide')
})

test('buildDayBlock assemble le bloc au format attendu', () => {
  const block = buildDayBlock({
    date: new Date('2025-12-09T12:00:00Z'),
    blockTitle: '📅 Agenda Nextcloud',
    entries: [
      { label: 'PC', lines: ['10:00-12:30 Laïcité LR', '15:15-16:15 Copil'] },
      { label: 'CB', lines: ['Lundi 12/01 - TT'] },
    ],
  })
  assert.equal(
    block,
    '> 📅 Agenda Nextcloud : Mardi 09 décembre 2025\n' +
      '\t> PC : 10:00-12:30 Laïcité LR, 15:15-16:15 Copil\n' +
      '\t> CB : Lundi 12/01 - TT',
  )
})

test('buildDayBlock écrit « Aucun événement » plutôt que d’omettre la ligne', () => {
  const block = buildDayBlock({
    date: new Date('2026-08-08T12:00:00Z'),
    blockTitle: '📅 Agenda Nextcloud',
    entries: [{ label: 'PC', lines: [] }],
  })
  assert.match(block, /> PC : Aucun événement$/)
})

// Constat 1 : une valeur multi-ligne (titre, lieu, message d'erreur) ne doit
// jamais faire éclater une entrée du bloc sur plusieurs lignes physiques.

test('flattenWhitespace aplatit tout blanc (sauts de ligne, tabulations, espaces multiples) en un espace simple', () => {
  assert.equal(flattenWhitespace('47 Avenue Simón Bolívar\n75019 Paris,\r\n  France'), '47 Avenue Simón Bolívar 75019 Paris, France')
  assert.equal(flattenWhitespace('  \t espaces   multiples \t'), 'espaces multiples')
  assert.equal(flattenWhitespace(''), '')
})

test('formatEventLine aplatit un titre contenant un saut de ligne en une ligne unique', () => {
  const line = formatEventLine({
    summary: 'Congrès\nannuel\r\nde printemps',
    start: new Date('2025-12-09T08:00:00Z'),
    end: new Date('2025-12-09T10:00:00Z'),
    allDay: false,
  })
  assert.equal(line.split('\n').length, 1)
  assert.equal(line, '09:00-11:00 Congrès annuel de printemps')
})

test('buildDayBlock aplatit une entrée contenant des sauts de ligne (défense en profondeur)', () => {
  const block = buildDayBlock({
    date: new Date('2026-08-08T12:00:00Z'),
    blockTitle: '📅 Agenda Nextcloud',
    entries: [{ label: 'PC', lines: ['⚠️ Le serveur a répondu :\n<html>\n<body>erreur</body>\n</html>'] }],
  })
  assert.equal(block.split('\n').length, 2)
  assert.doesNotMatch(block.split('\n')[1], /^</)
})

test('bout en bout : une valeur multi-ligne ne laisse pas de ligne orpheline après plusieurs rafraîchissements', () => {
  const blockTitle = '📅 Agenda Nextcloud'
  const block = buildDayBlock({
    date: new Date('2025-12-09T12:00:00Z'),
    blockTitle,
    entries: [
      {
        label: 'PC',
        lines: [
          formatEventLine({
            summary: 'Réunion\nsur plusieurs lignes',
            start: new Date('2025-12-09T08:00:00Z'),
            end: null,
            allDay: false,
          }),
          '⚠️ <d:error><s:message>Le service est\nen maintenance\nprogrammée</s:message></d:error>',
        ],
      },
    ],
  })

  let note = '## Mes notes\ndu texte à moi'
  note = replaceBlock(note, blockTitle, block)
  const afterFirst = note
  note = replaceBlock(note, blockTitle, block)
  note = replaceBlock(note, blockTitle, block)

  assert.equal(note, afterFirst)
  assert.equal((note.match(/Agenda Nextcloud/g) || []).length, 1)
  assert.match(note, /du texte à moi/)
  for (const line of note.split('\n')) {
    assert.ok(!/^</.test(line.trim()), `ligne orpheline détectée : ${line}`)
  }
})

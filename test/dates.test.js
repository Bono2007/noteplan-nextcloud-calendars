const { test } = require('node:test')
const assert = require('node:assert')
const {
  dateKey, isoDay, utcStamp, windowBounds, dayList, formatFrenchDate, formatTime,
  parisLocalFromParts, toParisParts, parisMidnight,
} = require('../src/dates')

test('dateKey donne la clé NotePlan en heure de Paris', () => {
  assert.equal(dateKey(new Date('2025-12-09T10:00:00Z')), '20251209')
})

test('dateKey bascule au bon jour près de minuit à Paris', () => {
  // 23h30 UTC en été = 01h30 le lendemain à Paris
  assert.equal(dateKey(new Date('2026-08-08T23:30:00Z')), '20260809')
})

test('isoDay formate en YYYY-MM-DD', () => {
  assert.equal(isoDay(new Date('2025-12-09T10:00:00Z')), '2025-12-09')
})

test('utcStamp produit le format du time-range CalDAV', () => {
  assert.equal(utcStamp(new Date('2025-12-09T09:30:00Z')), '20251209T093000Z')
})

test('windowBounds couvre daysAhead jours, borne haute exclusive', () => {
  const { from, to } = windowBounds(new Date('2026-08-08T12:00:00Z'), 7)
  // du 8 août 00:00 Paris au 15 août 00:00 Paris
  assert.equal(isoDay(from), '2026-08-08')
  assert.equal(isoDay(to), '2026-08-15')
})

test('dayList renvoie exactement daysAhead jours consécutifs', () => {
  const days = dayList(new Date('2026-08-08T12:00:00Z'), 7)
  assert.equal(days.length, 7)
  assert.equal(dateKey(days[0]), '20260808')
  assert.equal(dateKey(days[6]), '20260814')
})

test('dayList franchit correctement un changement de mois', () => {
  const days = dayList(new Date('2026-08-29T12:00:00Z'), 5)
  assert.deepEqual(days.map(dateKey), ['20260829', '20260830', '20260831', '20260901', '20260902'])
})

test('formatFrenchDate produit un libellé français capitalisé', () => {
  assert.equal(formatFrenchDate(new Date('2025-12-09T10:00:00Z')), 'Mardi 09 décembre 2025')
})

test('formatTime convertit UTC vers heure de Paris', () => {
  // 08:00 UTC en décembre (UTC+1) = 09:00 à Paris
  assert.equal(formatTime(new Date('2025-12-09T08:00:00Z')), '09:00')
  // 08:00 UTC en août (UTC+2) = 10:00 à Paris
  assert.equal(formatTime(new Date('2026-08-08T08:00:00Z')), '10:00')
})

test('parisLocalFromParts convertit correctement juste avant le passage à l\'heure d\'été', () => {
  // 29 mars 2026, 01:00 à Paris : encore en CET (+1), heure civile valide et non ambiguë
  assert.equal(
    parisLocalFromParts(2026, 3, 29, 1, 0, 0).toISOString(),
    '2026-03-29T00:00:00.000Z',
  )
})

test('parisLocalFromParts convertit correctement juste avant le passage à l\'heure d\'hiver', () => {
  // 25 octobre 2026, 01:00 à Paris : encore en CEST (+2), avant l'heure ambiguë 02h-03h
  assert.equal(
    parisLocalFromParts(2026, 10, 25, 1, 0, 0).toISOString(),
    '2026-10-24T23:00:00.000Z',
  )
})

test('parisLocalFromParts donne le bon instant UTC de part et d\'autre du passage à l\'heure d\'été', () => {
  // 28 mars 2026, 10:00 à Paris : encore en CET (+1)
  assert.equal(
    parisLocalFromParts(2026, 3, 28, 10, 0, 0).toISOString(),
    '2026-03-28T09:00:00.000Z',
  )
  // 30 mars 2026, 10:00 à Paris : déjà en CEST (+2)
  assert.equal(
    parisLocalFromParts(2026, 3, 30, 10, 0, 0).toISOString(),
    '2026-03-30T08:00:00.000Z',
  )
})

test('parisLocalFromParts donne le bon instant UTC de part et d\'autre du passage à l\'heure d\'hiver', () => {
  // 24 octobre 2026, 10:00 à Paris : encore en CEST (+2)
  assert.equal(
    parisLocalFromParts(2026, 10, 24, 10, 0, 0).toISOString(),
    '2026-10-24T08:00:00.000Z',
  )
  // 26 octobre 2026, 10:00 à Paris : déjà en CET (+1)
  assert.equal(
    parisLocalFromParts(2026, 10, 26, 10, 0, 0).toISOString(),
    '2026-10-26T09:00:00.000Z',
  )
})

test('dayList reste consécutif à travers le passage à l\'heure d\'été 2026', () => {
  const days = dayList(new Date('2026-03-27T12:00:00Z'), 5)
  assert.deepEqual(
    days.map(dateKey),
    ['20260327', '20260328', '20260329', '20260330', '20260331'],
  )
})

test('dayList reste consécutif à travers le passage à l\'heure d\'hiver 2026', () => {
  const days = dayList(new Date('2026-10-23T12:00:00Z'), 5)
  assert.deepEqual(
    days.map(dateKey),
    ['20261023', '20261024', '20261025', '20261026', '20261027'],
  )
})

test('toParisParts décompose un instant en heure d\'hiver', () => {
  // 10:00 UTC en décembre (CET, +1) = 11:00 à Paris
  assert.deepEqual(
    toParisParts(new Date('2025-12-09T10:00:00Z')),
    { year: 2025, month: 12, day: 9, hour: 11, minute: 0 },
  )
})

test('toParisParts décompose un instant en heure d\'été', () => {
  // 08:00 UTC en août (CEST, +2) = 10:00 à Paris
  assert.deepEqual(
    toParisParts(new Date('2026-08-08T08:00:00Z')),
    { year: 2026, month: 8, day: 8, hour: 10, minute: 0 },
  )
})

test('toParisParts ramène minuit à Paris à l\'heure 0, pas 24', () => {
  // 23:00 UTC le 8 décembre (CET, +1) = 00:00 le 9 décembre à Paris
  assert.deepEqual(
    toParisParts(new Date('2025-12-08T23:00:00Z')),
    { year: 2025, month: 12, day: 9, hour: 0, minute: 0 },
  )
})

test('parisMidnight rend l\'instant UTC de minuit à Paris en hiver', () => {
  // minuit Paris le 9 décembre 2025 (CET, +1) = 23:00 UTC la veille
  assert.equal(
    parisMidnight(new Date('2025-12-09T10:00:00Z')).toISOString(),
    '2025-12-08T23:00:00.000Z',
  )
})

test('parisMidnight rend l\'instant UTC de minuit à Paris en été', () => {
  // minuit Paris le 8 août 2026 (CEST, +2) = 22:00 UTC la veille
  assert.equal(
    parisMidnight(new Date('2026-08-08T12:00:00Z')).toISOString(),
    '2026-08-07T22:00:00.000Z',
  )
})

test('parisMidnight reste correct un jour de bascule vers l\'heure d\'été', () => {
  // le 29 mars 2026, minuit local est encore en CET (+1) : la bascule a lieu plus tard ce jour-là
  assert.equal(
    parisMidnight(new Date('2026-03-29T12:00:00Z')).toISOString(),
    '2026-03-28T23:00:00.000Z',
  )
})

test('parisMidnight reste correct un jour de bascule vers l\'heure d\'hiver', () => {
  // le 25 octobre 2026, minuit local est encore en CEST (+2) : la bascule a lieu plus tard ce jour-là
  assert.equal(
    parisMidnight(new Date('2026-10-25T12:00:00Z')).toISOString(),
    '2026-10-24T22:00:00.000Z',
  )
})

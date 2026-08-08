const { test } = require('node:test')
const assert = require('node:assert')
const {
  decodeXmlEntities, unfoldIcs, unescapeIcsText, parseIcsDate,
  extractCalendarData, parseEvents,
} = require('../src/ics')

test('decodeXmlEntities décode les entités du calendar-data', () => {
  assert.equal(decodeXmlEntities('R&amp;D &lt;test&gt; &quot;x&quot;'), 'R&D <test> "x"')
})

test('decodeXmlEntities traite &amp; en dernier pour éviter la double décodification', () => {
  assert.equal(decodeXmlEntities('&amp;lt;'), '&lt;')
})

test('decodeXmlEntities décode les entités numériques décimales et hexadécimales', () => {
  assert.equal(decodeXmlEntities('&#13;'), '\r')
  assert.equal(decodeXmlEntities('&#10;'), '\n')
  assert.equal(decodeXmlEntities('&#x0D;'), '\r')
  assert.equal(decodeXmlEntities('&#xE9;'), 'é')
})

test('decodeXmlEntities traite &amp; en dernier pour les entités numériques aussi', () => {
  assert.equal(decodeXmlEntities('&amp;#13;'), '&#13;')
})

test('unfoldIcs recolle les lignes pliées', () => {
  const folded = 'SUMMARY:Réunion très longue\r\n  suite du titre\r\nLOCATION:Paris'
  assert.equal(unfoldIcs(folded), 'SUMMARY:Réunion très longue suite du titre\nLOCATION:Paris')
})

test('unescapeIcsText décode les séquences échappées', () => {
  assert.equal(
    unescapeIcsText('47 Avenue Simón Bolívar\\n75019 Paris\\, France'),
    '47 Avenue Simón Bolívar\n75019 Paris, France',
  )
  assert.equal(unescapeIcsText('a\\;b\\\\c'), 'a;b\\c')
})

test('unescapeIcsText traite \\\\ avant \\n pour ne pas créer de saut de ligne parasite', () => {
  assert.equal(unescapeIcsText('C:\\\\nomFichier'), 'C:\\nomFichier')
})

test('parseIcsDate lit une date-heure UTC', () => {
  const date = parseIcsDate('20251209T090000Z', false)
  assert.equal(date.toISOString(), '2025-12-09T09:00:00.000Z')
})

test('parseIcsDate lit une date seule comme minuit à Paris', () => {
  const date = parseIcsDate('20251201', true)
  // minuit à Paris le 1er décembre = 23:00 UTC le 30 novembre
  assert.equal(date.toISOString(), '2025-11-30T23:00:00.000Z')
})

test('extractCalendarData sort les ICS quel que soit le préfixe de namespace', () => {
  const xml = `<d:multistatus><d:response><cal:calendar-data>BEGIN:VCALENDAR
END:VCALENDAR</cal:calendar-data></d:response></d:multistatus>`
  const found = extractCalendarData(xml)
  assert.equal(found.length, 1)
  assert.match(found[0], /BEGIN:VCALENDAR/)
})

test('parseEvents ignore les DTSTART situés dans un VTIMEZONE', () => {
  const ics = `BEGIN:VCALENDAR
BEGIN:VTIMEZONE
TZID:Europe/Paris
BEGIN:DAYLIGHT
DTSTART:19700329T020000
END:DAYLIGHT
END:VTIMEZONE
BEGIN:VEVENT
SUMMARY:Vrai événement
DTSTART:20251209T090000Z
DTEND:20251209T100000Z
END:VEVENT
END:VCALENDAR`
  const events = parseEvents(ics)
  assert.equal(events.length, 1)
  assert.equal(events[0].summary, 'Vrai événement')
})

test('parseEvents distingue journée entière et horaire', () => {
  const ics = `BEGIN:VCALENDAR
BEGIN:VEVENT
SUMMARY:Avignon
DTSTART;VALUE=DATE:20251201
DTEND;VALUE=DATE:20251202
END:VEVENT
BEGIN:VEVENT
SUMMARY:Réunion IRES des trésoriers
DTSTART:20251209T170000Z
DTEND:20251209T190000Z
LOCATION:47 Avenue Simón Bolívar\\n75019 Paris\\, France
END:VEVENT
END:VCALENDAR`
  const events = parseEvents(ics)
  assert.equal(events.length, 2)
  assert.equal(events[0].allDay, true)
  assert.equal(events[1].allDay, false)
  assert.equal(events[1].location, '47 Avenue Simón Bolívar\n75019 Paris, France')
})

test('parseEvents lit un DTSTART avec TZID sans planter', () => {
  const ics = `BEGIN:VEVENT
SUMMARY:Avec fuseau
DTSTART;TZID=Europe/Paris:20251209T100000
END:VEVENT`
  const events = parseEvents(ics)
  assert.equal(events.length, 1)
  assert.equal(events[0].summary, 'Avec fuseau')
  assert.ok(events[0].start instanceof Date)
})

test('parseEvents ignore un VEVENT sans DTSTART', () => {
  const ics = `BEGIN:VEVENT
SUMMARY:Sans date
END:VEVENT`
  assert.equal(parseEvents(ics).length, 0)
})

test('extractCalendarData + parseEvents gèrent la forme réelle du serveur (fins de ligne en &#13;)', () => {
  const xml = `<cal:calendar-data>BEGIN:VCALENDAR&#13;
VERSION:2.0&#13;
BEGIN:VEVENT&#13;
SUMMARY:Réunion réelle&#13;
DTSTART:20251208T150000Z&#13;
DTEND:20251208T160000Z&#13;
END:VEVENT&#13;
BEGIN:VEVENT&#13;
SUMMARY:Avignon&#13;
DTSTART;VALUE=DATE:20251201&#13;
DTEND;VALUE=DATE:20251202&#13;
END:VEVENT&#13;
END:VCALENDAR&#13;</cal:calendar-data>`
  const [ics] = extractCalendarData(xml)
  const events = parseEvents(ics)
  assert.equal(events.length, 2)
  assert.equal(events[0].summary, 'Réunion réelle')
  assert.equal(events[0].allDay, false)
  assert.equal(events[0].start.toISOString(), '2025-12-08T15:00:00.000Z')
  assert.equal(events[1].summary, 'Avignon')
  assert.equal(events[1].allDay, true)
})

test('extractCalendarData + parseEvents recollent une ligne pliée en forme encodée &#13;', () => {
  const xml = `<cal:calendar-data>BEGIN:VCALENDAR&#13;
BEGIN:VEVENT&#13;
SUMMARY:Réunion très longue&#13;
  suite du titre&#13;
DTSTART:20251209T090000Z&#13;
END:VEVENT&#13;
END:VCALENDAR&#13;</cal:calendar-data>`
  const [ics] = extractCalendarData(xml)
  const events = parseEvents(ics)
  assert.equal(events.length, 1)
  assert.equal(events[0].summary, 'Réunion très longue suite du titre')
})

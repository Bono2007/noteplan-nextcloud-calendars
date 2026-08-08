const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')
const {
  encodeBasicAuth, assertMultistatus, absolutize, originOf, parseCalendarList, calendarHomeUrl,
} = require('../src/caldav')

test('encodeBasicAuth encode en base64, accents compris', () => {
  assert.equal(encodeBasicAuth('a', 'b'), `Basic ${Buffer.from('a:b').toString('base64')}`)
  assert.equal(
    encodeBasicAuth('éà', 'mot2passe'),
    `Basic ${Buffer.from('éà:mot2passe', 'utf8').toString('base64')}`,
  )
})

test('assertMultistatus accepte une réponse valide', () => {
  const xml = '<?xml version="1.0"?><d:multistatus xmlns:d="DAV:"></d:multistatus>'
  assert.equal(assertMultistatus(xml, 'test'), xml)
})

test('assertMultistatus rejette une exception SabreDAV avec son nom', () => {
  const xml = '<d:error><s:exception>Sabre\\DAV\\Exception\\ReportNotSupported</s:exception></d:error>'
  assert.throws(() => assertMultistatus(xml, 'REPORT'), /ReportNotSupported/)
})

test('assertMultistatus rejette une page de connexion HTML', () => {
  assert.throws(
    () => assertMultistatus('<!doctype html><html><body>Login</body></html>', 'REPORT'),
    /identifiants|connexion/i,
  )
})

test('assertMultistatus rejette une réponse vide', () => {
  assert.throws(() => assertMultistatus('', 'REPORT'), /vide|réseau/i)
  assert.throws(() => assertMultistatus(null, 'REPORT'), /vide|réseau/i)
})

// Constat 3 : un serveur Nextcloud peut répondre <d:error> sans <exception> —
// ces réponses ne doivent pas tomber dans le fourre-tout qui déverse du XML brut.

test('assertMultistatus privilégie le contenu de <s:exception> quand <d:error> le contient', () => {
  const xml =
    '<d:error xmlns:d="DAV:" xmlns:s="http://sabredav.org/ns">' +
    '<s:exception>Sabre\\DAV\\Exception\\ServiceUnavailable</s:exception>' +
    '<s:message>Service temporairement indisponible</s:message>' +
    '</d:error>'
  assert.throws(() => assertMultistatus(xml, 'REPORT'), /ServiceUnavailable/)
})

test('assertMultistatus reconnaît <d:error> seule et en extrait le <s:message>', () => {
  const xml =
    '<d:error xmlns:d="DAV:" xmlns:s="http://sabredav.org/ns">' +
    '<s:message>Calendar is currently unavailable, please try again later.</s:message>' +
    '</d:error>'
  assert.throws(() => assertMultistatus(xml, 'REPORT'), (error) => {
    assert.match(error.message, /Calendar is currently unavailable/)
    assert.ok(!/xmlns/.test(error.message), 'le message ne doit pas déverser le XML brut')
    return true
  })
})

test('assertMultistatus reconnaît un <d:error> vide sans déverser de XML brut', () => {
  const xml = '<d:error xmlns:d="DAV:"></d:error>'
  assert.throws(() => assertMultistatus(xml, 'REPORT'), (error) => {
    assert.ok(!/<d:error/.test(error.message), 'le message ne doit pas contenir le XML brut')
    return true
  })
})

test('originOf extrait le schéma et l’hôte', () => {
  assert.equal(originOf('https://mynextcloud.ndd/remote.php/dav/x/'), 'https://mynextcloud.ndd')
})

test('absolutize préfixe un href relatif sans le ré-encoder', () => {
  assert.equal(
    absolutize('/remote.php/dav/calendars/a@b.org/personal_shared_by_COMPAIN%20Marion/', 'https://h.org'),
    'https://h.org/remote.php/dav/calendars/a@b.org/personal_shared_by_COMPAIN%20Marion/',
  )
})

test('absolutize laisse une URL absolue intacte', () => {
  assert.equal(absolutize('https://h.org/x/', 'https://autre.org'), 'https://h.org/x/')
})

// Constat 8 : « ne jamais ré-encoder une URL » vaut aussi pour l'identifiant
// utilisé par calendarHomeUrl — un identifiant déjà encodé ne doit pas subir
// un second encodeURIComponent (qui encoderait le « % » lui-même).

test('calendarHomeUrl encode un identifiant qui ne l’est pas déjà', () => {
  const url = calendarHomeUrl({ serverUrl: 'https://mynextcloud.ndd/remote.php/dav', username: 'personne@exemple.org' })
  assert.equal(url, 'https://mynextcloud.ndd/remote.php/dav/calendars/personne%40exemple.org/')
})

test('calendarHomeUrl n’encode pas une seconde fois un identifiant déjà encodé', () => {
  const url = calendarHomeUrl({ serverUrl: 'https://mynextcloud.ndd/remote.php/dav', username: 'personne%40exemple.org' })
  assert.equal(url, 'https://mynextcloud.ndd/remote.php/dav/calendars/personne%40exemple.org/')
})

test('parseCalendarList ne retient que les collections calendrier nommées', () => {
  const xml = `<d:multistatus xmlns:d="DAV:" xmlns:cal="urn:ietf:params:xml:ns:caldav">
<d:response><d:href>/dav/calendars/u/</d:href><d:propstat><d:prop>
<d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat></d:response>
<d:response><d:href>/dav/calendars/u/perso/</d:href><d:propstat><d:prop>
<d:displayname>Paul Côté (CÔTÉ Paul)</d:displayname>
<d:resourcetype><d:collection/><cal:calendar/></d:resourcetype></d:prop></d:propstat></d:response>
</d:multistatus>`
  const list = parseCalendarList(xml)
  assert.equal(list.length, 1)
  assert.equal(list[0].displayName, 'Paul Côté (CÔTÉ Paul)')
  assert.equal(list[0].href, '/dav/calendars/u/perso/')
})

test('parseCalendarList détecte <cal:calendar/> auto-fermant', () => {
  const xml = `<d:multistatus xmlns:d="DAV:" xmlns:cal="urn:ietf:params:xml:ns:caldav">
<d:response><d:href>/dav/calendars/u/auto/</d:href><d:propstat><d:prop>
<d:displayname>Auto fermant</d:displayname>
<d:resourcetype><d:collection/><cal:calendar/></d:resourcetype></d:prop></d:propstat></d:response>
</d:multistatus>`
  const list = parseCalendarList(xml)
  assert.equal(list.length, 1)
  assert.equal(list[0].displayName, 'Auto fermant')
})

test('parseCalendarList détecte <cal:calendar></cal:calendar> ouvert/fermé', () => {
  const xml = `<d:multistatus xmlns:d="DAV:" xmlns:cal="urn:ietf:params:xml:ns:caldav">
<d:response><d:href>/dav/calendars/u/ouvert/</d:href><d:propstat><d:prop>
<d:displayname>Ouvert fermé</d:displayname>
<d:resourcetype><d:collection/><cal:calendar></cal:calendar></d:resourcetype></d:prop></d:propstat></d:response>
</d:multistatus>`
  const list = parseCalendarList(xml)
  assert.equal(list.length, 1)
  assert.equal(list[0].displayName, 'Ouvert fermé')
})

test('parseCalendarList rejette calendar-proxy-read, ce n’est pas un calendrier', () => {
  const xml = `<d:multistatus xmlns:d="DAV:" xmlns:cal="urn:ietf:params:xml:ns:caldav">
<d:response><d:href>/dav/calendars/u/proxy/</d:href><d:propstat><d:prop>
<d:displayname>Proxy lecture</d:displayname>
<d:resourcetype><d:collection/><cal:calendar-proxy-read/></d:resourcetype></d:prop></d:propstat></d:response>
</d:multistatus>`
  const list = parseCalendarList(xml)
  assert.equal(list.length, 0)
})

// Constat 9 : fixture capturée sur le vrai serveur (anonymisée). Tous les
// autres échantillons de ce module sont écrits à la main avec des données
// idéalisées ; c'est le seul test contre une forme réellement produite par
// le serveur — c'est ce genre d'écart qui a laissé passer le bug du constat 1.

test('parseCalendarList extrait correctement les calendriers d’une vraie réponse serveur (fixture anonymisée)', () => {
  const xml = fs.readFileSync(path.join(__dirname, 'fixtures', 'propfind-calendriers.xml'), 'utf8')
  const list = parseCalendarList(xml)
  assert.equal(list.length, 5)
  const names = list.map((calendar) => calendar.displayName).sort((a, b) => a.localeCompare(b, 'fr'))
  assert.deepEqual(names, [
    'Julien DURAND MARTIN',
    'personal (ROUSSEAU Camille)',
    'UE (AUBRY Damien)',
    'UE (BLANCHARD Anaïs)',
    'UE (de MOREAU Amélie) (DE MOREAU Amélie)',
  ])
  const personal = list.find((calendar) => calendar.displayName === 'Julien DURAND MARTIN')
  assert.equal(personal.href, '/remote.php/dav/calendars/personne@exemple.org/personal/')
})

test('parseCalendarList rejette une réponse qui n’est pas un calendrier du tout', () => {
  const xml = `<d:multistatus xmlns:d="DAV:">
<d:response><d:href>/dav/calendars/u/</d:href><d:propstat><d:prop>
<d:displayname>Racine</d:displayname>
<d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat></d:response>
</d:multistatus>`
  const list = parseCalendarList(xml)
  assert.equal(list.length, 0)
})

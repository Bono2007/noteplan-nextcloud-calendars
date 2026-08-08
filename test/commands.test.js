const { test } = require('node:test')
const assert = require('node:assert')
const {
  groupEventsByDay, readConfig, buildEntriesForDay, distinctErrors, writeDayNote, agendaRafraichir,
} = require('../src/commands')
const { dateKey, dayList } = require('../src/dates')

/** Les commandes s'appuient sur des globales fournies par le runtime NotePlan. */
function withGlobals(values, run) {
  const previous = {}
  for (const key of Object.keys(values)) {
    previous[key] = global[key]
    global[key] = values[key]
  }
  return Promise.resolve()
    .then(run)
    .finally(() => {
      for (const key of Object.keys(values)) {
        if (previous[key] === undefined) delete global[key]
        else global[key] = previous[key]
      }
    })
}

test('groupEventsByDay range chaque événement dans le bon jour', () => {
  const days = [new Date('2025-12-09T12:00:00Z'), new Date('2025-12-10T12:00:00Z')]
  const events = [
    { summary: 'A', start: new Date('2025-12-09T09:00:00Z'), allDay: false },
    { summary: 'B', start: new Date('2025-12-10T09:00:00Z'), allDay: false },
  ]
  const grouped = groupEventsByDay(events, days)
  assert.deepEqual(grouped['20251209'].map((e) => e.summary), ['A'])
  assert.deepEqual(grouped['20251210'].map((e) => e.summary), ['B'])
})

test('groupEventsByDay initialise tous les jours, même vides', () => {
  const days = [new Date('2026-08-08T12:00:00Z')]
  const grouped = groupEventsByDay([], days)
  assert.deepEqual(grouped['20260808'], [])
})

test('groupEventsByDay ignore les événements hors fenêtre', () => {
  const days = [new Date('2025-12-09T12:00:00Z')]
  const grouped = groupEventsByDay(
    [{ summary: 'Hors', start: new Date('2025-12-25T09:00:00Z'), allDay: false }],
    days,
  )
  assert.deepEqual(grouped['20251209'], [])
})

// Constat 2 : la requête CalDAV retourne tout ce qui CHEVAUCHE la fenêtre ;
// un événement doit être rangé dans TOUS les jours de la fenêtre qu'il couvre.

test('groupEventsByDay range un événement sur trois jours dans les trois jours', () => {
  const days = [
    new Date('2026-08-10T12:00:00Z'), new Date('2026-08-11T12:00:00Z'), new Date('2026-08-12T12:00:00Z'),
  ]
  const event = {
    summary: 'Congrès', allDay: false,
    start: new Date('2026-08-10T08:00:00Z'), end: new Date('2026-08-12T16:00:00Z'),
  }
  const grouped = groupEventsByDay([event], days)
  assert.deepEqual(grouped['20260810'].map((e) => e.summary), ['Congrès'])
  assert.deepEqual(grouped['20260811'].map((e) => e.summary), ['Congrès'])
  assert.deepEqual(grouped['20260812'].map((e) => e.summary), ['Congrès'])
})

test('groupEventsByDay affiche dès le premier jour de la fenêtre un événement commencé avant', () => {
  const days = [new Date('2026-08-08T12:00:00Z'), new Date('2026-08-09T12:00:00Z')]
  const event = {
    summary: 'Formation', allDay: false,
    start: new Date('2026-08-06T08:00:00Z'), end: new Date('2026-08-09T16:00:00Z'),
  }
  const grouped = groupEventsByDay([event], days)
  assert.deepEqual(grouped['20260808'].map((e) => e.summary), ['Formation'])
  assert.deepEqual(grouped['20260809'].map((e) => e.summary), ['Formation'])
})

test('groupEventsByDay : journée entière sur deux jours, fin ICS exclusive', () => {
  const days = [
    new Date('2026-08-10T12:00:00Z'), new Date('2026-08-11T12:00:00Z'), new Date('2026-08-12T12:00:00Z'),
  ]
  // DTSTART;VALUE=DATE:20260810 / DTEND;VALUE=DATE:20260812 → couvre le 10 et le 11, pas le 12.
  const event = {
    summary: 'Avignon', allDay: true,
    start: new Date('2026-08-09T22:00:00Z'), end: new Date('2026-08-11T22:00:00Z'),
  }
  const grouped = groupEventsByDay([event], days)
  assert.deepEqual(grouped['20260810'].map((e) => e.summary), ['Avignon'])
  assert.deepEqual(grouped['20260811'].map((e) => e.summary), ['Avignon'])
  assert.deepEqual(grouped['20260812'], [])
})

test('groupEventsByDay : un événement horaire finissant à minuit pile ne déborde pas sur le lendemain', () => {
  const days = [new Date('2026-08-10T12:00:00Z'), new Date('2026-08-11T12:00:00Z')]
  // 20h à Paris (18h UTC en été) au 10, jusqu'à minuit pile à Paris (22h UTC) le 10→11.
  const event = {
    summary: 'Réunion tardive', allDay: false,
    start: new Date('2026-08-10T18:00:00Z'), end: new Date('2026-08-10T22:00:00Z'),
  }
  const grouped = groupEventsByDay([event], days)
  assert.deepEqual(grouped['20260810'].map((e) => e.summary), ['Réunion tardive'])
  assert.deepEqual(grouped['20260811'], [])
})

test('groupEventsByDay : un événement sans date de fin n’occupe que son jour de début', () => {
  const days = [new Date('2026-08-10T12:00:00Z'), new Date('2026-08-11T12:00:00Z')]
  const event = { summary: 'Point rapide', allDay: false, start: new Date('2026-08-10T08:00:00Z'), end: null }
  const grouped = groupEventsByDay([event], days)
  assert.deepEqual(grouped['20260810'].map((e) => e.summary), ['Point rapide'])
  assert.deepEqual(grouped['20260811'], [])
})

test('groupEventsByDay : un événement entièrement hors fenêtre est absent partout', () => {
  const days = [new Date('2026-08-10T12:00:00Z'), new Date('2026-08-11T12:00:00Z')]
  const event = {
    summary: 'Ailleurs', allDay: false,
    start: new Date('2026-08-01T08:00:00Z'), end: new Date('2026-08-02T08:00:00Z'),
  }
  const grouped = groupEventsByDay([event], days)
  assert.deepEqual(grouped['20260810'], [])
  assert.deepEqual(grouped['20260811'], [])
})

test('groupEventsByDay conserve le tri par heure de début au sein d’un même jour', () => {
  const days = [new Date('2026-08-10T12:00:00Z')]
  const late = { summary: 'Tard', allDay: false, start: new Date('2026-08-10T16:00:00Z'), end: null }
  const early = { summary: 'Tôt', allDay: false, start: new Date('2026-08-10T06:00:00Z'), end: null }
  const grouped = groupEventsByDay([late, early], days)
  assert.deepEqual(grouped['20260810'].map((e) => e.summary), ['Tôt', 'Tard'])
})

test('readConfig refuse une configuration incomplète', () => {
  assert.throws(() => readConfig({ serverUrl: '', username: 'a', password: 'b' }), /Racine WebDAV/i)
  assert.throws(() => readConfig({ serverUrl: 'https://x', username: '', password: 'b' }), /identifiant/i)
  assert.throws(() => readConfig({ serverUrl: 'https://x', username: 'a', password: '' }), /mot de passe/i)
})

test('readConfig applique les valeurs par défaut', () => {
  const config = readConfig({ serverUrl: 'https://x', username: 'a', password: 'b' })
  assert.equal(config.daysAhead, 7)
  assert.equal(config.blockTitle, '📅 Agendas partagés')
  assert.deepEqual(config.calendars, [])
})

test('readConfig borne daysAhead entre 1 et 31', () => {
  assert.equal(readConfig({ serverUrl: 'https://x', username: 'a', password: 'b', daysAhead: 0 }).daysAhead, 1)
  assert.equal(readConfig({ serverUrl: 'https://x', username: 'a', password: 'b', daysAhead: 99 }).daysAhead, 31)
})

// Constat 7 : un réglage numérique vidé, absent ou non numérique doit
// retomber sur les 7 jours par défaut — pas sur 1 jour silencieusement.

test('readConfig retombe sur 7 jours quand daysAhead est absent, vide, non numérique ou nul', () => {
  const base = { serverUrl: 'https://x', username: 'a', password: 'b' }
  assert.equal(readConfig(base).daysAhead, 7)
  assert.equal(readConfig({ ...base, daysAhead: '' }).daysAhead, 7)
  assert.equal(readConfig({ ...base, daysAhead: 'texte' }).daysAhead, 7)
  assert.equal(readConfig({ ...base, daysAhead: null }).daysAhead, 7)
})

test('readConfig arrondit une valeur décimale de daysAhead à l’entier', () => {
  assert.equal(readConfig({ serverUrl: 'https://x', username: 'a', password: 'b', daysAhead: 3.7 }).daysAhead, 4)
})

test('buildEntriesForDay évite le doublon quand le Lundi TT tombe le jour affiché', () => {
  const event = { summary: 'Lundi 12/01 - TT', start: new Date('2026-01-12T09:00:00Z'), allDay: false }
  const perCalendar = [
    {
      label: 'X',
      events: [event],
      grouped: { '20260112': [event] },
    },
  ]
  const entries = buildEntriesForDay('20260112', perCalendar)
  const mentions = entries[0].lines.filter((line) => line.includes('Lundi 12/01 - TT'))
  assert.equal(mentions.length, 1)
})

test('buildEntriesForDay affiche le Lundi TT dans les jours qui le précèdent', () => {
  const event = { summary: 'Lundi 12/01 - TT', start: new Date('2026-01-12T09:00:00Z'), allDay: false }
  const perCalendar = [
    {
      label: 'X',
      events: [event],
      grouped: { '20260110': [] },
    },
  ]
  const entries = buildEntriesForDay('20260110', perCalendar)
  assert.deepEqual(entries[0].lines, ['Lundi 12/01 - TT'])
})

test('buildEntriesForDay aplatit un message d’erreur contenant des sauts de ligne (constat 1)', () => {
  const perCalendar = [
    {
      label: 'PC',
      events: [],
      grouped: {},
      error: 'Récupération des événements : réponse inattendue (<html>\n<body>Erreur 503\n</body>\n</html>)',
    },
  ]
  const entries = buildEntriesForDay('20260808', perCalendar)
  assert.equal(entries[0].lines.length, 1)
  assert.equal(entries[0].lines[0].split('\n').length, 1)
})

// Constat 4 : la note d'un jour futur peut être absente. La cascade prévue
// est : essayer de l'obtenir ; sinon la créer via l'URL de rappel PUIS
// RÉESSAYER de l'obtenir ; si elle reste absente, le jour est non traité.

test('writeDayNote écrit directement quand la note existe déjà, sans passer par l’URL', () =>
  withGlobals(
    {
      DataStore: { calendarNoteByDateString: () => ({ content: '## Notes' }) },
      NotePlan: { openURL: async () => { throw new Error('ne doit pas être appelé') } },
    },
    async () => {
      const ok = await writeDayNote('20260810', '> 📅 Agenda Nextcloud : lundi', '📅 Agenda Nextcloud')
      assert.equal(ok, true)
    },
  ))

test('writeDayNote crée la note absente via l’URL puis la récupère avant d’écrire', () => {
  let calls = 0
  const note = { content: '' }
  return withGlobals(
    {
      DataStore: {
        calendarNoteByDateString: () => {
          calls += 1
          return calls === 1 ? null : note
        },
      },
      NotePlan: { openURL: async () => {} },
    },
    async () => {
      const ok = await writeDayNote('20260810', '> 📅 Agenda Nextcloud : lundi', '📅 Agenda Nextcloud')
      assert.equal(ok, true)
      assert.match(note.content, /Agenda Nextcloud/)
    },
  )
})

test('writeDayNote signale l’échec quand la note reste introuvable après création', () =>
  withGlobals(
    {
      DataStore: { calendarNoteByDateString: () => null },
      NotePlan: { openURL: async () => {} },
    },
    async () => {
      const ok = await writeDayNote('20260810', '> 📅 Agenda Nextcloud : lundi', '📅 Agenda Nextcloud')
      assert.equal(ok, false)
    },
  ))

test('writeDayNote retente la récupération même si NotePlan.openURL rejette', () =>
  withGlobals(
    {
      DataStore: { calendarNoteByDateString: () => null },
      NotePlan: { openURL: async () => { throw new Error('timeout callback') } },
    },
    async () => {
      const ok = await writeDayNote('20260810', '> 📅 Agenda Nextcloud : lundi', '📅 Agenda Nextcloud')
      assert.equal(ok, false)
    },
  ))

// Constat 5 : si la note visée est ouverte dans l'éditeur, écrire via
// note.content risque de perdre soit l'écriture du plugin, soit la saisie en
// cours de l'utilisateur (NotePlan gère alors deux tampons distincts).

test('writeDayNote écrit via Editor.content quand la note visée est ouverte dans l’éditeur', () => {
  const note = { filename: '20260810.md', content: '## Notes existantes' }
  return withGlobals(
    {
      DataStore: { calendarNoteByDateString: () => note },
      Editor: { note: { filename: '20260810.md' }, content: '## Notes existantes' },
      NotePlan: { openURL: async () => { throw new Error('ne doit pas être appelé') } },
    },
    async () => {
      const ok = await writeDayNote('20260810', '> 📅 Agenda Nextcloud : lundi', '📅 Agenda Nextcloud')
      assert.equal(ok, true)
      assert.match(global.Editor.content, /Agenda Nextcloud/)
      assert.equal(note.content, '## Notes existantes', 'note.content ne doit pas être écrit en parallèle de Editor.content')
    },
  )
})

test('writeDayNote écrit via note.content quand une autre note est ouverte dans l’éditeur', () => {
  const note = { filename: '20260810.md', content: '## Notes existantes' }
  return withGlobals(
    {
      DataStore: { calendarNoteByDateString: () => note },
      Editor: { note: { filename: 'autre-note.md' }, content: 'contenu sans rapport' },
    },
    async () => {
      const ok = await writeDayNote('20260810', '> 📅 Agenda Nextcloud : lundi', '📅 Agenda Nextcloud')
      assert.equal(ok, true)
      assert.match(note.content, /Agenda Nextcloud/)
      assert.equal(global.Editor.content, 'contenu sans rapport')
    },
  )
})

test('writeDayNote retombe sur note.content quand Editor est absent', () => {
  const note = { filename: '20260810.md', content: '' }
  return withGlobals({ DataStore: { calendarNoteByDateString: () => note } }, async () => {
    const ok = await writeDayNote('20260810', '> 📅 Agenda Nextcloud : lundi', '📅 Agenda Nextcloud')
    assert.equal(ok, true)
    assert.match(note.content, /Agenda Nextcloud/)
  })
})

test('writeDayNote retombe sur note.content quand Editor.note est nul', () => {
  const note = { filename: '20260810.md', content: '' }
  return withGlobals({ DataStore: { calendarNoteByDateString: () => note }, Editor: { note: null } }, async () => {
    const ok = await writeDayNote('20260810', '> 📅 Agenda Nextcloud : lundi', '📅 Agenda Nextcloud')
    assert.equal(ok, true)
    assert.match(note.content, /Agenda Nextcloud/)
  })
})

test('writeDayNote reste défensif si l’accès à Editor lève une exception', () => {
  const note = { filename: '20260810.md', content: '' }
  const brokenEditor = {}
  Object.defineProperty(brokenEditor, 'note', {
    get() { throw new Error('anomalie de la plateforme') },
  })
  return withGlobals({ DataStore: { calendarNoteByDateString: () => note }, Editor: brokenEditor }, async () => {
    const ok = await writeDayNote('20260810', '> 📅 Agenda Nextcloud : lundi', '📅 Agenda Nextcloud')
    assert.equal(ok, true)
    assert.match(note.content, /Agenda Nextcloud/)
  })
})

test('agendaRafraichir distingue les jours mis à jour des jours non traités dans le compte rendu', () => {
  const days = dayList(new Date(), 2)
  const [firstKey, secondKey] = days.map(dateKey)
  const notes = new Map([[firstKey, { content: '' }]])
  const originalFetch = global.fetch
  global.fetch = async () => '<?xml version="1.0"?><d:multistatus xmlns:d="DAV:"></d:multistatus>'
  let promptMessage = ''
  return withGlobals(
    {
      DataStore: {
        settings: {
          serverUrl: 'https://x', username: 'a', password: 'b', daysAhead: 2,
          calendars: [{ href: '/cal/', label: 'X' }],
        },
        calendarNoteByDateString: (key) => notes.get(key) || null,
      },
      NotePlan: { openURL: async () => {} },
      CommandBar: { prompt: async (title, message) => { promptMessage = message } },
    },
    async () => {
      await agendaRafraichir()
      assert.match(promptMessage, /1 jour\(s\) mis à jour/)
      assert.match(promptMessage, new RegExp(`jours non traités.*${secondKey}`))
    },
  ).finally(() => {
    global.fetch = originalFetch
  })
})

test('distinctErrors ne répète pas les messages identiques', () => {
  const perCalendar = [{ error: 'Identifiants invalides' }, { error: 'Serveur injoignable' }, { error: 'Identifiants invalides' }]
  assert.deepEqual(distinctErrors(perCalendar), ['Identifiants invalides', 'Serveur injoignable'])
})

const { dateKey, dayList, windowBounds, parisMidnight, toParisParts, DAY_MS } = require('./dates')
const { discoverCalendars, fetchEvents } = require('./caldav')
const { guessLabel, isMondayTT, formatEventLine, buildDayBlock, flattenWhitespace } = require('./format')
const { replaceBlock } = require('./noteplan')

const NOM_PLUGIN = 'Agendas Nextcloud'
const DEFAULT_BLOCK_TITLE = '📅 Agendas partagés'

/**
 * Une valeur absente, vide ou non numérique doit retomber sur les 7 jours
 * par défaut, pas sur 1 jour : un champ vidé par inadvertance dans les
 * préférences ne doit pas réduire silencieusement la fenêtre à la seule
 * journée courante.
 */
function readDaysAhead(rawValue) {
  const value = typeof rawValue === 'string' ? rawValue.trim() : rawValue
  if (value === undefined || value === null || value === '') return 7
  const number = Number(value)
  if (!Number.isFinite(number)) return 7
  const rounded = Math.round(number)
  if (rounded < 1) return 1
  if (rounded > 31) return 31
  return rounded
}

function readConfig(settings) {
  const source = settings || {}
  const serverUrl = String(source.serverUrl || '').trim()
  const username = String(source.username || '').trim()
  const password = String(source.password || '').trim()
  if (!serverUrl) throw new Error('Racine WebDAV manquante : renseignez-la dans les préférences du plugin.')
  if (!username) throw new Error('Identifiant CalDAV manquant : renseignez-le dans les préférences du plugin.')
  if (!password) throw new Error('Mot de passe CalDAV manquant : renseignez-le dans les préférences du plugin.')

  const daysAhead = readDaysAhead(source.daysAhead)

  return {
    serverUrl,
    username,
    password,
    daysAhead,
    blockTitle: String(source.blockTitle || '').trim() || DEFAULT_BLOCK_TITLE,
    calendars: Array.isArray(source.calendars) ? source.calendars : [],
  }
}

/**
 * Clé du jour calendaire (Paris) précédant celui de `date`. Passe par
 * parisMidnight + une marge d'une demi-journée (comme dayList) plutôt que par
 * une simple soustraction de 24h, pour rester correct autour des changements
 * d'heure d'été/hiver.
 */
function previousDayKey(date) {
  const midnight = parisMidnight(date)
  return dateKey(new Date(midnight.getTime() - DAY_MS / 2))
}

/**
 * Dernier jour (clé Paris) couvert par un événement.
 * - Pas de fin : seul le jour de début est occupé.
 * - Journée entière : DTEND ICS est EXCLUSIVE, le dernier jour affiché est
 *   donc la veille de la date de fin.
 * - Horaire finissant à minuit pile (Paris) : le jour de fin n'est pas
 *   occupé, l'événement s'arrête avant qu'il ne commence.
 * - Horaire finissant à toute autre heure : le jour de fin est occupé.
 */
function lastCoveredDayKey(event) {
  if (!event.end) return dateKey(event.start)
  if (event.allDay) return previousDayKey(event.end)
  const { hour, minute } = toParisParts(event.end)
  if (hour === 0 && minute === 0) return previousDayKey(event.end)
  return dateKey(event.end)
}

/**
 * La requête CalDAV retourne tout ce qui CHEVAUCHE la fenêtre : un événement
 * sur plusieurs jours doit donc être rangé dans CHACUN des jours de la
 * fenêtre qu'il couvre (bornés à `days`), pas seulement à son jour de début —
 * sans quoi un événement commencé avant la fenêtre et non terminé disparaît
 * purement et simplement.
 */
function groupEventsByDay(events, days) {
  const grouped = {}
  for (const day of days) grouped[dateKey(day)] = []
  for (const event of events) {
    if (!event.start) continue
    const startKey = dateKey(event.start)
    const endKey = lastCoveredDayKey(event)
    for (const day of days) {
      const key = dateKey(day)
      if (key >= startKey && key <= endKey) grouped[key].push(event)
    }
  }
  for (const key of Object.keys(grouped)) {
    grouped[key].sort((a, b) => (a.start ? a.start.getTime() : 0) - (b.start ? b.start.getTime() : 0))
  }
  return grouped
}

/**
 * Lundis TT : visibles même au-delà du jour traité, c'est tout leur intérêt.
 * La déduplication se fait sur le RÉSUMÉ des événements déjà présents ce
 * jour-là, pas sur les lignes déjà formatées (qui portent l'heure en préfixe
 * et ne peuvent donc jamais correspondre au résumé brut).
 */
function buildEntriesForDay(dayKey, perCalendar) {
  return perCalendar.map((calendar) => {
    if (calendar.error) {
      return { label: calendar.label, lines: [`⚠️ ${flattenWhitespace(calendar.error)}`] }
    }
    const dayEvents = calendar.grouped[dayKey] || []
    const daySummaries = new Set(dayEvents.map((event) => flattenWhitespace(event.summary)))
    const lines = dayEvents.map(formatEventLine)
    const mondays = calendar.events
      .filter((event) => isMondayTT(event.summary))
      .map((event) => flattenWhitespace(event.summary))
    for (const monday of mondays) {
      if (!daySummaries.has(monday)) lines.push(monday)
    }
    return { label: calendar.label, lines }
  })
}

/** Messages d'erreur distincts, dans l'ordre de première apparition. */
function distinctErrors(perCalendar) {
  const messages = []
  for (const calendar of perCalendar) {
    const message = calendar.error || 'cause inconnue'
    if (!messages.includes(message)) messages.push(message)
  }
  return messages
}

/**
 * La fenêtre réseau couvre toujours config.daysAhead, même quand on ne rend
 * qu'un seul jour (bloc du jour) : les Lundis TT doivent être vus à l'avance.
 */
async function collect(config, days) {
  const { from, to } = windowBounds(days[0], config.daysAhead)
  const perCalendar = []
  for (const calendar of config.calendars) {
    try {
      const events = await fetchEvents(config, calendar.href, from, to)
      perCalendar.push({
        label: calendar.label,
        events,
        grouped: groupEventsByDay(events, days),
      })
    } catch (error) {
      perCalendar.push({
        label: calendar.label,
        events: [],
        grouped: {},
        error: error && error.message ? error.message : String(error),
      })
    }
  }
  return perCalendar
}

/**
 * Vrai si `note` est celle actuellement ouverte dans l'éditeur (comparaison
 * par nom de fichier). Défensif par construction : Editor peut être absent de
 * l'environnement, sa note peut être nulle, toute anomalie retombe sur false
 * plutôt que d'interrompre l'écriture.
 */
function isNoteOpenInEditor(note) {
  try {
    if (!note || typeof Editor === 'undefined' || !Editor || !Editor.note) return false
    return Editor.note.filename === note.filename
  } catch (error) {
    return false
  }
}

/**
 * Écrit le bloc dans la note du jour `key`, en gérant la note absente.
 * Cascade prévue par la spécification : essayer d'obtenir la note ; si
 * absente, la créer via l'URL de rappel PUIS RETENTER de l'obtenir ; si elle
 * reste introuvable, le jour est considéré non traité (retourne false) sans
 * lever d'exception, pour ne pas interrompre le traitement des autres jours.
 *
 * NotePlan.openURL ne garantit pas que son rejet signifie un échec réel de la
 * création (le catch peut ne jamais se déclencher en pratique) : on ignore
 * son issue et on se fie uniquement à la nouvelle lecture de la note.
 *
 * Si la note visée est celle actuellement ouverte dans l'éditeur, l'écriture
 * passe par Editor plutôt que par l'objet note : NotePlan gère alors deux
 * tampons distincts, et écrire dans le mauvais perd soit la mise à jour du
 * plugin, soit la saisie en cours de l'utilisateur.
 */
async function writeDayNote(key, block, blockTitle) {
  let note = DataStore.calendarNoteByDateString(key)
  if (!note) {
    const url =
      'noteplan://x-callback-url/addText?noteDate=' + key +
      '&mode=prepend&openNote=no&text=' + encodeURIComponent(`${block}\n`)
    try {
      await NotePlan.openURL(url)
    } catch (error) {
      // ignoré volontairement : la vérification se fait juste après par relecture
    }
    note = DataStore.calendarNoteByDateString(key)
  }
  if (!note) return false
  if (isNoteOpenInEditor(note)) {
    Editor.content = replaceBlock(Editor.content || '', blockTitle, block)
  } else {
    note.content = replaceBlock(note.content || '', blockTitle, block)
  }
  return true
}

async function agendaRafraichir() {
  let config
  try {
    config = readConfig(DataStore.settings)
  } catch (error) {
    await CommandBar.prompt(NOM_PLUGIN, error.message)
    return
  }
  if (!config.calendars.length) {
    await CommandBar.prompt(
      NOM_PLUGIN,
      'Aucun calendrier suivi. Lancez d’abord « Agendas Nextcloud : choisir les calendriers ».',
    )
    return
  }

  const days = dayList(new Date(), config.daysAhead)
  const perCalendar = await collect(config, days)

  const allFailed = perCalendar.every((calendar) => calendar.error)
  if (allFailed) {
    const messages = distinctErrors(perCalendar)
    await CommandBar.prompt(
      `${NOM_PLUGIN} — échec`,
      `Aucun calendrier n’a répondu, aucune note n’a été modifiée.\n\n${messages.join('\n')}`,
    )
    return
  }

  let written = 0
  const failedDays = []
  for (const day of days) {
    const key = dateKey(day)
    const block = buildDayBlock({
      date: day,
      blockTitle: config.blockTitle,
      entries: buildEntriesForDay(key, perCalendar),
    })
    let ok
    try {
      ok = await writeDayNote(key, block, config.blockTitle)
    } catch (error) {
      ok = false
    }
    if (ok) written += 1
    else failedDays.push(key)
  }

  const errors = perCalendar.filter((calendar) => calendar.error).length
  const total = perCalendar.reduce((sum, calendar) => sum + calendar.events.length, 0)
  const parts = [`${written} jour(s) mis à jour`, `${total} événement(s)`]
  if (errors) parts.push(`${errors} calendrier(s) en erreur`)
  if (failedDays.length) parts.push(`jours non traités : ${failedDays.join(', ')}`)
  await CommandBar.prompt(NOM_PLUGIN, parts.join(' — '))
}

async function agendaBlocDuJour() {
  let config
  try {
    config = readConfig(DataStore.settings)
  } catch (error) {
    return `**${NOM_PLUGIN} indisponible** : ${error.message}`
  }
  if (!config.calendars.length) return `**${NOM_PLUGIN}** : aucun calendrier suivi.`

  const days = dayList(new Date(), 1)
  try {
    const perCalendar = await collect(config, days)
    return buildDayBlock({
      date: days[0],
      blockTitle: config.blockTitle,
      entries: buildEntriesForDay(dateKey(days[0]), perCalendar),
    })
  } catch (error) {
    return `**${NOM_PLUGIN} indisponible** : ${error && error.message ? error.message : error}`
  }
}

async function agendaChoisirCalendriers() {
  let config
  try {
    config = readConfig(DataStore.settings)
  } catch (error) {
    await CommandBar.prompt(NOM_PLUGIN, error.message)
    return
  }

  let available
  try {
    available = await discoverCalendars(config)
  } catch (error) {
    await CommandBar.prompt(`${NOM_PLUGIN} — découverte impossible`, error.message)
    return
  }
  if (!available.length) {
    await CommandBar.prompt(NOM_PLUGIN, 'Aucun calendrier trouvé sur le serveur.')
    return
  }

  const selected = new Map()
  for (const calendar of config.calendars) selected.set(calendar.href, calendar)

  // Étiquettes connues avant toute manipulation : un décoche/recoche dans la
  // même session doit retrouver l'étiquette personnalisée, pas la redéduire.
  const knownLabels = new Map()
  for (const calendar of config.calendars) knownLabels.set(calendar.href, calendar.label)

  // showOptions ne rend qu'un choix : on boucle jusqu'à « Terminer ».
  for (;;) {
    const options = ['✓ Terminer la sélection'].concat(
      available.map((calendar) => `${selected.has(calendar.href) ? '● ' : '   '}${calendar.displayName}`),
    )
    const choice = await CommandBar.showOptions(options, 'Calendriers à suivre')
    if (!choice || choice.index === undefined || choice.index <= 0) break
    const calendar = available[choice.index - 1]
    if (selected.has(calendar.href)) {
      selected.delete(calendar.href)
    } else {
      selected.set(calendar.href, {
        href: calendar.href,
        displayName: calendar.displayName,
        label: knownLabels.has(calendar.href) ? knownLabels.get(calendar.href) : guessLabel(calendar.displayName),
      })
    }
  }

  const chosen = Array.from(selected.values())
  for (const calendar of chosen) {
    const answer = await CommandBar.textPrompt(
      'Étiquette',
      `Étiquette pour « ${calendar.displayName} »`,
      calendar.label,
    )
    if (answer) calendar.label = String(answer).trim()
  }

  DataStore.settings = Object.assign({}, DataStore.settings, { calendars: chosen })
  await CommandBar.prompt(
    NOM_PLUGIN,
    chosen.length
      ? `${chosen.length} calendrier(s) suivi(s) : ${chosen.map((c) => c.label).join(', ')}`
      : 'Aucun calendrier suivi.',
  )
}

module.exports = {
  NOM_PLUGIN, DEFAULT_BLOCK_TITLE, readConfig, groupEventsByDay, buildEntriesForDay, distinctErrors,
  collect, writeDayNote, agendaRafraichir, agendaBlocDuJour, agendaChoisirCalendriers,
}

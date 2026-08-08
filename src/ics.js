const { parisLocalFromParts } = require('./dates')

/**
 * Le & doit être décodé en DERNIER, sinon "&amp;lt;" donnerait "<"
 * au lieu de "&lt;". Même règle pour les entités numériques : le serveur
 * CalDAV encode les fins de ligne en "&#13;" (retour chariot) — décoder ces
 * entités avant &amp; évite qu'une séquence littérale "&amp;#13;" (qui doit
 * rester le texte "&#13;") ne soit prise à tort pour un retour chariot.
 */
function decodeXmlEntities(text) {
  return String(text || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_match, dec) => String.fromCharCode(Number(dec)))
    .replace(/&amp;/g, '&')
}

/** Les lignes ICS > 75 octets sont pliées : la suite commence par un blanc. */
function unfoldIcs(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n[ \t]/g, '')
}

/**
 * Passe unique, comme decodeXmlEntities : \\ doit être reconnu AVANT \n,
 * sinon deux backslashes suivis d'un "n" (ex. "C:\\nomFichier") seraient
 * mal interprétés comme un backslash puis un saut de ligne \n, au lieu
 * d'un unique backslash littéral suivi de "nomFichier". Des remplacements
 * successifs (comme précédemment) rescannent le texte déjà transformé et
 * retombent dans ce piège ; une seule passe avec alternance ordonnée l'évite.
 */
function unescapeIcsText(value) {
  return String(value || '').replace(/\\\\|\\n|\\,|\\;/gi, (token) => {
    switch (token.toLowerCase()) {
      case '\\\\':
        return '\\'
      case '\\n':
        return '\n'
      case '\\,':
        return ','
      case '\\;':
        return ';'
      default:
        return token
    }
  })
}

/**
 * `isDateOnly` : DTSTART;VALUE=DATE:20251201 → minuit à Paris.
 * Sinon : 20251209T090000Z (UTC) ou 20251209T100000 (heure locale de Paris).
 */
function parseIcsDate(raw, isDateOnly) {
  const value = String(raw || '').trim()
  if (isDateOnly || /^\d{8}$/.test(value)) {
    const year = Number(value.slice(0, 4))
    const month = Number(value.slice(4, 6))
    const day = Number(value.slice(6, 8))
    // parisLocalFromParts vient de dates.js — ne pas réimplémenter ici.
    return parisLocalFromParts(year, month, day, 0, 0, 0)
  }
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/.exec(value)
  if (!match) return null
  const [, y, mo, d, h, mi, s, zulu] = match
  if (zulu === 'Z') {
    return new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s))
  }
  return parisLocalFromParts(+y, +mo, +d, +h, +mi, +s)
}

function extractCalendarData(xml) {
  const blocks = String(xml || '').match(
    /<[a-z0-9]*:?calendar-data[^>]*>([\s\S]*?)<\/[a-z0-9]*:?calendar-data>/gi,
  )
  if (!blocks) return []
  return blocks
    .map((block) => {
      const inner = /<[a-z0-9]*:?calendar-data[^>]*>([\s\S]*?)<\/[a-z0-9]*:?calendar-data>/i.exec(block)
      return inner ? decodeXmlEntities(inner[1]) : ''
    })
    .filter((value) => value.trim().length > 0)
}

function parseEvents(ics) {
  const lines = unfoldIcs(ics).split('\n')
  const events = []
  let current = null

  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed === 'BEGIN:VEVENT') {
      current = { summary: '', location: '', start: null, end: null, allDay: false }
      continue
    }
    if (trimmed === 'END:VEVENT') {
      if (current && current.start) events.push(current)
      current = null
      continue
    }
    if (!current) {
      // Hors VEVENT : on ignore tout, y compris les DTSTART des VTIMEZONE.
      continue
    }

    const separator = trimmed.indexOf(':')
    if (separator === -1) continue
    const rawName = trimmed.slice(0, separator)
    const value = trimmed.slice(separator + 1)
    const name = rawName.split(';')[0].toUpperCase()
    const isDateOnly = /VALUE=DATE(?!-)/i.test(rawName)

    if (name === 'SUMMARY') current.summary = unescapeIcsText(value)
    else if (name === 'LOCATION') current.location = unescapeIcsText(value)
    else if (name === 'DTSTART') {
      current.start = parseIcsDate(value, isDateOnly)
      current.allDay = isDateOnly || /^\d{8}$/.test(value.trim())
    } else if (name === 'DTEND') {
      current.end = parseIcsDate(value, isDateOnly)
    }
  }
  return events
}

module.exports = {
  decodeXmlEntities, unfoldIcs, unescapeIcsText, parseIcsDate,
  extractCalendarData, parseEvents,
}
